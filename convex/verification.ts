/**
 * VERIFICATION: probing candidates, and deciding what the catalog contains.
 *
 * ---------------------------------------------------------------------------
 * ONE AGENT PER FUNCTION INVOCATION
 * ---------------------------------------------------------------------------
 * The previous backend probed inside a loop: `refreshAgentDirectory` walked
 * every listed agent and, per agent, did a detail fetch plus up to two A2A
 * POSTs at a 20-second timeout each, sequentially, in one action. At 35 agents
 * that fits. At 500 it cannot finish, and one hung endpoint delays every agent
 * queued behind it - the exact "one dead agent blocks the pipeline" failure the
 * rebuild brief rules out.
 *
 * Here `scheduleBatch` picks due work and schedules ONE `verifyOne` per agent.
 * Each runs as its own Convex function with its own timeout and its own
 * transaction. A publisher whose server hangs for 20 seconds costs 20 seconds
 * of one function and nothing else. Convex allows 1,000 scheduled functions
 * from a single mutation; the batch is capped well under that.
 *
 * ---------------------------------------------------------------------------
 * THE CATALOG IS WRITTEN AS RARELY AS POSSIBLE
 * ---------------------------------------------------------------------------
 * A successful re-probe that finds nothing changed writes ZERO bytes to
 * `agents`. `lastProbeAt` lives on `agentVerification`, and `applyVerification`
 * compares the user-visible fields before patching. Every write to `agents`
 * invalidates the paginated queries the whole frontend subscribes to, so a
 * write has to mean something a person would see actually changed.
 */

import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { buildTags, categorize } from "./lib/categorize";
import { probeAgent } from "./lib/probe";
import { computeRank } from "./lib/rank";
import { parseAgentKey } from "./model/agent";
import { fetchAgentDetail, withRetry } from "./sources/scan8004";

/**
 * How many agents one cycle schedules.
 *
 * At a 10-minute cron this is 28,800 probes/day of capacity against a candidate
 * population of ~33,000 (the whole A2A + MCP slice of BSC mainnet), so the
 * initial backfill's queue drains in about a day and the steady state - a live
 * agent re-probed every 24h plus ~120 new candidates - uses a fraction of it.
 */
const BATCH_SIZE = 200;

/** Consecutive failures a LISTED agent survives before it is delisted. */
export const FAILURES_BEFORE_DELIST = 3;

/**
 * How long each state is trusted before the agent is asked again.
 *
 * `unavailable` backs off along a schedule rather than using one interval: the
 * first failure is very likely a bad afternoon and worth retrying soon, the
 * tenth is very likely permanent and not worth a request an hour forever.
 */
const LIVE_RECHECK_MS = 24 * 60 * 60 * 1000;
const INVALID_RECHECK_MS = 30 * 24 * 60 * 60 * 1000;
const UNAVAILABLE_BACKOFF_MS = [
  60 * 60 * 1000, // 1h
  4 * 60 * 60 * 1000, // 4h
  12 * 60 * 60 * 1000, // 12h
  24 * 60 * 60 * 1000, // 1d
  3 * 24 * 60 * 60 * 1000, // 3d
  7 * 24 * 60 * 60 * 1000, // 7d - the cap
];

function backoffFor(state: string, consecutiveFailures: number): number {
  if (state === "live") return LIVE_RECHECK_MS;
  if (state === "invalid") return INVALID_RECHECK_MS;
  const index = Math.min(Math.max(consecutiveFailures - 1, 0), UNAVAILABLE_BACKOFF_MS.length - 1);
  return UNAVAILABLE_BACKOFF_MS[index];
}

/* ---------------------------------------------------------------------------
 * THE BATCH
 * ------------------------------------------------------------------------ */

export const scheduleBatch = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }): Promise<{ scheduled: number }> => {
    const now = new Date().toISOString();
    const cap = limit ?? BATCH_SIZE;
    const picked: Doc<"agentVerification">[] = [];

    /*
     * Priority order, and it is deliberate:
     *
     *   unknown       a real agent sitting unprobed is the costliest state -
     *                 it is invisible and nobody knows whether it works.
     *   live          a listed agent that has died must be caught quickly,
     *                 because it is the one a user can actually walk into.
     *   unavailable   worth re-asking, but it is already not being shown.
     *   invalid       structurally broken; a month is soon enough.
     */
    for (const state of ["unknown", "live", "unavailable", "invalid"] as const) {
      if (picked.length >= cap) break;
      const rows = await ctx.db
        .query("agentVerification")
        .withIndex("by_state_next_probe", (q) =>
          q.eq("state", state).lte("nextProbeAt", now),
        )
        .order("asc")
        .take(cap - picked.length);
      picked.push(...rows);
    }

    for (const row of picked) {
      // Fan out. Each becomes its own function invocation with its own
      // timeout, so no agent can delay another.
      await ctx.scheduler.runAfter(0, internal.verification.verifyOne, {
        agentKey: row.agentKey,
      });
    }

    return { scheduled: picked.length };
  },
});

/* ---------------------------------------------------------------------------
 * ONE AGENT
 * ------------------------------------------------------------------------ */

export const verifyOne = internalAction({
  args: { agentKey: v.string() },
  handler: async (ctx, { agentKey }): Promise<void> => {
    const parsed = parseAgentKey(agentKey);
    if (!parsed) {
      await ctx.runMutation(internal.verification.applyVerification, {
        agentKey,
        state: "invalid",
        failureClass: "no-endpoint",
        detail: "Malformed agent key; this row cannot identify an agent and will not be probed.",
        probedEndpoint: null,
        protocol: null,
        catalog: null,
      });
      return;
    }

    /*
     * The detail fetch, and a failure here is NOT evidence about the agent.
     *
     * Measured 2026-09-07: five sequential detail fetches returned HTTP 500 at
     * ~10.8s immediately after a heavy filtered scan, and every one returned 200
     * in 400-1400ms a minute later. Treating that as "the agent is dead" would
     * delist working agents whenever the indexer had a bad minute - so the row
     * is rescheduled without touching its state or its failure counter.
     */
    let detail;
    try {
      detail = await withRetry(() => fetchAgentDetail(parsed.chainId, parsed.tokenId));
    } catch (cause) {
      await ctx.runMutation(internal.verification.deferProbe, {
        agentKey,
        reason: `8004scan did not answer for this agent: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      });
      return;
    }

    if (!detail) {
      // The indexer answered and has no such agent. That IS evidence: a
      // registration that no longer resolves cannot be listed.
      await ctx.runMutation(internal.verification.applyVerification, {
        agentKey,
        state: "invalid",
        failureClass: "no-endpoint",
        detail: "8004scan no longer publishes a record for this agent.",
        probedEndpoint: null,
        protocol: null,
        catalog: null,
      });
      return;
    }

    const probe = await probeAgent({
      services: detail.services,
      agentWallet: detail.agentWallet,
    });

    if (probe.state !== "live") {
      await ctx.runMutation(internal.verification.applyVerification, {
        agentKey,
        state: probe.state,
        failureClass: probe.failureClass,
        detail: probe.detail,
        probedEndpoint: probe.probedEndpoint,
        protocol: probe.protocol,
        catalog: null,
      });
      return;
    }

    /* ------------------------------------------------------------------
     * NORMALIZE. Only reached by an agent that answered and sells.
     * --------------------------------------------------------------- */
    const assignment = categorize({
      name: detail.name,
      description: detail.description,
      registryCategories: detail.categories,
      tags: detail.tags,
      skills: probe.skills,
    });
    const tags = buildTags(detail.tags, probe.skills);

    /*
     * THE REGISTRY'S NAME WINS, and the card is the fallback (2026-09-07).
     *
     * This was the other way round, on the reasoning that a card is what the
     * agent calls itself right now while the indexer holds a snapshot. That is
     * true for an agent with its own endpoint and WRONG when several agents
     * share one, which is common: the Brain on BNB family publishes tokens
     * 302257 ("Venus Health Factor Monitor") and 304493 ("Venus Yield Ranking")
     * behind a single card at agent.brainonbnb.com whose name is the PLATFORM's
     * - "Brain On BNB AI - hireable agents".
     *
     * Preferring the card gave both agents that same name, so the catalog
     * listed what looked like one agent twice. The registry name is per-agent
     * by construction; the card name is per-endpoint. Per-agent wins, and the
     * card only fills a gap.
     */
    const name = detail.name.trim() || probe.cardName || `Agent ${parsed.tokenId}`;
    const description = detail.description;

    const rank = computeRank({
      // Set by applyVerification from the existing row, so curation survives a
      // re-probe. Passing false here and letting the mutation re-add the boost
      // would be two sources of truth.
      curated: false,
      hasPayableQuote: probe.pricing !== null,
      skillCount: probe.skills.length,
      feedbackCount: detail.feedbackCount,
      sourceScore: detail.totalScore,
      endpointVerified: detail.isEndpointVerified === true,
      hasPublisherIcon: detail.iconUrl !== null,
      name,
      description,
    });

    await ctx.runMutation(internal.verification.applyVerification, {
      agentKey,
      state: "live",
      failureClass: null,
      detail: probe.detail,
      probedEndpoint: probe.probedEndpoint,
      protocol: probe.protocol,
      catalog: {
        chainId: parsed.chainId,
        registryAddress: parsed.registryAddress,
        tokenId: parsed.tokenId,
        ownerAddress: detail.ownerAddress,
        agentWallet: detail.agentWallet,
        publisher: detail.publisher,
        registeredAt: detail.createdAt,
        name,
        description,
        iconUrl: detail.iconUrl,
        categorySlug: assignment.slug,
        tags,
        skills: probe.skills,
        protocol: probe.protocol ?? "a2a",
        endpoint: probe.probedEndpoint ?? "",
        pricing: probe.pricing,
        x402Supported: detail.x402Supported,
        feedbackCount: detail.feedbackCount,
        // Null below one feedback: an average over zero is an artefact, not a rating.
        reputationScore: detail.feedbackCount > 0 ? detail.averageScore : null,
        rank,
      },
    });
  },
});

/* ---------------------------------------------------------------------------
 * PERSISTENCE
 * ------------------------------------------------------------------------ */

const catalogValidator = v.object({
  chainId: v.number(),
  registryAddress: v.string(),
  tokenId: v.string(),
  ownerAddress: v.string(),
  agentWallet: v.union(v.string(), v.null()),
  publisher: v.union(v.string(), v.null()),
  registeredAt: v.union(v.string(), v.null()),
  name: v.string(),
  description: v.string(),
  iconUrl: v.union(v.string(), v.null()),
  categorySlug: v.string(),
  tags: v.array(v.string()),
  skills: v.array(
    v.object({ name: v.string(), description: v.union(v.string(), v.null()) }),
  ),
  protocol: v.union(v.literal("a2a"), v.literal("mcp")),
  endpoint: v.string(),
  pricing: v.union(
    v.object({
      amountRaw: v.string(),
      token: v.string(),
      tokenSymbol: v.string(),
      tokenDecimals: v.number(),
      display: v.union(v.string(), v.null()),
      escrowContract: v.union(v.string(), v.null()),
    }),
    v.null(),
  ),
  x402Supported: v.boolean(),
  feedbackCount: v.number(),
  reputationScore: v.union(v.number(), v.null()),
  rank: v.number(),
});

/**
 * A tagline is the first sentence, not a hand-written line.
 *
 * The old catalog stored a separate `tagline` per editorial agent and derived
 * one for everything else. Deriving it for everything means one fewer field a
 * human has to maintain and no possibility of the two disagreeing.
 */
function deriveTagline(description: string): string {
  const trimmed = description.trim();
  const firstSentence = trimmed.split(/(?<=[.!?])\s/)[0] ?? trimmed;
  return firstSentence.length > 140 ? `${firstSentence.slice(0, 137)}...` : firstSentence;
}

function buildSearchText(input: {
  name: string;
  description: string;
  categorySlug: string;
  tags: string[];
  skills: { name: string }[];
}): string {
  return [
    input.name,
    input.description,
    input.categorySlug.replace(/-/g, " "),
    ...input.tags,
    ...input.skills.map((s) => s.name),
  ]
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}

export const applyVerification = internalMutation({
  args: {
    agentKey: v.string(),
    state: v.union(
      v.literal("unknown"),
      v.literal("live"),
      v.literal("unavailable"),
      v.literal("invalid"),
    ),
    failureClass: v.union(
      v.literal("transport"),
      v.literal("http"),
      v.literal("protocol"),
      v.literal("no-menu"),
      v.literal("no-endpoint"),
      v.literal("unsafe-url"),
      v.null(),
    ),
    detail: v.string(),
    probedEndpoint: v.union(v.string(), v.null()),
    protocol: v.union(v.literal("a2a"), v.literal("mcp"), v.null()),
    /** Present only for a LIVE result. Null means "do not write the catalog". */
    catalog: v.union(catalogValidator, v.null()),
  },
  handler: async (ctx, args) => {
    const now = new Date().toISOString();

    const verification = await ctx.db
      .query("agentVerification")
      .withIndex("by_key", (q) => q.eq("agentKey", args.agentKey))
      .unique();

    const previousFailures = verification?.consecutiveFailures ?? 0;
    const consecutiveFailures = args.state === "live" ? 0 : previousFailures + 1;
    const nextProbeAt = new Date(
      Date.now() + backoffFor(args.state, consecutiveFailures),
    ).toISOString();

    const verificationFields = {
      state: args.state,
      failureClass: args.failureClass,
      detail: args.detail.slice(0, 300),
      probedEndpoint: args.probedEndpoint,
      protocol: args.protocol,
      consecutiveFailures,
      attempts: (verification?.attempts ?? 0) + 1,
      lastProbeAt: now,
      lastOkAt: args.state === "live" ? now : (verification?.lastOkAt ?? null),
      nextProbeAt,
    };

    if (verification) {
      await ctx.db.patch(verification._id, verificationFields);
    } else {
      await ctx.db.insert("agentVerification", {
        agentKey: args.agentKey,
        firstSeenAt: now,
        sourceUpdatedAt: null,
        ...verificationFields,
      });
    }

    /* ------------------------------------------------------------------
     * THE CATALOG
     * --------------------------------------------------------------- */
    const existing = await ctx.db
      .query("agents")
      .withIndex("by_key", (q) => q.eq("agentKey", args.agentKey))
      .unique();

    // --- Not live -----------------------------------------------------
    if (!args.catalog) {
      if (!existing) return; // Never listed; nothing to do. The common case.

      /*
       * A LISTED AGENT IS NOT DELISTED ON ONE FAILURE.
       *
       * A single failed probe is weak evidence - 8004scan itself returns
       * 500/502/524s, and a publisher redeploying will fail one probe and pass
       * the next. Delisting on one would flicker the catalog on ordinary noise.
       * Three consecutive failures across three separate passes is a sustained
       * pattern, which is defensible.
       */
      const status =
        consecutiveFailures < FAILURES_BEFORE_DELIST ? "degraded" : "unavailable";
      if (existing.status !== status) {
        await ctx.db.patch(existing._id, { status });
        // Membership changed, so the browse chips are stale.
        if (status === "unavailable") await ctx.scheduler.runAfter(0, internal.facets.recompute, {});
      }
      /*
       * THE ROW IS KEPT, NOT DELETED - a deliberate change.
       *
       * The old pipeline deleted the `discoveredAgents` row on delist, so a
       * user holding a link or an existing hire found a page that no longer
       * existed. `agents.get` is ungated, so keeping the row means the page
       * still resolves and says the agent cannot be hired right now, which is
       * a far better failure than a dead link.
       */
      return;
    }

    // --- Live ---------------------------------------------------------
    const c = args.catalog;
    // Curation survives a re-probe: it is a human decision about the agent, not
    // an observation, so the probe must never clear it. Re-added to the rank
    // here rather than passed into computeRank, so there is one source of truth.
    const curated = existing?.curated ?? false;
    const rank = c.rank + (curated ? 300 : 0);

    const next = {
      agentKey: args.agentKey,
      chainId: c.chainId,
      registryAddress: c.registryAddress,
      tokenId: c.tokenId,
      ownerAddress: c.ownerAddress,
      agentWallet: c.agentWallet,
      publisher: c.publisher,
      registeredAt: c.registeredAt,
      name: c.name,
      tagline: deriveTagline(c.description),
      description: c.description,
      iconUrl: c.iconUrl,
      iconSource: (c.iconUrl ? "publisher" : "generated") as "publisher" | "generated",
      categorySlug: c.categorySlug,
      tags: c.tags,
      skills: c.skills,
      protocol: c.protocol,
      endpoint: c.endpoint,
      pricing: c.pricing,
      x402Supported: c.x402Supported,
      feedbackCount: c.feedbackCount,
      reputationScore: c.reputationScore,
      curated,
      status: "live" as const,
      rank,
      searchText: buildSearchText(c),
      publishedAt: existing?.publishedAt ?? now,
      lastVerifiedAt: now,
    };

    if (!existing) {
      await ctx.db.insert("agents", next);
      await ctx.scheduler.runAfter(0, internal.facets.recompute, {});
      return;
    }

    /*
     * CHANGE DETECTION - the reason a healthy catalog is almost never written.
     *
     * `lastVerifiedAt` is EXCLUDED from the comparison on purpose. It changes on
     * every single probe, so including it would make every re-probe a write and
     * defeat the whole point. It is refreshed only when something else changed,
     * which means it reads as "when this record last changed" rather than "when
     * it was last looked at" - and the latter is on agentVerification, where it
     * belongs.
     */
    const changed =
      existing.name !== next.name ||
      existing.description !== next.description ||
      existing.iconUrl !== next.iconUrl ||
      existing.categorySlug !== next.categorySlug ||
      existing.endpoint !== next.endpoint ||
      existing.protocol !== next.protocol ||
      existing.agentWallet !== next.agentWallet ||
      existing.x402Supported !== next.x402Supported ||
      existing.feedbackCount !== next.feedbackCount ||
      existing.reputationScore !== next.reputationScore ||
      existing.status !== next.status ||
      existing.rank !== next.rank ||
      JSON.stringify(existing.tags) !== JSON.stringify(next.tags) ||
      JSON.stringify(existing.skills) !== JSON.stringify(next.skills) ||
      JSON.stringify(existing.pricing) !== JSON.stringify(next.pricing);

    if (!changed) return; // The steady state. Zero bytes written.

    await ctx.db.patch(existing._id, next);
    if (existing.status !== "live" || existing.categorySlug !== next.categorySlug) {
      await ctx.scheduler.runAfter(0, internal.facets.recompute, {});
    }
  },
});

/**
 * Reschedules a probe WITHOUT recording a verdict.
 *
 * For failures that are ours or the indexer's rather than the agent's. Nothing
 * about `state` or `consecutiveFailures` moves, so an 8004scan outage cannot
 * delist a healthy catalog - which is the failure mode that matters most here,
 * because it would take out every agent at once rather than one.
 */
export const deferProbe = internalMutation({
  args: { agentKey: v.string(), reason: v.string() },
  handler: async (ctx, { agentKey, reason }) => {
    const row = await ctx.db
      .query("agentVerification")
      .withIndex("by_key", (q) => q.eq("agentKey", agentKey))
      .unique();
    if (!row) return;
    await ctx.db.patch(row._id, {
      nextProbeAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      detail: `Deferred: ${reason}`.slice(0, 300),
    });
  },
});

/* ---------------------------------------------------------------------------
 * Curation and operator tools
 * ------------------------------------------------------------------------ */

/**
 * Marks an agent hand-vetted, or clears it.
 *
 * This is what replaces EDITORIAL_AGENT_INPUTS - the nine agents that were a
 * TypeScript literal compiled into the backend, merged ahead of everything and
 * exempt from every gate. It boosts rank and NOTHING else: a curated agent
 * whose endpoint stops answering is delisted exactly like any other, which was
 * not true before and is why three curated agents were being merged into the
 * catalog while failing the sellability probe.
 *
 * Adding one no longer needs a deploy.
 */
export const setCurated = internalMutation({
  args: { agentKey: v.string(), curated: v.boolean() },
  handler: async (ctx, { agentKey, curated }) => {
    const row = await ctx.db
      .query("agents")
      .withIndex("by_key", (q) => q.eq("agentKey", agentKey))
      .unique();
    if (!row) {
      throw new Error(
        `No catalog row for ${agentKey}. An agent must pass verification before it can be curated - curation is a boost, not a bypass.`,
      );
    }
    const delta = curated === row.curated ? 0 : curated ? 300 : -300;
    await ctx.db.patch(row._id, { curated, rank: Math.max(0, row.rank + delta) });
  },
});

/** Queues one agent for an immediate re-probe. */
export const reprobe = internalQuery({
  args: { agentKey: v.string() },
  handler: async (ctx, { agentKey }) =>
    ctx.db
      .query("agentVerification")
      .withIndex("by_key", (q) => q.eq("agentKey", agentKey))
      .unique(),
});

/**
 * WHY IS AGENT X NOT LISTED — answerable without reading the database.
 *
 * The brief's §31 asks for exactly this, and the old pipeline answered it by
 * storing a written-out sentence on a quarter of a million rows. Here the
 * sentences already exist on the (bounded) verification rows; this just counts
 * them by state and failure class and shows a sample of each.
 *
 * Bounded by `take` so it cannot grow into Convex's read limit as the candidate
 * population does - and it says so when it hits the cap rather than reporting a
 * quietly truncated number as if it were the total.
 */
export const report = query({
  args: { sampleSize: v.optional(v.number()) },
  handler: async (ctx, { sampleSize }) => {
    const cap = 4000;
    const byState: Record<string, number> = {};
    const byFailure: Record<string, number> = {};
    const samples: Record<string, { agentKey: string; detail: string }[]> = {};
    const wanted = sampleSize ?? 3;
    let scanned = 0;

    for (const state of ["unknown", "live", "unavailable", "invalid"] as const) {
      const rows = await ctx.db
        .query("agentVerification")
        .withIndex("by_state_next_probe", (q) => q.eq("state", state))
        .take(cap);
      scanned += rows.length;
      byState[state] = rows.length;

      for (const row of rows) {
        const key = row.failureClass ?? "none";
        byFailure[key] = (byFailure[key] ?? 0) + 1;
        const bucket = (samples[key] ??= []);
        if (bucket.length < wanted) {
          bucket.push({ agentKey: row.agentKey, detail: row.detail });
        }
      }
    }

    return {
      byState,
      byFailure,
      samples,
      truncated: Object.values(byState).some((n) => n === cap),
      scanned,
    };
  },
});

export const runBatchNow = action({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ scheduled: number }> =>
    ctx.runMutation(internal.verification.scheduleBatch, args),
});

/**
 * Probes one agent immediately, by key. The manual path for testing.
 *
 * A BLOCK BODY, not an expression body, and the difference is not style.
 * `verifyOne` declares `Promise<void>`, but Convex SERIALIZES an action's
 * return value and `undefined` serializes to `null` - so `runAction` is typed
 * `Promise<null>`, and returning it straight out of a `Promise<void>` handler
 * does not typecheck. Awaiting and returning nothing is what this always meant.
 */
export const verifyNow = action({
  args: { agentKey: v.string() },
  handler: async (ctx, { agentKey }): Promise<void> => {
    await ctx.runAction(internal.verification.verifyOne, { agentKey });
  },
});
