import type { Address } from "viem";

import type { AgentCategory, DataSourceLabel } from "@/types/agent";

export const BSC_CHAIN_ID = 56 as const;

const configuredBscRpcUrl = process.env.EXPO_PUBLIC_BSC_RPC_URL?.trim();

export const BSC_RPC_URL =
  configuredBscRpcUrl || "https://bsc-dataseed.bnbchain.org";

export const ERC8004_REGISTRY_ADDRESSES = {
  identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as Address,
  reputation: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63" as Address,
} as const;

export const AGENT_CATEGORY_SLUGS = [
  "monitoring",
  "grid-trading",
  "health-factor",
  "yield",
] as const satisfies readonly AgentCategory[];

export const AGENT_CATEGORIES: readonly {
  slug: AgentCategory;
  label: string;
  description: string;
}[] = [
  {
    slug: "monitoring",
    label: "Monitoring",
    description: "Agents that publish market, wallet, or position monitoring.",
  },
  {
    slug: "grid-trading",
    label: "Grid Trading",
    description: "Range-strategy agents and their available track-record evidence.",
  },
  {
    slug: "health-factor",
    label: "Health Factor",
    description: "Lending-risk agents and their published liquidation-buffer data.",
  },
  {
    slug: "yield",
    label: "Yield",
    description: "Yield agents and their available protocol and performance sources.",
  },
];

export const AGENTS_API = {
  baseUrl: "https://8004scan.io/api/v1/public",
  chainId: BSC_CHAIN_ID,
} as const;

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
} as const satisfies Record<string, DataSourceLabel>;

export const AGENT_QUERY_TIMINGS = {
  listStaleTimeMs: 5 * 60 * 1_000,
  detailStaleTimeMs: 10 * 60 * 1_000,
  garbageCollectionTimeMs: 60 * 60 * 1_000,
} as const;
