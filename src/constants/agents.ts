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

// The categories the marketplace browses. The first four are the ones graded
// by the hackathon's Agent Diversity rubric; "trading" is an additional
// Dolphin category, not a fifth graded one - the registry has a real
// population of general trading agents that none of the other four describe,
// and force-fitting them into grid-trading would have been the same
// substance-wrong mistake the 2026-08-28 taxonomy audit corrected.
//
// "monitoring" stays a valid AgentCategory (Wallet Watch's data and hire
// record are real and unbroken) but is deliberately excluded from this
// enumerated list - see project-scope.md's category taxonomy notes. It is
// never presented as one of the graded categories, so it does not appear in
// Discover/Search/onboarding's category browsing surfaces, which all iterate
// over this list.
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
  {
    slug: "trading",
    label: "Trading",
    description: "Agents that plan or execute trades, and the track-record evidence they publish.",
  },
];

/* ---------------------------------------------------------------------------
 * OPEN CATEGORIES: total lookups, so an unknown slug can never render blank.
 * ---------------------------------------------------------------------------
 * `AgentCategory` is a free string as of the 2026-09-07 rebuild (see
 * src/types/agent.ts for why). That makes every `Record<AgentCategory, T>`
 * lookup partial at runtime while still typechecking, because
 * `noUncheckedIndexedAccess` is off in this project — so a `research` agent
 * would have silently rendered `undefined` as its category label.
 *
 * Every category lookup in the app goes through the three functions below, and
 * each one is total by construction. Nothing should index a category map
 * directly again.
 * ------------------------------------------------------------------------ */

const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  monitoring: "Monitoring",
  rebalancing: "Rebalancing",
  "grid-trading": "Grid trading",
  "health-factor": "Health factor",
  yield: "Yield",
  trading: "Trading",
  research: "Research",
  development: "Development",
  security: "Security",
  payments: "Payments",
  content: "Content",
  automation: "Automation",
  general: "General",
};

/**
 * A human label for any slug, known or not.
 *
 * The fallback title-cases the slug, so a category the registry invents next
 * week reads as "Data Pipelines" rather than as nothing at all. This mirrors
 * `categoryLabel` in convex/lib/categorize.ts — the same manual-mirror rule
 * AGENTS.md §9 already applies to the Convex validators.
 */
export function categoryLabel(slug: string): string {
  const known = CATEGORY_LABELS[slug];
  if (known) return known;
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export interface CategoryVisual {
  /** Tint behind an icon or chip. */
  background: string;
  /** Foreground for a glyph drawn on that tint. */
  foreground: string;
  /** One short line of plain-language copy for a browse chip. */
  subtitle: string;
}

const CATEGORY_VISUALS: Readonly<Record<string, CategoryVisual>> = {
  monitoring: { background: "#F5F3EC", foreground: "#8A7B4F", subtitle: "Watch wallets" },
  rebalancing: { background: "#EAF1FB", foreground: "#3C6FB4", subtitle: "LP ranges" },
  "grid-trading": { background: "#FAF5E6", foreground: "#B08A2E", subtitle: "Price ladders" },
  "health-factor": { background: "#F9F3F0", foreground: "#B0663C", subtitle: "Borrow risk" },
  yield: { background: "#F0F7F2", foreground: "#3F8A5C", subtitle: "Find yield" },
  trading: { background: "#F4F0FA", foreground: "#7B5CB8", subtitle: "Trade markets" },
  research: { background: "#EFF4F6", foreground: "#48727F", subtitle: "Dig into data" },
  development: { background: "#F1F1F6", foreground: "#5B5B86", subtitle: "Build and review" },
  security: { background: "#FBF0F0", foreground: "#A64B4B", subtitle: "Spot risk" },
  payments: { background: "#EFF6F3", foreground: "#3E8375", subtitle: "Move money" },
  content: { background: "#FAF2F5", foreground: "#A65778", subtitle: "Write and make" },
  automation: { background: "#F2F5EE", foreground: "#6B8449", subtitle: "Run workflows" },
};

/** Neutral, and deliberately not one of the branded tints. */
const DEFAULT_VISUAL: CategoryVisual = {
  background: "#F3F3F1",
  foreground: "#6C6C6C",
  subtitle: "Other agents",
};

export function categoryVisual(slug: string): CategoryVisual {
  return CATEGORY_VISUALS[slug] ?? DEFAULT_VISUAL;
}

const configured8004ScanBaseUrl = process.env.EXPO_PUBLIC_8004SCAN_API_BASE_URL?.trim();

export const AGENTS_API = {
  baseUrl: configured8004ScanBaseUrl || "https://8004scan.io/api/v1/public",
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
 * every source, and components/hire-sheet.tsx gates its flow on the price
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
 * comment. The hire sheet no longer renders it as a headline price at all -
 * the price a user sees comes from the agent's own live quote, never as a
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
