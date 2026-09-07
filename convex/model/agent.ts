/**
 * THE INTERNAL AGENT MODEL.
 *
 * Everything downstream of the 8004scan adapter speaks these types and no
 * others. `convex/sources/scan8004.ts` is the only module in the codebase that
 * knows a field called `image_url` or `a2a_endpoint` exists; if 8004scan renames
 * something, that file changes and this one does not.
 *
 * ---------------------------------------------------------------------------
 * IDENTITY: THE COMPOSITE KEY, NOT A BARE TOKEN ID
 * ---------------------------------------------------------------------------
 * The previous schema keyed `agentCandidates` on (chainId, registryAddress,
 * tokenId) and keyed every other table - the catalog, the directory, hires,
 * reviews, escrow jobs, session grants, live stats - on a bare `tokenId`.
 *
 * That is not a tidiness problem, it is a correctness one, and the old code
 * already had a branch admitting it: `resolveStatus` held every agent on the
 * BRC8004 identity registry at `pending` forever, with the stated reason that
 * publishing one "would silently merge two agents" because its token ids
 * collide with the primary registry's. An entire registry was unreachable by
 * design, and a hire row could in principle have attached to the wrong agent.
 *
 * `agentKey` is the fix, and it is not invented here: it is byte-identical to
 * the `agent_id` 8004scan publishes on every record.
 *
 *     56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:302257
 *     └┬┘ └──────────────────┬──────────────────┘ └──┬──┘
 *   chainId          registry address (lowercase)  tokenId
 *
 * The registry address is lowercased rather than checksummed, because it is
 * being used as a database key: a key that can be spelled two ways is two keys.
 * Checksumming is for display and for on-chain comparison, and
 * `parseAgentKey` hands back the raw string for callers that need to re-case it.
 */

/** BNB Smart Chain mainnet. The only chain Dolphin lists today. */
export const BSC_CHAIN_ID = 56;

/** The primary ERC-8004 AgentIdentity registry on BSC mainnet. */
export const ERC8004_IDENTITY_REGISTRY =
  "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

/*
 * A SECOND registry exists on BNB Chain - "BRC8004", found by the 2026-08-29
 * Task 0.5 walk, whose token ids collide with the primary registry's. That
 * collision is the entire reason `agentKey` exists.
 *
 * ITS ADDRESS IS DELIBERATELY NOT A CONSTANT HERE. Every record this codebase
 * has ever written records it truncated, as `0xfA09B339...`, and AGENTS.md §9
 * forbids writing a contract address that has not been independently verified
 * against the protocol's own deployment record. Guessing the remaining 32 hex
 * characters to fill a constant would be exactly the fabrication that rule
 * exists to prevent.
 *
 * Nor is one needed. Every discovered record carries its own registry in
 * 8004scan's `contract_address` field, so the registry a row belongs to is READ
 * from the data rather than assumed from a list of known ones. That is both
 * safer and the reason a third registry would need no code change at all.
 */

export type AgentKey = string;

/** Builds the canonical key. Lowercases the registry - see the header. */
export function buildAgentKey(
  chainId: number,
  registryAddress: string,
  tokenId: string,
): AgentKey {
  return `${chainId}:${registryAddress.toLowerCase()}:${tokenId}`;
}

export interface ParsedAgentKey {
  chainId: number;
  registryAddress: string;
  tokenId: string;
}

/**
 * Parses a key back into its parts, or returns null.
 *
 * Returns null rather than throwing because the commonest caller is a public
 * query handling a reference a client supplied, and a malformed reference is a
 * "not found", not a server error.
 */
export function parseAgentKey(key: string): ParsedAgentKey | null {
  const parts = key.split(":");
  if (parts.length !== 3) return null;
  const chainId = Number(parts[0]);
  if (!Number.isInteger(chainId) || chainId <= 0) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(parts[1])) return null;
  if (!/^\d+$/.test(parts[2])) return null;
  return {
    chainId,
    registryAddress: parts[1].toLowerCase(),
    tokenId: parts[2],
  };
}

/**
 * Accepts either a full agentKey or a bare tokenId and returns a key.
 *
 * THE COMPATIBILITY SEAM, and it is deliberately narrow. Every existing deep
 * link, every route param in `src/app/agent/[id].tsx`, and every stored client
 * reference is a bare tokenId. Refusing those would break links that already
 * exist, so a bare numeric id is resolved against the primary registry - which
 * is where every agent Dolphin has ever listed actually lives.
 *
 * This is the ONLY place that assumption is made, and it is a read-path
 * convenience. Nothing on the write path may call it: a record being stored
 * must carry the registry it actually came from.
 */
export function coerceAgentKey(reference: string): AgentKey | null {
  const trimmed = reference.trim();
  if (parseAgentKey(trimmed)) return trimmed.toLowerCase();
  if (/^\d+$/.test(trimmed)) {
    return buildAgentKey(BSC_CHAIN_ID, ERC8004_IDENTITY_REGISTRY, trimmed);
  }
  return null;
}

/* ---------------------------------------------------------------------------
 * VERIFICATION
 * ------------------------------------------------------------------------ */

/**
 * What Dolphin currently believes about whether an agent can be hired.
 *
 * FOUR STATES, AND THE SPLIT BETWEEN THE LAST TWO IS THE LOAD-BEARING ONE.
 * `unavailable` is a claim about right now that can change on its own -
 * somebody's server is down. `invalid` is a claim about the registration
 * itself, which nothing but the publisher editing it will change. Collapsing
 * them would mean either re-probing a URL that can never work every hour, or
 * abandoning an agent whose host had a bad afternoon.
 */
export type VerificationState =
  /** Never probed, or probe results expired. NOT listed. */
  | "unknown"
  /** Answered a protocol-appropriate call and offered work for sale. Listed. */
  | "live"
  /** Advertised an endpoint, we called it, it failed. Retryable. */
  | "unavailable"
  /** Structurally uncallable. No endpoint, a template URL, an unsafe host. */
  | "invalid";

/** Why a probe failed. Drives the backoff schedule and the operator's answer. */
export type FailureClass =
  /** DNS, connection refused, TLS, timeout. */
  | "transport"
  /** Answered, but with a status that is not a service (404, 405, 500). */
  | "http"
  /** Answered with something that is not the protocol it claims to speak. */
  | "protocol"
  /** Reachable and speaking the protocol, but offers nothing for sale. */
  | "no-menu"
  /** Advertises no callable endpoint at all. */
  | "no-endpoint"
  /** The advertised URL is one Dolphin refuses to fetch. See lib/safeFetch.ts. */
  | "unsafe-url";

/** The transport an agent's service actually speaks. */
export type AgentProtocol = "a2a" | "mcp";

/* ---------------------------------------------------------------------------
 * THE CATALOG RECORD
 * ------------------------------------------------------------------------ */

export interface AgentSkill {
  name: string;
  description: string | null;
}

/**
 * What an agent charges, read from its own live quote.
 *
 * NULL IS A REAL ANSWER and it means "this agent did not quote a price",
 * not "free". The previous implementation priced every agent at a hardcoded
 * `0 BNB` as marketplace policy while real ERC-8183 quotes were sitting
 * unread in the probe response - so a paid agent rendered as "Free" and the
 * Manage screen printed "Free" over a hire that had cost money.
 *
 * Every field here is read from the seller's own signed quote and checked
 * against its registered on-chain wallet by `normalizeQuote`. Nothing in this
 * object is Dolphin's opinion.
 */
export interface AgentPricing {
  /** Atomic token units, as a decimal string: a bigint is not a Convex value. */
  amountRaw: string;
  /** The ERC-20 the seller wants to be paid in. */
  token: string;
  tokenSymbol: string;
  tokenDecimals: number;
  /** The seller's own rendering, e.g. "0.10 $U". Kept verbatim. */
  display: string | null;
  /** The ERC-8183 kernel the job would live in. */
  escrowContract: string | null;
}

/**
 * One agent in the marketplace catalog.
 *
 * WHAT IS DELIBERATELY NOT HERE:
 *
 *   performanceSeries / recentActivity - both were hardcoded `[]` on every
 *   agent, so two sections of the detail page were permanently dead. The real
 *   source for the first is `agentStatsHistory`, which exists and works; the
 *   second has no wired source and says so rather than shipping an empty array
 *   that reads as "no activity".
 *
 *   LiveMetric<T> wrappers - these are PRESENTATION. Storing them tripled the
 *   document size to carry a source label and a methodology sentence that are
 *   constant per field. They are constructed in the query's return mapping.
 *
 *   Raw 8004scan payloads, probe transcripts, historical snapshots - none of
 *   it is read by a product surface.
 */
export interface MarketplaceAgent {
  agentKey: AgentKey;
  chainId: number;
  registryAddress: string;
  tokenId: string;

  // Identity
  ownerAddress: string;
  /** The registered payee. An agent without one cannot be paid, so cannot sell. */
  agentWallet: string | null;
  publisher: string | null;
  registeredAt: string | null;

  // Presentation
  name: string;
  tagline: string;
  description: string;
  /** A URL, never a blob. Null means the client renders its DiceBear fallback. */
  iconUrl: string | null;
  iconSource: "publisher" | "cached" | "generated";

  // Classification - open, not an enum. See ARCHITECTURE §N.
  categorySlug: string;
  tags: string[];
  skills: AgentSkill[];

  // Service
  protocol: AgentProtocol;
  /** The endpoint the probe PROVED answers, not the one that was advertised. */
  endpoint: string;

  // Marketplace
  pricing: AgentPricing | null;
  x402Supported: boolean;
  /** Boosts rank. Does NOT exempt from verification. */
  curated: boolean;

  // State
  status: "live" | "degraded" | "unavailable";
  rank: number;
  searchText: string;
  publishedAt: string;
  lastVerifiedAt: string;
}
