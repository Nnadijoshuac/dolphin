/**
 * THE AUTOMATED DISCOVERY PIPELINE.
 *
 * Replaces hand curation with a continuous cycle that finds, judges, verifies
 * and onboards agents on its own:
 *
 *   sweep -> cheap pre-filter -> classifier (+ registration-file cross-check)
 *         -> liveness probe -> icon sourcing -> publish or pending
 *
 * Stages 1-4 are convex/lib/prefilter.ts, agentScoring.ts, registrationFile.ts,
 * liveness.ts and pipelineStatus.ts. This file is the orchestration: which
 * records get swept, in what order, on what budget, and what happens to the
 * catalog as a result.
 *
 * ---------------------------------------------------------------------------
 * WHY THREE SWEEP PATHS AND NOT ONE.
 * ---------------------------------------------------------------------------
 * Measured live in this session's Task 0 investigation, not assumed:
 *
 *   - The registry holds 289,938 identities on BSC mainnet. A full walk is 2,900
 *     pages, which is only 2.9% of the 100,000/day request budget - but at a
 *     measured 0.180 pages/s it is ~4.5 HOURS of wall time. A Convex action's
 *     ceiling is 10 minutes. So a full sweep cannot happen in one pass; it must
 *     be incremental. That is settled by measurement.
 *   - 8004scan's `search=` returns a `total`, so the topically relevant slice
 *     can be MEASURED rather than guessed. A 50-term DeFi vocabulary sweep
 *     returned a union of 1,446 unique agents in 65 requests and 102 seconds -
 *     roughly 45x cheaper than seeing all 289,938, for the slice that actually
 *     matters.
 *   - `total` moved 289,938 -> 289,971 in ~70 minutes of this session's own
 *     calls: ~28 new registrations per hour.
 *
 * Hence:
 *
 *   A. VOCABULARY SEARCH - cheap, high yield, runs every cycle. Carries the
 *      pipeline's precision.
 *   B. NEW-REGISTRATION TAIL - `sort_by=token_id&sort_order=desc`, a few pages.
 *      Bounds time-to-first-sight for anything newly registered to one cycle,
 *      rather than "whenever the backfill happens to reach it".
 *   C. RESUMABLE ASCENDING BACKFILL - completeness. Budgeted per cycle and
 *      resumed from a stored offset. Correct rather than merely plausible
 *      because an ERC-8004 token id only ever increases, so `token_id asc`
 *      pagination is stable under insertion: new rows append at the end and
 *      never shift an offset already walked.
 */

import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
} from "./_generated/server";
import { agentCategoryValidator } from "./categoryStatsValidators";
import {
  AGENT_CATEGORY_SLUGS,
  ERC8004_IDENTITY_REGISTRY,
  type AgentCategory,
} from "./lib/agentCatalog";
import { explainShortfall, scoreAgent } from "./lib/agentScoring";
import { fallbackIconBlob, fetchIcon, type IconSource } from "./lib/agentIcons";
import { BSC_CHAIN_ID } from "./lib/bscClient";
import { probeLiveness, type ProbeEndpoint } from "./lib/liveness";
import { PREFILTER_RULES, prefilterAgent } from "./lib/prefilter";
import {
  DELIST_AFTER_CONSECUTIVE_FAILURES,
  needsDeepEvaluation,
  resolveStatus,
  type CandidateStatus,
} from "./lib/pipelineStatus";
import { fetchRegistrationFile } from "./lib/registrationFile";
import { MANUALLY_EXCLUDED_TOKEN_IDS } from "./lib/manualExclusions";

/* ---------------------------------------------------------------------------
 * 8004scan access
 * ------------------------------------------------------------------------ */

const AGENTS_URL =
  process.env.SCAN8004_API_URL?.trim() || "https://api.8004scan.io/api/v1/agents";

const PAGE_SIZE = 100; // 8004scan caps `limit` at 100; 200/500/1000 all return HTTP 422.
const REQUEST_TIMEOUT_MS = 45_000;

/**
 * Concurrency 4, measured rather than picked. Task 0 compared 2/4/8 against the
 * live API: concurrency 8 doubled p50 latency (13s -> 31s) for a 24% throughput
 * gain and started timing requests out, and concurrency 2 was slower AND had 3
 * timeouts in 24. The bottleneck is 8004scan's server-side offset scanning, not
 * our request rate, so raising this does not help.
 */
const SWEEP_CONCURRENCY = 4;

/** Wall-clock budgets. A Convex action is killed at 10 minutes; leave headroom. */
const SEARCH_SWEEP_BUDGET_MS = 240_000;
const SWEEP_TOTAL_BUDGET_MS = 480_000;
const DEEP_EVAL_BUDGET_MS = 420_000;

/** Pages of the descending tail to walk each cycle. See the cadence note below. */
const TAIL_PAGES = 3;
/** Most candidates one deep-evaluation pass will process, budget permitting. */
const DEEP_EVAL_BATCH = 40;

function scan8004Headers(): HeadersInit {
  const apiKey = process.env.SCAN8004_API_KEY;
  return apiKey
    ? { Accept: "application/json", "X-API-Key": apiKey }
    : { Accept: "application/json" };
}

interface RawAgentListItem {
  token_id: string;
  name: string | null;
  description: string | null;
  image_url: string | null;
  owner_address: string | null;
  x402_supported: boolean | null;
  created_at: string | null;
}

interface ListPage {
  items: RawAgentListItem[];
  total: number | null;
}

async function fetchPage(params: string): Promise<ListPage> {
  const url = `${AGENTS_URL}?chain_id=${BSC_CHAIN_ID}&is_testnet=false&${params}`;
  const response = await fetch(url, {
    headers: scan8004Headers(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`8004scan ${response.status} for ${params}`);
  }
  const payload = (await response.json()) as { items?: RawAgentListItem[]; total?: number };
  return {
    items: Array.isArray(payload.items) ? payload.items : [],
    total: typeof payload.total === "number" ? payload.total : null,
  };
}

/** Runs `tasks` with bounded concurrency, never throwing for an individual failure. */
async function withConcurrency<T>(
  tasks: readonly (() => Promise<T>)[],
  limit: number,
  onError: (error: unknown) => void,
): Promise<T[]> {
  const results: T[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= tasks.length) return;
      try {
        results.push(await tasks[index]());
      } catch (error) {
        onError(error);
      }
    }
  });
  await Promise.all(workers);
  return results;
}

/* ---------------------------------------------------------------------------
 * PATH A's vocabulary.
 *
 * Far narrower than convex/lib/prefilter.ts's topical gate, on purpose: this
 * list decides what 8004scan is ASKED for, so every term has to be worth a
 * round trip. The gate decides what is KEPT once seen, so it can afford to be
 * generous. Terms are the four categories' own language plus the protocol names
 * their live-stats readers actually integrate against (Venus, PancakeSwap,
 * Aave, Lista, Beefy).
 *
 * Each term was measured against the live search endpoint in Task 0 - e.g.
 * "health factor" total=16, "liquidation" total=325, "apy" total=341,
 * "concentrated liquidity" total=20, "grid trading" total=9.
 * ------------------------------------------------------------------------ */
const SEARCH_VOCABULARY: readonly string[] = [
  // rebalancing
  "rebalance", "rebalancing", "concentrated liquidity", "liquidity range",
  "lp position", "tick range", "reposition", "liquidity provider", "v3 pool",
  "impermanent loss", "fee tier", "position manager",
  // grid trading
  "grid trading", "grid trader", "grid strategy", "price ladder", "grid bot",
  "buy and sell ladder", "grid level",
  // health factor
  "health factor", "liquidation", "liquidation risk", "collateral ratio",
  "loan to value", "borrow limit", "lending position", "collateral",
  "liquidation protection",
  // yield
  "yield", "yield farming", "yield optimizer", "apy", "apr", "auto compound",
  "autocompound", "vault", "staking rewards", "farming", "earn",
  "yield aggregator",
  // protocols the live-stats readers integrate against
  "venus", "pancakeswap", "aave", "lista", "beefy", "alpaca finance",
  "thena", "wombat", "kinza", "morpho",
  // general
  "defi agent", "portfolio rebalancing", "liquidity management",
];

/** How many pages deep one search term is followed. `apy` topped out at 341. */
const MAX_PAGES_PER_TERM = 5;

/* ---------------------------------------------------------------------------
 * Stage 1 + 2, cheap half: run over every record the sweep sees.
 * ------------------------------------------------------------------------ */

interface CheapVerdict {
  status: CandidateStatus;
  statusReason: string;
  prefilterRule: string | null;
  category: AgentCategory | null;
  confidence: "confirmed" | "likely" | null;
  score: number | null;
  runnerUpCategory: AgentCategory | null;
  runnerUpScore: number | null;
  matchedTerms: string[];
  classificationEvidence: string[];
  shortfall: string | null;
}

/**
 * The cheap pass: pre-filter, then score. Both are pure string work with no
 * network call, so they can run over every record the sweep touches.
 *
 * A survivor never reaches `published` here - the most it can be is `pending`.
 * Publication additionally requires the liveness probe, which is expensive and
 * happens in the deep-evaluation pass.
 */
function evaluateCheaply(item: {
  tokenId: string;
  name: string;
  description: string;
}): CheapVerdict {
  const prefilter = prefilterAgent(item.name, item.description);
  if (prefilter.verdict === "reject") {
    return {
      status: "rejected-prefilter",
      statusReason: prefilter.reason ?? "Rejected by the pre-filter.",
      prefilterRule: prefilter.rule,
      category: null,
      confidence: null,
      score: null,
      runnerUpCategory: null,
      runnerUpScore: null,
      matchedTerms: [],
      classificationEvidence: [],
      shortfall: null,
    };
  }

  const scored = scoreAgent(item.name, item.description);
  const evidence = [
    ...scored.signals.map((s) => `+${s.weight} ${s.category}: ${s.detail}`),
    ...scored.penalties.map((p) => `${p.amount} penalty: ${p.detail}`),
  ];

  if (scored.category === null) {
    return {
      status: "rejected-classifier",
      statusReason: scored.rejectionReason ?? "Not classifiable into one of the four graded categories.",
      prefilterRule: null,
      category: null,
      confidence: null,
      score: scored.score,
      runnerUpCategory: scored.runnerUp?.category ?? null,
      runnerUpScore: scored.runnerUp?.score ?? null,
      matchedTerms: [],
      classificationEvidence: evidence,
      shortfall: null,
    };
  }

  return {
    status: "pending",
    statusReason:
      "Classified from 8004scan's indexed text and awaiting the registration-file cross-check and a live endpoint probe before it can be published.",
    prefilterRule: null,
    category: scored.category,
    confidence: scored.confidence,
    score: scored.score,
    runnerUpCategory: scored.runnerUp?.category ?? null,
    runnerUpScore: scored.runnerUp?.score ?? null,
    matchedTerms: scored.signals
      .filter((s) => s.category === scored.category)
      .map((s) => s.detail),
    classificationEvidence: evidence,
    shortfall: explainShortfall(scored),
  };
}

/* ---------------------------------------------------------------------------
 * THE SWEEP
 * ------------------------------------------------------------------------ */

export interface SweepReport {
  searchTerms: number;
  searchRequests: number;
  tailPages: number;
  backfillPages: number;
  backfillOffsetBefore: number;
  backfillOffsetAfter: number;
  registryTotal: number | null;
  uniqueRecordsSeen: number;
  newCandidates: number;
  reEvaluated: number;
  unchangedSkipped: number;
  rejectedPrefilter: number;
  rejectedClassifier: number;
  pending: number;
  prefilterByRule: Record<string, number>;
  byCategory: Record<string, number>;
  elapsedMs: number;
  errors: string[];
}

export const sweep = internalAction({
  args: {
    /** Skip the (slow) backfill - used when verifying the other two paths. */
    skipBackfill: v.optional(v.boolean()),
    /** Override the wall-clock budget, for manual runs. */
    budgetMs: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SweepReport> => {
    const startedAt = Date.now();
    const totalBudget = args.budgetMs ?? SWEEP_TOTAL_BUDGET_MS;
    const errors: string[] = [];
    const seen = new Map<string, RawAgentListItem>();

    let searchRequests = 0;
    let registryTotal: number | null = null;

    const note = (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (errors.length < 40) errors.push(message);
    };

    const collect = (page: ListPage) => {
      if (page.total !== null) registryTotal = page.total;
      for (const item of page.items) {
        if (item?.token_id && !seen.has(item.token_id)) seen.set(item.token_id, item);
      }
      return page.items.length;
    };

    /* PATH A - vocabulary search. */
    const searchDeadline = startedAt + Math.min(SEARCH_SWEEP_BUDGET_MS, totalBudget);
    await withConcurrency(
      SEARCH_VOCABULARY.map((term) => async () => {
        for (let page = 0; page < MAX_PAGES_PER_TERM; page++) {
          if (Date.now() > searchDeadline) return;
          searchRequests++;
          const result = await fetchPage(
            `search=${encodeURIComponent(term)}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`,
          );
          const count = collect(result);
          // A short page is the last page for this term.
          if (count < PAGE_SIZE) return;
        }
      }),
      SWEEP_CONCURRENCY,
      note,
    );

    /* PATH B - newest registrations first, so anything new is seen within one cycle. */
    let tailPages = 0;
    await withConcurrency(
      Array.from({ length: TAIL_PAGES }, (_, page) => async () => {
        if (Date.now() > startedAt + totalBudget) return;
        tailPages++;
        collect(
          await fetchPage(
            `sort_by=token_id&sort_order=desc&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`,
          ),
        );
      }),
      SWEEP_CONCURRENCY,
      note,
    );

    /* PATH C - resumable ascending backfill, whatever budget is left. */
    const state = await ctx.runQuery(internal.discoveryPipeline.getDiscoveryState, {});
    const backfillOffsetBefore = state?.backfillOffset ?? 0;
    let backfillOffset = backfillOffsetBefore;
    let backfillPages = 0;
    let backfillCompletedAt = state?.backfillCompletedAt ?? null;

    if (args.skipBackfill !== true) {
      while (Date.now() < startedAt + totalBudget) {
        // Four pages at a time, matching the measured optimum concurrency.
        const offsets = Array.from(
          { length: SWEEP_CONCURRENCY },
          (_, i) => backfillOffset + i * PAGE_SIZE,
        );
        let shortPage = false;
        await withConcurrency(
          offsets.map((offset) => async () => {
            const result = await fetchPage(
              `sort_by=token_id&sort_order=asc&limit=${PAGE_SIZE}&offset=${offset}`,
            );
            if (collect(result) < PAGE_SIZE) shortPage = true;
          }),
          SWEEP_CONCURRENCY,
          note,
        );
        backfillPages += offsets.length;
        backfillOffset += offsets.length * PAGE_SIZE;

        if (shortPage) {
          // Walked off the end of the registry: one full pass is complete.
          backfillCompletedAt = new Date().toISOString();
          backfillOffset = 0;
          break;
        }
      }
    }

    /* Judge everything seen, and record it. */
    const now = new Date().toISOString();
    let newCandidates = 0;
    let reEvaluated = 0;
    let unchangedSkipped = 0;
    const counts = { rejectedPrefilter: 0, rejectedClassifier: 0, pending: 0 };
    const prefilterByRule: Record<string, number> = Object.fromEntries(
      PREFILTER_RULES.map((rule) => [rule, 0]),
    );
    const byCategory: Record<string, number> = Object.fromEntries(
      AGENT_CATEGORY_SLUGS.map((slug) => [slug, 0]),
    );

    const records = [...seen.values()].map((item) => {
      const name = item.name ?? "";
      const description = item.description ?? "";
      const verdict = evaluateCheaply({ tokenId: item.token_id, name, description });

      if (verdict.status === "rejected-prefilter" && verdict.prefilterRule) {
        prefilterByRule[verdict.prefilterRule] = (prefilterByRule[verdict.prefilterRule] ?? 0) + 1;
        counts.rejectedPrefilter++;
      } else if (verdict.status === "rejected-classifier") {
        counts.rejectedClassifier++;
      } else {
        counts.pending++;
        if (verdict.category) byCategory[verdict.category] = (byCategory[verdict.category] ?? 0) + 1;
      }

      return {
        tokenId: item.token_id,
        name,
        description,
        scanIconUrl: item.image_url ?? null,
        ownerAddress: item.owner_address ?? "",
        registeredAt: item.created_at ?? null,
        x402Supported: typeof item.x402_supported === "boolean" ? item.x402_supported : null,
        ...verdict,
      };
    });

    // Written in chunks: one mutation per record would be tens of thousands of
    // transactions, and one mutation for all of them would exceed Convex's
    // per-transaction limits on a full backfill page batch.
    for (let i = 0; i < records.length; i += 200) {
      const outcome = await ctx.runMutation(internal.discoveryPipeline.recordSweepBatch, {
        records: records.slice(i, i + 200),
        source: "sweep",
        seenAt: now,
      });
      newCandidates += outcome.inserted;
      reEvaluated += outcome.updated;
      unchangedSkipped += outcome.unchanged;
    }

    const elapsedMs = Date.now() - startedAt;
    const summary =
      `saw ${seen.size} records; ${newCandidates} new, ${reEvaluated} re-evaluated; ` +
      `${counts.pending} classified, ${counts.rejectedPrefilter} pre-filtered out, ` +
      `${counts.rejectedClassifier} unclassifiable; ${elapsedMs}ms`;

    await ctx.runMutation(internal.discoveryPipeline.saveDiscoveryState, {
      backfillOffset,
      backfillCompletedAt,
      registryTotal,
      lastSweepAt: now,
      lastSweepSummary: summary,
    });

    return {
      searchTerms: SEARCH_VOCABULARY.length,
      searchRequests,
      tailPages,
      backfillPages,
      backfillOffsetBefore,
      backfillOffsetAfter: backfillOffset,
      registryTotal,
      uniqueRecordsSeen: seen.size,
      newCandidates,
      reEvaluated,
      unchangedSkipped,
      rejectedPrefilter: counts.rejectedPrefilter,
      rejectedClassifier: counts.rejectedClassifier,
      pending: counts.pending,
      prefilterByRule,
      byCategory,
      elapsedMs,
      errors,
    };
  },
});

/* ---------------------------------------------------------------------------
 * DEEP EVALUATION - the expensive stages, on the small surviving set only.
 * ------------------------------------------------------------------------ */

export interface DeepEvalReport {
  considered: number;
  evaluated: number;
  published: number;
  delisted: number;
  stillPending: number;
  rejected: number;
  liveness: Record<string, number>;
  crossCheck: Record<string, number>;
  drifted: number;
  icons: Record<string, number>;
  elapsedMs: number;
  errors: string[];
}

export const deepEvaluate = internalAction({
  args: {
    limit: v.optional(v.number()),
    budgetMs: v.optional(v.number()),
    /** Evaluate these specific token ids ahead of the normal queue (submissions). */
    tokenIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<DeepEvalReport> => {
    const startedAt = Date.now();
    const budget = args.budgetMs ?? DEEP_EVAL_BUDGET_MS;
    const errors: string[] = [];

    const batch: Doc<"agentCandidates">[] = await ctx.runQuery(
      internal.discoveryPipeline.selectDeepEvaluationBatch,
      { limit: args.limit ?? DEEP_EVAL_BATCH, tokenIds: args.tokenIds },
    );

    const report: DeepEvalReport = {
      considered: batch.length,
      evaluated: 0,
      published: 0,
      delisted: 0,
      stillPending: 0,
      rejected: 0,
      liveness: { "verified-live": 0, unreachable: 0, "no-endpoint-advertised": 0 },
      crossCheck: { fetched: 0, "no-token-uri": 0, unreachable: 0, "unsupported-transport": 0 },
      drifted: 0,
      icons: { "8004scan-image": 0, "registration-file": 0, "generated-fallback": 0, failed: 0 },
      elapsedMs: 0,
      errors,
    };

    for (const candidate of batch) {
      if (Date.now() > startedAt + budget) break;

      try {
        /* Stage 2b - the agent's own current claim about itself. */
        const registration = await fetchRegistrationFile(candidate.tokenId);
        report.crossCheck[registration.state] = (report.crossCheck[registration.state] ?? 0) + 1;

        const driftNotes: string[] = [];
        if (registration.state === "fetched") {
          if (registration.name && registration.name !== candidate.name) {
            driftNotes.push(
              `the agent's own file calls it "${registration.name}" where 8004scan has "${candidate.name}"`,
            );
          }
          if (
            registration.description &&
            candidate.description &&
            registration.description.trim() !== candidate.description.trim()
          ) {
            driftNotes.push("its own description differs from 8004scan's cached copy");
          }
        }
        if (driftNotes.length > 0) report.drifted++;

        /* Stage 2 - re-score, now including what the agent itself says. */
        const scored = scoreAgent(candidate.name, candidate.description, {
          name: registration.name,
          description: registration.description,
          skills: registration.skills,
        });

        /* Stage 3 - liveness, against every endpoint either source knows about. */
        const directory = await ctx.runQuery(internal.discoveryPipeline.getDirectoryRow, {
          tokenId: candidate.tokenId,
        });
        const endpoints: ProbeEndpoint[] = [
          ...registration.endpoints,
          ...(directory?.services ?? []).map((service) => ({
            protocol: service.name,
            url: service.endpoint,
          })),
        ];
        const liveness = await probeLiveness(endpoints);
        report.liveness[liveness.state] = (report.liveness[liveness.state] ?? 0) + 1;

        const consecutiveProbeFailures =
          liveness.state === "unreachable" ? candidate.consecutiveProbeFailures + 1 : 0;

        /* Stage 4 - the publish gate. */
        const decision = resolveStatus({
          category: scored.category,
          confidence: scored.confidence,
          liveness: liveness.state,
          consecutiveProbeFailures,
          offPrimaryRegistry:
            candidate.registryAddress.toLowerCase() !== ERC8004_IDENTITY_REGISTRY.toLowerCase(),
          manuallyExcluded:
            candidate.manualOverride === "exclude" ||
            MANUALLY_EXCLUDED_TOKEN_IDS.has(candidate.tokenId),
          currentlyPublished: candidate.status === "published",
        });

        /* Icon sourcing (Task 4) - part of onboarding, so it runs here. */
        const iconOutcome = await sourceIcon(ctx, {
          tokenId: candidate.tokenId,
          scanIconUrl: directory?.iconUrl ?? candidate.scanIconUrl,
          registrationIconUrl: registration.iconUrl,
          alreadyCached: (directory?.iconSource ?? null) !== null,
        });
        if (iconOutcome) {
          report.icons[iconOutcome] = (report.icons[iconOutcome] ?? 0) + 1;
        }

        const wasPublished = candidate.status === "published";
        await ctx.runMutation(internal.discoveryPipeline.applyDeepEvaluation, {
          id: candidate._id,
          status: decision.status,
          statusReason: decision.reason,
          category: scored.category,
          confidence: scored.confidence,
          score: scored.score,
          runnerUpCategory: scored.runnerUp?.category ?? null,
          runnerUpScore: scored.runnerUp?.score ?? null,
          matchedTerms: scored.signals
            .filter((s) => s.category === scored.category)
            .map((s) => s.detail),
          classificationEvidence: [
            ...scored.signals.map((s) => `+${s.weight} ${s.category}: ${s.detail}`),
            ...scored.penalties.map((p) => `${p.amount} penalty: ${p.detail}`),
            ...driftNotes.map((d) => `cross-check: ${d}`),
          ],
          shortfall: explainShortfall(scored),
          crossCheckState: registration.state,
          crossCheckTokenUri: registration.tokenUri,
          crossCheckDrift: driftNotes.length > 0 ? driftNotes.join("; ") : null,
          livenessState: liveness.state,
          livenessProtocol: liveness.protocol,
          livenessUrl: liveness.probedUrl,
          livenessDetail: liveness.detail,
          livenessCheckedAt: liveness.checkedAt,
          consecutiveProbeFailures,
          evaluatedAt: new Date().toISOString(),
        });

        report.evaluated++;
        if (decision.status === "published") {
          report.published++;
        } else if (decision.status === "pending") {
          report.stillPending++;
          if (wasPublished) report.delisted++;
        } else {
          report.rejected++;
          if (wasPublished) report.delisted++;
        }
      } catch (error) {
        errors.push(
          `${candidate.tokenId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    report.elapsedMs = Date.now() - startedAt;
    return report;
  },
});

/**
 * Sources and CACHES one agent's icon. Returns which tier supplied it, or null
 * when the agent already had a cached icon and nothing needed doing.
 *
 * Tiers 1 and 2 are fetched once and stored; tier 3 is generated in-process and
 * stored too, so every listed agent ends up served from Dolphin's own storage
 * and no render depends on a third-party host.
 */
async function sourceIcon(
  ctx: ActionCtx,
  input: {
    tokenId: string;
    scanIconUrl: string | null;
    registrationIconUrl: string | null;
    alreadyCached: boolean;
  },
): Promise<IconSource | "failed" | null> {
  if (input.alreadyCached) return null;

  const attempts: { source: IconSource; url: string }[] = [];
  if (input.scanIconUrl) attempts.push({ source: "8004scan-image", url: input.scanIconUrl });
  if (input.registrationIconUrl && input.registrationIconUrl !== input.scanIconUrl) {
    attempts.push({ source: "registration-file", url: input.registrationIconUrl });
  }

  for (const attempt of attempts) {
    try {
      const icon = await fetchIcon(attempt.url);
      const storageId = await ctx.storage.store(icon.blob);
      await ctx.runMutation(internal.discoveryPipeline.setAgentIcon, {
        tokenId: input.tokenId,
        storageId,
        source: attempt.source,
        originUrl: attempt.url,
      });
      return attempt.source;
    } catch {
      // Fall through to the next tier. A publisher's broken image URL is not an
      // error worth failing an evaluation over.
    }
  }

  try {
    const { blob } = fallbackIconBlob(input.tokenId);
    const storageId = await ctx.storage.store(blob);
    await ctx.runMutation(internal.discoveryPipeline.setAgentIcon, {
      tokenId: input.tokenId,
      storageId,
      source: "generated-fallback" satisfies IconSource,
      originUrl: null,
    });
    return "generated-fallback";
  } catch {
    return "failed";
  }
}

/* ---------------------------------------------------------------------------
 * Mutations and queries the actions above drive.
 * ------------------------------------------------------------------------ */

const sweepRecordValidator = v.object({
  tokenId: v.string(),
  name: v.string(),
  description: v.string(),
  scanIconUrl: v.union(v.string(), v.null()),
  ownerAddress: v.string(),
  registeredAt: v.union(v.string(), v.null()),
  x402Supported: v.union(v.boolean(), v.null()),
  status: v.union(
    v.literal("rejected-prefilter"),
    v.literal("rejected-classifier"),
    v.literal("pending"),
    v.literal("published"),
  ),
  statusReason: v.string(),
  prefilterRule: v.union(v.string(), v.null()),
  category: v.union(agentCategoryValidator, v.null()),
  confidence: v.union(v.literal("confirmed"), v.literal("likely"), v.null()),
  score: v.union(v.number(), v.null()),
  runnerUpCategory: v.union(agentCategoryValidator, v.null()),
  runnerUpScore: v.union(v.number(), v.null()),
  matchedTerms: v.array(v.string()),
  classificationEvidence: v.array(v.string()),
  shortfall: v.union(v.string(), v.null()),
});

export const recordSweepBatch = internalMutation({
  args: {
    records: v.array(sweepRecordValidator),
    source: v.string(),
    seenAt: v.string(),
  },
  handler: async (ctx, { records, source, seenAt }) => {
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;

    for (const record of records) {
      const existing = await ctx.db
        .query("agentCandidates")
        .withIndex("by_agent", (q) =>
          q
            .eq("chainId", BSC_CHAIN_ID)
            .eq("registryAddress", ERC8004_IDENTITY_REGISTRY)
            .eq("tokenId", record.tokenId),
        )
        .unique();

      if (!existing) {
        await ctx.db.insert("agentCandidates", {
          chainId: BSC_CHAIN_ID,
          registryAddress: ERC8004_IDENTITY_REGISTRY,
          ...record,
          source,
          crossCheckState: null,
          crossCheckTokenUri: null,
          crossCheckDrift: null,
          livenessState: null,
          livenessProtocol: null,
          livenessUrl: null,
          livenessDetail: null,
          livenessCheckedAt: null,
          consecutiveProbeFailures: 0,
          manualOverride: null,
          submittedAt: null,
          firstSeenAt: seenAt,
          lastSeenAt: seenAt,
          lastEvaluatedAt: seenAt,
          lastDeepEvaluatedAt: null,
        });
        inserted++;
        continue;
      }

      // A record whose 8004scan text has not changed needs nothing but a
      // liveness bump on `lastSeenAt`. This is the whole point of the ledger:
      // ~280,000 already-rejected records must not be re-processed every cycle.
      const textUnchanged =
        existing.name === record.name && existing.description === record.description;

      if (textUnchanged && existing.lastDeepEvaluatedAt !== null) {
        await ctx.db.patch(existing._id, { lastSeenAt: seenAt });
        unchanged++;
        continue;
      }

      // A published or manually-overridden row is never demoted by the cheap
      // pass - only the deep evaluation, which has the liveness evidence, may
      // change a published agent's status.
      const keepStatus = existing.status === "published" || existing.manualOverride !== null;

      await ctx.db.patch(existing._id, {
        name: record.name,
        description: record.description,
        scanIconUrl: record.scanIconUrl,
        ownerAddress: record.ownerAddress || existing.ownerAddress,
        registeredAt: record.registeredAt ?? existing.registeredAt,
        x402Supported: record.x402Supported,
        ...(keepStatus
          ? {}
          : {
              status: record.status,
              statusReason: record.statusReason,
              prefilterRule: record.prefilterRule,
              category: record.category,
              confidence: record.confidence,
              score: record.score,
              runnerUpCategory: record.runnerUpCategory,
              runnerUpScore: record.runnerUpScore,
              matchedTerms: record.matchedTerms,
              classificationEvidence: record.classificationEvidence,
              shortfall: record.shortfall,
            }),
        lastSeenAt: seenAt,
        lastEvaluatedAt: seenAt,
      });
      updated++;
    }

    return { inserted, updated, unchanged };
  },
});

export const selectDeepEvaluationBatch = internalQuery({
  args: { limit: v.number(), tokenIds: v.optional(v.array(v.string())) },
  handler: async (ctx, { limit, tokenIds }): Promise<Doc<"agentCandidates">[]> => {
    if (tokenIds && tokenIds.length > 0) {
      const rows: Doc<"agentCandidates">[] = [];
      for (const tokenId of tokenIds) {
        const row = await ctx.db
          .query("agentCandidates")
          .withIndex("by_token", (q) => q.eq("chainId", BSC_CHAIN_ID).eq("tokenId", tokenId))
          .first();
        if (row) rows.push(row);
      }
      return rows;
    }

    const now = Date.now();
    const picked: Doc<"agentCandidates">[] = [];

    // Priority order: never-deep-evaluated candidates first (a real agent
    // sitting unseen is the costliest state), then published agents due a
    // re-probe, then stale rejections due reconsideration.
    for (const status of ["pending", "published", "rejected-classifier"] as const) {
      if (picked.length >= limit) break;
      const rows = await ctx.db
        .query("agentCandidates")
        .withIndex("by_status_evaluated", (q) => q.eq("status", status))
        .order("asc")
        .take(limit * 4);
      for (const row of rows) {
        if (picked.length >= limit) break;
        if (needsDeepEvaluation(row, now)) picked.push(row);
      }
    }

    return picked;
  },
});

export const applyDeepEvaluation = internalMutation({
  args: {
    id: v.id("agentCandidates"),
    status: v.union(
      v.literal("rejected-prefilter"),
      v.literal("rejected-classifier"),
      v.literal("pending"),
      v.literal("published"),
    ),
    statusReason: v.string(),
    category: v.union(agentCategoryValidator, v.null()),
    confidence: v.union(v.literal("confirmed"), v.literal("likely"), v.null()),
    score: v.union(v.number(), v.null()),
    runnerUpCategory: v.union(agentCategoryValidator, v.null()),
    runnerUpScore: v.union(v.number(), v.null()),
    matchedTerms: v.array(v.string()),
    classificationEvidence: v.array(v.string()),
    shortfall: v.union(v.string(), v.null()),
    crossCheckState: v.union(v.string(), v.null()),
    crossCheckTokenUri: v.union(v.string(), v.null()),
    crossCheckDrift: v.union(v.string(), v.null()),
    livenessState: v.union(v.string(), v.null()),
    livenessProtocol: v.union(v.string(), v.null()),
    livenessUrl: v.union(v.string(), v.null()),
    livenessDetail: v.union(v.string(), v.null()),
    livenessCheckedAt: v.union(v.string(), v.null()),
    consecutiveProbeFailures: v.number(),
    evaluatedAt: v.string(),
  },
  handler: async (ctx, { id, evaluatedAt, ...fields }) => {
    const candidate = await ctx.db.get(id);
    if (!candidate) return;

    await ctx.db.patch(id, {
      ...fields,
      lastEvaluatedAt: evaluatedAt,
      lastDeepEvaluatedAt: evaluatedAt,
    });

    // Publication is a write to `discoveredAgents`, which is what
    // agents.listAgents already merges into the catalog. Keeping that as the
    // published surface means neither frontend changes at all: the pipeline
    // decides what goes in, the existing read path is untouched.
    const existingPublished = await ctx.db
      .query("discoveredAgents")
      .withIndex("by_agent", (q) =>
        q.eq("chainId", BSC_CHAIN_ID).eq("tokenId", candidate.tokenId),
      )
      .unique();

    if (fields.status === "published" && fields.category && fields.confidence) {
      const document = {
        chainId: BSC_CHAIN_ID,
        tokenId: candidate.tokenId,
        name: candidate.name,
        description: candidate.description,
        iconUrl: candidate.scanIconUrl,
        ownerAddress: candidate.ownerAddress,
        category: fields.category,
        confidence: fields.confidence,
        matchedTerms: fields.matchedTerms.slice(0, 8),
        x402Supported: candidate.x402Supported ?? false,
        registeredAt: candidate.registeredAt,
        syncedAt: evaluatedAt,
      };
      if (existingPublished) await ctx.db.patch(existingPublished._id, document);
      else await ctx.db.insert("discoveredAgents", document);
    } else if (existingPublished) {
      // Delisted. The evaluation record survives in agentCandidates with its
      // reason, so this is reversible by one successful probe - and a user can
      // never be sent to an agent Dolphin currently believes is dead.
      await ctx.db.delete(existingPublished._id);
    }
  },
});

export const setAgentIcon = internalMutation({
  args: {
    tokenId: v.string(),
    storageId: v.id("_storage"),
    source: v.string(),
    originUrl: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { tokenId, storageId, source }) => {
    const existing = await ctx.db
      .query("agentDirectory")
      .withIndex("by_agent", (q) => q.eq("chainId", BSC_CHAIN_ID).eq("tokenId", tokenId))
      .unique();

    const iconFields = {
      iconStorageId: storageId,
      iconSource: source,
      iconCheckedAt: new Date().toISOString(),
    };

    if (existing) {
      // Replacing an icon leaves the old blob orphaned; delete it so storage
      // does not grow without bound across re-evaluations.
      if (existing.iconStorageId && existing.iconStorageId !== storageId) {
        await ctx.storage.delete(existing.iconStorageId);
      }
      await ctx.db.patch(existing._id, iconFields);
      return;
    }

    // An agent can be onboarded before its 8004scan directory row exists. Insert
    // a minimal row so the icon is not lost; agents.refreshAgentDirectory fills
    // in the rest on its next pass and cannot clobber these fields.
    const now = new Date().toISOString();
    await ctx.db.insert("agentDirectory", {
      chainId: BSC_CHAIN_ID,
      tokenId,
      name: null,
      description: null,
      iconUrl: null,
      publisher: null,
      ownerAddress: null,
      agentWallet: null,
      registeredAt: null,
      tags: [],
      services: [],
      x402Supported: null,
      isActive: null,
      reputationScore: null,
      feedbackCount: null,
      endpointStatus: null,
      endpointCheckedAt: null,
      indexedAt: now,
      refreshedAt: now,
      ...iconFields,
    });
  },
});

export const getDirectoryRow = internalQuery({
  args: { tokenId: v.string() },
  handler: async (ctx, { tokenId }) =>
    ctx.db
      .query("agentDirectory")
      .withIndex("by_agent", (q) => q.eq("chainId", BSC_CHAIN_ID).eq("tokenId", tokenId))
      .unique(),
});

export const getDiscoveryState = internalQuery({
  args: {},
  handler: async (ctx) =>
    ctx.db
      .query("discoveryState")
      .withIndex("by_key", (q) => q.eq("key", "bsc-sweep"))
      .unique(),
});

export const saveDiscoveryState = internalMutation({
  args: {
    backfillOffset: v.number(),
    backfillCompletedAt: v.union(v.string(), v.null()),
    registryTotal: v.union(v.number(), v.null()),
    lastSweepAt: v.union(v.string(), v.null()),
    lastSweepSummary: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("discoveryState")
      .withIndex("by_key", (q) => q.eq("key", "bsc-sweep"))
      .unique();
    if (existing) await ctx.db.patch(existing._id, args);
    else await ctx.db.insert("discoveryState", { key: "bsc-sweep", ...args });
  },
});

/* ---------------------------------------------------------------------------
 * The manual safety valve (Task 6.3), runtime half.
 * ------------------------------------------------------------------------ */

/**
 * Hand-corrects one agent the automated pipeline got wrong, without a deploy.
 * The compile-time denylist (MANUALLY_EXCLUDED_TOKEN_IDS) is unchanged and
 * still authoritative; this is the same capability for cases found after one.
 *
 * An "exclude" override delists immediately and survives every later sweep:
 * recordSweepBatch refuses to touch the status of an overridden row.
 */
export const setManualOverride = mutation({
  args: {
    tokenId: v.string(),
    override: v.union(v.literal("exclude"), v.literal("include"), v.null()),
    reason: v.string(),
  },
  handler: async (ctx, { tokenId, override, reason }) => {
    const candidate = await ctx.db
      .query("agentCandidates")
      .withIndex("by_token", (q) => q.eq("chainId", BSC_CHAIN_ID).eq("tokenId", tokenId))
      .first();
    if (!candidate) {
      throw new Error(`No candidate record exists for token ${tokenId}.`);
    }

    await ctx.db.patch(candidate._id, {
      manualOverride: override,
      statusReason: `Manual override (${override ?? "cleared"}): ${reason}`,
      ...(override === "exclude" ? { status: "rejected-classifier" as const } : {}),
    });

    if (override === "exclude") {
      const published = await ctx.db
        .query("discoveredAgents")
        .withIndex("by_agent", (q) => q.eq("chainId", BSC_CHAIN_ID).eq("tokenId", tokenId))
        .unique();
      if (published) await ctx.db.delete(published._id);
    }

    return { tokenId, override, status: override === "exclude" ? "rejected-classifier" : candidate.status };
  },
});

/* ---------------------------------------------------------------------------
 * Reporting
 * ------------------------------------------------------------------------ */

/** The funnel, as it actually stands. Used to report real numbers, not projections. */
export const getPipelineStats = query({
  args: {},
  handler: async (ctx) => {
    const state = await ctx.db
      .query("discoveryState")
      .withIndex("by_key", (q) => q.eq("key", "bsc-sweep"))
      .unique();

    const byStatus: Record<string, number> = {
      "rejected-prefilter": 0,
      "rejected-classifier": 0,
      pending: 0,
      published: 0,
    };
    const byCategory: Record<string, number> = {};
    const byLiveness: Record<string, number> = {};
    let deepEvaluated = 0;

    for await (const row of ctx.db.query("agentCandidates")) {
      byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
      if (row.lastDeepEvaluatedAt !== null) deepEvaluated++;
      if (row.status === "published" && row.category) {
        byCategory[row.category] = (byCategory[row.category] ?? 0) + 1;
      }
      if (row.livenessState) {
        byLiveness[row.livenessState] = (byLiveness[row.livenessState] ?? 0) + 1;
      }
    }

    const directory = await ctx.db.query("agentDirectory").collect();
    const iconsBySource: Record<string, number> = {};
    for (const row of directory) {
      const key = row.iconSource ?? "none";
      iconsBySource[key] = (iconsBySource[key] ?? 0) + 1;
    }

    return {
      registryTotal: state?.registryTotal ?? null,
      backfillOffset: state?.backfillOffset ?? 0,
      backfillCompletedAt: state?.backfillCompletedAt ?? null,
      lastSweepAt: state?.lastSweepAt ?? null,
      lastSweepSummary: state?.lastSweepSummary ?? null,
      candidates: byStatus,
      deepEvaluated,
      publishedByCategory: byCategory,
      livenessByState: byLiveness,
      iconsBySource,
      delistAfterConsecutiveFailures: DELIST_AFTER_CONSECUTIVE_FAILURES,
    };
  },
});

/** Inspect one band of the funnel - what is pending, and exactly why. */
export const listCandidates = query({
  args: {
    status: v.union(
      v.literal("rejected-prefilter"),
      v.literal("rejected-classifier"),
      v.literal("pending"),
      v.literal("published"),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { status, limit }) =>
    ctx.db
      .query("agentCandidates")
      .withIndex("by_status_evaluated", (q) => q.eq("status", status))
      .order("desc")
      .take(limit ?? 50),
});

/* ---------------------------------------------------------------------------
 * Manual triggers, so every stage can be run and verified by hand.
 * ------------------------------------------------------------------------ */

export const runSweepNow = action({
  args: { skipBackfill: v.optional(v.boolean()), budgetMs: v.optional(v.number()) },
  handler: async (ctx, args): Promise<SweepReport> =>
    ctx.runAction(internal.discoveryPipeline.sweep, args),
});

export const runDeepEvaluationNow = action({
  args: {
    limit: v.optional(v.number()),
    budgetMs: v.optional(v.number()),
    tokenIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<DeepEvalReport> =>
    ctx.runAction(internal.discoveryPipeline.deepEvaluate, args),
});
