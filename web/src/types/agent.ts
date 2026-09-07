/**
 * Hand-mirrored from the mobile app's src/types/agent.ts (AGENTS.md SS9's manual
 * mirror rule). Both frontends render agents.listAgents from the same Convex
 * backend, so this shape MUST match - if src/types/agent.ts changes, change
 * this in the same commit.
 *
 * The only intentional difference: viem is not used for typing here, so
 * `Address` is declared locally rather than imported from viem.
 */
export type Address = `0x${string}`;
/**
 * A category slug. OPEN, not a union — this is the client half of the
 * 2026-09-07 backend rebuild.
 *
 * ---------------------------------------------------------------------------
 * WHY IT STOPPED BEING A UNION
 * ---------------------------------------------------------------------------
 * It was `"monitoring" | "rebalancing" | ... | "trading"`, mirrored by hand into
 * a Convex validator, a scorer, a classifier and the website's own copy. The
 * cost of that was measured rather than theoretical: adding `trading` on
 * 2026-09-03 meant a schema change, a scoring-ruleset version bump and a
 * re-judge of a 258,000-row ledger, and the category still rendered empty for
 * two days because a SEPARATE hardcoded vocabulary decided what the discovery
 * API was even asked for. Meanwhile 5,921 agents had been thrown away by a
 * classifier whose only complaint was that they did not fit these six words.
 *
 * The marketplace has to be able to carry a research agent, a security agent,
 * or something nobody has named yet, so the backend stores a free string and
 * the browse chips are read from the data (`useCategoryFacets`).
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS MEANS FOR CODE THAT USED TO SWITCH ON IT
 * ---------------------------------------------------------------------------
 * `Record<AgentCategory, T>` no longer type-errors on a missing key, so an
 * unknown slug would silently index to `undefined` at runtime. Never index a
 * category map directly. Use the helpers in `@/constants/agents`
 * (`categoryLabel`, `categoryVisual`) and the `?? fallback` patterns in
 * `src/wallet/*-policy.ts`, all of which are total by construction.
 */
export type AgentCategory = string;

/**
 * The categories Dolphin has copy, colours and (sometimes) a protocol reader
 * for. Not a constraint — a well-known subset of an open set, used for defaults.
 */
export const KNOWN_AGENT_CATEGORIES = [
  "monitoring",
  "rebalancing",
  "grid-trading",
  "health-factor",
  "yield",
  "trading",
] as const;

export type KnownAgentCategory = (typeof KNOWN_AGENT_CATEGORIES)[number];

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
  /**
   * NULL for a category with no wired protocol reader — which, now that
   * categories are open, is most of them. `research`, `security` and anything
   * the registry invents have no protocol holding a number about them, and the
   * detail page renders no live-metric panel rather than an empty one.
   */
  liveStats: AgentLiveStats | null;
  /** Whether a live-metric panel exists for this category at all. */
  hasLiveStats: boolean;
  performanceSeries: AgentPerformancePoint[];
  recentActivity: AgentActivity[];
  priceModel: LiveMetric<AgentPriceModel>;
  /**
   * The agent's own quoted price, read from a signed quote at verification time
   * and checked against its registered on-chain wallet. NULL means it published
   * no headline price — which is not the same as free, and not the same as
   * unhireable: the hire flow requests a live quote at checkout.
   */
  pricing: {
    amountRaw: string;
    token: string;
    tokenSymbol: string;
    tokenDecimals: number;
    display: string | null;
    escrowContract: string | null;
  } | null;
  /** The canonical "<chainId>:<registry>:<tokenId>" key. Same value as `id`. */
  agentKey: string;
  /**
   * How this agent is used. "a2a" is commissioned and paid over an ERC-8183
   * escrow; "mcp" publishes tools you call directly. Mirrors the mobile type.
   */
  protocol: "a2a" | "mcp";
  /** Seed for the client's deterministic avatar when `iconUrl` is null. */
  iconSeed: string;
  iconSource: "publisher" | "cached" | "generated";
  tags: string[];
  /** Hand-vetted. Boosts ordering; never exempts an agent from verification. */
  curated: boolean;
  /**
   * Dolphin's own verdict. "live" means we called this agent's endpoint and it
   * offered work for sale; "degraded" means it has failed recently but not
   * enough times to be delisted; "unavailable" means it is delisted and only
   * reachable by direct link.
   */
  status: "live" | "degraded" | "unavailable";
  verifiedAt: string;
  publishedAt: string;
  registryVerification: RegistryVerification;
  sourceLabels: DataSourceLabel[];
  recordStatus: "indexed" | "editorial-fallback";
}
