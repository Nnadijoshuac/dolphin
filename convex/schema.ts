import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import { agentCategoryValidator, agentLiveStatsValidator } from "./categoryStatsValidators";

export default defineSchema({
  agentLiveStats: defineTable({
    chainId: v.number(),
    tokenId: v.string(),
    category: agentCategoryValidator,
    agentWallet: v.union(v.string(), v.null()),
    stats: agentLiveStatsValidator,
    checkedAt: v.string(),
  }).index("by_agent_category", ["chainId", "tokenId", "category"]),

  agentHires: defineTable({
    chainId: v.number(),
    tokenId: v.string(),
    category: agentCategoryValidator,
    walletAddress: v.string(),
    status: v.union(v.literal("active"), v.literal("cancelled")),
    hiredAt: v.string(),
    cancelledAt: v.union(v.string(), v.null()),
  })
    .index("by_agent_wallet", ["chainId", "tokenId", "walletAddress"])
    .index("by_wallet", ["walletAddress", "status"]),

  /**
   * Altana session grants, recorded next to the agentHires row they belong to.
   * See convex/agentSessions.ts for why this lives in the backend rather than
   * only in the granting browser: a session is the one thing in Dolphin that
   * hands real authority to someone else, so "what have I authorized" needs
   * exactly one answer rather than two that can disagree.
   *
   * Public reference detail only. No signer and no key material of any kind -
   * nothing in this table can act on a wallet, only describe what was granted
   * and identify what to revoke.
   *
   * Keyed on the ALTANA wallet address, not the hiring wallet: they are two
   * different accounts (Altana's SDK ships no injected signer) and it is the
   * Altana wallet that carries the authority.
   */
  agentSessions: defineTable({
    chainId: v.number(),
    tokenId: v.string(),
    /**
     * The agent's name AS SHOWN when the grant was made. Denormalized on
     * purpose: this is an authorization record, and "what did I agree to"
     * should keep reading the way it read at the time, even if the agent is
     * later renamed in the catalog.
     */
    agentName: v.string(),
    category: agentCategoryValidator,
    /** The Altana smart account the session can act on. */
    altanaWalletAddress: v.string(),
    /** The wagmi address on the matching agentHires row, when there is one. */
    hirerWalletAddress: v.union(v.string(), v.null()),
    /** On-chain identifier for the session, and all revokeSession needs. */
    sessionPublicKey: v.string(),
    /** Never empty - an empty allowlist is how Altana spells "any contract". */
    allowlist: v.array(v.object({ address: v.string(), label: v.string() })),
    /** Decimal string: a bigint is not a Convex value. */
    spendCapWei: v.string(),
    spendPeriod: v.string(),
    /** Unix epoch seconds. */
    expiry: v.number(),
    grantedAt: v.string(),
    revokedAt: v.union(v.string(), v.null()),
    grantTransactionHash: v.union(v.string(), v.null()),
    /**
     * "expired" is derived on read from `expiry` rather than written here -
     * nothing runs to flip it, so a stored value would go stale and overstate
     * how much authority is outstanding.
     */
    status: v.union(v.literal("active"), v.literal("revoked"), v.literal("expired")),
  })
    .index("by_session_key", ["chainId", "sessionPublicKey"])
    .index("by_altana_wallet", ["chainId", "altanaWalletAddress"]),

  // 8004scan's indexed view of one agent, refreshed server-side by
  // agents.refreshAgentDirectory. Before this table the mobile app fetched
  // 8004scan per agent from the client on every list render, and the website
  // would have had to do the same - two surfaces hitting the same API and
  // applying the same decode rules independently. agents.listAgents overlays
  // these rows onto the curated catalog so both frontends read one answer.
  //
  // Every field is nullable on purpose: a missing value means 8004scan did not
  // publish it, and listAgents turns that into an explicit "unavailable"
  // metric rather than a plausible-looking default (AGENTS.md SS5).
  agentDirectory: defineTable({
    chainId: v.number(),
    tokenId: v.string(),
    name: v.union(v.string(), v.null()),
    description: v.union(v.string(), v.null()),
    iconUrl: v.union(v.string(), v.null()),
    publisher: v.union(v.string(), v.null()),
    ownerAddress: v.union(v.string(), v.null()),
    agentWallet: v.union(v.string(), v.null()),
    registeredAt: v.union(v.string(), v.null()),
    tags: v.array(v.string()),
    services: v.array(
      v.object({
        name: v.string(),
        endpoint: v.string(),
        version: v.union(v.string(), v.null()),
      }),
    ),
    x402Supported: v.union(v.boolean(), v.null()),
    isActive: v.union(v.boolean(), v.null()),
    reputationScore: v.union(v.number(), v.null()),
    feedbackCount: v.union(v.number(), v.null()),
    endpointStatus: v.union(v.string(), v.null()),
    endpointCheckedAt: v.union(v.string(), v.null()),
    indexedAt: v.string(),
    refreshedAt: v.string(),

    // Icon cache (Task 4). Optional so existing rows stay valid without a
    // migration, and written by a separate mutation (agents.setAgentIcon) so
    // the 8004scan refresh above can never clobber a cached icon.
    //
    // An icon is fetched ONCE and its bytes stored here; the frontends render a
    // Convex storage URL. Nothing is hotlinked - a slow or dead third-party
    // image host would otherwise be a permanent property of every page render.
    iconStorageId: v.optional(v.union(v.id("_storage"), v.null())),
    // "8004scan-image" | "registration-file" | "generated-fallback" - kept as a
    // string rather than a literal union so a new tier does not need a schema
    // migration. The authoritative list is IconSource in convex/lib/agentIcons.ts.
    iconSource: v.optional(v.union(v.string(), v.null())),
    iconCheckedAt: v.optional(v.union(v.string(), v.null())),
  }).index("by_agent", ["chainId", "tokenId"]),

  /**
   * THE EVALUATION LEDGER - one row per tokenId the discovery sweep has ever
   * seen, whatever became of it.
   *
   * This is what makes the pipeline incremental (Task 1.3). 8004scan indexes
   * 289,938 identities on BSC mainnet and the overwhelming majority are spam;
   * without a record of what has already been judged, every cycle would re-walk
   * and re-reject the same ~280,000 records forever. A sweep that re-sees a
   * known tokenId refreshes `lastSeenAt` and moves on.
   *
   * It is also the audit trail. Every rejection carries the rule or reason that
   * produced it and every classification carries its evidence, so "why is this
   * agent not listed" and "why is this agent listed" are both answerable after
   * the fact, without re-running anything. A pipeline that publishes to a public
   * marketplace with no human watching needs to be able to show its work.
   *
   * Keyed on (chainId, registryAddress, tokenId) rather than (chainId, tokenId):
   * Task 0.5 found a second identity registry on BNB Chain (BRC8004,
   * 0xfA09B339...) whose token ids collide with the primary AgentIdentity
   * registry's. The rest of Dolphin's catalog is still keyed on a bare tokenId,
   * which is exactly why BRC8004 agents are recorded here but held `pending`
   * rather than published - see convex/lib/pipelineStatus.ts.
   */
  agentCandidates: defineTable({
    chainId: v.number(),
    registryAddress: v.string(),
    tokenId: v.string(),

    status: v.union(
      v.literal("rejected-prefilter"),
      v.literal("rejected-classifier"),
      v.literal("pending"),
      v.literal("published"),
    ),
    /** Always set. One checkable sentence saying why the row is in that status. */
    statusReason: v.string(),
    /** Which sweep path or intake first produced this row. */
    source: v.string(),

    // 8004scan's list-item view, as last seen.
    name: v.string(),
    description: v.string(),
    scanIconUrl: v.union(v.string(), v.null()),
    ownerAddress: v.string(),
    registeredAt: v.union(v.string(), v.null()),
    x402Supported: v.union(v.boolean(), v.null()),

    // Stage 1: the cheap pre-filter (convex/lib/prefilter.ts).
    prefilterRule: v.union(v.string(), v.null()),

    // Stage 2: the classifier (convex/lib/agentScoring.ts).
    category: v.union(agentCategoryValidator, v.null()),
    confidence: v.union(v.literal("confirmed"), v.literal("likely"), v.null()),
    score: v.union(v.number(), v.null()),
    runnerUpCategory: v.union(agentCategoryValidator, v.null()),
    runnerUpScore: v.union(v.number(), v.null()),
    matchedTerms: v.array(v.string()),
    /** Signal and penalty details, so a classification is auditable. */
    classificationEvidence: v.array(v.string()),
    /** Why a `likely` agent fell short of `confirmed`. Real information, not decoration. */
    shortfall: v.union(v.string(), v.null()),

    // Stage 2b: the agent's own registration file (convex/lib/registrationFile.ts).
    crossCheckState: v.union(v.string(), v.null()),
    crossCheckTokenUri: v.union(v.string(), v.null()),
    /** Set when the agent's own file disagrees with what 8004scan has cached. */
    crossCheckDrift: v.union(v.string(), v.null()),

    // Stage 3: the liveness probe (convex/lib/liveness.ts).
    livenessState: v.union(v.string(), v.null()),
    livenessProtocol: v.union(v.string(), v.null()),
    livenessUrl: v.union(v.string(), v.null()),
    livenessDetail: v.union(v.string(), v.null()),
    livenessCheckedAt: v.union(v.string(), v.null()),
    /** Drives the delist-after-3 rule in convex/lib/pipelineStatus.ts. */
    consecutiveProbeFailures: v.number(),

    // The manual safety valve, runtime half. The compile-time half
    // (MANUALLY_EXCLUDED_TOKEN_IDS) is preserved in convex/discoveredAgents.ts;
    // this lets an operator hand-correct a specific case without a deploy.
    manualOverride: v.union(v.literal("exclude"), v.literal("include"), v.null()),

    submittedAt: v.union(v.string(), v.null()),

    firstSeenAt: v.string(),
    lastSeenAt: v.string(),
    /** Last time the cheap pre-filter ran over this record. */
    lastEvaluatedAt: v.string(),
    /** Last time the expensive stages (cross-check, probe, icon) ran. Null = never. */
    lastDeepEvaluatedAt: v.union(v.string(), v.null()),
  })
    .index("by_agent", ["chainId", "registryAddress", "tokenId"])
    .index("by_token", ["chainId", "tokenId"])
    // Picks the deep-evaluation batch: oldest-evaluated first within a status.
    .index("by_status_evaluated", ["status", "lastDeepEvaluatedAt"]),

  /**
   * Resumable cursor for the ascending backfill sweep, plus the counters the
   * session log and HANDOVER report from. One row, keyed by name.
   *
   * The backfill is resumable rather than restarting because 8004scan's
   * `sort_by=token_id&sort_order=asc` is stable under insertion: an ERC-8004
   * token id only ever increases, so new registrations append at the end and
   * never shift the offsets of pages already walked. That measured fact (Task 0)
   * is what makes an offset cursor correct here rather than merely plausible.
   */
  discoveryState: defineTable({
    key: v.string(),
    /** Next `offset` the ascending backfill should request. */
    backfillOffset: v.number(),
    /** Set when the backfill has walked the whole registry at least once. */
    backfillCompletedAt: v.union(v.string(), v.null()),
    /** `total` as 8004scan last reported it, for progress reporting. */
    registryTotal: v.union(v.number(), v.null()),
    lastSweepAt: v.union(v.string(), v.null()),
    lastSweepSummary: v.union(v.string(), v.null()),

    // Running ledger totals, maintained transactionally on every insert and
    // every status transition.
    //
    // WHY COUNTERS AND NOT A COUNT QUERY. getPipelineStats originally derived
    // these by scanning agentCandidates. That worked at a few thousand rows and
    // then failed outright once the backfill had run - Convex caps a single
    // function execution at 16MB of reads, and the ledger passes that at around
    // 12,000 rows. It only grows from here (the registry is 291,543), so a scan
    // was never going to be the answer. Optional so existing rows stay valid.
    ledgerTotal: v.optional(v.number()),
    ledgerRejectedPrefilter: v.optional(v.number()),
    ledgerRejectedClassifier: v.optional(v.number()),
    ledgerPending: v.optional(v.number()),
    ledgerPublished: v.optional(v.number()),
  }).index("by_key", ["key"]),

  discoveredAgents: defineTable({
    chainId: v.number(),
    tokenId: v.string(),
    name: v.string(),
    description: v.string(),
    iconUrl: v.union(v.string(), v.null()),
    ownerAddress: v.string(),
    category: agentCategoryValidator,
    confidence: v.union(v.literal("confirmed"), v.literal("likely")),
    matchedTerms: v.array(v.string()),
    x402Supported: v.boolean(),
    registeredAt: v.union(v.string(), v.null()),
    syncedAt: v.string(),
  })
    .index("by_agent", ["chainId", "tokenId"])
    .index("by_category", ["chainId", "category"]),
});
