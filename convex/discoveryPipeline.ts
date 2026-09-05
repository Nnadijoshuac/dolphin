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
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
} from "./_generated/server";
import { agentCategoryValidator } from "./categoryStatsValidators";
import {
  AGENT_CATEGORY_SLUGS,
  EDITORIAL_TOKEN_IDS,
  ERC8004_IDENTITY_REGISTRY,
  type AgentCategory,
} from "./lib/agentCatalog";
import {
  SCORING_RULESET_VERSION,
  explainShortfall,
  scoreAgent,
} from "./lib/agentScoring";
import { fallbackIconBlob, fetchIcon, type IconSource } from "./lib/agentIcons";
import { BSC_CHAIN_ID } from "./lib/bscClient";
import { probeLiveness, type ProbeEndpoint } from "./lib/liveness";
import {
  PREFILTER_RULES,
  PREFILTER_RULE_REASONS,
  hashCandidateText,
  prefilterAgent,
  type PrefilterRule,
} from "./lib/prefilter";
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

/**
 * Hard ceiling on how many records one sweep holds in memory and writes.
 *
 * MEASURED, NOT GUESSED. An unbounded backfill run was tried first and the
 * Convex action was killed with no error message - the sweep had accumulated
 * tens of thousands of records in a Map and then tried to judge and persist all
 * of them at the end of the same invocation. Capping the batch keeps one sweep
 * inside the runtime's memory and time limits, and costs nothing in coverage:
 * the backfill offset is persisted, so the next cycle resumes exactly where
 * this one stopped. Being incremental is the design, not a compromise.
 */
const MAX_RECORDS_PER_SWEEP = 8_000;
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
 * generous. Terms are the categories' own language plus the protocol names
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
  // trading
  //
  // ADDED 2026-09-05, and it is the reason the Trading category was empty.
  // `trading` became a browsable category on 2026-09-03 (agentScoring.ts and
  // agentCatalog.ts both), but this list - which decides what 8004scan is
  // actually ASKED for - was never extended, so the highest-yield sweep path
  // has never once requested a trading agent. The other two paths could only
  // have found one by accident.
  //
  // Every term below is drawn from the same place the other categories' terms
  // were: the `defining` and `supporting` tiers of agentScoring.ts's `trading`
  // entry, which were themselves measured against real registry rows. No term
  // is here because it sounds like it should exist.
  //
  // Bare "trading" and "trade" are deliberately ABSENT. They are the opening
  // words of the four largest mass-registration templates on the registry
  // (Ave.ai's "AI-driven multi-chain trading agent" at 630/2000 of the Task 0
  // sample, "autonomous trading agent (simple-mode)" at 131/1446 of the topical
  // union, the Aster DEX perp series at 38, Debot at 48). Asking for them would
  // spend five pages per term retrieving records the pre-filter already rejects
  // by exact template match - real request budget for a guaranteed zero.
  "trading strategy", "algorithmic trading", "systematic trading",
  "trade execution", "momentum trading", "trend following", "stop loss",
  "take profit", "limit order", "dollar-cost averaging", "position sizing",
  "trading signal", "backtest", "entry and exit",
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
      statusReason: scored.rejectionReason ?? "Not classifiable into any browsable category.",
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
    /** Skip the search sweep - used when verifying the backfill on its own. */
    skipSearch: v.optional(v.boolean()),
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
    if (args.skipSearch !== true) await withConcurrency(
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
      while (
        Date.now() < startedAt + totalBudget &&
        seen.size < MAX_RECORDS_PER_SWEEP
      ) {
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

      const textHash = hashCandidateText(name, description);

      /*
       * A PREFILTER REJECTION IS STORED NARROW.
       *
       * These are 251,922 of the 257,991 rows in the table and they exist to
       * answer exactly one question on a later sweep: has this record changed
       * since we rejected it? `textHash` answers that in 16 bytes, so none of
       * the text, the icon URL, the owner or the written-out reason is kept -
       * the description that got a record rejected was the single largest
       * contributor to the 349 MB of documents that took this deployment over
       * its storage ceiling and switched the sweep off.
       *
       * What survives is what makes a rejection auditable: the tokenId, the
       * rule that fired, and when it was seen. The sentence is derivable from
       * the rule (PREFILTER_RULE_REASONS) and the record itself is one 8004scan
       * fetch away by tokenId, so nothing here is unrecoverable - it is simply
       * not duplicated a quarter of a million times.
       */
      if (verdict.status === "rejected-prefilter") {
        return {
          tokenId: item.token_id,
          name: "",
          description: "",
          textHash,
          scanIconUrl: null,
          ownerAddress: "",
          registeredAt: null,
          x402Supported: null,
          status: verdict.status,
          statusReason: "",
          prefilterRule: verdict.prefilterRule,
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

      return {
        tokenId: item.token_id,
        name,
        description,
        textHash,
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
          manuallyIncluded: candidate.manualOverride === "include",
          currentlyPublished: candidate.status === "published",
        });

        /*
         * Icon sourcing (Task 4) - ONLY for an agent the gate just published.
         *
         * This used to run for every deep-evaluated candidate, before the
         * decision above was consulted. An icon is fetched from a third party
         * and its BYTES ARE STORED, so a rejected agent left a stored image
         * behind that nothing ever renders: agentDirectory holds 6,070 rows
         * with a cached icon against 27 agents that are actually listed. At a
         * 2 MB per-icon cap that is the largest single storage sink in this
         * deployment and it was never counted - the cron note blamed
         * agentCandidates alone.
         *
         * Nothing is lost by waiting. A pending agent that later goes live gets
         * its icon on the pass that publishes it, and ensureCatalogIcons sweeps
         * published + editorial every 12 hours as a backstop.
         */
        if (decision.status === "published") {
          const iconOutcome = await sourceIcon(ctx, {
            tokenId: candidate.tokenId,
            scanIconUrl: directory?.iconUrl ?? candidate.scanIconUrl,
            registrationIconUrl: registration.iconUrl,
            alreadyCached: (directory?.iconSource ?? null) !== null,
          });
          if (iconOutcome) {
            report.icons[iconOutcome] = (report.icons[iconOutcome] ?? 0) + 1;
          }
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
  textHash: v.optional(v.string()),
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


/**
 * Keeps the running ledger counters in `discoveryState` correct.
 *
 * These exist because getPipelineStats used to derive them by scanning
 * agentCandidates, which worked at a few thousand rows and then failed outright
 * once the backfill had run: Convex caps one function execution at 16MB of
 * reads and the ledger crosses that at roughly 12,000 rows. The registry is
 * 291,543, so the ledger only grows - a scan was never going to be the answer.
 *
 * `from` is null for a newly inserted row.
 */
const LEDGER_FIELD: Record<CandidateStatus, "ledgerRejectedPrefilter" | "ledgerRejectedClassifier" | "ledgerPending" | "ledgerPublished"> = {
  "rejected-prefilter": "ledgerRejectedPrefilter",
  "rejected-classifier": "ledgerRejectedClassifier",
  pending: "ledgerPending",
  published: "ledgerPublished",
};

async function adjustLedger(
  ctx: MutationCtx,
  from: CandidateStatus | null,
  to: CandidateStatus,
): Promise<void> {
  if (from === to) return;

  const state = await ctx.db
    .query("discoveryState")
    .withIndex("by_key", (q) => q.eq("key", "bsc-sweep"))
    .unique();
  if (!state) return; // The first sweep creates it; nothing to adjust before then.

  const patch: Record<string, number> = {};
  if (from === null) {
    patch.ledgerTotal = (state.ledgerTotal ?? 0) + 1;
  } else {
    const fromField = LEDGER_FIELD[from];
    patch[fromField] = Math.max(0, (state[fromField] ?? 0) - 1);
  }
  const toField = LEDGER_FIELD[to];
  patch[toField] = (patch[toField] ?? state[toField] ?? 0) + 1;

  await ctx.db.patch(state._id, patch);
}

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
          rulesetVersion: SCORING_RULESET_VERSION,
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
        await adjustLedger(ctx, null, record.status);
        inserted++;
        continue;
      }

      // A record whose 8004scan text has not changed needs nothing but a bump
      // on `lastSeenAt`. This is the whole point of the ledger: ~280,000
      // already-rejected records must not be re-processed every cycle.
      //
      // The condition is text alone, deliberately. The cheap verdict is a pure
      // function of (name, description) - same text in, same pre-filter rule and
      // same score out - so re-deriving it changes nothing. An earlier version
      // also required `lastDeepEvaluatedAt !== null`, which was wrong: a
      // pre-filter rejection is never deep-evaluated, so that field stays null
      // forever and every rejected record was re-judged and re-patched on every
      // single cycle. A live backfill run measured it re-writing 8,296 of 8,300
      // records it had already judged an hour earlier.
      /*
       * Compared by fingerprint, not by the text itself.
       *
       * A `rejected-prefilter` row no longer stores its name or description, so
       * a direct text comparison would find "" === "" on every one of them and
       * report every record as unchanged forever - including ones whose
       * publisher had rewritten them into something real.
       *
       * Rows written before textHash existed still carry their text, so their
       * fingerprint is computed on the spot from what they do have. That is what
       * makes this correct during the migration rather than only after it.
       */
      const incomingHash =
        record.textHash ?? hashCandidateText(record.name, record.description);
      const storedHash =
        existing.textHash ?? hashCandidateText(existing.name, existing.description);
      const textUnchanged = incomingHash === storedHash;

      /*
       * ...and the rules that produced the stored verdict are still the current
       * ones. Added 2026-09-05.
       *
       * "Same text in, same score out" holds only within ONE version of
       * agentScoring.ts. When `trading` was added as a category, every row in
       * the ledger had unchanged text and was therefore skipped here, so the
       * new category was never applied to a single existing record. The skip
       * was silently preserving verdicts the scorer would no longer give.
       *
       * A prefilter rejection is exempt: it never reached the scorer, so a
       * scorer version tells us nothing about it, and re-judging 251,922 of
       * them on a scorer bump would be pure cost.
       */
      const rulesetCurrent =
        record.status === "rejected-prefilter" ||
        existing.status === "rejected-prefilter" ||
        (existing.rulesetVersion ?? 0) >= SCORING_RULESET_VERSION;

      if (textUnchanged && rulesetCurrent) {
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
        textHash: record.textHash,
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
              rulesetVersion: SCORING_RULESET_VERSION,
            }),
        lastSeenAt: seenAt,
        lastEvaluatedAt: seenAt,
      });
      if (!keepStatus) await adjustLedger(ctx, existing.status, record.status);
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
      // The deep pass re-scores (see the scoreAgent call in deepEvaluate), so
      // this row's verdict is now the current ruleset's. Stamping it here is
      // what stops it being re-judged on every subsequent pass.
      rulesetVersion: SCORING_RULESET_VERSION,
      lastEvaluatedAt: evaluatedAt,
      lastDeepEvaluatedAt: evaluatedAt,
    });
    await adjustLedger(ctx, candidate.status, fields.status);

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
      ...(override === "exclude"
        ? { status: "rejected-classifier" as const }
        : // An "include" or a cleared override does not publish anything by
          // itself - it re-opens the agent for the normal deep evaluation, which
          // still has to find a live endpoint before anything is listed.
          { lastDeepEvaluatedAt: null }),
    });

    if (override === "exclude") {
      await adjustLedger(ctx, candidate.status, "rejected-classifier");
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

    // Only the two SMALL bands are read row by row. The two rejection bands are
    // tens of thousands of rows and are reported from the maintained counters -
    // see adjustLedger above for why that is not optional.
    const pending = await ctx.db
      .query("agentCandidates")
      .withIndex("by_status_evaluated", (q) => q.eq("status", "pending"))
      .collect();
    const published = await ctx.db
      .query("agentCandidates")
      .withIndex("by_status_evaluated", (q) => q.eq("status", "published"))
      .collect();

    const byCategory: Record<string, number> = {};
    const byLiveness: Record<string, number> = {};
    let deepEvaluated = 0;
    for (const row of [...pending, ...published]) {
      if (row.lastDeepEvaluatedAt !== null) deepEvaluated++;
      if (row.livenessState) {
        byLiveness[row.livenessState] = (byLiveness[row.livenessState] ?? 0) + 1;
      }
    }
    for (const row of published) {
      if (row.category) byCategory[row.category] = (byCategory[row.category] ?? 0) + 1;
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
      ledgerTotal: state?.ledgerTotal ?? 0,
      candidates: {
        "rejected-prefilter": state?.ledgerRejectedPrefilter ?? 0,
        "rejected-classifier": state?.ledgerRejectedClassifier ?? 0,
        pending: pending.length,
        published: published.length,
      },
      deepEvaluatedInLiveBands: deepEvaluated,
      publishedByCategory: byCategory,
      livenessByState: byLiveness,
      iconsBySource,
      delistAfterConsecutiveFailures: DELIST_AFTER_CONSECUTIVE_FAILURES,
    };
  },
});

/**
 * One-shot repair for the ledger counters: recounts every band by paginating
 * the index, then writes the totals back.
 *
 * Needed once because the counters were added after the ledger already held
 * ~12,000 rows, and worth keeping because a counter maintained by deltas can in
 * principle drift. Paginated so it never trips the same 16MB read cap that made
 * the counters necessary in the first place.
 */
export const recountLedger = internalAction({
  args: {},
  handler: async (ctx): Promise<Record<string, number>> => {
    const totals: Record<string, number> = {};
    for (const status of [
      "rejected-prefilter",
      "rejected-classifier",
      "pending",
      "published",
    ] as const) {
      let cursor: string | null = null;
      let count = 0;
      for (;;) {
        const page: { count: number; cursor: string | null; isDone: boolean } =
          await ctx.runQuery(internal.discoveryPipeline.countLedgerPage, { status, cursor });
        count += page.count;
        if (page.isDone) break;
        cursor = page.cursor;
      }
      totals[status] = count;
    }
    await ctx.runMutation(internal.discoveryPipeline.writeLedgerCounts, {
      rejectedPrefilter: totals["rejected-prefilter"],
      rejectedClassifier: totals["rejected-classifier"],
      pending: totals["pending"],
      published: totals["published"],
    });
    return totals;
  },
});

export const countLedgerPage = internalQuery({
  args: {
    status: v.union(
      v.literal("rejected-prefilter"),
      v.literal("rejected-classifier"),
      v.literal("pending"),
      v.literal("published"),
    ),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { status, cursor }) => {
    const page = await ctx.db
      .query("agentCandidates")
      .withIndex("by_status_evaluated", (q) => q.eq("status", status))
      .paginate({ cursor, numItems: 2000 });
    return { count: page.page.length, cursor: page.continueCursor, isDone: page.isDone };
  },
});

export const writeLedgerCounts = internalMutation({
  args: {
    rejectedPrefilter: v.number(),
    rejectedClassifier: v.number(),
    pending: v.number(),
    published: v.number(),
  },
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("discoveryState")
      .withIndex("by_key", (q) => q.eq("key", "bsc-sweep"))
      .unique();
    if (!state) return;
    await ctx.db.patch(state._id, {
      ledgerRejectedPrefilter: args.rejectedPrefilter,
      ledgerRejectedClassifier: args.rejectedClassifier,
      ledgerPending: args.pending,
      ledgerPublished: args.published,
      ledgerTotal:
        args.rejectedPrefilter + args.rejectedClassifier + args.pending + args.published,
    });
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
  handler: async (ctx, { status, limit }) => {
    const rows = await ctx.db
      .query("agentCandidates")
      .withIndex("by_status_evaluated", (q) => q.eq("status", status))
      .order("desc")
      .take(limit ?? 50);

    /*
     * A narrowed prefilter rejection stores no statusReason - the sentence is
     * derivable from `prefilterRule`, and persisting it 251,922 times was tens
     * of megabytes of prose restating the rule id beside it.
     *
     * Derived here rather than left blank so this query keeps its contract: a
     * caller reading a row still gets a sentence saying why the agent is where
     * it is, which is the whole reason the ledger is described as an audit
     * trail. Only the per-record specifics are gone ("Description is 12
     * characters" becomes the rule's general statement).
     */
    return rows.map((row) =>
      row.statusReason === "" && row.prefilterRule
        ? {
            ...row,
            statusReason:
              PREFILTER_RULE_REASONS[row.prefilterRule as PrefilterRule] ??
              `Rejected by the ${row.prefilterRule} rule.`,
          }
        : row,
    );
  },
});

/**
 * Makes sure EVERY agent the catalog lists has a cached icon - including the
 * eight hand-vetted editorial agents, which never pass through the candidate
 * pipeline and so would otherwise be the only listings still hotlinking (or
 * showing nothing).
 *
 * Task 4 is "every agent gets a real icon", and an editorial agent with a blank
 * tile is just as bad for the store framing as a discovered one. Cheap and
 * idempotent: it skips anything that already has a cached icon, so it costs
 * nothing on a steady-state run.
 */
export const ensureCatalogIcons = internalAction({
  args: { includeFallback: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<Record<string, number>> => {
    const targets: { tokenId: string; scanIconUrl: string | null; cached: boolean }[] =
      await ctx.runQuery(internal.discoveryPipeline.listIconTargets, {});

    const counts: Record<string, number> = {
      "8004scan-image": 0,
      "registration-file": 0,
      "generated-fallback": 0,
      failed: 0,
      skipped: 0,
    };

    for (const target of targets) {
      if (target.cached) {
        counts.skipped++;
        continue;
      }
      // Only fetch the registration file when the cheaper source is missing -
      // this pass exists to fill gaps, not to re-do the deep evaluation.
      const registrationIconUrl =
        target.scanIconUrl === null
          ? (await fetchRegistrationFile(target.tokenId)).iconUrl
          : null;

      const outcome = await sourceIcon(ctx, {
        tokenId: target.tokenId,
        scanIconUrl: target.scanIconUrl,
        registrationIconUrl,
        alreadyCached: false,
      });
      if (outcome) counts[outcome] = (counts[outcome] ?? 0) + 1;
    }

    return counts;
  },
});

export const listIconTargets = internalQuery({
  args: {},
  handler: async (ctx) => {
    const published = await ctx.db
      .query("discoveredAgents")
      .withIndex("by_agent", (q) => q.eq("chainId", BSC_CHAIN_ID))
      .collect();

    const tokenIds = [
      ...new Set([...EDITORIAL_TOKEN_IDS, ...published.map((row) => row.tokenId)]),
    ];

    const targets: { tokenId: string; scanIconUrl: string | null; cached: boolean }[] = [];
    for (const tokenId of tokenIds) {
      const directory = await ctx.db
        .query("agentDirectory")
        .withIndex("by_agent", (q) => q.eq("chainId", BSC_CHAIN_ID).eq("tokenId", tokenId))
        .unique();
      targets.push({
        tokenId,
        scanIconUrl: directory?.iconUrl ?? null,
        cached: (directory?.iconSource ?? null) !== null,
      });
    }
    return targets;
  },
});

/* ---------------------------------------------------------------------------
 * STORAGE RECLAMATION
 *
 * Two one-off passes that undo what two bugs accumulated. Both are paginated,
 * both are idempotent, and both DEFAULT TO A DRY RUN that reports exactly what
 * it would touch without touching it - deleting stored bytes and blanking a
 * quarter of a million rows are not things to discover the shape of afterwards.
 *
 * Why this deployment needs them: agentCandidates reached ~1.05 GB and the
 * hourly sweep has been disabled since 2026-09-02 as a result, which is why
 * discovery coverage has not advanced. These reclaim the space in place, so the
 * 257,991 existing verdicts, the 47% of the registry already walked, and every
 * runtime manual override all survive.
 * ------------------------------------------------------------------------ */

const paginationArgs = {
  cursor: v.union(v.string(), v.null()),
  numItems: v.number(),
};

/**
 * Cached icons belonging to agents that are not listed anywhere.
 *
 * Their existence is the bug fixed in deepEvaluate above: icons were sourced
 * for every deep-evaluated candidate before the publish gate was consulted, so
 * ~6,040 agents that were then rejected each left a stored image behind.
 *
 * `size` is read from Convex's own `_storage` system table rather than
 * estimated, so the dry run reports bytes that are actually there.
 */
export const listPurgeableIcons = internalQuery({
  args: paginationArgs,
  handler: async (ctx, { cursor, numItems }) => {
    const published = await ctx.db
      .query("discoveredAgents")
      .withIndex("by_agent", (q) => q.eq("chainId", BSC_CHAIN_ID))
      .collect();
    const listed = new Set<string>([
      ...EDITORIAL_TOKEN_IDS,
      ...published.map((row) => row.tokenId),
    ]);

    const page = await ctx.db
      .query("agentDirectory")
      .paginate({ cursor, numItems });

    const purgeable: { id: Id<"agentDirectory">; storageId: Id<"_storage">; bytes: number }[] = [];
    for (const row of page.page) {
      if (!row.iconStorageId) continue;
      if (listed.has(row.tokenId)) continue;
      const meta = await ctx.db.system.get(row.iconStorageId);
      purgeable.push({
        id: row._id,
        storageId: row.iconStorageId,
        bytes: meta?.size ?? 0,
      });
    }

    return {
      purgeable,
      scanned: page.page.length,
      isDone: page.isDone,
      cursor: page.continueCursor,
    };
  },
});

/** Deletes the blobs and clears the row's icon fields, in one transaction. */
export const purgeIconBatch = internalMutation({
  args: {
    rows: v.array(
      v.object({ id: v.id("agentDirectory"), storageId: v.id("_storage") }),
    ),
  },
  handler: async (ctx, { rows }) => {
    let deleted = 0;
    for (const row of rows) {
      // Storage first, then the pointer. The other order would leave an
      // unreferenced blob behind on a failure, which nothing would ever find
      // again - the exact leak this pass exists to clean up.
      await ctx.storage.delete(row.storageId);
      await ctx.db.patch(row.id, {
        iconStorageId: null,
        iconSource: null,
        iconCheckedAt: null,
      });
      deleted++;
    }
    return { deleted };
  },
});

/**
 * Reclaims stored icons for agents nobody can see. DRY RUN BY DEFAULT.
 *
 * Run it once to read the report, then again with `{ "apply": true }`.
 * Idempotent: a second apply finds nothing, because the rows it cleared no
 * longer carry an iconStorageId.
 */
export const reclaimUnlistedIcons = action({
  args: { apply: v.optional(v.boolean()) },
  handler: async (
    ctx,
    { apply },
  ): Promise<{ applied: boolean; rows: number; bytes: number; scanned: number }> => {
    let cursor: string | null = null;
    let rows = 0;
    let bytes = 0;
    let scanned = 0;

    for (;;) {
      const page: {
        purgeable: { id: Id<"agentDirectory">; storageId: Id<"_storage">; bytes: number }[];
        scanned: number;
        isDone: boolean;
        cursor: string;
      } = await ctx.runQuery(internal.discoveryPipeline.listPurgeableIcons, {
        cursor,
        numItems: 200,
      });

      scanned += page.scanned;
      rows += page.purgeable.length;
      bytes += page.purgeable.reduce((sum, row) => sum + row.bytes, 0);

      if (apply && page.purgeable.length > 0) {
        await ctx.runMutation(internal.discoveryPipeline.purgeIconBatch, {
          rows: page.purgeable.map(({ id, storageId }) => ({ id, storageId })),
        });
      }

      if (page.isDone) break;
      cursor = page.cursor;
    }

    return { applied: apply === true, rows, bytes, scanned };
  },
});

/**
 * Prefilter rejections still holding the text that got them rejected.
 *
 * Returns the text too, because the fingerprint that replaces it has to be
 * computed from what the row currently carries - once blanked it cannot be
 * derived, and a row with neither text nor hash would be re-judged forever.
 */
export const listWideRejections = internalQuery({
  args: paginationArgs,
  handler: async (ctx, { cursor, numItems }) => {
    const page = await ctx.db
      .query("agentCandidates")
      .withIndex("by_status_evaluated", (q) => q.eq("status", "rejected-prefilter"))
      .paginate({ cursor, numItems });

    const wide = page.page
      // Already narrowed rows have a hash and no text. Skipping them is what
      // makes a re-run cheap rather than a second full rewrite.
      .filter((row) => row.textHash === undefined || row.name !== "" || row.description !== "")
      .map((row) => ({
        id: row._id,
        textHash: hashCandidateText(row.name, row.description),
        bytes: row.name.length + row.description.length + row.statusReason.length,
      }));

    return {
      wide,
      scanned: page.page.length,
      isDone: page.isDone,
      cursor: page.continueCursor,
    };
  },
});

/** Blanks the heavy fields, leaving the fingerprint and the rule. */
export const narrowRejectionBatch = internalMutation({
  args: {
    rows: v.array(v.object({ id: v.id("agentCandidates"), textHash: v.string() })),
  },
  handler: async (ctx, { rows }) => {
    for (const row of rows) {
      await ctx.db.patch(row.id, {
        textHash: row.textHash,
        name: "",
        description: "",
        statusReason: "",
        scanIconUrl: null,
        ownerAddress: "",
        registeredAt: null,
        x402Supported: null,
        matchedTerms: [],
        classificationEvidence: [],
        shortfall: null,
      });
    }
    return { narrowed: rows.length };
  },
});

/**
 * Rewrites existing prefilter rejections into the narrow shape the sweep now
 * writes. DRY RUN BY DEFAULT - run once to read the report, then with
 * `{ "apply": true }`.
 *
 * `prefilterRule` and every timestamp are untouched, so the funnel counts and
 * the audit trail are unchanged by this pass. What goes is the description that
 * got each record rejected, its written-out reason, and the empty classifier
 * columns - none of which any reader consults for a rejected row.
 *
 * Bounded by wall clock rather than run to completion in one call: a Convex
 * action stops at 10 minutes, and this walks 251,922 rows. It reports its own
 * cursor position through `isDone`, so re-running it resumes from the start of
 * whatever is still wide - which, because narrowed rows are filtered out, is
 * exactly where it left off.
 */
export const narrowRejectedRows = action({
  args: { apply: v.optional(v.boolean()), budgetMs: v.optional(v.number()) },
  handler: async (
    ctx,
    { apply, budgetMs },
  ): Promise<{
    applied: boolean;
    rows: number;
    approxBytesFreed: number;
    scanned: number;
    isDone: boolean;
  }> => {
    const startedAt = Date.now();
    const budget = budgetMs ?? 420_000;
    let cursor: string | null = null;
    let rows = 0;
    let approxBytesFreed = 0;
    let scanned = 0;
    let isDone = false;

    for (;;) {
      const page: {
        wide: { id: Id<"agentCandidates">; textHash: string; bytes: number }[];
        scanned: number;
        isDone: boolean;
        cursor: string;
      } = await ctx.runQuery(internal.discoveryPipeline.listWideRejections, {
        cursor,
        numItems: 500,
      });

      scanned += page.scanned;
      rows += page.wide.length;
      approxBytesFreed += page.wide.reduce((sum, row) => sum + row.bytes, 0);

      if (apply && page.wide.length > 0) {
        await ctx.runMutation(internal.discoveryPipeline.narrowRejectionBatch, {
          rows: page.wide.map(({ id, textHash }) => ({ id, textHash })),
        });
      }

      if (page.isDone) {
        isDone = true;
        break;
      }
      cursor = page.cursor;
      if (Date.now() > startedAt + budget) break;
    }

    return { applied: apply === true, rows, approxBytesFreed, scanned, isDone };
  },
});

/* ---------------------------------------------------------------------------
 * Manual triggers, so every stage can be run and verified by hand.
 * ------------------------------------------------------------------------ */

export const runSweepNow = action({
  args: {
    skipBackfill: v.optional(v.boolean()),
    skipSearch: v.optional(v.boolean()),
    budgetMs: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SweepReport> =>
    ctx.runAction(internal.discoveryPipeline.sweep, args),
});

export const recountLedgerNow = action({
  args: {},
  handler: async (ctx): Promise<Record<string, number>> =>
    ctx.runAction(internal.discoveryPipeline.recountLedger, {}),
});

export const runIconPassNow = action({
  args: {},
  handler: async (ctx): Promise<Record<string, number>> =>
    ctx.runAction(internal.discoveryPipeline.ensureCatalogIcons, {}),
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
