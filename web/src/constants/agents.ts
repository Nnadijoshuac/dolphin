import type { AgentCategory, DataSourceLabel, AgentPriceModel, LiveMetric } from "@/types/agent";
import type { Address } from "@/types/agent";

export const BSC_CHAIN_ID = 56 as const;

const configuredBscRpcUrl = process.env.NEXT_PUBLIC_BSC_RPC_URL?.trim();

export const BSC_RPC_URL =
  configuredBscRpcUrl || "https://bsc-dataseed.bnbchain.org";

export const ERC8004_REGISTRY_ADDRESSES = {
  identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as Address,
  reputation: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63" as Address,
} as const;

// Mirrors AGENT_CATEGORY_SLUGS in src/constants/agents.ts, where the reasoning
// for each entry lives. "trading" is an additional Dolphin category, not a
// fifth hackathon-graded one.
export const AGENT_CATEGORY_SLUGS = [
  "rebalancing",
  "grid-trading",
  "health-factor",
  "yield",
  "trading",
] as const satisfies readonly AgentCategory[];

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
  {
    slug: "trading",
    label: "Trading",
    description:
      "Agents that plan or execute trades, and the track-record evidence they publish.",
  },
];

export const AGENT_DATA_SOURCES = {
  registry: {
    id: "erc-8004-bsc-registry",
    label: "ERC-8004 registry on BSC",
    url: "https://bscscan.com/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
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
  marketplacePolicy: {
    id: "dolphin-marketplace-policy",
    label: "Dolphin marketplace policy (not a publisher-published value)",
  },
} as const satisfies Record<string, DataSourceLabel>;

export const DEFAULT_READ_ONLY_PRICE_MODEL = {
  type: "flat",
  amount: "0",
  token: "BNB",
} as const satisfies AgentPriceModel;

const READ_ONLY_PRICE_METHODOLOGY =
  "Dolphin's own hire price, not a publisher-published one. A hire here records a " +
  "read-only subscription and requests no signature, payment, session, or spend cap, " +
  "so it costs nothing. The publisher may charge separately at its own service " +
  "endpoint; ERC-8004 and 8004scan expose no price field for Dolphin to read.";

export function defaultReadOnlyPriceMetric(): LiveMetric<AgentPriceModel> {
  return {
    status: "live",
    value: { ...DEFAULT_READ_ONLY_PRICE_MODEL },
    asOf: new Date().toISOString(),
    source: AGENT_DATA_SOURCES.marketplacePolicy,
    methodology: READ_ONLY_PRICE_METHODOLOGY,
  };
}

export const AGENT_QUERY_TIMINGS = {
  listStaleTimeMs: 5 * 60 * 1_000,
  detailStaleTimeMs: 10 * 60 * 1_000,
  garbageCollectionTimeMs: 60 * 60 * 1_000,
} as const;
