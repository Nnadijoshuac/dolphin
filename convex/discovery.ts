/**
 * DISCOVERY: finding candidates, and writing as little as possible about them.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS REPLACES
 * ---------------------------------------------------------------------------
 * convex/discoveryPipeline.ts ran three sweep paths - a 78-term vocabulary
 * search, a descending tail, and a resumable ascending offset backfill over the
 * whole registry - and wrote a row for every record any of them saw. 257,991
 * rows, of which 251,922 recorded a string-only rejection. It took the
 * deployment over its storage ceiling and has been switched off since
 * 2026-09-02.
 *
 * Two changes remove all of it:
 *
 *   1. ASK THE SOURCE FOR THE RIGHT RECORDS. `has_a2a=true` returns 27,742 of
 *      307,559; `has_mcp=true` returns 5,474. An agent with neither publishes no
 *      door to knock on and can never be hired through Dolphin, so the other 89%
 *      of the registry was never worth reading.
 *
 *   2. GO INCREMENTAL BY TIME, NOT BY OFFSET. `created_after=<high-water mark>`
 *      returns exactly the new registrations - ~1,348/day on BSC mainnet - so
 *      the steady state is a handful of pages every half hour with no cursor
 *      arithmetic and no possibility of re-walking what has already been judged.
 *
 * The screen still runs, and it still rejects most of what it sees. It just
 * does not write anything down: rejections are COUNTED into the cursor row.
 *
 * ---------------------------------------------------------------------------
 * THE FILTER IS AN OPTIMISATION, NEVER A DEPENDENCY
 * ---------------------------------------------------------------------------
 * Measured 2026-09-07: `has_a2a` takes ~35s and returns HTTP 500 intermittently
 * at ~10.5s, which is a server-side query timeout rather than an auth problem -
 * and several sibling filters fail that way every time. So every filtered call
 * is retried, and after FILTER_FAILURES_BEFORE_FALLBACK consecutive failures the
 * cycle falls back to the unfiltered walk with a client-side check on
 * `supported_protocols`, which is present and correct in the list payload
 * (verified: 100/100 on a filtered page).
 *
 * Discovery then degrades in SPEED and never in correctness, and
 * `discoveryCursor.filterFailures` is how an operator sees that it has.
 */

import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, action, query } from "./_generated/server";
import { screenAgent, SCREEN_RULES } from "./lib/screen";
import {
  PAGE_SIZE,
  REQUEST_CONCURRENCY,
  ScanError,
  fetchAgentPage,
  hasCallableProtocol,
  withConcurrency,
  withRetry,
  type ScanListItem,
} from "./sources/scan8004";

const CURSOR_KEY = "bsc";

/**
 * Wall-clock budget for one discovery run.
 *
 * A Convex-runtime action is killed at 30 minutes (Node-runtime actions at 10;
 * these run in the Convex runtime). Four minutes is far inside that on purpose:
 * this runs every 30 minutes and only ever has ~1,348 records a day to look at,
 * so a long run means something is wrong and should end rather than grind.
 */
const RUN_BUDGET_MS = 240_000;

/** Pages of the one-time backfill to attempt per cycle. */
const BACKFILL_PAGES_PER_RUN = 8;

/** After this many consecutive filter failures, walk unfiltered instead. */
const FILTER_FAILURES_BEFORE_FALLBACK = 3;

export interface DiscoveryReport {
  mode: "incremental" | "backfill" | "fallback";
  pages: number;
  seen: number;
  malformed: number;
  screenedOut: number;
  noCallableProtocol: number;
  candidates: number;
  newCandidates: number;
  screenByRule: Record<string, number>;
  registryTotal: number | null;
  lastCreatedAtBefore: string | null;
  lastCreatedAtAfter: string | null;
  backfillOffset: number;
  elapsedMs: number;
  errors: string[];
}

/* ---------------------------------------------------------------------------
 * THE RUN
 * ------------------------------------------------------------------------ */

export const run = internalAction({
  args: {
    /** Force the one-time backfill even when the incremental cursor is set. */
    backfill: v.optional(v.boolean()),
    budgetMs: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<DiscoveryReport> => {
    const startedAt = Date.now();
    const budget = args.budgetMs ?? RUN_BUDGET_MS;
    const errors: string[] = [];
    const note = (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (errors.length < 20) errors.push(message);
    };

    const state = await ctx.runQuery(internal.discovery.readCursor, {});
    const lastCreatedAtBefore = state?.lastCreatedAt ?? null;
    const backfillDone = state?.backfillCompletedAt !== null && state?.backfillCompletedAt !== undefined;
    const useBackfill = args.backfill === true || !backfillDone;

    const seen = new Map<string, ScanListItem>();
    let pages = 0;
    let malformed = 0;
    let registryTotal: number | null = null;
    let filterFailed = false;

    const collect = (page: { items: ScanListItem[]; total: number | null; malformed: number }) => {
      if (page.total !== null) registryTotal = page.total;
      malformed += page.malformed;
      for (const item of page.items) {
        if (!seen.has(item.agentKey)) seen.set(item.agentKey, item);
      }
      return page.items.length + page.malformed;
    };

    /*
     * The filtered query, with the unfiltered walk behind it.
     *
     * `is_active=any` deliberately: 8004scan's `is_active` is the OWNER-DECLARED
     * `active` field from metadata, not an observation, and Dolphin makes its
     * own liveness call. Excluding on it would drop agents whose publisher never
     * set the flag.
     */
    const fetchFiltered = async (params: string): Promise<number> => {
      try {
        return collect(await withRetry(() => fetchAgentPage(params)));
      } catch (cause) {
        if (cause instanceof ScanError && cause.retryable) filterFailed = true;
        note(cause);
        return 0;
      }
    };

    let mode: DiscoveryReport["mode"] = useBackfill ? "backfill" : "incremental";
    let backfillOffset = state?.backfillOffset ?? 0;
    let backfillPhase = state?.backfillPhase ?? "a2a";
    let backfillCompletedAt = state?.backfillCompletedAt ?? null;

    const filterUnavailable = (state?.filterFailures ?? 0) >= FILTER_FAILURES_BEFORE_FALLBACK;
    if (filterUnavailable) mode = "fallback";

    if (mode === "incremental") {
      /*
       * THE STEADY STATE. `created_after` with an ascending sort is a
       * high-water mark: token ids only increase and a registration's
       * `created_at` never changes, so this returns exactly what is new and
       * cannot re-return what has already been judged. No offset, no cursor
       * drift, no MAX_RECORDS_PER_SWEEP.
       */
      const since = lastCreatedAtBefore ?? new Date(Date.now() - 86_400_000).toISOString();
      for (let page = 0; page < 30; page++) {
        if (Date.now() > startedAt + budget) break;
        pages++;
        const count = await fetchFiltered(
          `is_active=any&created_after=${encodeURIComponent(since)}` +
            `&sort_by=created_at&sort_order=asc&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`,
        );
        if (count < PAGE_SIZE) break;
      }
    } else if (mode === "backfill") {
      /*
       * THE ONE-TIME CATCH-UP over the population that already exists. Walks
       * `has_a2a=true` (27,806) then `has_mcp=true` (5,474) rather than the
       * whole registry (307,559) - roughly 330 pages instead of 3,076.
       *
       * -------------------------------------------------------------------
       * NEWEST FIRST, AND THE FIRST RUN IS WHY (measured 2026-09-07)
       * -------------------------------------------------------------------
       * This walked `created_at asc` on the reasoning that an ascending offset
       * walk is stable under insertion: new rows append at the end and never
       * shift an offset already read. That is true, and it is the wrong end to
       * start from. The first live run probed 60 of the registry's OLDEST
       * A2A registrations - token ids 705, 728, 2115 - and found zero live
       * agents. Oldest-first means walking the dead end of the registry first
       * and spending days there before reaching anything worth listing.
       *
       * Descending is safe for a different reason, and the direction matters:
       * inserting a record pushes everything to a HIGHER offset, so an offset
       * walk that has read 0..799 and next reads 800..899 re-sees records it
       * already judged. It over-reads under insertion; it cannot skip. Since
       * every write here is an idempotent upsert on agentKey, re-seeing costs
       * one wasted comparison and nothing else - whereas skipping would lose an
       * agent silently, which is what ascending protects against and descending
       * does not need protecting against.
       *
       * So: safe in the way that matters, and it front-loads the registrations
       * most likely to still answer.
       */
      const filter = backfillPhase === "mcp" ? "has_mcp=true" : "has_a2a=true";
      const offsets = Array.from(
        { length: BACKFILL_PAGES_PER_RUN },
        (_, i) => backfillOffset + i * PAGE_SIZE,
      );
      let shortPage = false;
      await withConcurrency(
        offsets.map((offset) => async () => {
          if (Date.now() > startedAt + budget) return;
          pages++;
          const count = await fetchFiltered(
            `is_active=any&${filter}&sort_by=created_at&sort_order=desc` +
              `&limit=${PAGE_SIZE}&offset=${offset}`,
          );
          if (count < PAGE_SIZE) shortPage = true;
        }),
        REQUEST_CONCURRENCY,
        note,
      );
      backfillOffset += offsets.length * PAGE_SIZE;

      if (shortPage) {
        // Walked off the end of this filter. Move to the next phase, or finish.
        if (backfillPhase === "a2a") {
          backfillPhase = "mcp";
          backfillOffset = 0;
        } else {
          backfillPhase = "done";
          backfillOffset = 0;
          backfillCompletedAt = new Date().toISOString();
        }
      }
    } else {
      /*
       * FALLBACK. The filter has failed repeatedly, so walk unfiltered and do
       * the protocol check here instead. Slower and correct, rather than
       * stopped.
       */
      for (let page = 0; page < BACKFILL_PAGES_PER_RUN; page++) {
        if (Date.now() > startedAt + budget) break;
        pages++;
        const count = await fetchFiltered(
          `is_active=any&sort_by=created_at&sort_order=desc` +
            `&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`,
        );
        if (count < PAGE_SIZE) break;
      }
    }

    /* ---------------------------------------------------------------------
     * JUDGE EVERYTHING SEEN. Nothing below writes a rejection.
     * ------------------------------------------------------------------ */
    const screenByRule: Record<string, number> = Object.fromEntries(
      SCREEN_RULES.map((rule) => [rule, 0]),
    );
    let screenedOut = 0;
    let noCallableProtocol = 0;
    const candidates: {
      agentKey: string;
      sourceUpdatedAt: string | null;
    }[] = [];
    let newestCreatedAt = lastCreatedAtBefore;

    for (const item of seen.values()) {
      // Track the high-water mark over EVERY record seen, judged or not - a
      // rejected record still advances the cursor, which is what stops the next
      // cycle re-reading it.
      if (item.createdAt && (newestCreatedAt === null || item.createdAt > newestCreatedAt)) {
        newestCreatedAt = item.createdAt;
      }

      if (!hasCallableProtocol(item)) {
        noCallableProtocol++;
        continue;
      }

      const screen = screenAgent(item.name, item.description);
      if (screen.verdict === "reject") {
        screenedOut++;
        if (screen.rule) screenByRule[screen.rule] = (screenByRule[screen.rule] ?? 0) + 1;
        continue;
      }

      candidates.push({ agentKey: item.agentKey, sourceUpdatedAt: item.updatedAt });
    }

    // One narrow row per candidate that has an endpoint, queued for probing.
    let newCandidates = 0;
    for (let i = 0; i < candidates.length; i += 200) {
      const outcome = await ctx.runMutation(internal.discovery.enqueueCandidates, {
        candidates: candidates.slice(i, i + 200),
      });
      newCandidates += outcome.inserted;
    }

    const elapsedMs = Date.now() - startedAt;
    const summary =
      `${mode}: ${pages} pages, ${seen.size} records; ${candidates.length} candidates ` +
      `(${newCandidates} new); ${screenedOut} screened out, ${noCallableProtocol} with no ` +
      `callable protocol, ${malformed} malformed; ${elapsedMs}ms`;

    await ctx.runMutation(internal.discovery.writeCursor, {
      lastCreatedAt: newestCreatedAt,
      backfillOffset,
      backfillCompletedAt,
      backfillPhase,
      registryTotal,
      lastRunAt: new Date().toISOString(),
      lastRunSummary: summary,
      addSeen: seen.size,
      addScreenedOut: screenedOut + noCallableProtocol,
      addCandidates: candidates.length,
      // A successful filtered call RESETS the counter, so a single bad minute
      // does not permanently demote discovery to the slow path.
      filterFailureDelta: filterFailed ? 1 : -(state?.filterFailures ?? 0),
    });

    return {
      mode,
      pages,
      seen: seen.size,
      malformed,
      screenedOut,
      noCallableProtocol,
      candidates: candidates.length,
      newCandidates,
      screenByRule,
      registryTotal,
      lastCreatedAtBefore,
      lastCreatedAtAfter: newestCreatedAt,
      backfillOffset,
      elapsedMs,
      errors,
    };
  },
});

/* ---------------------------------------------------------------------------
 * Mutations and queries
 * ------------------------------------------------------------------------ */

export const readCursor = internalQuery({
  args: {},
  handler: async (ctx) =>
    ctx.db
      .query("discoveryCursor")
      .withIndex("by_key", (q) => q.eq("key", CURSOR_KEY))
      .unique(),
});

export const writeCursor = internalMutation({
  args: {
    lastCreatedAt: v.union(v.string(), v.null()),
    backfillOffset: v.number(),
    backfillCompletedAt: v.union(v.string(), v.null()),
    backfillPhase: v.union(v.literal("a2a"), v.literal("mcp"), v.literal("done")),
    registryTotal: v.union(v.number(), v.null()),
    lastRunAt: v.string(),
    lastRunSummary: v.string(),
    addSeen: v.number(),
    addScreenedOut: v.number(),
    addCandidates: v.number(),
    filterFailureDelta: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("discoveryCursor")
      .withIndex("by_key", (q) => q.eq("key", CURSOR_KEY))
      .unique();

    const patch = {
      lastCreatedAt: args.lastCreatedAt,
      backfillOffset: args.backfillOffset,
      backfillCompletedAt: args.backfillCompletedAt,
      backfillPhase: args.backfillPhase,
      registryTotal: args.registryTotal,
      lastRunAt: args.lastRunAt,
      lastRunSummary: args.lastRunSummary,
      seenTotal: (existing?.seenTotal ?? 0) + args.addSeen,
      screenedOut: (existing?.screenedOut ?? 0) + args.addScreenedOut,
      candidatesFound: (existing?.candidatesFound ?? 0) + args.addCandidates,
      filterFailures: Math.max(0, (existing?.filterFailures ?? 0) + args.filterFailureDelta),
    };

    if (existing) await ctx.db.patch(existing._id, patch);
    else await ctx.db.insert("discoveryCursor", { key: CURSOR_KEY, ...patch });
  },
});

/**
 * Queues candidates for verification.
 *
 * IDEMPOTENT BY CONSTRUCTION: an upsert on `agentKey`, so running discovery
 * twice produces the same rows. An existing row's probe state is NEVER reset
 * here - re-seeing an agent is not evidence about whether it works, and
 * clearing `nextProbeAt` on every sighting would put the whole known population
 * back in the probe queue every cycle.
 *
 * The one exception is `sourceUpdatedAt`: when 8004scan reports the publisher
 * edited the registration, the agent is re-probed early rather than waiting out
 * its normal interval, because a changed record may well be a changed endpoint.
 */
export const enqueueCandidates = internalMutation({
  args: {
    candidates: v.array(
      v.object({
        agentKey: v.string(),
        sourceUpdatedAt: v.union(v.string(), v.null()),
      }),
    ),
  },
  handler: async (ctx, { candidates }) => {
    const now = new Date().toISOString();
    let inserted = 0;
    let refreshed = 0;

    for (const candidate of candidates) {
      const existing = await ctx.db
        .query("agentVerification")
        .withIndex("by_key", (q) => q.eq("agentKey", candidate.agentKey))
        .unique();

      if (!existing) {
        await ctx.db.insert("agentVerification", {
          agentKey: candidate.agentKey,
          state: "unknown",
          failureClass: null,
          detail: "Discovered and queued for verification; not probed yet.",
          probedEndpoint: null,
          protocol: null,
          consecutiveFailures: 0,
          attempts: 0,
          firstSeenAt: now,
          lastProbeAt: null,
          lastOkAt: null,
          nextProbeAt: now,
          sourceUpdatedAt: candidate.sourceUpdatedAt,
        });
        inserted++;
        continue;
      }

      const changed =
        candidate.sourceUpdatedAt !== null &&
        candidate.sourceUpdatedAt !== existing.sourceUpdatedAt;
      if (changed) {
        await ctx.db.patch(existing._id, {
          sourceUpdatedAt: candidate.sourceUpdatedAt,
          nextProbeAt: now,
        });
        refreshed++;
      }
      // Otherwise: nothing. Deliberately no `lastSeenAt` bump - a write per
      // sighting is exactly the churn this design exists to avoid, and nothing
      // reads such a field.
    }

    return { inserted, refreshed };
  },
});

/* ---------------------------------------------------------------------------
 * Reporting and manual triggers
 * ------------------------------------------------------------------------ */

/**
 * The funnel, as counters rather than as a quarter of a million rows.
 *
 * The previous getPipelineStats derived its numbers by scanning the ledger,
 * which worked at a few thousand rows and then failed outright: Convex caps one
 * function execution at 16 MiB of reads and 32,000 scanned documents, and the
 * ledger crossed that at ~12,000. This reads four documents.
 */
export const getStats = query({
  args: {},
  handler: async (ctx) => {
    const cursor = await ctx.db
      .query("discoveryCursor")
      .withIndex("by_key", (q) => q.eq("key", CURSOR_KEY))
      .unique();
    const facets = await ctx.db
      .query("catalogFacets")
      .withIndex("by_key", (q) => q.eq("key", CURSOR_KEY))
      .unique();

    // Bounded reads: the two states worth counting exactly are small, and
    // `take` caps them so this query cannot grow into the read limit.
    const due = await ctx.db
      .query("agentVerification")
      .withIndex("by_state_next_probe", (q) => q.eq("state", "unknown"))
      .take(1000);

    return {
      registryTotal: cursor?.registryTotal ?? null,
      lastRunAt: cursor?.lastRunAt ?? null,
      lastRunSummary: cursor?.lastRunSummary ?? null,
      lastCreatedAt: cursor?.lastCreatedAt ?? null,
      backfill: {
        phase: cursor?.backfillPhase ?? "a2a",
        offset: cursor?.backfillOffset ?? 0,
        completedAt: cursor?.backfillCompletedAt ?? null,
      },
      counters: {
        seenTotal: cursor?.seenTotal ?? 0,
        screenedOut: cursor?.screenedOut ?? 0,
        candidatesFound: cursor?.candidatesFound ?? 0,
        filterFailures: cursor?.filterFailures ?? 0,
      },
      /** "1000+" when the cap was hit, so the number is never quietly wrong. */
      awaitingFirstProbe: due.length === 1000 ? "1000+" : due.length,
      catalog: {
        totalLive: facets?.totalLive ?? 0,
        categories: facets?.categories ?? [],
      },
    };
  },
});

export const runNow = action({
  args: { backfill: v.optional(v.boolean()), budgetMs: v.optional(v.number()) },
  handler: async (ctx, args): Promise<DiscoveryReport> =>
    ctx.runAction(internal.discovery.run, args),
});

/**
 * Sends the backfill back to the start of its walk.
 *
 * An operator tool, and a needed one: the walk's ORDER is a decision that can
 * change (it went oldest-first to newest-first on 2026-09-07 after the first
 * live run found zero live agents among the registry's oldest registrations),
 * and a stored offset from the old order means nothing under the new one.
 *
 * Touches only the cursor. Every candidate already discovered keeps its row and
 * its probe history, because re-walking is idempotent - the point is to change
 * where the walk resumes, not to forget what it found.
 */
export const resetBackfill = action({
  args: {},
  handler: async (ctx): Promise<{ reset: true }> => {
    await ctx.runMutation(internal.discovery.rewindCursor, {});
    return { reset: true };
  },
});

export const rewindCursor = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("discoveryCursor")
      .withIndex("by_key", (q) => q.eq("key", CURSOR_KEY))
      .unique();
    if (!existing) return;
    await ctx.db.patch(existing._id, {
      backfillOffset: 0,
      backfillPhase: "a2a",
      backfillCompletedAt: null,
    });
  },
});
