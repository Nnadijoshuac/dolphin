import { v } from "convex/values";

import { liveMetric } from "./lib/liveMetric";

/**
 * One validator per AgentCategory, mirroring the AgentLiveStats union in
 * src/types/agent.ts field-for-field. Keep these two in sync by hand -
 * Convex validators can't be generated from a TypeScript type.
 */
export const monitoringStatsValidator = v.object({
  category: v.literal("monitoring"),
  alertFrequency: liveMetric(v.string()),
  assetsWatched: liveMetric(v.array(v.string())),
  lastAlertAt: liveMetric(v.string()),
  falsePositiveRate: liveMetric(v.number()),
});

export const rebalancingStatsValidator = v.object({
  category: v.literal("rebalancing"),
  winRate: liveMetric(v.number()),
  activeRange: liveMetric(v.string()),
  currentPnl: liveMetric(v.string()),
  positionCount: liveMetric(v.number()),
  trackRecordPeriod: liveMetric(v.string()),
});

export const gridTradingStatsValidator = v.object({
  category: v.literal("grid-trading"),
  winRate: liveMetric(v.number()),
  activeRange: liveMetric(v.string()),
  currentPnl: liveMetric(v.string()),
  positionCount: liveMetric(v.number()),
  trackRecordPeriod: liveMetric(v.string()),
});

export const healthFactorStatsValidator = v.object({
  category: v.literal("health-factor"),
  positionsMonitored: liveMetric(v.number()),
  averageHealthFactor: liveMetric(v.number()),
  liquidationsPrevented: liveMetric(v.number()),
  responseLatencyMs: liveMetric(v.number()),
});

export const yieldStatsValidator = v.object({
  category: v.literal("yield"),
  currentApy: liveMetric(v.number()),
  tvlManagedUsd: liveMetric(v.number()),
  protocolsUsed: liveMetric(v.array(v.string())),
  rebalanceFrequency: liveMetric(v.string()),
});

export const tradingStatsValidator = v.object({
  category: v.literal("trading"),
  winRate: liveMetric(v.number()),
  tradesExecuted: liveMetric(v.number()),
  realizedPnl: liveMetric(v.string()),
  marketsTraded: liveMetric(v.array(v.string())),
  trackRecordPeriod: liveMetric(v.string()),
});

export const agentLiveStatsValidator = v.union(
  monitoringStatsValidator,
  rebalancingStatsValidator,
  gridTradingStatsValidator,
  healthFactorStatsValidator,
  yieldStatsValidator,
  tradingStatsValidator,
);

/**
 * THE CLOSED SET, and it is closed for a reason that has nothing to do with
 * taxonomy.
 *
 * `agents.categorySlug` is an open `v.string()` so the marketplace can carry
 * categories nobody has thought of yet. This validator is a DIFFERENT question:
 * "which protocol reader do we run for this agent's headline metric". The set
 * of integrations that exist - Venus, PancakeSwap V3, Aave - really is finite,
 * because each one is hand-written code against a specific contract.
 *
 * A catalog category with no wired reader maps to null through
 * `statsCategoryFor` in convex/lib/statsCategory.ts and renders as unavailable,
 * which is the same honest answer convex/protocols/unavailable.ts already gives
 * for grid-trading and trading.
 *
 * Renamed from `agentCategoryValidator` in the 2026-09-07 rebuild so the two
 * concepts cannot be confused at a call site again - the old name was used both
 * as "what drawer is this agent in" and as "which reader do we run", and those
 * had to diverge.
 */
export const statsCategoryValidator = v.union(
  v.literal("monitoring"),
  v.literal("rebalancing"),
  v.literal("grid-trading"),
  v.literal("health-factor"),
  v.literal("yield"),
  v.literal("trading"),
);
