/** Alias for Ethereum addresses — keeps compat with the mobile app's viem-based types */
export type Address = `0x${string}`;

export type AgentCategory =
  | "monitoring"
  | "grid-trading"
  | "health-factor"
  | "yield";

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
  | "oasf-metadata";

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

export interface GridTradingLiveStats {
  category: "grid-trading";
  winRate: LiveMetric<number>;
  activeRange: LiveMetric<string>;
  currentPnl: LiveMetric<string>;
  gridCount: LiveMetric<number>;
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

export type AgentLiveStats =
  | MonitoringLiveStats
  | GridTradingLiveStats
  | HealthFactorLiveStats
  | YieldLiveStats;

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
