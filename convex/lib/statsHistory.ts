/**
 * The agent detail page's "Published track record" chart, given a real source.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS (2026-09-06)
 * ---------------------------------------------------------------------------
 * `performanceSeries` was hardcoded `[]` in convex/lib/agentCatalog.ts and
 * src/data/editorial-agents.ts, and NOTHING anywhere ever wrote it. So the
 * chart rendered its empty state - "A chart appears after the indexer receives
 * at least two dated, sourced observations" - on 100% of agents, permanently,
 * describing an indexer that did not exist. A truthful sentence that creates a
 * false impression is the same failure as a fabricated number wearing better
 * clothes, and AGENTS.md §5 covers both.
 *
 * The fix is not to invent a series. It is to notice that Dolphin ALREADY takes
 * a real, sourced, timestamped on-chain reading of every agent it lists, every
 * time someone opens its page (convex/categoryStats.ts), and then throws all but
 * the latest one away by upserting over it.
 *
 * So: keep them. Each point in this history is one real protocol read - Venus's
 * Comptroller, PancakeSwap V3's position manager, Aave's pool - at a real
 * timestamp, carrying the same DataSourceLabel the metric itself carried. There
 * is no interpolation, no backfill, no synthetic origin point, and no value that
 * was not read off BNB Chain. A new agent's chart is genuinely empty until it
 * has been observed twice, and that sentence is now true.
 *
 * ---------------------------------------------------------------------------
 * ONE METRIC PER CATEGORY, AND ONLY WHERE ONE IS REAL
 * ---------------------------------------------------------------------------
 * A chart needs a single number that means something over time. Three
 * categories have one; three do not, and those get no chart rather than a chart
 * of something unrelated:
 *
 *   health-factor  averageHealthFactor  - the whole point of the category
 *   rebalancing    winRate              - "rebalance efficiency" in the UI
 *   yield          currentApy           - the number a yield user is tracking
 *
 *   grid-trading   none - every metric is unavailableGridTradingStats
 *   trading        none - every metric is unavailableTradingStats
 *   monitoring     none - every metric is unavailableMonitoringStats
 *
 * The three without a source return null here, which reads through to "no
 * observations yet" rather than to a flat line at zero. A flat line at zero is a
 * claim.
 */

import type { DataSourceLabelInput } from "./liveMetric";

/**
 * The smallest gap between two stored observations of the same agent.
 *
 * The client refreshes on mount and then every 60s, and the action is public,
 * so the write rate is bounded by callers rather than by anything real. One
 * point an hour is what makes this a track record rather than a log of who
 * opened the page - and it is what keeps a table that only ever grows from
 * repeating the storage-ceiling incident of 2026-09-02 (see
 * SESSION-LOG-2026-09-06 §1).
 *
 * At this cadence and MAX_OBSERVATIONS below, one agent-category costs at most
 * 720 rows, and only for agents somebody actually looks at.
 */
export const MIN_OBSERVATION_GAP_MS = 60 * 60 * 1000;

/**
 * How many observations are kept per agent-category. 720 hourly points is 30
 * days, which matches the longest window the UI offers and is a bound rather
 * than a hope.
 */
export const MAX_OBSERVATIONS = 720;

/**
 * How long a cached reading is served without going back to the chain.
 *
 * This is a real cost control, not a nicety: refreshAgentCategoryStats is a
 * PUBLIC action that performs live BSC RPC reads, so before this gate its call
 * rate - and therefore Dolphin's RPC bill - was set by whoever chose to call
 * it. With the gate, N callers asking about one agent cost one read per minute
 * between them instead of N.
 *
 * 60s matches the client's own polling interval, so no honest caller is ever
 * refused data it would otherwise have had.
 */
export const STATS_FRESHNESS_MS = 60 * 1000;

/** A live numeric metric, extracted from whatever shape its category has. */
export type ChartableObservation = {
  /** The field name on the category's stats object. Stored so a later reader can tell what was charted. */
  metric: string;
  value: number;
  source: DataSourceLabelInput;
};

type MaybeLiveMetric = {
  status?: unknown;
  value?: unknown;
  source?: unknown;
};

/**
 * Reads a metric only if it actually resolved. "syncing" and "unavailable"
 * carry a null value by construction (see liveMetric.ts), and a null must never
 * become a zero on the way into a chart.
 */
function readLiveNumber(
  candidate: unknown,
  metric: string,
): ChartableObservation | null {
  if (typeof candidate !== "object" || candidate === null) return null;
  const entry = candidate as MaybeLiveMetric;

  if (entry.status !== "live" && entry.status !== "stale") return null;
  if (typeof entry.value !== "number" || !Number.isFinite(entry.value)) return null;
  if (typeof entry.source !== "object" || entry.source === null) return null;

  return {
    metric,
    value: entry.value,
    source: entry.source as DataSourceLabelInput,
  };
}

/**
 * The one number worth charting for this category, or null when the category
 * has no wired source. Kept as a lookup rather than a switch with casts because
 * the stats union is validator-derived and the field names are the contract.
 */
const CHART_METRIC_BY_CATEGORY: Readonly<Record<string, string | null>> = {
  "health-factor": "averageHealthFactor",
  rebalancing: "winRate",
  yield: "currentApy",
  "grid-trading": null,
  trading: null,
  monitoring: null,
};

export function chartableObservation(
  stats: { category: string } & Record<string, unknown>,
): ChartableObservation | null {
  const field = CHART_METRIC_BY_CATEGORY[stats.category] ?? null;
  if (field === null) return null;
  return readLiveNumber(stats[field], field);
}

/**
 * How the charted number should be read, per metric. Returned to the client
 * with the series so the axis label is not a second place this mapping lives.
 */
export const CHART_METRIC_LABELS: Readonly<Record<string, string>> = {
  averageHealthFactor: "Average health factor",
  winRate: "Rebalance efficiency (%)",
  currentApy: "Current APY (%)",
};
