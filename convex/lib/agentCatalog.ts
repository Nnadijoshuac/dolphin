/**
 * The authoritative agent catalog: curation, taxonomy, price policy, and the
 * editorial/discovered merge rule, all in one server-side module.
 *
 * WHY THIS EXISTS (2026-08-29). These decisions used to live only in the
 * mobile app's client code - src/data/editorial-agents.ts (curation),
 * src/constants/agents.ts (taxonomy + DEFAULT_READ_ONLY_PRICE_MODEL),
 * src/data/discovered-agents.ts (the discovered->Agent mapping) and
 * src/hooks/use-agents.ts (merge-and-dedupe). The Next.js site under web/ had
 * begun re-implementing all four from a copy taken on 2026-08-28, and had
 * already drifted: its taxonomy still listed "monitoring" as a graded category
 * where the mobile app had replaced it with "rebalancing" a day earlier, so the
 * two surfaces would have shown different categories and different agent lists
 * for the same registry.
 *
 * Everything here is a DECISION (which agents are curated, what category they
 * are in, what a hire costs, which duplicate wins). Pure fetch mechanics stay
 * in convex/agents.ts. Both frontends read the result through
 * agents.listAgents / agents.getAgent and shape nothing themselves.
 *
 * MANUAL MIRROR, same rule as convex/lib/liveMetric.ts and
 * convex/categoryStatsValidators.ts: Convex functions are bundled from convex/
 * only and cannot import from src/, so the Agent-shaped types below are
 * hand-mirrored from src/types/agent.ts. If one changes, change the other in
 * the same commit and say so in the message.
 */

import { BSC_CHAIN_ID } from "./bscClient";

export type AgentCategory =
  | "monitoring"
  | "rebalancing"
  | "grid-trading"
  | "health-factor"
  | "yield";

export interface DataSourceLabel {
  id: string;
  label: string;
  url?: string;
}

export const ERC8004_IDENTITY_REGISTRY =
  "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

// The four categories graded by the hackathon's Agent Diversity rubric.
// "monitoring" stays a valid AgentCategory (Wallet Watch's data and hire
// record are real and unbroken) but is deliberately excluded from this
// enumerated list - see project-scope.md's category taxonomy notes. Mirrors
// AGENT_CATEGORY_SLUGS in src/constants/agents.ts.
export const AGENT_CATEGORY_SLUGS: readonly AgentCategory[] = [
  "rebalancing",
  "grid-trading",
  "health-factor",
  "yield",
];

export const AGENT_CATEGORIES: readonly {
  slug: AgentCategory;
  label: string;
  description: string;
}[] = [
  {
    slug: "rebalancing",
    label: "Rebalancing",
    description:
      "LP-range agents that reset concentrated-liquidity positions automatically.",
  },
  {
    slug: "grid-trading",
    label: "Grid Trading",
    description: "Price-ladder agents and their available track-record evidence.",
  },
  {
    slug: "health-factor",
    label: "Health Factor",
    description:
      "Lending-risk agents and their published liquidation-buffer data.",
  },
  {
    slug: "yield",
    label: "Yield",
    description:
      "Yield agents and their available protocol and performance sources.",
  },
];

export const AGENT_DATA_SOURCES = {
  registry: {
    id: "erc-8004-bsc-registry",
    label: "ERC-8004 registry on BSC",
    url: `https://bscscan.com/address/${ERC8004_IDENTITY_REGISTRY}`,
  },
  scan: {
    id: "8004scan",
    label: "8004scan indexed data",
    url: "https://8004scan.io",
  },
  publisher: {
    id: "publisher-metadata",
    label: "Publisher-reported metadata",
  },
  editorial: {
    id: "dolphin-editorial",
    label: "Dolphin editorial classification",
  },
  heuristicDiscovery: {
    id: "dolphin-heuristic-discovery",
    label: "Dolphin automated discovery (keyword-matched, not human-vetted)",
  },
  // Not a data feed: a value set by Dolphin's own marketplace policy.
  marketplacePolicy: {
    id: "dolphin-marketplace-policy",
    label: "Dolphin marketplace policy (not a publisher-published value)",
  },
} as const satisfies Record<string, DataSourceLabel>;

/* ---------------------------------------------------------------------------
 * DECISION (2026-08-29): what an agent costs when nobody publishes a price.
 * ---------------------------------------------------------------------------
 * Moved here from src/constants/agents.ts on 2026-08-29 so the mobile app and
 * the website cannot price the same agent differently. The full reasoning is
 * unchanged and reproduced below; that constant now re-exports this one.
 *
 * ERC-8004 carries no price field, and 8004scan's agent API publishes none
 * either (verified by inspecting every key of a full raw response). No
 * third-party price feed for these agents exists to fall back on.
 *
 * The resolution is to price what Dolphin actually does, which is precisely
 * knowable rather than guessed. A Dolphin hire is a read-only subscription
 * record (convex/agentHires.ts): no signature, no spend cap, no session, no
 * on-chain transaction, no custody. It costs the user exactly zero. That is a
 * verifiable fact about this marketplace, not an assumption about a publisher,
 * which is why it does not violate the data-integrity rule in AGENTS.md SS5 the
 * way inventing an APY or a win rate would.
 *
 * What this deliberately does NOT claim: that the publisher offers their
 * service free. They may charge at their own service endpoint; Dolphin cannot
 * see that and must not assert otherwise. So `source` names Dolphin's own
 * policy instead of a data feed, and `methodology` states the limit.
 *
 * TO REVERSE THIS (e.g. once x402 or a real publisher price feed lands):
 * change or delete this constant. It is now the single call site for both
 * frontends. Paid agents already fail closed: convex/agentHires.ts rejects any
 * non-zero price because no x402 seller-side integration is wired up.
 */
export const DEFAULT_READ_ONLY_PRICE_MODEL = {
  type: "flat",
  amount: "0",
  token: "BNB",
} as const;

const READ_ONLY_PRICE_METHODOLOGY =
  "Dolphin's own hire price, not a publisher-published one. A hire here records a " +
  "read-only subscription and requests no signature, payment, session, or spend cap, " +
  "so it costs nothing. The publisher may charge separately at its own service " +
  "endpoint; ERC-8004 and 8004scan expose no price field for Dolphin to read.";

export function defaultReadOnlyPriceMetric(asOf: string) {
  return {
    status: "live" as const,
    value: { ...DEFAULT_READ_ONLY_PRICE_MODEL },
    asOf,
    source: AGENT_DATA_SOURCES.marketplacePolicy,
    methodology: READ_ONLY_PRICE_METHODOLOGY,
  };
}

const METRICS_NOT_PUBLISHED =
  "No auditable live metric feed or execution history is published for this value.";

export function unavailableMetric(
  reason: string,
  source: DataSourceLabel = AGENT_DATA_SOURCES.publisher,
) {
  return {
    status: "unavailable" as const,
    value: null,
    asOf: null as string | null,
    source,
    reason,
  };
}

export function liveMetric<T>(
  value: T,
  asOf: string,
  source: DataSourceLabel,
  methodology?: string,
) {
  return { status: "live" as const, value, asOf, source, methodology };
}

export function unverifiedRegistry() {
  const reason = "On-chain identity has not been checked in this request yet.";
  return {
    registered: unavailableMetric(reason, AGENT_DATA_SOURCES.registry),
    owner: unavailableMetric(reason, AGENT_DATA_SOURCES.registry),
    tokenUri: unavailableMetric(reason, AGENT_DATA_SOURCES.registry),
    agentWallet: unavailableMetric(reason, AGENT_DATA_SOURCES.registry),
  };
}

/**
 * Every metric a category can carry, all explicitly unavailable. The real
 * numbers arrive separately through convex/categoryStats.ts, which is refreshed
 * per agent on view - this is the honest placeholder until then, and the
 * permanent answer for categories with no wired protocol read.
 * Mirrors unavailableLiveStats in src/data/editorial-agents.ts.
 */
export function unavailableLiveStats(category: AgentCategory) {
  const m = () => unavailableMetric(METRICS_NOT_PUBLISHED);

  switch (category) {
    case "monitoring":
      return {
        category,
        alertFrequency: m(),
        assetsWatched: m(),
        lastAlertAt: m(),
        falsePositiveRate: m(),
      };
    case "rebalancing":
    case "grid-trading":
      return {
        category,
        winRate: m(),
        activeRange: m(),
        currentPnl: m(),
        positionCount: m(),
        trackRecordPeriod: m(),
      };
    case "health-factor":
      return {
        category,
        positionsMonitored: m(),
        averageHealthFactor: m(),
        liquidationsPrevented: m(),
        responseLatencyMs: m(),
      };
    case "yield":
      return {
        category,
        currentApy: m(),
        tvlManagedUsd: m(),
        protocolsUsed: m(),
        rebalanceFrequency: m(),
      };
  }
}

export function agentId(tokenId: string): string {
  return `${BSC_CHAIN_ID}:${ERC8004_IDENTITY_REGISTRY.toLowerCase()}:${tokenId}`;
}

/* ---------------------------------------------------------------------------
 * Editorial curation - the hand-vetted agents.
 * ------------------------------------------------------------------------ */

export interface EditorialAgentInput {
  tokenId: string;
  name: string;
  ownerAddress: string;
  category: AgentCategory;
  tagline: string;
  description: string;
  iconUrl: string | null;
  registeredAt: string;
  reportedSkills: string[];
}

/**
 * Ported verbatim from src/data/editorial-agents.ts on 2026-08-29 - same eight
 * agents, same token IDs, same categories, same copy. Each is a real ERC-8004
 * identity on BSC mainnet, checked by hand.
 */
export const EDITORIAL_AGENT_INPUTS: readonly EditorialAgentInput[] = [
  {
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
  },
  {
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
  },
  {
    tokenId: "45650",
    name: "V3 Pools powered by HeyAnon",
    ownerAddress: "0xda977767452c5dd021624511f14df67b6c9c2c1b",
    category: "rebalancing",
    tagline:
      "Validates and executes concentrated-liquidity V3 pool positions across several chains, including BSC.",
    description:
      "The publisher describes a safe execution layer for Uniswap V3-style concentrated liquidity (covering PancakeSwap, Uniswap, and other V3-style DEXs) that validates price ranges, estimates tick spacing, and returns pre-validated calldata for creating positions, adjusting liquidity, and collecting fees.",
    iconUrl: "https://api.8004scan.io/api/v1/media/agents/56/45650/image",
    registeredAt: "2026-03-18T15:16:36Z",
    reportedSkills: [
      "Concentrated liquidity position management",
      "Multi-DEX range execution",
    ],
  },
  {
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
  },
  {
    tokenId: "302257",
    name: "Brain on BNB — Venus Health Factor Monitor",
    ownerAddress: "0x73809f69916fcf7ddc5bb1315fbdf96a569a5963",
    category: "health-factor",
    tagline:
      "Reads Venus lending positions and reports the real health factor before liquidation risk.",
    description:
      "The publisher describes an agent that reads a Venus lending position market by market on BNB Chain and returns its health factor, the collateral drawdown that would trigger liquidation, and a stress table cross-checked against Venus's own getAccountLiquidity call - self-declared as health-factor-monitoring in its own on-chain metadata.",
    iconUrl: "https://api.8004scan.io/api/v1/media/agents/56/302257/image",
    registeredAt: "2026-08-25T11:09:12Z",
    reportedSkills: [
      "Venus health factor calculation",
      "Liquidation stress testing",
    ],
  },
  {
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
  },
  {
    tokenId: "45381",
    name: "Aave powered by HeyAnon",
    ownerAddress: "0xda977767452c5dd021624511f14df67b6c9c2c1b",
    // Reclassified from "yield": its own description centers on validating
    // collateral requirements and checking health factors, not moving capital
    // to yield - and convex/lib/classification.ts's independent keyword
    // classifier agrees, tagging this same token "health-factor" (confirmed).
    category: "health-factor",
    tagline:
      "Validates and executes Aave lending actions across several chains, including BSC.",
    description:
      "The publisher describes a safe execution layer for Aave lending that validates collateral requirements, checks health factors, and verifies token approvals before returning pre-validated calldata for supply, borrow, repay, withdraw, and liquidation actions.",
    iconUrl: "https://api.8004scan.io/api/v1/media/agents/56/45381/image",
    registeredAt: "2026-03-18T11:43:14Z",
    reportedSkills: [
      "Aave lending execution",
      "Collateral and health factor validation",
    ],
  },
  {
    tokenId: "45422",
    name: "Beefy powered by HeyAnon",
    ownerAddress: "0xda977767452c5dd021624511f14df67b6c9c2c1b",
    category: "yield",
    tagline:
      "Validates and executes Beefy vault deposits and withdrawals across several chains, including BSC.",
    description:
      "The publisher describes a safe execution layer for Beefy classic vaults and CLM pools that validates vault compatibility and deposit limits, handles token approvals, and returns pre-validated calldata for deposits, withdrawals, staking, and reward claims.",
    iconUrl: "https://api.8004scan.io/api/v1/media/agents/56/45422/image",
    registeredAt: "2026-03-18T12:05:55Z",
    reportedSkills: ["Beefy vault execution", "CLM pool staking"],
  },
];

export const EDITORIAL_TOKEN_IDS: readonly string[] = EDITORIAL_AGENT_INPUTS.map(
  ({ tokenId }) => tokenId,
);

export function buildEditorialAgent(input: EditorialAgentInput, asOf: string) {
  return {
    id: agentId(input.tokenId),
    tokenId: input.tokenId,
    chain: "bsc" as const,
    chainId: BSC_CHAIN_ID,
    registryAddress: ERC8004_IDENTITY_REGISTRY,
    name: input.name,
    publisher: input.ownerAddress,
    publisherAddress: input.ownerAddress as string | null,
    category: input.category,
    classificationSource: "editorial-explicit-metadata" as const,
    classificationConfidence: undefined as "confirmed" | "likely" | undefined,
    tagline: input.tagline,
    description: input.description,
    iconUrl: input.iconUrl,
    registeredAt: input.registeredAt as string | null,
    agentWallet: null as string | null,
    skills: input.reportedSkills.map((name) => ({
      name,
      evidence: "publisher-reported" as const,
    })),
    verifiedSkills: [] as string[],
    services: [] as { name: string; endpoint: string; version: string | null }[],
    x402Supported: unavailableMetric(
      "Payment support has not been refreshed from the indexer.",
      AGENT_DATA_SOURCES.scan,
    ),
    isActive: unavailableMetric(
      "Registry activity has not been refreshed from the indexer.",
      AGENT_DATA_SOURCES.scan,
    ),
    reputationScore: unavailableMetric(
      "No reviewer-filtered reputation score is available.",
      AGENT_DATA_SOURCES.registry,
    ),
    feedbackCount: unavailableMetric(
      "Feedback count has not been refreshed from the indexer.",
      AGENT_DATA_SOURCES.scan,
    ),
    endpointStatus: unavailableMetric(
      "No recent endpoint health check is available.",
      AGENT_DATA_SOURCES.scan,
    ),
    liveStats: unavailableLiveStats(input.category),
    performanceSeries: [] as unknown[],
    recentActivity: [] as unknown[],
    priceModel: defaultReadOnlyPriceMetric(asOf),
    registryVerification: unverifiedRegistry(),
    sourceLabels: [
      AGENT_DATA_SOURCES.editorial,
      AGENT_DATA_SOURCES.publisher,
      AGENT_DATA_SOURCES.scan,
    ] as DataSourceLabel[],
    recordStatus: "editorial-fallback" as "indexed" | "editorial-fallback",
  };
}

export type CatalogAgent = ReturnType<typeof buildEditorialAgent>;

function deriveTagline(description: string): string {
  const trimmed = description.trim();
  const firstSentence = trimmed.split(/(?<=[.!?])\s/)[0] ?? trimmed;
  return firstSentence.length > 140
    ? `${firstSentence.slice(0, 137)}...`
    : firstSentence;
}

/**
 * Maps one discoveredAgents row (real 8004scan data, category assigned by
 * convex/lib/classification.ts's keyword heuristic - not a human) into the same
 * shape as an editorial agent. classificationSource/classificationConfidence
 * carry that provenance through so a UI can visibly distinguish these from the
 * hand-vetted entries. Ported from src/data/discovered-agents.ts.
 */
export function buildDiscoveredAgent(
  row: {
    tokenId: string;
    name: string;
    description: string;
    iconUrl: string | null;
    ownerAddress: string;
    category: AgentCategory;
    confidence: "confirmed" | "likely";
    matchedTerms: string[];
    x402Supported: boolean;
    registeredAt: string | null;
    syncedAt: string;
  },
  asOf: string,
): CatalogAgent {
  return {
    ...buildEditorialAgent(
      {
        tokenId: row.tokenId,
        name: row.name,
        ownerAddress: row.ownerAddress,
        category: row.category,
        tagline: deriveTagline(row.description),
        description: row.description,
        iconUrl: row.iconUrl,
        registeredAt: row.registeredAt ?? "",
        reportedSkills: row.matchedTerms,
      },
      asOf,
    ),
    registeredAt: row.registeredAt,
    classificationSource: "heuristic-keyword-match" as never,
    classificationConfidence: row.confidence,
    x402Supported: liveMetric(
      row.x402Supported,
      row.syncedAt,
      AGENT_DATA_SOURCES.scan,
    ) as never,
    sourceLabels: [
      AGENT_DATA_SOURCES.scan,
      AGENT_DATA_SOURCES.publisher,
      AGENT_DATA_SOURCES.heuristicDiscovery,
    ],
    recordStatus: "indexed",
  };
}

/**
 * THE MERGE RULE. Editorial agents are hand-vetted; a discovered row for the
 * same tokenId is a re-sync of one we already curated, so the editorial copy
 * wins and the duplicate is dropped. This used to live in useAgents() in the
 * mobile app only - the website would have had to re-implement it, which is
 * exactly the drift this module exists to prevent.
 */
export function mergeCatalog(
  editorial: readonly CatalogAgent[],
  discovered: readonly CatalogAgent[],
): CatalogAgent[] {
  const curated = new Set(editorial.map(({ tokenId }) => tokenId));
  return [
    ...editorial,
    ...discovered.filter(({ tokenId }) => !curated.has(tokenId)),
  ];
}
