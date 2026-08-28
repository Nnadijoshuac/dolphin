import type { Address } from "viem";

import {
  AGENT_DATA_SOURCES,
  BSC_CHAIN_ID,
  ERC8004_REGISTRY_ADDRESSES,
} from "@/constants/agents";
import type {
  Agent,
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

export function unavailableLiveStats(category: AgentCategory): AgentLiveStats {
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
    performanceSeries: [],
    recentActivity: [],
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
    name: "Wallet Watch",
    ownerAddress: "0x60382499dcf0493235690e5cebfb032f4400bee6",
    category: "monitoring",
    tagline: "Tracks wallet activity and alerts you to important changes.",
    description:
      "The publisher describes an autonomous agent that monitors market movements, protocol conditions, and on-chain data to identify opportunities and risks.",
    iconUrl: "https://api.8004scan.io/api/v1/media/agents/56/303727/image",
    registeredAt: "2026-08-25T20:14:02Z",
    reportedSkills: ["Wallet monitoring", "On-chain activity alerts"],
  }),
  createEditorialAgent({
    tokenId: "292939",
    name: "Range Maker",
    ownerAddress: "0xfaf0ffd121947b9ee3920fa0cfbf9eeeb0acbf7f",
    category: "grid-trading",
    tagline: "Creates and manages optimal price ranges to capture fees.",
    description:
      "The publisher describes geometric grid trading for BNB/USDT through PancakeSwap, with computed grid plans and live strategy status.",
    iconUrl: null,
    registeredAt: "2026-08-22T11:35:42Z",
    reportedSkills: ["Geometric grid planning", "PancakeSwap range maker"],
  }),
  createEditorialAgent({
    tokenId: "45650",
    name: "V3 Pools powered by HeyAnon",
    ownerAddress: "0xda977767452c5dd021624511f14df67b6c9c2c1b",
    category: "grid-trading",
    tagline: "Validates and executes concentrated-liquidity V3 pool positions across several chains, including BSC.",
    description:
      "The publisher describes a safe execution layer for Uniswap V3-style concentrated liquidity (covering PancakeSwap, Uniswap, and other V3-style DEXs) that validates price ranges, estimates tick spacing, and returns pre-validated calldata for creating positions, adjusting liquidity, and collecting fees.",
    iconUrl: "https://api.8004scan.io/api/v1/media/agents/56/45650/image",
    registeredAt: "2026-03-18T15:16:36Z",
    reportedSkills: ["Concentrated liquidity position management", "Multi-DEX range execution"],
  }),
  createEditorialAgent({
    tokenId: "292058",
    name: "Liquidation Guard",
    ownerAddress: "0xa09991fc5d8637bb4245737c3ebf26e24d653962",
    category: "health-factor",
    tagline: "Monitors your positions and helps prevent liquidations.",
    description:
      "The publisher describes a read-only agent that evaluates Venus Core and isolated-pool positions, stress-tests collateral drawdowns, and calculates repayment requirements.",
    iconUrl: null,
    registeredAt: "2026-08-22T07:16:53Z",
    reportedSkills: ["Venus position analysis", "Liquidation prevention"],
  }),
  createEditorialAgent({
    tokenId: "302257",
    name: "Brain on BNB — Venus Health Factor Monitor",
    ownerAddress: "0x73809f69916fcf7ddc5bb1315fbdf96a569a5963",
    category: "health-factor",
    tagline: "Reads Venus lending positions and reports the real health factor before liquidation risk.",
    description:
      "The publisher describes an agent that reads a Venus lending position market by market on BNB Chain and returns its health factor, the collateral drawdown that would trigger liquidation, and a stress table cross-checked against Venus's own getAccountLiquidity call - self-declared as health-factor-monitoring in its own on-chain metadata.",
    iconUrl: "https://api.8004scan.io/api/v1/media/agents/56/302257/image",
    registeredAt: "2026-08-25T11:09:12Z",
    reportedSkills: ["Venus health factor calculation", "Liquidation stress testing"],
  }),
  createEditorialAgent({
    tokenId: "12046",
    name: "Yield Maximizer",
    ownerAddress: "0x7b65b716bc7d3ba0ccdda9694ba50fd03036c088",
    category: "yield",
    tagline: "Maximizes returns across verified DeFi opportunities.",
    description:
      "The publisher describes an agent for yield farming, auto-compounding rewards, and finding DeFi earning opportunities.",
    iconUrl: "https://api.8004scan.io/api/v1/media/agents/56/12046/image",
    registeredAt: "2026-03-02T07:32:20Z",
    reportedSkills: ["Yield opportunity discovery", "Auto-compounding"],
  }),
  createEditorialAgent({
    tokenId: "45381",
    name: "Aave powered by HeyAnon",
    ownerAddress: "0xda977767452c5dd021624511f14df67b6c9c2c1b",
    category: "yield",
    tagline: "Validates and executes Aave lending actions across several chains, including BSC.",
    description:
      "The publisher describes a safe execution layer for Aave lending that validates collateral requirements, checks health factors, and verifies token approvals before returning pre-validated calldata for supply, borrow, repay, withdraw, and liquidation actions.",
    iconUrl: "https://api.8004scan.io/api/v1/media/agents/56/45381/image",
    registeredAt: "2026-03-18T11:43:14Z",
    reportedSkills: ["Aave lending execution", "Collateral and health factor validation"],
  }),
  createEditorialAgent({
    tokenId: "45422",
    name: "Beefy powered by HeyAnon",
    ownerAddress: "0xda977767452c5dd021624511f14df67b6c9c2c1b",
    category: "yield",
    tagline: "Validates and executes Beefy vault deposits and withdrawals across several chains, including BSC.",
    description:
      "The publisher describes a safe execution layer for Beefy classic vaults and CLM pools that validates vault compatibility and deposit limits, handles token approvals, and returns pre-validated calldata for deposits, withdrawals, staking, and reward claims.",
    iconUrl: "https://api.8004scan.io/api/v1/media/agents/56/45422/image",
    registeredAt: "2026-03-18T12:05:55Z",
    reportedSkills: ["Beefy vault execution", "CLM pool staking"],
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
