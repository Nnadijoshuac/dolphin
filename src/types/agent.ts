import type { Address } from "viem";

export type AgentCategory =
  | "monitoring"
  | "rebalancing"
  | "grid-trading"
  | "health-factor"
  | "yield"
  | "trading";

export type LiveMetricStatus =
  | "syncing"
  | "live"
  | "stale"
  | "unavailable";

export interface DataSourceLabel {
  id: string;
  label: string;
  url?: string;
}

interface MetricBase {
  source: DataSourceLabel;
  methodology?: string;
}

export type LiveMetric<T> =
  | (MetricBase & {
      status: "live" | "stale";
      value: T;
      asOf: string;
      reason?: never;
    })
  | (MetricBase & {
      status: "syncing" | "unavailable";
      value: null;
      asOf: string | null;
      reason?: string;
    });

export type AgentClassificationSource =
  | "editorial-explicit-metadata"
  | "registry-metadata"
  | "oasf-metadata"
  | "heuristic-keyword-match";

/**
 * How sure the category assignment is, for agents classified by
 * convex/lib/classification.ts's keyword heuristic rather than a human.
 * "confirmed" = an unambiguous, category-specific phrase matched and no
 * other category also matched. "likely" = a weaker/generic term matched
 * for exactly one category. Absent (undefined) means classification was
 * not heuristic - editorial/registry/oasf sources are implicitly certain.
 */
export type ClassificationConfidence = "confirmed" | "likely";

export interface AgentSkill {
  name: string;
  evidence: "publisher-reported" | "registry-metadata" | "verified";
}

export interface AgentService {
  name: string;
  endpoint: string;
  version: string | null;
}

export interface MonitoringLiveStats {
  category: "monitoring";
  alertFrequency: LiveMetric<string>;
  assetsWatched: LiveMetric<string[]>;
  lastAlertAt: LiveMetric<string>;
  falsePositiveRate: LiveMetric<number>;
}

/**
 * LP-range management: resets/rebalances a concentrated-liquidity position
 * automatically (e.g. PancakeSwap V3). Renamed from what this codebase used
 * to call "grid-trading" - that name was substance-wrong (see
 * GridTradingLiveStats below for the actual price-ladder definition).
 */
export interface RebalancingLiveStats {
  category: "rebalancing";
  winRate: LiveMetric<number>;
  activeRange: LiveMetric<string>;
  currentPnl: LiveMetric<string>;
  positionCount: LiveMetric<number>;
  trackRecordPeriod: LiveMetric<string>;
}

/**
 * True price-ladder grid trading: buy/sell orders placed across a fixed
 * range. Distinct from RebalancingLiveStats above (LP-range management) -
 * see project-scope.md's category taxonomy notes for the split's history.
 */
export interface GridTradingLiveStats {
  category: "grid-trading";
  winRate: LiveMetric<number>;
  activeRange: LiveMetric<string>;
  currentPnl: LiveMetric<string>;
  positionCount: LiveMetric<number>;
  trackRecordPeriod: LiveMetric<string>;
}

export interface HealthFactorLiveStats {
  category: "health-factor";
  positionsMonitored: LiveMetric<number>;
  averageHealthFactor: LiveMetric<number>;
  liquidationsPrevented: LiveMetric<number>;
  responseLatencyMs: LiveMetric<number>;
}

export interface YieldLiveStats {
  category: "yield";
  currentApy: LiveMetric<number>;
  tvlManagedUsd: LiveMetric<number>;
  protocolsUsed: LiveMetric<string[]>;
  rebalanceFrequency: LiveMetric<string>;
}

/**
 * Discretionary or systematic trading: an agent that plans or executes trades
 * on crypto markets for a user - signal generation, entry/exit, execution.
 *
 * Deliberately distinct from the three trade-adjacent categories that already
 * exist. GridTradingLiveStats is one specific strategy (a fixed price ladder),
 * RebalancingLiveStats is LP-range management, and YieldLiveStats is farming.
 * A trading agent is not committed to any of those shapes, so its metrics are
 * about the trades themselves rather than about a range or a venue.
 */
export interface TradingLiveStats {
  category: "trading";
  winRate: LiveMetric<number>;
  tradesExecuted: LiveMetric<number>;
  realizedPnl: LiveMetric<string>;
  marketsTraded: LiveMetric<string[]>;
  trackRecordPeriod: LiveMetric<string>;
}

export type AgentLiveStats =
  | MonitoringLiveStats
  | RebalancingLiveStats
  | GridTradingLiveStats
  | HealthFactorLiveStats
  | YieldLiveStats
  | TradingLiveStats;

export interface AgentPerformancePoint {
  timestamp: string;
  value: number;
  source: DataSourceLabel;
}

export interface AgentActivity {
  timestamp: string;
  action: string;
  txHash?: `0x${string}`;
  source: DataSourceLabel;
}

export interface AgentPriceModel {
  type: "flat" | "per-call" | "percentage-fee";
  amount: string;
  token: string;
}

export type AgentEndpointStatus =
  | "healthy"
  | "degraded"
  | "unhealthy"
  | "unknown";

export interface RegistryVerification {
  registered: LiveMetric<boolean>;
  owner: LiveMetric<Address>;
  tokenUri: LiveMetric<string>;
  agentWallet: LiveMetric<Address>;
}

export interface Agent {
  id: string;
  tokenId: string;
  chain: "bsc";
  chainId: 56;
  registryAddress: Address;
  name: string;
  publisher: string;
  publisherAddress: Address | null;
  category: AgentCategory;
  classificationSource: AgentClassificationSource;
  classificationConfidence?: ClassificationConfidence;
  tagline: string;
  description: string;
  iconUrl: string | null;
  registeredAt: string | null;
  agentWallet: Address | null;
  skills: AgentSkill[];
  verifiedSkills: string[];
  services: AgentService[];
  x402Supported: LiveMetric<boolean>;
  isActive: LiveMetric<boolean>;
  reputationScore: LiveMetric<number>;
  feedbackCount: LiveMetric<number>;
  endpointStatus: LiveMetric<AgentEndpointStatus>;
  liveStats: AgentLiveStats;
  performanceSeries: AgentPerformancePoint[];
  recentActivity: AgentActivity[];
  priceModel: LiveMetric<AgentPriceModel>;
  registryVerification: RegistryVerification;
  sourceLabels: DataSourceLabel[];
  recordStatus: "indexed" | "editorial-fallback";
}
