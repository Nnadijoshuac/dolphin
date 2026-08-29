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
  Address,
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
