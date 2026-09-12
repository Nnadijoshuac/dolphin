/**
 * Metric placeholders for a category, and nothing else any more.
 *
 * ---------------------------------------------------------------------------
 * THE NINE HARDCODED EDITORIAL AGENTS ARE GONE (2026-09-07)
 * ---------------------------------------------------------------------------
 * This file used to export `EDITORIAL_AGENTS`: nine complete `Agent` objects,
 * written by hand, used as the client-side catalog whenever
 * EXPO_PUBLIC_CONVEX_URL was unset and as a lookup fallback elsewhere.
 *
 * They went for three reasons, in order of weight:
 *
 *   They were never verified. A hardcoded agent is listed whether or not its
 *   endpoint answers, which is the one thing the rebuild exists to prevent.
 *   Three of the nine were already failing the sellability probe while still
 *   being merged into the catalog ahead of everything else.
 *
 *   They were a second source of truth for the same records, so the app could
 *   show a different name, category or price for an agent than the backend did.
 *
 *   Curation is now data: `verification.setCurated` marks an agent hand-vetted,
 *   which boosts its ordering and does NOT exempt it from verification. Adding
 *   one no longer needs a deploy.
 *
 * The metric helpers below survive because the detail page needs a shape to
 * render while real stats load, and because a category with no wired protocol
 * reader has no live metrics at all - which is now most of them.
 */

import type { Address } from "viem";

import { AGENT_DATA_SOURCES } from "@/constants/agents";
import type {
  AgentCategory,
  AgentLiveStats,
  DataSourceLabel,
  LiveMetric,
  RegistryVerification,
} from "@/types/agent";

const METRICS_NOT_PUBLISHED =
  "No auditable live metric feed or execution history is published for this value.";

export function unavailableMetric<T>(
  reason: string,
  source: DataSourceLabel = AGENT_DATA_SOURCES.publisher,
): LiveMetric<T> {
  return {
    status: "unavailable",
    value: null,
    asOf: null,
    source,
    reason,
  };
}

export function unverifiedRegistry(): RegistryVerification {
  const reason = "On-chain identity has not been checked in this request yet.";

  return {
    registered: unavailableMetric<boolean>(reason, AGENT_DATA_SOURCES.registry),
    owner: unavailableMetric<Address>(reason, AGENT_DATA_SOURCES.registry),
    tokenUri: unavailableMetric<string>(reason, AGENT_DATA_SOURCES.registry),
    agentWallet: unavailableMetric<Address>(reason, AGENT_DATA_SOURCES.registry),
  };
}

/**
 * Returns NULL for a category with no wired protocol reader - which, now that
 * categories are open strings, is most of them. `research`, `security` and
 * anything the registry invents have no protocol holding a number about them,
 * so the detail page renders no live-metric panel rather than an empty one.
 *
 * This used to be an exhaustive switch over a closed union with no default. As
 * an open string that stops compiling ("lacks ending return statement"), and
 * the honest fix is to say there is nothing to show rather than to invent a
 * shape for a category nobody has integrated.
 */
export function unavailableLiveStats(category: AgentCategory): AgentLiveStats | null {
  switch (category) {
    case "monitoring":
      return {
        category,
        alertFrequency: unavailableMetric<string>(METRICS_NOT_PUBLISHED),
        assetsWatched: unavailableMetric<string[]>(METRICS_NOT_PUBLISHED),
        lastAlertAt: unavailableMetric<string>(METRICS_NOT_PUBLISHED),
        falsePositiveRate: unavailableMetric<number>(METRICS_NOT_PUBLISHED),
      };
    case "rebalancing":
      return {
        category,
        winRate: unavailableMetric<number>(METRICS_NOT_PUBLISHED),
        activeRange: unavailableMetric<string>(METRICS_NOT_PUBLISHED),
        currentPnl: unavailableMetric<string>(METRICS_NOT_PUBLISHED),
        positionCount: unavailableMetric<number>(METRICS_NOT_PUBLISHED),
        trackRecordPeriod: unavailableMetric<string>(METRICS_NOT_PUBLISHED),
      };
    case "grid-trading":
      return {
        category,
        winRate: unavailableMetric<number>(METRICS_NOT_PUBLISHED),
        activeRange: unavailableMetric<string>(METRICS_NOT_PUBLISHED),
        currentPnl: unavailableMetric<string>(METRICS_NOT_PUBLISHED),
        positionCount: unavailableMetric<number>(METRICS_NOT_PUBLISHED),
        trackRecordPeriod: unavailableMetric<string>(METRICS_NOT_PUBLISHED),
      };
    case "health-factor":
      return {
        category,
        positionsMonitored: unavailableMetric<number>(METRICS_NOT_PUBLISHED),
        averageHealthFactor: unavailableMetric<number>(METRICS_NOT_PUBLISHED),
        liquidationsPrevented: unavailableMetric<number>(METRICS_NOT_PUBLISHED),
        responseLatencyMs: unavailableMetric<number>(METRICS_NOT_PUBLISHED),
      };
    case "yield":
      return {
        category,
        currentApy: unavailableMetric<number>(METRICS_NOT_PUBLISHED),
        rebalanceFrequency: unavailableMetric<string>(METRICS_NOT_PUBLISHED),
      };
    case "trading":
      return {
        category,
        winRate: unavailableMetric<number>(METRICS_NOT_PUBLISHED),
        tradesExecuted: unavailableMetric<number>(METRICS_NOT_PUBLISHED),
        realizedPnl: unavailableMetric<string>(METRICS_NOT_PUBLISHED),
        marketsTraded: unavailableMetric<string[]>(METRICS_NOT_PUBLISHED),
        trackRecordPeriod: unavailableMetric<string>(METRICS_NOT_PUBLISHED),
      };
    default:
      // A category with no wired protocol reader. Mirrors statsCategoryFor in
      // convex/lib/statsCategory.ts, and null is the honest answer rather than
      // a metric shape nothing can ever fill.
      return null;
  }
}

/**
 * The same field set as unavailableLiveStats, but every metric marked
 * "syncing" instead of "unavailable" - the honest state while the Convex
 * backend read (convex/categoryStats.ts) is still in flight.
 *
 * The distinction matters and is required by project-scope.md SS5:
 * "unavailable" asserts we checked and no feed exists, "syncing" says we
 * have not finished checking yet. Showing "Not reported" during the initial
 * load would state the stronger claim before it is known to be true.
 *
 * Derived from unavailableLiveStats rather than repeating its switch, so
 * adding a category or a metric only has to be done in one place. The cast
 * is safe because only each metric's `status`/`asOf` change - the key set
 * and the `category` discriminant are carried through untouched.
 */
export function syncingLiveStats(category: AgentCategory): AgentLiveStats | null {
  const settled = unavailableLiveStats(category);
  if (!settled) return null;

  const syncing = Object.fromEntries(
    Object.entries(settled).map(([key, field]) =>
      key === "category"
        ? [key, field]
        : [
            key,
            {
              status: "syncing",
              value: null,
              asOf: null,
              source: (field as LiveMetric<unknown>).source,
            },
          ],
    ),
  );

  return syncing as AgentLiveStats;
}
