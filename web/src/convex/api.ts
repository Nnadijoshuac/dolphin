import { anyApi } from "convex/server";

import type {
  Agent,
  AgentLiveStats,
  AgentPriceModel,
} from "@/types/agent";

/**
 * Typed handle on the Convex queries this site calls.
 *
 * WHY NOT `convex/_generated/api`. That codegen lives at the repo root, beside
 * the mobile app. Importing it from here would mean this project's build
 * reaches outside web/ and resolves the `convex` package from the ROOT
 * node_modules - so the website could not install or build from a clean clone
 * without the mobile app also being installed. Keeping the two projects
 * independently installable is a deliberate constraint of this repo (see the
 * import commit for web/), and it outranks the convenience of shared codegen.
 *
 * This is not a hand-rolled reimplementation of anything: `_generated/api.js`
 * is literally `export const api = anyApi`, so the runtime object below IS the
 * generated one. Only the type annotation is written by hand, and it declares
 * a signature, never behaviour - all the curation, taxonomy, pricing and merge
 * logic stays in convex/lib/agentCatalog.ts where both frontends read it.
 *
 * IF convex/agents.ts CHANGES the args or return shape of either query, change
 * the annotation here in the same commit. Both projects pin convex ^1.45.0.
 */
type Query<Args, Result> = {
  _type: "query";
  _visibility: "public";
  _args: Args;
  _returnType: Result;
  _componentPath: undefined;
};

type Mutation<Args, Result> = {
  _type: "mutation";
  _visibility: "public";
  _args: Args;
  _returnType: Result;
  _componentPath: undefined;
};

type Action<Args, Result> = {
  _type: "action";
  _visibility: "public";
  _args: Args;
  _returnType: Result;
  _componentPath: undefined;
};

export const api = anyApi as unknown as {
  agents: {
    /**
     * convex/agents.ts -> list. PAGINATED (2026-09-07).
     *
     * Replaces `listAgents`, which took no arguments and returned the entire
     * catalog. There is no unpaginated read any more, deliberately: a Convex
     * query has a 1-second execution budget, and the old one did a
     * file-storage lookup per agent inside it.
     */
    list: Query<
      {
        category?: string;
        /**
         * WHAT THE AGENT IS, not what it does. Added here 2026-09-08, having
         * existed on the backend and been undeclared - so the website could not
         * offer the filter at all, and `npm run check:convex-api` caught it on
         * its first run.
         *
         * An A2A agent is commissioned and paid over an ERC-8183 escrow; an MCP
         * agent publishes tools you call. Conflating them is what made MCP
         * agents read as broken A2A ones (bc9b46e on mobile).
         */
        protocol?: "a2a" | "mcp";
        paginationOpts: PaginationOptions;
      },
      PaginationResult<Agent>
    >;
    /** convex/agents.ts -> search. A Convex search index, relevance-ordered. */
    search: Query<
      {
        text: string;
        category?: string;
        protocol?: "a2a" | "mcp";
        paginationOpts: PaginationOptions;
      },
      PaginationResult<Agent>
    >;
    /** convex/agents.ts -> get. Accepts an agentKey or a bare tokenId. */
    get: Query<{ reference: string }, Agent | null>;
    /** convex/agents.ts -> getMany. Bounded point lookups, for known keys. */
    getMany: Query<{ references: string[] }, Agent[]>;
    /** convex/agents.ts -> signals. Batched; never one query per rendered row. */
    signals: Query<
      { agentKeys: string[] },
      {
        agentKey: string;
        hires: number;
        activeHires: number;
        paidHires: number;
        reviews: number;
        wouldHireAgain: number;
        wouldHireAgainRate: number | null;
        deliveredCount: number;
      }[]
    >;
  };
  facets: {
    /** convex/facets.ts -> list. The browse chips, computed from the catalog. */
    list: Query<
      Record<string, never>,
      {
        categories: { slug: string; label: string; count: number }[];
        totalLive: number;
        updatedAt: string | null;
      }
    >;
  };
};

/** Convex's own cursor-pagination shapes, mirrored so this file stays standalone. */
export interface PaginationOptions {
  numItems: number;
  cursor: string | null;
}

export interface PaginationResult<T> {
  page: T[];
  isDone: boolean;
  continueCursor: string;
}

/**
 * The categories that have a wired protocol reader.
 *
 * `AgentCategory` is an open string as of 2026-09-07, but live stats are read
 * by hand-written code against a specific contract, so the set with any is
 * finite and the Convex validator behind these queries is a closed union.
 * Mirrors statsCategoryFor in convex/lib/statsCategory.ts.
 */
export type StatsCategory =
  | "monitoring"
  | "rebalancing"
  | "grid-trading"
  | "health-factor"
  | "yield"
  | "trading";

/** One agentLiveStats row - convex/categoryStats.ts's cache table. */
export interface AgentCategoryStatsRow {
  agentKey: string;
  category: StatsCategory;
  agentWallet: string | null;
  stats: AgentLiveStats;
  checkedAt: string;
}

/**
 * Kept separate from `api` above only because convex/react's `useQuery` and
 * `useAction` want the reference itself; splitting the namespaces makes the two
 * modules' call sites read the same as the mobile app's `api.categoryStats.*`.
 */
export const categoryStatsApi = anyApi as unknown as {
  categoryStats: {
    /** convex/categoryStats.ts -> getAgentCategoryStats */
    getAgentCategoryStats: Query<
      { agentKey: string; category: StatsCategory },
      AgentCategoryStatsRow | null
    >;
    /** convex/categoryStats.ts -> refreshAgentCategoryStats */
    refreshAgentCategoryStats: Action<
      { agentKey: string; category: StatsCategory; agentWallet: string | null },
      unknown
    >;
    /**
     * convex/categoryStats.ts -> getAgentStatsHistory. THE CHART'S REAL SOURCE.
     *
     * -----------------------------------------------------------------------
     * WHY THE CHART WAS EMPTY ON EVERY AGENT, FOREVER (found 2026-09-08)
     * -----------------------------------------------------------------------
     * `PerformancePanel` read `agent.performanceSeries`, and
     * convex/lib/publicAgent.ts sets that to `[] as never[]` on every agent it
     * returns. The panel needs two points to draw. So 100% of agent pages
     * rendered "No performance series yet" - permanently - and the entire SVG
     * path builder behind it was code that had never executed and could not.
     *
     * The data existed. `agentStatsHistory` has been accumulating real
     * observations since 2026-09-06: each point is ONE protocol read (Venus's
     * Comptroller, PancakeSwap V3's position manager, Aave's pool) at the
     * timestamp it was taken, carrying the source label the metric carried,
     * written at most hourly per agent and pruned to a bound. Nothing is
     * interpolated, backfilled or seeded, and `convex/lib/statsHistory.ts` says
     * so at length. This query has existed the whole time and neither frontend
     * called it.
     *
     * `metric` is null when the category has no chartable number - three of the
     * six do not, and those get no chart rather than a chart of something
     * unrelated. A flat line at zero is a claim.
     */
    getAgentStatsHistory: Query<
      { agentKey: string; category: StatsCategory },
      {
        points: {
          timestamp: string;
          value: number;
          source: { id: string; label: string; url?: string };
        }[];
        metric: string | null;
        metricLabel: string | null;
      }
    >;
  };
};

/**
 * convex/walletAuth.ts. Sign-in with Ethereum: ask for a challenge, sign it,
 * exchange the signature for a session token.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS NAMESPACE HAD TO BE ADDED (2026-09-07)
 * ---------------------------------------------------------------------------
 * It should have arrived with the backend change it belongs to. On 2026-09-06
 * every authenticated write in Convex swapped its untrusted `walletAddress`
 * argument for a `sessionToken` (convex/lib/walletAuth.ts explains why). The
 * mobile app was updated in the same commit. THIS FILE WAS NOT, and neither was
 * anything else under web/ - so the website went on sending `walletAddress` to
 * a mutation that no longer accepts it, and every hire on the site failed with:
 *
 *   ArgumentValidationError: Object is missing the required field `sessionToken`
 *
 * The annotation below is hand-written (see the note at the top of this file),
 * which is precisely why it did not fail to compile when the backend moved. The
 * rule in that note - "if convex/*.ts changes the args, change the annotation
 * here in the same commit" - is the only thing keeping these in step, and it
 * was not followed. Treat a drift here as a runtime outage, because that is
 * what it is.
 */
export const walletAuthApi = anyApi as unknown as {
  walletAuth: {
    /** The server chooses the message. Sign `message` byte for byte. */
    requestNonce: Action<
      { address: string },
      { nonce: string; message: string; expiresAt: string }
    >;
    verifySignature: Action<
      { nonce: string; signature: string },
      { token: string; address: string; expiresAt: string }
    >;
    /** Null for an unknown or expired token, so an expired session signs out on its own. */
    currentSession: Query<
      { sessionToken: string | null },
      { address: string; expiresAt: string } | null
    >;
    signOut: Mutation<{ sessionToken: string }, null>;
  };
};

/**
 * convex/agentHires.ts. A hire is a subscription row - no spend cap, no
 * allowlist, no transaction of its own. `priceModel` must be the agent's
 * ALREADY RESOLVED priceModel.value, or null; passing null makes the mutation
 * reject rather than assume free.
 *
 * `sessionToken` replaced `walletAddress` on 2026-09-06. The hiring address is
 * now RECOVERED from the session the token identifies rather than taken from a
 * string the client typed - see the walletAuthApi note above for what that
 * change broke here.
 *
 * A NON-ZERO price additionally requires `paymentJobId` - the id of an
 * ERC-8183 job that convex/agentPayments.ts already verified on-chain. The
 * mutation looks that row up itself, so passing an id nothing paid for is an
 * error rather than a hire. Neither refusal may be worked around on the client.
 */
export const agentHiresApi = anyApi as unknown as {
  agentHires: {
    hireReadOnlyAgent: Mutation<
      {
        agentKey: string;
        sessionToken: string;
        priceModel: AgentPriceModel | null;
        paymentJobId?: string | null;
      },
      string
    >;
    /**
     * Ends a hire. Does NOT refund or alter an ERC-8183 escrow job - that money
     * is on-chain and Convex has no authority over it - so a cancelled paid
     * hire keeps its paymentJobId.
     */
    cancelHire: Mutation<{ agentKey: string; sessionToken: string }, null>;
    /**
     * Reading a hire list is not an authenticated write and deliberately still
     * takes a plain address: who someone has hired is not a secret from anyone
     * who already knows their public address.
     */
    getHiredAgentsForWallet: Query<
      { walletAddress: string },
      {
        agentKey: string;
        walletAddress: string;
        status: "active" | "cancelled";
        hiredAt: string;
        paymentJobId: string | null;
      }[]
    >;
  };
};

/**
 * convex/agentReviews.ts. STRUCTURED OUTCOMES, NOT STARS.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS NAMESPACE TOOK SO LONG TO APPEAR (2026-09-08)
 * ---------------------------------------------------------------------------
 * It is not new work. `convex/agentReviews.ts` has been complete for days: three
 * gates enforced in the mutation (authenticated, has hired it, hire at least
 * 24h old), one editable review per wallet per agent, a summary query, and an
 * action that witnesses an ERC-8004 Reputation Registry transaction on-chain
 * before a review is allowed to claim it was published. The mobile app consumes
 * all of it through src/hooks/use-agent-reviews.ts.
 *
 * THIS FILE DID NOT DECLARE IT AT ALL, so the website - the surface a stranger
 * actually sees - showed a "Feedback" count sourced from 8004scan's index and
 * nothing else. The one differentiated thing this marketplace has was built and
 * then shown to nobody. That is the drift the two-frontends decision record
 * warns about, in its purest form.
 *
 * WHY NOT STARS, restated here because it is the reason the shapes below look
 * unusual: a five-star mean over a marketplace this size reorders on a single
 * opinion, "how did you feel" is the wrong question about software that moves
 * money, and stars invite bulk manufacture in a way two structured questions
 * tied to a verified, aged, sometimes-paid hire do not.
 */
export type ReviewOutcome = "yes" | "partially" | "no";

export type AgentReviewRow = {
  /** Full, not anonymised: it is already public, and checkability is the point. */
  walletAddress: string;
  outcome: ReviewOutcome;
  wouldHireAgain: boolean;
  comment: string | null;
  /** Non-null when an on-chain escrow paid for the hire behind this review. */
  paidJobId: string | null;
  /** Non-null once witnessed in the ERC-8004 Reputation Registry. */
  onChainTxHash: string | null;
  hiredAt: string;
  updatedAt: string;
};

export const agentReviewsApi = anyApi as unknown as {
  agentReviews: {
    /**
     * Every review of one agent, plus the summary above them.
     *
     * `wouldHireAgainRate` is NULL below five reviews rather than a
     * small-sample percentage - "100% would hire again" over one review is true
     * arithmetic and a false impression. A caller that gets null must render
     * the counts instead. Do not work that refusal around on the client.
     */
    getAgentReviews: Query<
      { agentKey: string },
      {
        total: number;
        paidReviews: number;
        onChainReviews: number;
        outcomes: { yes: number; partially: number; no: number };
        wouldHireAgainCount: number;
        wouldHireAgainRate: number | null;
        reviews: AgentReviewRow[];
      }
    >;
    /**
     * Whether this wallet may review this agent, and if not, WHY.
     *
     * Public so the form can state the real reason - "your hire is 3 hours old"
     * is a different thing to tell someone than "you have not hired this agent"
     * - rather than offering a form that fails on submit. The gates are still
     * enforced in the mutation; this only makes the UI agree with them.
     */
    getReviewEligibility: Query<
      { agentKey: string; sessionToken: string | null },
      {
        eligible: boolean;
        reason: string | null;
        existing: {
          outcome: ReviewOutcome;
          wouldHireAgain: boolean;
          comment: string | null;
          updatedAt: string;
          onChainTxHash: string | null;
        } | null;
      }
    >;
    submitReview: Mutation<
      {
        sessionToken: string;
        agentKey: string;
        outcome: ReviewOutcome;
        wouldHireAgain: boolean;
        comment: string | null;
      },
      null
    >;
    /**
     * Marks an ALREADY-SAVED review as published to the reputation registry.
     *
     * It does not send the transaction - Convex holds no key and cannot. The
     * caller sends it from the reviewer's own wallet and hands over the hash;
     * this reads the receipt off BNB Chain and refuses unless it succeeded,
     * went to the registry, and came from the reviewer. A hash alone proves
     * nothing, which is exactly why this is an action and not a mutation.
     */
    attestReviewOnChain: Action<
      { sessionToken: string; agentKey: string; transactionHash: string },
      { transactionHash: string }
    >;
  };
};

/**
 * convex/agentRetention.ts. The signal that needs no reviewer.
 *
 * The percentage of hires still active after 7 and 30 days, computed entirely
 * from Dolphin's own agentHires table. It is the most honest comparison signal
 * this marketplace can produce - nobody writes it, nobody can inflate it
 * without paying for hires, and it is available for every agent the moment it
 * has any history at all.
 *
 * `rate` is null below five eligible hires, same threshold and same reason as
 * the review rate above. A null must be rendered as counts, never as a
 * percentage with a small denominator hidden behind it.
 */
export const agentRetentionApi = anyApi as unknown as {
  agentRetention: {
    getAgentRetention: Query<
      { agentKey: string },
      {
        totalHires: number;
        activeHires: number;
        day7: {
          eligible: number;
          retained: number;
          sufficient: boolean;
          rate: number | null;
        };
        day30: {
          eligible: number;
          retained: number;
          sufficient: boolean;
          rate: number | null;
        };
      }
    >;
  };
};

/**
 * convex/agentSessions.ts. Altana session grants, recorded next to the hire
 * row they belong to so "what have I authorized" has exactly one answer rather
 * than two that can disagree.
 *
 * Reference detail only - a session's public key, its bounds, and the agent it
 * was granted to. No signer and no key material passes through here, so
 * nothing in this namespace can act on a wallet; it can only describe a grant
 * and identify what to revoke.
 *
 * `recordSessionGrant` records a grant that ALREADY happened on-chain; it
 * cannot create one (Convex cannot sign). It rejects an empty allowlist,
 * because that is how Altana spells "any contract" - do not work that refusal
 * around on the client.
 */
export type AgentSessionRow = {
  agentKey: string;
  agentName: string;
  altanaWalletAddress: string;
  hirerWalletAddress: string | null;
  sessionPublicKey: string;
  allowlist: { address: string; label: string }[];
  spendCapWei: string;
  spendPeriod: string;
  expiry: number;
  grantedAt: string;
  revokedAt: string | null;
  grantTransactionHash: string | null;
  status: "active" | "revoked" | "expired";
};

export const agentSessionsApi = anyApi as unknown as {
  agentSessions: {
    recordSessionGrant: Mutation<
      {
        /** Added 2026-09-06 with authentication - see walletAuthApi above. */
        sessionToken: string;
        agentKey: string;
        agentName: string;
        altanaWalletAddress: string;
        hirerWalletAddress: string | null;
        sessionPublicKey: string;
        allowlist: { address: string; label: string }[];
        spendCapWei: string;
        spendPeriod: string;
        expiry: number;
        grantTransactionHash: string | null;
      },
      string
    >;
    markSessionRevoked: Mutation<
      { sessionPublicKey: string; sessionToken: string },
      string | null
    >;
    getSessionsForAltanaWallet: Query<
      { altanaWalletAddress: string },
      AgentSessionRow[]
    >;
    getActiveSessionForAgent: Query<
      { agentKey: string; altanaWalletAddress: string },
      AgentSessionRow | null
    >;
  };
};

/**
 * convex/agentPayments.ts. Paid hires over ERC-8183 escrow.
 *
 * Two of these are a RELAY and one is a WITNESS, and the distinction matters:
 *
 * - `requestQuote` / `notifyJobFunded` POST to a third-party agent endpoint on
 *   the browser's behalf, because the browser genuinely cannot - 2 of the 3
 *   live sellers answer a CORS preflight with 405 and no
 *   Access-Control-Allow-Origin. They forward a request and return a response.
 *   They hold no key material and cannot move a token.
 * - `recordJobPayment` does not believe the client. It reads the ERC-8183
 *   kernel on BSC itself and refuses unless the job is really funded, really
 *   from this wallet, really to this agent's registered address, and really
 *   for a non-zero budget.
 *
 * The payment itself is signed in the browser by the passkey. Nothing in this
 * namespace signs anything - Convex cannot, and this project's whole
 * authorization story depends on it never starting.
 */
export type AgentQuote = {
  dialect: "instructions" | "signed-envelope";
  /** Checked server-side to equal the agent's registered ERC-8004 wallet. */
  provider: string;
  /** Atomic units as a decimal string. Never parse this into a number. */
  priceRaw: string;
  paymentToken: string;
  /** Read on-chain from the quoted token itself, not assumed. */
  paymentTokenSymbol: string;
  paymentTokenDecimals: number;
  verifyingContract: string;
  chainId: number;
  estimatedCompletionSeconds: number | null;
  quoteExpiresAt: number | null;
  negotiationHash: string | null;
  providerSignature: string | null;
  taskDescription: string;
  /** The seller's signed envelope. Anchored into the on-chain job description. */
  signedEnvelope: string | null;
  /** The seller's own words about what it will deliver. */
  deliverables: string | null;
  endpoint: string;
  rawResponse: string;
};

export type AgentJobRow = {
  agentKey: string;
  agentName: string;
  altanaWalletAddress: string;
  hirerWalletAddress: string | null;
  providerAddress: string;
  escrowContract: string;
  jobId: string;
  jobStatus: string;
  budgetRaw: string;
  paymentToken: string;
  paymentTokenSymbol: string;
  paymentTokenDecimals: number;
  taskDescription: string;
  transactionHash: string | null;
  verifiedAt: string;
};

export const agentPaymentsApi = anyApi as unknown as {
  agentPayments: {
    requestQuote: Action<
      { agentKey: string; taskDescription: string; serviceId?: string },
      AgentQuote
    >;
    notifyJobFunded: Action<
      { agentKey: string; jobId: string },
      { accepted: boolean; detail: string }
    >;
    recordJobPayment: Action<
      {
        agentKey: string;
        altanaWalletAddress: string;
        hirerWalletAddress: string | null;
        escrowContract: string;
        jobId: string;
        transactionHash: string | null;
        paymentToken: string;
        paymentTokenSymbol: string;
        paymentTokenDecimals: number;
      },
      { recordId: string; jobStatus: string; budgetRaw: string }
    >;
    getJobsForAgent: Query<
      { agentKey: string; altanaWalletAddress: string },
      AgentJobRow[]
    >;
    getJobsForAltanaWallet: Query<{ altanaWalletAddress: string }, AgentJobRow[]>;
  };
};

/** One call the Dolphin agent made to one marketplace agent. */
export type DolphinToolCall = {
  id: string;
  messageId: string;
  agentKey: string;
  agentName: string;
  toolName: string;
  /** What Dolphin asked, JSON. Shown beside what came back. */
  argumentsJson: string;
  resultText: string | null;
  isError: boolean;
  transportError: string | null;
  latencyMs: number | null;
  calledAt: number;
};

export type DolphinMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "thinking" | "consulting" | "complete" | "error";
  errorReason: string | null;
  /**
   * Which kind of failure, when status is "error". See the note on `errorKind`
   * in convex/schema.ts: "out of free model calls" is not a fault and must not
   * render like one. Null on rows written before 2026-09-12.
   */
  errorKind: "capacity" | "provider" | "input" | "fault" | null;
  model: string | null;
  createdAt: number;
  completedAt: number | null;
};

/**
 * convex/dolphin.ts. The in-app agent that consults marketplace agents.
 *
 * Declared here in the SAME change as the backend, which is the rule this file
 * exists to enforce and the one that was broken on 2026-09-06 - see
 * web/scripts/check-convex-api.mjs for what that cost.
 *
 * TWO THINGS THE UI MUST HONOUR, because they are correctness rather than
 * presentation:
 *
 * `toolCalls` is the record of what actually RAN, written by the executor
 * before and after each call - it is not the model's account of its own
 * sources. Render these, never a source list parsed out of the prose. The model
 * is small and free and will claim to have consulted an agent it never called.
 *
 * `completedAt` is when the answer was produced, and a reused answer keeps its
 * ORIGINAL value. Show it. Live metrics restated as current when they were read
 * an hour ago is the fabricated-liveness failure of AGENTS.md §5 wearing a
 * cache as a disguise.
 */
export const dolphinApi = anyApi as unknown as {
  dolphin: {
    createConversation: Mutation<
      { seedAgentKey?: string; sessionToken?: string; userAddress?: string },
      { conversationKey: string }
    >;
    getConversation: Query<
      { conversationKey: string },
      {
        conversation: {
          conversationKey: string;
          title: string;
          seedAgentKey: string | null;
          createdAt: number;
        };
        messages: DolphinMessage[];
        toolCalls: DolphinToolCall[];
        agentDirectory: Array<{ agentKey: string; name: string }>;
      } | null
    >;
    /**
     * Long-running by design: it opens MCP sessions against third-party servers
     * and calls their tools. Progress is NOT in this return value - subscribe to
     * `getConversation` and watch the message status and tool-call rows land.
     */
    ask: Action<
      { conversationKey: string; text: string; userAddress?: string },
      { messageId: string }
    >;
  };
};

export type AdminOverview = {
  serverTimestamp: string;
  discovery: {
    seenTotal: number;
    screenedOut: number;
    candidatesFound: number;
    filterFailures: number;
    lastRunAt: string | null;
    lastRunSummary: string | null;
    backfillPhase: "a2a" | "mcp" | "done";
    backfillOffset: number;
    registryTotal: number | null;
    lastCreatedAt: string | null;
  };
  catalog: {
    totalLive: number;
    categories: Array<{ slug: string; label: string; count: number }>;
    liveAgents: Array<{
      agentKey: string;
      name: string;
      categorySlug: string;
      protocol: "a2a" | "mcp";
      rank: number;
      status: "live" | "degraded" | "unavailable";
      pricing: string;
      reputationScore: number | null;
      feedbackCount: number;
      endpoint: string;
      curated: boolean;
      lastVerifiedAt: string;
    }>;
    degradedAgents: Array<{
      agentKey: string;
      name: string;
      categorySlug: string;
      protocol: "a2a" | "mcp";
      rank: number;
      status: "live" | "degraded" | "unavailable";
      pricing: string;
      reputationScore: number | null;
      feedbackCount: number;
      endpoint: string;
      lastVerifiedAt: string;
    }>;

  };
  verification: {
    counts: Record<string, number>;
    recentIssues: Array<{
      agentKey: string;
      state: string;
      failureClass: string | null;
      detail: string;
      consecutiveFailures: number;
      attempts: number;
      probedEndpoint: string | null;
      lastProbeAt: string | null;
      nextProbeAt: string;
    }>;
    unprobed: Array<{
      agentKey: string;
      detail: string;
      firstSeenAt: string;
      nextProbeAt: string;
    }>;
  };
  dolphin: {
    totalConversations: number;
    recentConversations: Array<{
      id: string;
      key: string;
      title: string;
      ownerAddress: string | null;
      seedAgentKey: string | null;
      updatedAt: number;
    }>;
    recentMessages: Array<{
      id: string;
      role: "user" | "assistant";
      status: "thinking" | "consulting" | "complete" | "error";
      content: string;
      model: string | null;
      errorReason: string | null;
      createdAt: number;
      completedAt: number | null;
    }>;
    recentToolCalls: Array<{
      id: string;
      agentName: string;
      agentKey: string;
      toolName: string;
      latencyMs: number | null;
      isError: boolean;
      transportError: string | null;
      argumentsJson: string;
      resultPreview: string | null;
      calledAt: number;
    }>;
  };
  commerce: {
    activeHiresCount: number;
    recentJobs: Array<{
      id: string;
      agentName: string;
      agentKey: string;
      jobId: string;
      jobStatus: string;
      budgetRaw: string;
      paymentTokenSymbol: string;
      verifiedAt: string;
      transactionHash: string | null;
      providerAddress: string;
    }>;
    recentSessions: Array<{
      id: string;
      agentName: string;
      altanaWalletAddress: string;
      status: "active" | "revoked" | "expired";
      spendCapWei: string;
      grantedAt: string;
    }>;
  };
  crons: {
    discovery: {
      name: string;
      intervalMinutes: number;
      cadenceLabel: string;
      lastRunAt: string | null;
      lastRunSummary: string | null;
      target: string;
    };
    verification: {
      name: string;
      intervalMinutes: number;
      cadenceLabel: string;
      lastRunAt: string | null;
      lastRunSummary: string | null;
      target: string;
    };
    facets: {
      name: string;
      intervalMinutes: number;
      cadenceLabel: string;
      lastRunAt: string | null;
      lastRunSummary: string | null;
      target: string;
    };
  };
};

export const adminApi = anyApi as unknown as {
  admin: {
    getOverview: Query<Record<string, never>, AdminOverview>;
    triggerDiscoverySweep: Action<{ backfill?: boolean }, unknown>;
    triggerProbeBatch: Action<{ limit?: number }, unknown>;
    triggerAgentProbe: Action<{ agentKey: string }, { probed: boolean; agentKey: string }>;
    triggerFacetRecompute: Action<Record<string, never>, unknown>;
  };
};



/** One call in an agent-built batch, after convex/lib/agentTransaction.ts validated it. */
export type AgentCall = {
  to: string;
  data: string;
  value: string;
  /** The agent's own words for this step. Rendered verbatim and attributed. */
  label: string | null;
};

/**
 * A transaction an agent BUILT for the user to sign.
 *
 * The only way an agent acts in Dolphin today: it computes the route and the
 * calls, the user's own wallet signs them, and no key or allowance is ever
 * granted to the agent. See convex/agentTools.ts.
 */
export type AgentTransactionPlan = {
  chainId: number;
  calls: AgentCall[];
  /** True when every call must land together - the Dolphin Wallet batches natively. */
  atomicRequired: boolean;
  payer: string | null;
  /** The agent's own claims about the outcome. Its words, not Dolphin's. */
  summary: Record<string, string>;
  raw: string;
};

export const agentToolsApi = anyApi as unknown as {
  agentTools: {
    buildAgentTransaction: Action<
      {
        agentKey: string;
        toolName: string;
        toolArguments: Record<string, string | number | boolean | string[]>;
      },
      { agentName: string; toolName: string; plan: AgentTransactionPlan }
    >;
  };
};
