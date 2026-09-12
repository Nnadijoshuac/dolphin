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

/**
 * ===========================================================================
 * CATEGORIES ARE DATA. THIS FILE ONLY HOLDS COPY. (2026-09-08)
 * ===========================================================================
 *
 * WHAT THIS USED TO BE, and what it cost. `AGENT_CATEGORIES` was a hardcoded
 * list of five, and it was THE browse list: Discover's filter rail, Search's
 * tab row, the footer's Browse column and `isAgentCategory()`'s guard all read
 * it. Meanwhile `convex/lib/categorize.ts` classifies agents into THIRTEEN
 * slugs - the five below plus monitoring, research, development, security,
 * payments, content, automation, and `general`, which is the fallback every
 * unclassified agent lands in.
 *
 * So eight categories, including the default one, had no chip anywhere on the
 * site. Agents in them were reachable only by typing the right word into the
 * search box. `useCategoryFacets()` - the hook written for exactly this, whose
 * own comment says "which categories exist is a property of the data" - existed
 * in src/hooks/use-agents.ts and was called from nowhere.
 *
 * It also broke a link. `agent-detail.tsx` sends the category breadcrumb to
 * `/search?category=<slug>`, and Search's guard rejected any slug not in this
 * list, so a monitoring or research agent's own breadcrumb silently landed on
 * "All agents".
 *
 * THE BROWSE LIST NOW COMES FROM `useCategoryFacets()`, which reads
 * `convex/facets.ts` - counted from the live catalog, ordered by population,
 * and containing a category only if agents are actually in it. What stays here
 * is what the backend has no opinion about: the one-line DESCRIPTION shown
 * beside a chip. A category with no entry below gets a derived label and no
 * description, which is a smaller failure than not existing.
 *
 * Never reintroduce a hardcoded browse list, and never index a category map
 * directly - use `categoryLabel()` / `categoryDescription()` below, both total.
 */

/**
 * The five Dolphin has editorial copy for. NOT the browse list, NOT a
 * constraint, and NOT the set the backend classifies into. "trading" is an
 * additional Dolphin category, not a fifth hackathon-graded one.
 */
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

/**
 * Descriptions for the categories the backend classifies into but this app has
 * no editorial entry for. Mirrors the slugs in `convex/lib/categorize.ts`'s
 * CATEGORY_DEFINITIONS; the LABEL comes from the backend with the facet, so
 * only the description lives here.
 *
 * A slug missing from both maps still browses - it just gets a derived label
 * and no supporting line. That is the point of the open set.
 */
const CATEGORY_DESCRIPTIONS: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    AGENT_CATEGORIES.map((category) => [category.slug, category.description]),
  ),
  monitoring:
    "Read-only agents that watch positions, wallets or markets and raise alerts.",
  research:
    "Agents that gather, summarise or analyse information rather than act on it.",
  development:
    "Agents that write, review or operate code and developer tooling.",
  security:
    "Agents that audit contracts, screen transactions or monitor for exploits.",
  payments:
    "Agents that quote, invoice or settle payments on behalf of their operator.",
  content: "Agents that generate or transform text, images, audio or video.",
  automation:
    "Agents that chain tasks together and run workflows on a schedule or trigger.",
  general:
    "Agents whose published description did not place them in a narrower role.",
};

/**
 * A human label for any slug, including one the registry invented.
 *
 * Mirrors `categoryLabel` in convex/lib/categorize.ts, and exists for the two
 * places a label is needed WITHOUT a facet row to hand: a single agent's own
 * category on a detail page or a card. When a facet row is available, prefer
 * its `label` - it is the same function, run against the same data, one hop
 * closer to the source.
 *
 * Total by construction. `AgentCategory` is an open string, so
 * `Record<AgentCategory, T>[slug]` returns `undefined` at runtime without a
 * type error - which is how every unknown category rendered as the literal
 * string "Monitoring" on cards and as `undefined` in the detail breadcrumb.
 */
export function categoryLabel(slug: AgentCategory | null | undefined): string {
  if (!slug) return "Uncategorised";

  const known = AGENT_CATEGORIES.find((category) => category.slug === slug);
  if (known) return known.label;

  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** The supporting line beside a chip, or null when Dolphin has nothing to add. */
export function categoryDescription(
  slug: AgentCategory | null | undefined,
): string | null {
  if (!slug) return null;
  return CATEGORY_DESCRIPTIONS[slug] ?? null;
}

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

/**
 * The id Dolphin's own URLs use: the bare ERC-8004 token id.
 *
 * ---------------------------------------------------------------------------
 * WHY BARE, GIVEN AGENTS.md §9 (2026-09-12)
 * ---------------------------------------------------------------------------
 * §9 is right that `agentKey` is the identity and that a bare token id is
 * ambiguous in principle: BNB Chain has more than one ERC-8004-shaped registry
 * and their token ids can collide. It is also explicit that bare ids are
 * accepted on the READ path, through `coerceAgentKey`, which resolves them
 * against the identity registry in convex/model/agent.ts.
 *
 * A URL is a read path. Measured against the live catalog: 43 agents, ONE
 * registry (0x8004a169…a432), ZERO duplicate token ids. So the collision is
 * theoretical today, and `/agent/[id]` has always used the bare id - including
 * the canonical URL emitted for search engines. Percent-encoding a 60-character
 * composite key into `/manage/` made that one route disagree with every other
 * link in the product, for a disambiguation nothing currently needs.
 *
 * WHAT WOULD CHANGE THIS: a second registry appearing in the catalog. The check
 * is one query - `distinct registryAddress` over live agents - and the fix is
 * to route on `agentKey` everywhere rather than to special-case one screen.
 * Storage and mutation arguments are unaffected and must stay keyed on
 * `agentKey`, exactly as §9 requires.
 */
export function agentRouteId(reference: string): string {
  if (!reference.includes(":")) return reference;
  return reference.split(":").pop() || reference;
}
