import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import { agentLiveStatsValidator, statsCategoryValidator } from "./categoryStatsValidators";

/**
 * THE MARKETPLACE SCHEMA (rebuilt 2026-09-07).
 *
 * See Agent/ARCHITECTURE-2026-09-07-backend-rebuild.md for the audit this
 * replaces and the reasoning behind every table below. The short version:
 *
 * The previous schema held 257,991 rows to describe 26 published agents.
 * 251,922 of them (97.6%) recorded that a record had been rejected by a pure
 * string function with no network call - the cheapest decision in the pipeline,
 * persisted forever, at a storage cost proportional to the REGISTRY rather than
 * to the catalog. It took the deployment over its plan limit and the discovery
 * sweep has been switched off since 2026-09-02 as a result.
 *
 * The inversion this schema corrects: persist decisions that cost a network
 * round trip; re-derive the ones that cost microseconds. So there is no
 * rejection ledger. A record dismissed by the cheap screen is COUNTED, not
 * stored, and the incremental cursor guarantees it is never fetched twice.
 *
 * ---------------------------------------------------------------------------
 * ONE KEY, EVERYWHERE: `agentKey`
 * ---------------------------------------------------------------------------
 * "<chainId>:<lowercase registry address>:<tokenId>" - byte-identical to the
 * `agent_id` 8004scan publishes. The old schema keyed its ledger on the
 * registry-qualified triple and every other table on a bare `tokenId`, which
 * is why `resolveStatus` had a branch holding an entire second BNB Chain
 * registry at `pending` forever: publishing one of its agents "would silently
 * merge two agents". See convex/model/agent.ts.
 */
export default defineSchema({
  /* =========================================================================
   * THE CATALOG
   * ====================================================================== */

  /**
   * Every agent Dolphin lists, and nothing else.
   *
   * A row exists here only after the agent answered a protocol-appropriate call
   * and offered work for sale. Candidates, rejects and never-probed records do
   * not appear - they live in `agentVerification` or nowhere at all.
   *
   * WRITTEN SPARINGLY, ON PURPOSE. A successful re-probe that finds nothing
   * changed writes ZERO bytes here: `lastVerifiedAt` lives on
   * `agentVerification`, and the upsert compares the user-visible fields before
   * patching. Every write to this table invalidates the paginated queries the
   * whole frontend is subscribed to, so a write must mean something a person
   * would actually see changed.
   */
  agents: defineTable({
    agentKey: v.string(),
    // Denormalized out of agentKey so an index can filter without parsing.
    chainId: v.number(),
    registryAddress: v.string(),
    tokenId: v.string(),

    // --- Identity -------------------------------------------------------
    ownerAddress: v.string(),
    /**
     * The registered on-chain payee. An agent without one cannot be paid, so it
     * cannot be sold - `probeSellability` refuses to quote without it, and that
     * refusal is why this is nullable rather than required: a row can exist
     * with a null wallet only while `status` is not "live".
     */
    agentWallet: v.union(v.string(), v.null()),
    /** A human-readable publisher name when the indexer has one. */
    publisher: v.union(v.string(), v.null()),
    registeredAt: v.union(v.string(), v.null()),

    // --- Presentation ---------------------------------------------------
    name: v.string(),
    tagline: v.string(),
    description: v.string(),
    /**
     * A URL. NEVER a blob, and never a stored DiceBear render.
     *
     * The previous pipeline generated a DiceBear avatar in-process and then
     * stored the SVG bytes in Convex file storage. It is a deterministic
     * function of tokenId - the module says so - so storing its output was a
     * redundant write repeated for every agent, against a table that had
     * accumulated 6,038 rows with no listed agent behind them.
     *
     * Null means "no publisher image": the client renders the same deterministic
     * avatar it can compute itself, and `iconSource` says which tier this was.
     */
    iconUrl: v.union(v.string(), v.null()),
    iconSource: v.union(
      v.literal("publisher"),
      v.literal("cached"),
      v.literal("generated"),
    ),

    // --- Classification -------------------------------------------------
    /**
     * OPEN, not an enum. This is the single change that makes the marketplace
     * able to carry categories nobody has thought of yet.
     *
     * The old `AgentCategory` was a Convex validator union used in six modules
     * and both frontends, so adding "trading" meant a schema change, a scorer
     * edit, a ruleset-version bump and a re-judge of a 258,000-row ledger - and
     * the category still sat empty for two days because the search vocabulary
     * that decides what 8004scan is ASKED for was a separate hardcoded list.
     *
     * Note this is NOT the same field as `agentLiveStats.category` below, which
     * stays closed. That one answers "which protocol reader do we run", and the
     * set of integrations that exist really is finite.
     */
    categorySlug: v.string(),
    tags: v.array(v.string()),
    /**
     * Read from the agent's OWN A2A card, not from the indexer. Verified
     * 2026-09-07: token 302257 publishes empty `categories` and `tags` at
     * 8004scan while serving a real card - the card is the source of truth for
     * what an agent can do, and it is fetched by the probe anyway.
     */
    skills: v.array(
      v.object({ name: v.string(), description: v.union(v.string(), v.null()) }),
    ),

    // --- Service --------------------------------------------------------
    protocol: v.union(v.literal("a2a"), v.literal("mcp")),
    /**
     * The endpoint the probe PROVED answers - resolved from the card's own
     * `url`, not the URL that was advertised.
     *
     * These differ for most of this catalog: the `a2a` service publishers
     * register is frequently the discovery document (a static
     * /.well-known/agent-card.json) whose directory holds the JSON-RPC
     * endpoint. POSTing to the card file returns 404 or 405, which is what a
     * previous probe reported for nine agents, five of which sell.
     */
    endpoint: v.string(),

    // --- Marketplace ----------------------------------------------------
    /**
     * The agent's own quoted price, or null when it did not quote one.
     *
     * NULL MEANS "NO PRICE PUBLISHED", NOT "FREE". The previous catalog priced
     * every agent at a hardcoded `0 BNB` as marketplace policy while real
     * ERC-8183 quotes went unread, so paid agents rendered as free and the
     * Manage screen printed "Free" over a hire that had cost money.
     */
    pricing: v.union(
      v.object({
        amountRaw: v.string(),
        token: v.string(),
        tokenSymbol: v.string(),
        tokenDecimals: v.number(),
        display: v.union(v.string(), v.null()),
        escrowContract: v.union(v.string(), v.null()),
      }),
      v.null(),
    ),
    x402Supported: v.boolean(),
    /**
     * ERC-8004 feedback, as the indexer aggregates it. Two numbers, kept
     * because the detail page renders them and re-fetching 8004scan per view to
     * get them would put a third-party API on the render path.
     *
     * `reputationScore` is null unless there is at least one feedback behind
     * it: an average over zero is not a rating, it is an artefact, and showing
     * one would be a fabricated number in the place users trust most.
     */
    feedbackCount: v.number(),
    reputationScore: v.union(v.number(), v.null()),
    /**
     * Hand-vetted. Boosts `rank`; does NOT exempt from verification.
     *
     * The nine editorial agents used to be a TypeScript literal compiled into
     * the backend, merged ahead of everything and exempt from every gate - so
     * adding one needed a deploy, and three of them were failing the
     * sellability gate while still being merged in. A curated agent whose
     * endpoint dies is now delisted like any other.
     */
    curated: v.boolean(),

    // --- State ----------------------------------------------------------
    /**
     * "degraded" is a listed agent that has failed a probe but not yet enough
     * of them to be delisted. It is visible and marked, which is the honest
     * state between "working" and "gone".
     */
    status: v.union(
      v.literal("live"),
      v.literal("degraded"),
      v.literal("unavailable"),
    ),
    /**
     * The stable sort key. One precomputed number rather than a sort over a
     * collected set, which is what makes cursor pagination correct: an ordering
     * that can change between pages shows duplicates and skips rows.
     */
    rank: v.number(),
    /** name + description + skills + tags, lowercased. Feeds the search index. */
    searchText: v.string(),
    publishedAt: v.string(),
    lastVerifiedAt: v.string(),
  })
    // Detail page, and every internal point lookup.
    .index("by_key", ["agentKey"])
    // Browse everything, paginated, stable.
    .index("by_status_rank", ["status", "rank"])
    // Browse one category, paginated; the [status, categorySlug] prefix also
    // serves the facet counts.
    .index("by_status_category_rank", ["status", "categorySlug", "rank"])
    /*
     * Browse by PROTOCOL, optionally narrowed by category.
     *
     * One index covers both, because protocol sits ahead of category in the
     * key: [status, protocol] answers "every agent I can run" and
     * [status, protocol, categorySlug] answers "yield agents I can run".
     *
     * It has to BE an index rather than a filter over a page. Filtering 24 rows
     * in memory returns three of them for a full page and breaks the cursor -
     * the same defect that took the reputation sort off the category screen.
     */
    .index("by_status_protocol_category_rank", [
      "status",
      "protocol",
      "categorySlug",
      "rank",
    ])
    // Server-side search. Replaces shipping the whole catalog to the client and
    // filtering it in JavaScript, which is what both frontends do today.
    .searchIndex("search_text", {
      searchField: "searchText",
      filterFields: ["status", "categorySlug", "protocol"],
    }),

  /* =========================================================================
   * OPERATIONAL DATA - deliberately NOT on the catalog row
   * ====================================================================== */

  /**
   * What Dolphin knows about whether one candidate can be hired.
   *
   * SEPARATE FROM `agents` FOR A CONCRETE REASON, not for tidiness. Probing
   * writes on a schedule. If the probe result lived on the catalog row, every
   * successful unchanged re-probe would rewrite a document that every
   * subscribed list query is watching - continuous reactivity, and a write per
   * agent per day for no visible change. This table absorbs that churn.
   *
   * It also holds the candidates that never make it: a row exists for every
   * agent that advertises an endpoint, whether or not it answers. Bounded by
   * the population that publishes an endpoint at all (~33,000 across A2A and
   * MCP on BSC mainnet, measured 2026-09-07), not by the registry's 307,559 -
   * and `invalid` rows are pruned.
   */
  agentVerification: defineTable({
    agentKey: v.string(),

    state: v.union(
      v.literal("unknown"),
      v.literal("live"),
      v.literal("unavailable"),
      v.literal("invalid"),
    ),
    /**
     * Why it failed, when it did. Drives the backoff schedule: a transport
     * failure recovers on its own and is retried soon, a structural one does
     * not and is retried in a month.
     */
    failureClass: v.union(
      v.literal("transport"),
      v.literal("http"),
      v.literal("protocol"),
      v.literal("no-menu"),
      v.literal("no-endpoint"),
      v.literal("unsafe-url"),
      v.null(),
    ),
    /**
     * One checkable sentence, capped. This is the whole observability story for
     * "why is agent X not listed" - enough to answer it, short enough that
     * 33,000 of them are not a storage problem. Probe transcripts are not kept.
     */
    detail: v.string(),
    /** The URL actually called, so the sentence above can be reproduced. */
    probedEndpoint: v.union(v.string(), v.null()),
    /** The transport that answered, or was tried. */
    protocol: v.union(v.literal("a2a"), v.literal("mcp"), v.null()),

    consecutiveFailures: v.number(),
    attempts: v.number(),

    firstSeenAt: v.string(),
    lastProbeAt: v.union(v.string(), v.null()),
    lastOkAt: v.union(v.string(), v.null()),
    /** When this row becomes due. The probe batch is selected on it. */
    nextProbeAt: v.string(),

    /**
     * 8004scan's `updated_at` as of the last time we looked. A change means the
     * publisher edited the registration, which schedules an early re-probe
     * instead of waiting out the normal interval.
     */
    sourceUpdatedAt: v.union(v.string(), v.null()),
  })
    .index("by_key", ["agentKey"])
    // Selects the probe batch: due work within a state.
    .index("by_state_next_probe", ["state", "nextProbeAt"]),

  /**
   * The browse chips, as data.
   *
   * One row. Recomputed when the catalog changes, so rendering the category
   * list costs one document read instead of a scan - and so a category that
   * appears in the registry appears in the UI without a code change, which is
   * the point of `categorySlug` being an open string.
   */
  catalogFacets: defineTable({
    key: v.string(),
    categories: v.array(
      v.object({ slug: v.string(), label: v.string(), count: v.number() }),
    ),
    totalLive: v.number(),
    updatedAt: v.string(),
  }).index("by_key", ["key"]),

  /**
   * Discovery's high-water marks and counters. One row.
   *
   * THE COUNTERS ARE THE REPLACEMENT FOR THE REJECTION LEDGER. "We screened out
   * 240,000 records" is a number, and a number is what an operator actually
   * reads - the previous design stored it as 251,922 documents.
   */
  discoveryCursor: defineTable({
    key: v.string(),

    /**
     * The incremental cursor: 8004scan's `created_at` of the newest record
     * already seen. Replaces the offset-based backfill entirely for new
     * registrations - `created_after=<this>` returns exactly what is new
     * (~1,348/day on BSC mainnet, measured 2026-09-07).
     */
    lastCreatedAt: v.union(v.string(), v.null()),

    /** The one-time catch-up over the existing endpoint-publishing population. */
    backfillOffset: v.number(),
    backfillCompletedAt: v.union(v.string(), v.null()),
    /** Which filtered query the backfill is currently walking. */
    backfillPhase: v.union(v.literal("a2a"), v.literal("mcp"), v.literal("done")),

    registryTotal: v.union(v.number(), v.null()),
    lastRunAt: v.union(v.string(), v.null()),
    lastRunSummary: v.union(v.string(), v.null()),

    // Running totals. Cheap observability with no per-record rows.
    seenTotal: v.number(),
    screenedOut: v.number(),
    candidatesFound: v.number(),
    /**
     * How many times 8004scan's own filter failed. Measured 2026-09-07:
     * `has_a2a` intermittently returns HTTP 500 at ~10.5s, which is a
     * server-side query timeout rather than an auth problem. After a threshold
     * the pipeline falls back to the unfiltered walk, so this number is how an
     * operator knows discovery is running degraded rather than stopped.
     */
    filterFailures: v.number(),
  }).index("by_key", ["key"]),

  /* =========================================================================
   * HIRING, PAYMENTS, REVIEWS, AUTH
   *
   * Carried over from the previous backend deliberately and almost unchanged -
   * see ARCHITECTURE §L. These subsystems are verified end to end against a
   * live deployment (SIWE replay and forged-token rejection; a six-way
   * verification of the ERC-8004 Reputation Registry address before a line was
   * written). Rewriting working, security-sensitive code because it shares a
   * directory with the broken part is how a rebuild adds regressions nobody
   * predicted.
   *
   * The ONE change is the key: `chainId` + `tokenId` becomes `agentKey`, so a
   * hire can never attach to a colliding token id on a different registry.
   * Free, because the new deployment starts empty - the old one held 4 test
   * hires, zero reviews and zero paid hires.
   * ====================================================================== */

  /**
   * Login challenges. One row per sign-in attempt, single-use, short-lived.
   *
   * `message` is the EIP-4361 text THE SERVER built and the client was asked to
   * sign. Verification runs against this stored copy, never against a message
   * the client sends back - if the client chose the message it could sign
   * anything and present the result as a login. See convex/lib/walletAuth.ts.
   */
  authNonces: defineTable({
    nonce: v.string(),
    address: v.string(),
    message: v.string(),
    issuedAt: v.string(),
    expiresAt: v.string(),
  }).index("by_nonce", ["nonce"]),

  /**
   * Signed-in wallets.
   *
   * `tokenHash` is SHA-256 of the bearer token; the token itself is never
   * stored, so a dump of this table yields no usable credential. Expiry is
   * enforced on read rather than by a sweep, so an expired row is inert the
   * moment it expires.
   */
  walletSessions: defineTable({
    tokenHash: v.string(),
    address: v.string(),
    chainId: v.number(),
    issuedAt: v.string(),
    expiresAt: v.string(),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_address", ["address"]),

  /**
   * The latest protocol reading for one agent in one stats category.
   *
   * `category` here stays a CLOSED union while `agents.categorySlug` is an open
   * string, and that is not an inconsistency - it answers a different question.
   * The catalog's category is "what drawer is this in", which must be open. This
   * one is "which protocol reader do we run", and the set of integrations that
   * exist (Venus, PancakeSwap V3, Aave) really is finite. A category with no
   * wired reader maps to null and renders as unavailable.
   */
  agentLiveStats: defineTable({
    agentKey: v.string(),
    category: statsCategoryValidator,
    agentWallet: v.union(v.string(), v.null()),
    stats: agentLiveStatsValidator,
    checkedAt: v.string(),
  }).index("by_agent_category", ["agentKey", "category"]),

  /**
   * THE TRACK RECORD. One row per real on-chain reading Dolphin has taken of an
   * agent's headline metric, kept instead of discarded.
   *
   * agentLiveStats above holds only the LATEST reading, because it upserts. That
   * is correct for "what is true now" and it is why the agent detail page's
   * chart had no source at all: `performanceSeries` was hardcoded `[]` and
   * nothing wrote it, so a permanent "track record syncing" state described an
   * indexer that did not exist.
   *
   * Every row here is one protocol read - Venus, PancakeSwap V3, Aave - at the
   * timestamp it was taken, carrying the source label the metric itself carried.
   * Nothing is interpolated, backfilled or seeded. An agent nobody has opened
   * twice has no chart, and that is the honest answer rather than a flat line.
   *
   * BOUNDED ON BOTH AXES, deliberately. Writes are gated to one per hour per
   * agent-category (MIN_OBSERVATION_GAP_MS) and pruned to MAX_OBSERVATIONS, so
   * a table that only ever grows cannot repeat the storage-ceiling incident of
   * 2026-09-02. See convex/lib/statsHistory.ts.
   */
  agentStatsHistory: defineTable({
    agentKey: v.string(),
    category: statsCategoryValidator,
    /** Which field of the category's stats this point is. */
    metric: v.string(),
    value: v.number(),
    /** ISO timestamp of the read itself, not of the insert. */
    observedAt: v.string(),
    /** Denormalized DataSourceLabel: a point should keep saying where it came from. */
    source: v.object({
      id: v.string(),
      label: v.string(),
      url: v.optional(v.string()),
    }),
  }).index("by_agent_category", ["agentKey", "category"]),

  agentHires: defineTable({
    agentKey: v.string(),
    walletAddress: v.string(),
    status: v.union(v.literal("active"), v.literal("cancelled")),
    hiredAt: v.string(),
    cancelledAt: v.union(v.string(), v.null()),
    /**
     * The agentJobs.jobId that paid for this hire, or null when the hire was
     * free.
     */
    paymentJobId: v.union(v.string(), v.null()),
  })
    .index("by_agent_wallet", ["agentKey", "walletAddress"])
    .index("by_wallet", ["walletAddress", "status"])
    .index("by_agent", ["agentKey"]),

  /**
   * REVIEWS — one per wallet per agent, and only from a wallet that hired it.
   *
   * Deliberately NOT a star rating. A five-star average tells you how people
   * felt. For an agent that manages money, what matters is whether it did the
   * thing it said it would, and whether the person who paid for that would do
   * it again. Those are the two questions here, and both are answerable in one
   * tap.
   *
   * THE EVIDENCE IS DENORMALIZED ON PURPOSE. hiredAt and paidJobId are copied
   * onto the review when it is written, so a review keeps its own provenance:
   * how long that hire had run, and whether real money went through an escrow
   * for it. A paid review is a materially stronger signal than a free one and
   * the UI needs to be able to say so without re-deriving it.
   *
   * NO MODERATION EXISTS YET. `comment` is free text written by users and shown
   * to other users, capped at REVIEW_COMMENT_MAX_LENGTH and otherwise stored as
   * typed. That is a known gap rather than an oversight - it is recorded in
   * Agent/TODO.md, and it is the reason the structured answers carry the signal
   * and the comment is decoration.
   */
  agentReviews: defineTable({
    agentKey: v.string(),
    /** The reviewer. Always from the authenticated session, never an argument. */
    walletAddress: v.string(),

    /** Did it do what it said it would? The question a paying user actually has. */
    outcome: v.union(v.literal("yes"), v.literal("partially"), v.literal("no")),
    /** The single most predictive question in any review system. */
    wouldHireAgain: v.boolean(),
    comment: v.union(v.string(), v.null()),

    // Provenance, copied from the hire at write time. See above.
    hiredAt: v.string(),
    /** Non-null when an ERC-8183 escrow paid for the hire this review is about. */
    paidJobId: v.union(v.string(), v.null()),

    createdAt: v.string(),
    updatedAt: v.string(),

    /**
     * The ERC-8004 Reputation Registry transaction that mirrored this review
     * on-chain, when the reviewer chose to pay for one.
     */
    onChainTxHash: v.union(v.string(), v.null()),
  })
    .index("by_agent", ["agentKey"])
    .index("by_agent_reviewer", ["agentKey", "walletAddress"]),

  /**
   * Altana session grants, recorded next to the agentHires row they belong to.
   * A session is the one thing in Dolphin that hands real authority to someone
   * else, so "what have I authorized" needs exactly one answer rather than two
   * that can disagree.
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
    agentKey: v.string(),
    /**
     * The agent's name AS SHOWN when the grant was made. Denormalized on
     * purpose: this is an authorization record, and "what did I agree to"
     * should keep reading the way it read at the time, even if the agent is
     * later renamed in the catalog.
     */
    agentName: v.string(),
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
    chainId: v.number(),
  })
    .index("by_session_key", ["chainId", "sessionPublicKey"])
    .index("by_altana_wallet", ["chainId", "altanaWalletAddress"]),

  /**
   * ERC-8183 escrow jobs — the evidence that a paid hire was actually paid.
   *
   * Every row here was written only after convex/agentPayments.ts read the
   * kernel on BSC and confirmed the job exists, is funded, was funded by this
   * wallet, pays this agent's registered wallet, and carries a real budget.
   * Nothing writes to this table on a client's say-so: insertJobRecord is an
   * internalMutation precisely so there is no public way to assert a payment
   * without one having happened (AGENTS.md §5).
   *
   * `jobId` and `transactionHash` are the checkable references - anyone can
   * take a jobId to the kernel at `escrowContract` and read back the same job.
   *
   * The token's symbol and decimals are DENORMALIZED on purpose. They are read
   * on-chain from the token the seller quoted, at payment time, and a receipt
   * should keep reading the way it read then. They are also what makes this
   * row renderable without a second contract read per row.
   */
  agentJobs: defineTable({
    agentKey: v.string(),
    /** The agent's name as shown when the payment was made. See agentSessions. */
    agentName: v.string(),
    /** The Altana smart account that paid - the job's on-chain `client`. */
    altanaWalletAddress: v.string(),
    /** The wagmi address on the matching agentHires row, when there is one. */
    hirerWalletAddress: v.union(v.string(), v.null()),
    /** The job's on-chain `provider`, checked to equal the agent's own wallet. */
    providerAddress: v.string(),
    /** The ERC-8183 kernel this job lives in. Where to go to re-check it. */
    escrowContract: v.string(),
    /** Decimal string: a bigint is not a Convex value. */
    jobId: v.string(),
    /** OPEN | FUNDED | SUBMITTED | COMPLETED | REJECTED | EXPIRED, as last read. */
    jobStatus: v.string(),
    /** Budget in atomic token units, read from the chain rather than the client. */
    budgetRaw: v.string(),
    paymentToken: v.string(),
    paymentTokenSymbol: v.string(),
    paymentTokenDecimals: v.number(),
    /** The job description as the chain holds it - what was actually bought. */
    taskDescription: v.string(),
    transactionHash: v.union(v.string(), v.null()),
    /** When Dolphin last read this job back off the chain. */
    verifiedAt: v.string(),
    chainId: v.number(),
  })
    .index("by_job", ["chainId", "jobId"])
    .index("by_altana_wallet", ["chainId", "altanaWalletAddress"])
    .index("by_agent_wallet", ["agentKey", "altanaWalletAddress"]),
});
