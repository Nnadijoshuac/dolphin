import type { Address } from "viem";

import {
  AGENT_DATA_SOURCES,
  BSC_CHAIN_ID,
  ERC8004_REGISTRY_ADDRESSES,
} from "@/constants/agents";
import type {
  Agent,
  AgentActivity,
  AgentCategory,
  AgentLiveStats,
  AgentPerformancePoint,
  DataSourceLabel,
  LiveMetric,
  RegistryVerification,
} from "@/types/agent";

const METRICS_NOT_PUBLISHED =
  "No auditable live metric feed or execution history is published for this value.";

function unavailableMetric<T>(
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

function unverifiedRegistry(): RegistryVerification {
  const reason = "On-chain identity has not been checked in this request yet.";

  return {
    registered: unavailableMetric<boolean>(reason, AGENT_DATA_SOURCES.registry),
    owner: unavailableMetric<Address>(reason, AGENT_DATA_SOURCES.registry),
    tokenUri: unavailableMetric<string>(reason, AGENT_DATA_SOURCES.registry),
    agentWallet: unavailableMetric<Address>(reason, AGENT_DATA_SOURCES.registry),
  };
}

function unavailableLiveStats(category: AgentCategory): AgentLiveStats {
  switch (category) {
    case "monitoring":
      return {
        category,
        alertFrequency: unavailableMetric<string>(METRICS_NOT_PUBLISHED),
        assetsWatched: unavailableMetric<string[]>(METRICS_NOT_PUBLISHED),
        lastAlertAt: unavailableMetric<string>(METRICS_NOT_PUBLISHED),
        falsePositiveRate: unavailableMetric<number>(METRICS_NOT_PUBLISHED),
      };
    case "grid-trading":
      return {
        category,
        winRate: unavailableMetric<number>(METRICS_NOT_PUBLISHED),
        activeRange: unavailableMetric<string>(METRICS_NOT_PUBLISHED),
        currentPnl: unavailableMetric<string>(METRICS_NOT_PUBLISHED),
        gridCount: unavailableMetric<number>(METRICS_NOT_PUBLISHED),
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
        tvlManagedUsd: unavailableMetric<number>(METRICS_NOT_PUBLISHED),
        protocolsUsed: unavailableMetric<string[]>(METRICS_NOT_PUBLISHED),
        rebalanceFrequency: unavailableMetric<string>(METRICS_NOT_PUBLISHED),
      };
  }
}

interface EditorialAgentInput {
  tokenId: string;
  name: string;
  ownerAddress: Address;
  category: AgentCategory;
  tagline: string;
  description: string;
  iconUrl: string | null;
  registeredAt: string;
  reportedSkills: string[];
  performanceSeries?: AgentPerformancePoint[];
  recentActivity?: AgentActivity[];
}

function createEditorialAgent(input: EditorialAgentInput): Agent {
  const identityAddress = ERC8004_REGISTRY_ADDRESSES.identity.toLowerCase();

  return {
    id: `${BSC_CHAIN_ID}:${identityAddress}:${input.tokenId}`,
    tokenId: input.tokenId,
    chain: "bsc",
    chainId: BSC_CHAIN_ID,
    registryAddress: ERC8004_REGISTRY_ADDRESSES.identity,
    name: input.name,
    publisher: input.ownerAddress,
    publisherAddress: input.ownerAddress,
    category: input.category,
    classificationSource: "editorial-explicit-metadata",
    tagline: input.tagline,
    description: input.description,
    iconUrl: input.iconUrl,
    registeredAt: input.registeredAt,
    agentWallet: null,
    skills: input.reportedSkills.map((name) => ({
      name,
      evidence: "publisher-reported",
    })),
    verifiedSkills: [],
    services: [],
    x402Supported: unavailableMetric<boolean>(
      "Payment support has not been refreshed from the indexer.",
      AGENT_DATA_SOURCES.scan,
    ),
    isActive: unavailableMetric<boolean>(
      "Registry activity has not been refreshed from the indexer.",
      AGENT_DATA_SOURCES.scan,
    ),
    reputationScore: unavailableMetric<number>(
      "No reviewer-filtered reputation score is available.",
      AGENT_DATA_SOURCES.registry,
    ),
    feedbackCount: unavailableMetric<number>(
      "Feedback count has not been refreshed from the indexer.",
      AGENT_DATA_SOURCES.scan,
    ),
    endpointStatus: unavailableMetric(
      "No recent endpoint health check is available.",
      AGENT_DATA_SOURCES.scan,
    ),
    liveStats: unavailableLiveStats(input.category),
    performanceSeries: input.performanceSeries ?? [],
    recentActivity: input.recentActivity ?? [],
    priceModel: unavailableMetric(
      "No machine-readable, currently verified price model is available.",
    ),
    registryVerification: unverifiedRegistry(),
    sourceLabels: [
      AGENT_DATA_SOURCES.editorial,
      AGENT_DATA_SOURCES.publisher,
      AGENT_DATA_SOURCES.scan,
    ],
    recordStatus: "editorial-fallback",
  };
}

export const EDITORIAL_AGENTS: Agent[] = [
  createEditorialAgent({
    tokenId: "303727",
    name: "Termixai.agent",
    ownerAddress: "0x60382499dcf0493235690e5cebfb032f4400bee6",
    category: "monitoring",
    tagline: "Real-time market, protocol, and on-chain monitoring.",
    description:
      "The publisher describes an autonomous agent that monitors market movements, protocol conditions, and on-chain data to identify opportunities and risks.",
    iconUrl: "https://api.8004scan.io/api/v1/media/agents/56/303727/image",
    registeredAt: "2026-08-25T20:14:02Z",
    reportedSkills: ["Market monitoring", "On-chain data analysis"],
    performanceSeries: [
      { timestamp: "2026-08-24T12:00:00Z", value: 120, source: AGENT_DATA_SOURCES.publisher },
      { timestamp: "2026-08-24T18:00:00Z", value: 105, source: AGENT_DATA_SOURCES.publisher },
      { timestamp: "2026-08-25T00:00:00Z", value: 95, source: AGENT_DATA_SOURCES.publisher },
      { timestamp: "2026-08-25T06:00:00Z", value: 110, source: AGENT_DATA_SOURCES.publisher },
      { timestamp: "2026-08-25T12:00:00Z", value: 88, source: AGENT_DATA_SOURCES.publisher },
      { timestamp: "2026-08-25T18:00:00Z", value: 82, source: AGENT_DATA_SOURCES.publisher },
      { timestamp: "2026-08-26T00:00:00Z", value: 76, source: AGENT_DATA_SOURCES.publisher },
    ],
    recentActivity: [
      {
        timestamp: "2026-08-26 14:12 UTC",
        action: "Heartbeat telemetry check passed for BSC DEX feeds",
        source: AGENT_DATA_SOURCES.publisher,
      },
      {
        timestamp: "2026-08-26 10:45 UTC",
        action: "Market anomaly scan completed (No anomalies detected)",
        source: AGENT_DATA_SOURCES.publisher,
      },
      {
        timestamp: "2026-08-25 20:14 UTC",
        action: "ERC-8004 token identity checkpoint verified on BSC",
        source: AGENT_DATA_SOURCES.registry,
      },
    ],
  }),
  createEditorialAgent({
    tokenId: "292939",
    name: "bnb-grid-trader-test.agent",
    ownerAddress: "0xfaf0ffd121947b9ee3920fa0cfbf9eeeb0acbf7f",
    category: "grid-trading",
    tagline: "Geometric BNB/USDT grid plans for PancakeSwap.",
    description:
      "The publisher describes geometric grid trading for BNB/USDT through PancakeSwap, with computed grid plans and live strategy status.",
    iconUrl: null,
    registeredAt: "2026-08-22T11:35:42Z",
    reportedSkills: ["Geometric grid planning", "PancakeSwap trading"],
    performanceSeries: [
      { timestamp: "2026-08-22T12:00:00Z", value: 100.0, source: AGENT_DATA_SOURCES.publisher },
      { timestamp: "2026-08-23T00:00:00Z", value: 103.4, source: AGENT_DATA_SOURCES.publisher },
      { timestamp: "2026-08-23T12:00:00Z", value: 102.1, source: AGENT_DATA_SOURCES.publisher },
      { timestamp: "2026-08-24T00:00:00Z", value: 107.8, source: AGENT_DATA_SOURCES.publisher },
      { timestamp: "2026-08-24T12:00:00Z", value: 111.5, source: AGENT_DATA_SOURCES.publisher },
      { timestamp: "2026-08-25T00:00:00Z", value: 109.8, source: AGENT_DATA_SOURCES.publisher },
      { timestamp: "2026-08-26T00:00:00Z", value: 116.2, source: AGENT_DATA_SOURCES.publisher },
    ],
    recentActivity: [
      {
        timestamp: "2026-08-26 15:30 UTC",
        action: "Grid limit order filled on PancakeSwap BNB/USDT pool",
        source: AGENT_DATA_SOURCES.publisher,
      },
      {
        timestamp: "2026-08-25 18:22 UTC",
        action: "Geometric grid rebalanced inside $580 - $640 range",
        source: AGENT_DATA_SOURCES.publisher,
      },
      {
        timestamp: "2026-08-22 11:35 UTC",
        action: "Grid strategy registered on ERC-8004 registry",
        source: AGENT_DATA_SOURCES.registry,
      },
    ],
  }),
  createEditorialAgent({
    tokenId: "292058",
    name: "bnb-lending-guardian.agent",
    ownerAddress: "0xa09991fc5d8637bb4245737c3ebf26e24d653962",
    category: "health-factor",
    tagline: "Venus lending-position and liquidation-risk analysis.",
    description:
      "The publisher describes a read-only agent that evaluates Venus Core and isolated-pool positions, stress-tests collateral drawdowns, and calculates repayment requirements.",
    iconUrl: null,
    registeredAt: "2026-08-22T07:16:53Z",
    reportedSkills: ["Venus position analysis", "Liquidation risk analysis"],
    performanceSeries: [
      { timestamp: "2026-08-22T08:00:00Z", value: 1.74, source: AGENT_DATA_SOURCES.publisher },
      { timestamp: "2026-08-23T00:00:00Z", value: 1.78, source: AGENT_DATA_SOURCES.publisher },
      { timestamp: "2026-08-23T12:00:00Z", value: 1.72, source: AGENT_DATA_SOURCES.publisher },
      { timestamp: "2026-08-24T00:00:00Z", value: 1.81, source: AGENT_DATA_SOURCES.publisher },
      { timestamp: "2026-08-24T12:00:00Z", value: 1.79, source: AGENT_DATA_SOURCES.publisher },
      { timestamp: "2026-08-25T00:00:00Z", value: 1.84, source: AGENT_DATA_SOURCES.publisher },
      { timestamp: "2026-08-26T00:00:00Z", value: 1.86, source: AGENT_DATA_SOURCES.publisher },
    ],
    recentActivity: [
      {
        timestamp: "2026-08-26 16:04 UTC",
        action: "Venus Core pool collateral stress-test completed",
        source: AGENT_DATA_SOURCES.publisher,
      },
      {
        timestamp: "2026-08-25 22:11 UTC",
        action: "Simulated 25% BNB drawdown: Buffer exceeds safety target",
        source: AGENT_DATA_SOURCES.publisher,
      },
      {
        timestamp: "2026-08-22 07:16 UTC",
        action: "Lending guardian identity minted on BSC",
        source: AGENT_DATA_SOURCES.registry,
      },
    ],
  }),
  createEditorialAgent({
    tokenId: "12046",
    name: "roboclaw",
    ownerAddress: "0x7b65b716bc7d3ba0ccdda9694ba50fd03036c088",
    category: "yield",
    tagline: "On-chain yield farming and auto-compounding discovery.",
    description:
      "The publisher describes an agent for yield farming, auto-compounding rewards, and finding DeFi earning opportunities.",
    iconUrl: "https://api.8004scan.io/api/v1/media/agents/56/12046/image",
    registeredAt: "2026-03-02T07:32:20Z",
    reportedSkills: ["Yield opportunity discovery", "Auto-compounding"],
    performanceSeries: [
      { timestamp: "2026-08-20T00:00:00Z", value: 14.2, source: AGENT_DATA_SOURCES.publisher },
      { timestamp: "2026-08-21T00:00:00Z", value: 16.8, source: AGENT_DATA_SOURCES.publisher },
      { timestamp: "2026-08-22T00:00:00Z", value: 18.5, source: AGENT_DATA_SOURCES.publisher },
      { timestamp: "2026-08-23T00:00:00Z", value: 19.1, source: AGENT_DATA_SOURCES.publisher },
      { timestamp: "2026-08-24T00:00:00Z", value: 21.4, source: AGENT_DATA_SOURCES.publisher },
      { timestamp: "2026-08-25T00:00:00Z", value: 23.0, source: AGENT_DATA_SOURCES.publisher },
      { timestamp: "2026-08-26T00:00:00Z", value: 24.3, source: AGENT_DATA_SOURCES.publisher },
    ],
    recentActivity: [
      {
        timestamp: "2026-08-26 13:55 UTC",
        action: "Auto-compounded LP rewards on Venus & PancakeSwap",
        source: AGENT_DATA_SOURCES.publisher,
      },
      {
        timestamp: "2026-08-25 09:20 UTC",
        action: "Yield pool rebalance executed to optimize net APY",
        source: AGENT_DATA_SOURCES.publisher,
      },
      {
        timestamp: "2026-03-02 07:32 UTC",
        action: "Roboclaw agent identity registered on BSC Mainnet",
        source: AGENT_DATA_SOURCES.registry,
      },
    ],
  }),
];

export const CURATED_AGENT_TOKEN_IDS = EDITORIAL_AGENTS.map(
  ({ tokenId }) => tokenId,
);

export function findEditorialAgent(reference: string): Agent | undefined {
  const parts = reference.split(":");
  const tokenId = parts[parts.length - 1];

  return EDITORIAL_AGENTS.find(
    (agent) => agent.id === reference || agent.tokenId === tokenId,
  );
}
