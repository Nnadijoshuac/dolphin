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

export const agentCategoryValidator = v.union(
  v.literal("monitoring"),
  v.literal("rebalancing"),
  v.literal("grid-trading"),
  v.literal("health-factor"),
  v.literal("yield"),
  v.literal("trading"),
);
