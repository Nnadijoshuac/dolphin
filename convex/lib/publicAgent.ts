/**
 * THE READ SHAPE: one catalog row, dressed for the frontends.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SEPARATE STEP AND NOT THE STORED SHAPE
 * ---------------------------------------------------------------------------
 * The old schema stored every field as a `LiveMetric<T>` - a value plus a
 * status, an `asOf` timestamp, a source label object and a methodology
 * sentence. The label and the sentence are CONSTANT per field, so persisting
 * them multiplied every document by their combined size to carry text that
 * never varies. They are provenance for a reader, which makes them
 * presentation, and presentation is built on the way out.
 *
 * ---------------------------------------------------------------------------
 * IT DELIBERATELY PRESERVES THE OLD CONTRACT
 * ---------------------------------------------------------------------------
 * Every field the mobile app and the website already read is still here, in the
 * shape they already read it in. That is not inertia - `AGENTS.md` §12 (§11 when this was written) keeps the
 * UI layer off-limits, and the rebuild's authorisation covers three screens
 * (Discover, Search, category listing) so pagination and server-side search can
 * be wired. Changing the agent shape underneath twenty components was never in
 * scope, and it would have turned a backend rebuild into a rewrite of the app.
 *
 * The two genuinely new things are additive: `pricing` (a real quoted price
 * where one exists, where every agent used to render as free) and `verification`
 * (Dolphin's own probe result, where the old `endpointStatus` was 8004scan's
 * cached opinion - which is wrong in both directions, see convex/sources).
 */

import type { Doc } from "../_generated/dataModel";
import { readExecutionCapability } from "./toolCapability";
import { hasLiveStats, statsCategoryFor } from "./statsCategory";

export interface DataSourceLabel {
  id: string;
  label: string;
  url?: string;
}

export const AGENT_DATA_SOURCES = {
  registry: {
    id: "erc-8004-bsc-registry",
    label: "ERC-8004 registry on BSC",
    url: "https://bscscan.com/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  },
  scan: { id: "8004scan", label: "8004scan indexed data", url: "https://8004scan.io" },
  publisher: { id: "publisher-metadata", label: "Publisher-reported metadata" },
  /** The strongest label in the system: Dolphin called the endpoint itself. */
  probe: { id: "dolphin-verification", label: "Dolphin endpoint verification" },
  marketplacePolicy: {
    id: "dolphin-marketplace-policy",
    label: "Dolphin marketplace policy (not a publisher-published value)",
  },
} as const satisfies Record<string, DataSourceLabel>;

function live<T>(value: T, asOf: string, source: DataSourceLabel, methodology?: string) {
  return { status: "live" as const, value, asOf, source, methodology };
}

function unavailable(reason: string, source: DataSourceLabel) {
  return {
    status: "unavailable" as const,
    value: null,
    asOf: null as string | null,
    source,
    reason,
  };
}

/**
 * Every metric a stats category can carry, all explicitly unavailable.
 *
 * The real numbers arrive separately through convex/categoryStats.ts, refreshed
 * per agent on view - this is the honest placeholder until then, and the
 * permanent answer for a category with no wired protocol read.
 *
 * Returns null for a category that has no live-metric shape at all, which is
 * now most of them: `research`, `security`, `content` and anything the registry
 * invents have no protocol holding a number about them. The detail page renders
 * no panel rather than an empty one.
 */
function unavailableLiveStats(categorySlug: string) {
  const category = statsCategoryFor(categorySlug);
  if (!category) return null;
  const m = () =>
    unavailable(
      "No auditable live metric feed or execution history is published for this value.",
      AGENT_DATA_SOURCES.publisher,
    );

  switch (category) {
    case "monitoring":
      return { category, alertFrequency: m(), assetsWatched: m(), lastAlertAt: m(), falsePositiveRate: m() };
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
      return { category, currentApy: m(), tvlManagedUsd: m(), protocolsUsed: m(), rebalanceFrequency: m() };
    case "trading":
      return {
        category,
        winRate: m(),
        tradesExecuted: m(),
        realizedPnl: m(),
        marketsTraded: m(),
        trackRecordPeriod: m(),
      };
  }
}

/**
 * What a hire costs.
 *
 * TWO CASES, AND THE DIFFERENCE IS THE WHOLE POINT.
 *
 * A published price means the agent answered a negotiate call with a quote that
 * `normalizeQuote` validated against its registered on-chain wallet. That is a
 * real number, from the seller, checked - and it is what the old catalog threw
 * away by pricing everything at a hardcoded zero, which is how the Manage screen
 * came to print "Free" over a hire that had cost money.
 *
 * No published price does NOT mean free, and it does not mean unhireable
 * either - an agent that publishes a service menu sells without quoting a
 * headline price, and the hire flow asks it for a live quote at checkout. So
 * this reports Dolphin's own zero-cost policy for the marketplace RECORD, with
 * `source` naming Dolphin rather than a data feed and `methodology` stating
 * exactly what it does and does not claim. The user is never shown this as the
 * publisher's price; the price they pay comes from the agent's own live quote.
 */
function priceModelFor(row: Doc<"agents">, asOf: string) {
  if (row.pricing) {
    return live(
      {
        type: "flat" as const,
        amount: row.pricing.amountRaw,
        token: row.pricing.tokenSymbol || row.pricing.token,
      },
      row.lastVerifiedAt,
      AGENT_DATA_SOURCES.probe,
      "Read from the agent's own signed quote at verification time and checked against its " +
        "registered ERC-8004 wallet. The amount is in the payment token's atomic units. The " +
        "price charged at checkout is re-quoted live and may differ.",
    );
  }
  return live(
    { type: "flat" as const, amount: "0", token: "BNB" },
    asOf,
    AGENT_DATA_SOURCES.marketplacePolicy,
    "Dolphin's own hire price, not a publisher-published one - this agent quotes no headline " +
      "price. Recording a hire costs nothing. The publisher may charge at its own service " +
      "endpoint, and the hire flow requests a live quote before any payment.",
  );
}

/**
 * The stored row, as both frontends consume it.
 *
 * `id`, `chain`, `verifiedSkills`, `performanceSeries`, `recentActivity` and
 * `registryVerification` are all preserved from the previous contract.
 * `performanceSeries` and `recentActivity` were hardcoded `[]` on every agent
 * before, so returning `[]` is byte-for-byte the previous behaviour rather than
 * a regression - the real chart source is `agentStatsHistory`, which the detail
 * page reads separately.
 */
export function toPublicAgent(row: Doc<"agents">) {
  const asOf = new Date().toISOString();

  return {
    id: row.agentKey,
    agentKey: row.agentKey,
    tokenId: row.tokenId,
    chain: "bsc" as const,
    chainId: row.chainId,
    registryAddress: row.registryAddress,

    name: row.name,
    publisher: row.publisher ?? row.ownerAddress,
    publisherAddress: row.ownerAddress,
    agentWallet: row.agentWallet,
    registeredAt: row.registeredAt,

    /** An open string now. A screen must not index a fixed record with it. */
    category: row.categorySlug,
    classificationSource: row.curated
      ? ("editorial-explicit-metadata" as const)
      : ("registry-metadata" as const),
    tagline: row.tagline,
    description: row.description,
    iconUrl: row.iconUrl,
    /**
     * The seed for the client's deterministic DiceBear fallback, sent
     * explicitly so no render can end up blank and so the frontend never has to
     * know that a tokenId happens to be the seed.
     */
    iconSeed: row.tokenId,
    iconSource: row.iconSource,

    /**
     * `evidence: "verified"` and it is earned: these come from the agent's own
     * A2A card or MCP tool list, fetched by the probe. The old catalog reported
     * `publisher-reported` skills copied from a marketing description.
     */
    skills: row.skills.map((skill) => ({ name: skill.name, evidence: "verified" as const })),
    verifiedSkills: row.skills.map((skill) => skill.name),
    tags: row.tags,
    services: [{ name: row.protocol, endpoint: row.endpoint, version: null }],
    /**
     * The transport, surfaced as a first-class field rather than left implicit
     * in `services[0].name`.
     *
     * The UI branches on this - an A2A agent is commissioned and paid, an MCP
     * agent is run - and reaching into an array's first element to decide what
     * a button says is the kind of coupling that breaks quietly the day an
     * agent publishes two services.
     */
    protocol: row.protocol,

    /**
     * WHAT THIS AGENT CAN DO, read off the tools it actually publishes.
     *
     * Derived here rather than stored (AGENTS.md §9 - re-derive what costs
     * microseconds) from `row.skills`, which the probe records unfiltered
     * straight from the agent's own card or MCP tool list.
     *
     * It is the answer to the first question anyone has about an agent and the
     * catalog had no field for it. Measured 2026-09-12: the six agents in the
     * "trading" category publish only `explain_strategy`, `list_agents`,
     * `get_hire_link` and `top_traders` - none of them trades - while five
     * agents filed under health-factor, yield, rebalancing and payments publish
     * real Aave V3 and PancakeSwap V3 writes. A name said one thing and the
     * tool list said another, and only the name was on screen.
     */
    execution: readExecutionCapability(row.skills, row.protocol),

    x402Supported: live(row.x402Supported, row.lastVerifiedAt, AGENT_DATA_SOURCES.scan),
    /**
     * Dolphin's own answer, not the indexer's. `status: "live"` means we called
     * this endpoint and it sold; "degraded" means it has failed recently but not
     * enough times to be delisted.
     */
    isActive: live(row.status === "live", row.lastVerifiedAt, AGENT_DATA_SOURCES.probe),
    reputationScore:
      row.reputationScore === null
        ? unavailable(
            "No indexed ERC-8004 feedback is available for a reputation score.",
            AGENT_DATA_SOURCES.scan,
          )
        : live(
            row.reputationScore,
            row.lastVerifiedAt,
            AGENT_DATA_SOURCES.scan,
            "Unfiltered 8004scan feedback aggregate. Review count and reviewer trust must be considered separately.",
          ),
    feedbackCount: live(row.feedbackCount, row.lastVerifiedAt, AGENT_DATA_SOURCES.scan),
    endpointStatus: live(
      row.status === "live" ? ("healthy" as const) : ("degraded" as const),
      row.lastVerifiedAt,
      AGENT_DATA_SOURCES.probe,
      "Dolphin called this agent's own endpoint in the protocol it advertises and it answered. " +
        "This is not 8004scan's cached health flag, which reports agents that demonstrably sell " +
        "as unhealthy.",
    ),

    liveStats: unavailableLiveStats(row.categorySlug),
    hasLiveStats: hasLiveStats(row.categorySlug),
    /** Sourced from agentStatsHistory by the detail page, not from this row. */
    performanceSeries: [] as never[],
    recentActivity: [] as never[],

    priceModel: priceModelFor(row, asOf),
    /** The raw quote, when there is one. New; nothing renders it yet. */
    pricing: row.pricing,
    curated: row.curated,

    /**
     * The client performs its own on-chain check (`verifyAgentRegistration`)
     * and overlays the result, which is deliberate: a direct viem read against
     * the identity contract is the app's OWN verification of what an indexer
     * claims, and routing it through the backend would make it second-hand.
     */
    registryVerification: {
      registered: unavailable(
        "On-chain identity has not been checked in this request yet.",
        AGENT_DATA_SOURCES.registry,
      ),
      owner: unavailable(
        "On-chain identity has not been checked in this request yet.",
        AGENT_DATA_SOURCES.registry,
      ),
      tokenUri: unavailable(
        "On-chain identity has not been checked in this request yet.",
        AGENT_DATA_SOURCES.registry,
      ),
      agentWallet: unavailable(
        "On-chain identity has not been checked in this request yet.",
        AGENT_DATA_SOURCES.registry,
      ),
    },

    status: row.status,
    verifiedAt: row.lastVerifiedAt,
    publishedAt: row.publishedAt,
    recordStatus: "indexed" as const,
    sourceLabels: [
      AGENT_DATA_SOURCES.probe,
      AGENT_DATA_SOURCES.scan,
      AGENT_DATA_SOURCES.publisher,
    ] as DataSourceLabel[],
  };
}

export type PublicAgent = ReturnType<typeof toPublicAgent>;
