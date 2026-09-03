import type { Infer } from "convex/values";

import type {
  gridTradingStatsValidator,
  healthFactorStatsValidator,
  monitoringStatsValidator,
  rebalancingStatsValidator,
  tradingStatsValidator,
  yieldStatsValidator,
} from "../categoryStatsValidators";

export type MonitoringLiveStats = Infer<typeof monitoringStatsValidator>;
export type RebalancingLiveStats = Infer<typeof rebalancingStatsValidator>;
export type GridTradingLiveStats = Infer<typeof gridTradingStatsValidator>;
export type HealthFactorLiveStats = Infer<typeof healthFactorStatsValidator>;
export type YieldLiveStats = Infer<typeof yieldStatsValidator>;
export type TradingLiveStats = Infer<typeof tradingStatsValidator>;
