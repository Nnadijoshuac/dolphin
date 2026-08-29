import type { Address } from "viem";

import type {
  AgentCategory,
  AgentPriceModel,
  DataSourceLabel,
  LiveMetric,
} from "@/types/agent";

export const BSC_CHAIN_ID = 56 as const;

const configuredBscRpcUrl = process.env.EXPO_PUBLIC_BSC_RPC_URL?.trim();

export const BSC_RPC_URL =
  configuredBscRpcUrl || "https://bsc-dataseed.bnbchain.org";

export const ERC8004_REGISTRY_ADDRESSES = {
  identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as Address,
  reputation: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63" as Address,
} as const;

// The four categories graded by the hackathon's Agent Diversity rubric.
// "monitoring" stays a valid AgentCategory (Wallet Watch's data and hire
// record are real and unbroken) but is deliberately excluded from this
// enumerated list - see project-scope.md's category taxonomy notes. It is
// never presented as one of the four graded categories, so it does not
// appear in Discover/Search/onboarding's category browsing surfaces, which
// all iterate over this list.
export const AGENT_CATEGORY_SLUGS = [
  "rebalancing",
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
    slug: "rebalancing",
    label: "Rebalancing",
    description: "LP-range agents that reset concentrated-liquidity positions automatically.",
  },
  {
    slug: "grid-trading",
    label: "Grid Trading",
    description: "Price-ladder agents and their available track-record evidence.",
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
  // Not a data feed: a value set by Dolphin's own marketplace policy. Used
  // for DEFAULT_READ_ONLY_PRICE_MODEL below, so a reader can always tell a
  // Dolphin-set value apart from an indexed or on-chain one.
  marketplacePolicy: {
    id: "dolphin-marketplace-policy",
    label: "Dolphin marketplace policy (not a publisher-published value)",
  },
} as const satisfies Record<string, DataSourceLabel>;

/* ---------------------------------------------------------------------------
 * DECISION (2026-08-29): what an agent costs when nobody publishes a price.
 * ---------------------------------------------------------------------------
 * NO LONGER THE AUTHORITY. As of the 2026-08-29 centralization, the live
 * price every surface renders comes from convex/lib/agentCatalog.ts's
 * DEFAULT_READ_ONLY_PRICE_MODEL, which both this app and the website under
 * web/ read through agents.listAgents. Change it THERE.
 *
 * What survives here is the fallback path only: the editorial agents built in
 * src/data/editorial-agents.ts, used when EXPO_PUBLIC_CONVEX_URL is unset (see
 * fetchAgentCatalog in src/hooks/use-agents.ts). Kept identical to the Convex
 * copy on purpose - if you change one, change both, the same manual-mirror
 * rule AGENTS.md SS9 already applies to the Convex validators.
 *
 * The original reasoning, unchanged:
 *
 * ERC-8004 carries no price field, and 8004scan's agent API publishes none
 * either (verified by inspecting every key of a full raw response). No
 * third-party price feed for these agents exists to fall back on.
 *
 * Until now `priceModel` was hardcoded `unavailable` on every agent from
 * every source, and hire/[id].tsx gates its Hire button on the price
 * resolving to "live"/"stale" - so hiring was unreachable for every agent in
 * every category. That was the single dead end in the judged
 * land -> find -> understand -> activate flow.
 *
 * The resolution is to price what Dolphin actually does, which is precisely
 * knowable rather than guessed. A Dolphin hire is a read-only subscription
 * record (convex/agentHires.ts): no signature, no spend cap, no session, no
 * on-chain transaction, no custody. It costs the user exactly zero. That is
 * a verifiable fact about this marketplace, not an assumption about a
 * publisher, which is why it does not violate the data-integrity rule in
 * AGENTS.md SS5 the way inventing an APY or a win rate would.
 *
 * What this deliberately does NOT claim: that the publisher offers their
 * service free. They may charge at their own service endpoint; Dolphin
 * cannot see that and must not assert otherwise. So `source` names Dolphin's
 * own policy instead of a data feed, and `methodology` states the limit -
 * the provenance travels with the value rather than living only in this
 * comment. hire/[id].tsx renders it as "Dolphin hire price", never as a
 * publisher-published price.
 *
 * TO REVERSE THIS (e.g. once x402 or a real publisher price feed lands):
 * change or delete this constant and the two call sites that use it -
 * src/data/editorial-agents.ts. src/services/agents-api.ts inherits it via
 * its `...fallback` spread.
 * Paid agents already fail closed: convex/agentHires.ts rejects any non-zero
 * price because no x402 seller-side integration is wired up.
 */
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
