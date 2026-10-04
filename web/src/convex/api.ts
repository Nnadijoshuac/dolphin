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
    /** convex/agents.ts -> byOwner. Other live agents from one wallet, capped at 24. */
    byOwner: Query<{ ownerAddress: string; excludeKey?: string }, Agent[]>;
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
/** convex/myAgents.ts - the agents a wallet built, with what each is doing. Session-gated. */
export type MyBuiltAgent = {
  conversationKey: string | null;
  name: string;
  description: string | null;
  updatedAt: number;
  paperMode: boolean;
  published: { hash: string; visibility: "public" | "private"; priceUsd: number | null; network: "bsc" | "bsc-testnet" } | null;
  trading: { status: "active" | "stopped" | "expired"; expiresAt: number; spends: string[] } | null;
  nextRunAt: number | null;
  practiceTrades: number;
  practiceTradesCapped: boolean;
  lastTradeAt: string | null;
};
export const myAgentsApi = anyApi as unknown as {
  myAgents: {
    built: Query<{ sessionToken: string }, MyBuiltAgent[]>;
  };
};

/** convex/setAndQuest.ts - one wallet's progress against the Set and Earn rules. */
export type QuestHire = {
  agentKey: string;
  agentName: string;
  category: string | null;
  onchain: boolean;
  paidFrom: string | null;
  jobStatus: string | null;
  transactionHash: string | null;
  hiredAt: string;
};

export type QuestAgent = {
  name: string;
  hash: string;
  agentKey: string;
  tokenId: string | null;
  chainId: number;
  network: "bsc" | "bsc-testnet";
  category: string;
  categoryLabel: string | null;
  registeredAt: string | null;
  listingStatus: string | null;
  lastLiveAt: string | null;
  otherHirers: number;
  actions: number;
  actionDays: number;
  checks: { registered: boolean; listed: boolean; campaignCategory: boolean; live: boolean; hiredByOthers: boolean; executes: boolean };
  passed: number;
};

export type QuestProgress = {
  wallet: string;
  hire: { hires: QuestHire[]; onchainAgents: number; needed: number; onDolphin: boolean };
  build: { agents: QuestAgent[]; needed: { otherHirers: number; actions: number; actionDays: number }; drafting: boolean };
} | null;

export const setAndQuestApi = anyApi as unknown as {
  setAndQuest: {
    progress: Query<{ wallet: string }, QuestProgress>;
  };
};

/** convex/walletHistory.ts - the Dolphin Wallet's history, read from the chain. */
export type WalletHistoryEntry = {
  hash: string;
  at: number;
  kind: "deposit" | "payment" | "refund" | "swap" | "withdraw" | "setup" | "fee" | "other";
  title: string;
  movements: { direction: "in" | "out"; symbol: string; decimals: number; amountRaw: string }[];
  feeWei: string;
};

export const walletHistoryApi = anyApi as unknown as {
  walletHistory: {
    forWallet: Action<
      { address: string },
      { status: "ok"; entries: WalletHistoryEntry[]; hiddenTokens: number } | { status: "unavailable"; reason: string }
    >;
  };
};

/** convex/chatDeletion.ts - deletes chats from the database; keeps only an anonymous summary. */
export const chatDeletionApi = anyApi as unknown as {
  chatDeletion: {
    deleteConversations: Mutation<{ conversationKeys: string[] }, { started: number }>;
  };
};

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
  /** Set once a refund was verified on-chain (agentPayments.recordJobRefund). */
  refundTransactionHash?: string | null;
  refundedAt?: string | null;
  verifiedAt: string;
  /** What the seller said when told the job was funded (agentPayments.recordSellerReply). */
  sellerReply?: { accepted: boolean; reason: string | null; at: string };
  /** What the seller delivered, fetched from the URL its submit tx names (agentPayments.fetchDeliverable). */
  deliverable?: { url: string; content: string | null; contentType: string | null; submitTx: string | null; fetchedAt: string };
  /** When the verified payment was recorded. verifiedAt moves on every re-read. */
  _creationTime: number;
};

export const agentPaymentsApi = anyApi as unknown as {
  agentPayments: {
    requestQuote: Action<
      { agentKey: string; taskDescription: string; serviceId?: string },
      AgentQuote
    >;
    fetchDeliverable: Action<
      { jobId: string },
      { url: string; content: string | null; contentType: string | null } | null
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
    recordJobRefund: Action<
      { jobId: string; altanaWalletAddress: string; transactionHash: string },
      { jobStatus: string }
    >;
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

/** One side of a trade ticket. Mirrors tradeTokenValidator in convex/schema.ts. */
export type TradeTicketToken = {
  /** Null for native BNB. */
  address: string | null;
  symbol: string;
  decimals: number;
  /** On Dolphin's hand-verified token list (convex/lib/tradeTokens.ts). */
  verified: boolean;
};

/**
 * A trade the chat recognised ("buy 50 U of CAKE"). See convex/trade.ts.
 * There is no price in it on purpose: the ticket quotes PancakeSwap live.
 */
export type TradeTicket = {
  kind: "swap";
  amountIn: string;
  tokenIn: TradeTicketToken;
  tokenOut: TradeTicketToken;
  /** What BNB Chain Token Safety said, attributed and dated. Null when nothing needed checking. */
  safety: {
    agentKey: string;
    agentName: string;
    token: string;
    symbol: string;
    verdict: string | null;
    headline: string | null;
    reason: string | null;
    unavailable: string | null;
    checkedAt: number;
  } | null;
};

export type DolphinMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Set when the question was a trade, or an agent asked to hire another. */
  ticket: TradeTicket | HireTicket | null;
  /** A corrected request (a token typo) to confirm with one tap. Sent as a new turn. */
  suggestedPrompt: string | null;
  status: "thinking" | "consulting" | "complete" | "error";
  /**
   * When this answer was FIRST produced, if it is a replay of an earlier one.
   *
   * Null when a model wrote it this turn. A number means an identical question
   * was answered before and the text was reused rather than spending one of a
   * strictly limited number of free-tier model calls.
   *
   * RENDER THIS TIMESTAMP, not the moment of reuse — see the note on
   * `reusedFrom` in convex/schema.ts. Only tool-free explanations are ever
   * reused, so a reused answer never restates a live reading as current.
   */
  reusedFrom: number | null;
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
      {
        seedAgentKey?: string;
        sessionToken?: string;
        userAddress?: string;
        /** Fixed for the conversation's life. A try-run is opened by agentBuilder.startTry. */
        mode?: "chat" | "build";
      },
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
      {
        conversationKey: string;
        text: string;
        userAddress?: string;
        /** The Dolphin Wallet on this device, so a balance question reads it too. */
        dolphinWalletAddress?: string;
      },
      { messageId: string }
    >;
  };
};

/** One asset a wallet action moved. `token` null is BNB; `amountRaw` null means unknown. */
export type WalletMovement = { token: string | null; symbol: string; decimals: number; amountRaw: string | null };

export type WalletAction = {
  transactionHash: string;
  kind: "trade" | "withdraw" | "agent";
  purpose: "chat" | "hire" | "withdraw" | "agent";
  sent: WalletMovement[];
  received: WalletMovement[];
  counterparty: string | null;
  /** For an agent-built transaction: whose plan was signed. */
  agentKey: string | null;
  agentName: string | null;
  /** The block's time. */
  executedAt: string;
};

/**
 * convex/walletActions.ts. Every trade and withdrawal the Dolphin Wallet
 * makes, recorded from its receipt, never from what the browser says it sent.
 */
export const walletActionsApi = anyApi as unknown as {
  walletActions: {
    record: Action<
      {
        altanaWalletAddress: string;
        transactionHash: string;
        kind: "trade" | "withdraw" | "agent";
        purpose: "chat" | "hire" | "withdraw" | "agent";
        to?: string;
        agentKey?: string;
        agentName?: string;
      },
      { recorded: boolean }
    >;
    forWallet: Query<{ altanaWalletAddress: string }, WalletAction[]>;
  };
};

export type DolphinConversationMode = "chat" | "build" | "try";

/** One tool of a built agent: a read-only tool of a listed MCP agent. */
export type AgentDraftTool = { agentKey: string; agentName: string; toolName: string };

/** Every text field is null until the person and the builder have settled it. */
/** The model a draft thinks with, on its builder's own key. Never the key. */
export type AgentBrain = { provider: BrainProviderId; model: string; keyName: string; baseUrl?: string | null };

/**
 * The providers a Brain can run on. Mirrors BRAIN_PROVIDERS in
 * convex/lib/openrouter.ts, where every endpoint was checked live on
 * 2026-09-28. `example` is a model id shown as a placeholder, not a default.
 */
export const BRAIN_PROVIDER_OPTIONS = [
  { id: "openai", label: "OpenAI", keyName: "OPENAI_API_KEY", example: "gpt-4o-mini" },
  { id: "anthropic", label: "Anthropic", keyName: "ANTHROPIC_API_KEY", example: "claude-sonnet-5" },
  { id: "openrouter", label: "OpenRouter", keyName: "OPENROUTER_API_KEY", example: "openai/gpt-4o-mini" },
  { id: "google", label: "Google Gemini", keyName: "GEMINI_API_KEY", example: "gemini-2.5-flash" },
  { id: "groq", label: "Groq", keyName: "GROQ_API_KEY", example: "llama-3.3-70b-versatile" },
  { id: "deepseek", label: "DeepSeek", keyName: "DEEPSEEK_API_KEY", example: "deepseek-chat" },
  { id: "mistral", label: "Mistral", keyName: "MISTRAL_API_KEY", example: "mistral-large-latest" },
  { id: "xai", label: "xAI", keyName: "XAI_API_KEY", example: "grok-4" },
  { id: "together", label: "Together", keyName: "TOGETHER_API_KEY", example: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
  { id: "fireworks", label: "Fireworks", keyName: "FIREWORKS_API_KEY", example: "accounts/fireworks/models/llama-v3p3-70b-instruct" },
  { id: "custom", label: "Custom endpoint", keyName: "CUSTOM_API_KEY", example: "the model id your endpoint expects" },
] as const;
export type BrainProviderId = (typeof BRAIN_PROVIDER_OPTIONS)[number]["id"];

export function brainProviderLabel(id: string): string {
  return BRAIN_PROVIDER_OPTIONS.find((option) => option.id === id)?.label ?? id;
}

/** A paid A2A hire a flow's agent asked for. The owner confirms the payment. Mirrors schema.ts. */
export type HireTicket = {
  kind: "hire";
  agentKey: string;
  agentName: string;
  task: string;
  /** What the agent quoted when asked. Re-quoted before paying. */
  priceText: string | null;
};

/** A toolbox block. Mirrors AgentBlock in convex/lib/agentBlocks.ts. */
export type AgentBlockData =
  | { id: string; type: "market"; config: { tokenAddress: string; symbol: string; name: string; poolAddress: string | null } }
  | { id: string; type: "safety"; config: Record<string, never> }
  | { id: string; type: "swap"; config: Record<string, never> }
  | { id: string; type: "risk"; config: { maxTradeUsd: number; maxTradesPerDay: number } }
  | { id: string; type: "schedule"; config: { everyMinutes: number } }
  | { id: string; type: "price"; config: { direction: "above" | "below"; priceUsd: number } }
  | { id: string; type: "walletWatch"; config: { addresses: string[]; label: string | null } }
  | { id: string; type: "hire"; config: { agentKey: string; agentName: string } }
  | { id: string; type: "memory"; config: { url: string | null; keyName: string | null } }
  | { id: string; type: "indicators"; config: { timeframe: "1h" | "4h" | "1d" } }
  | { id: string; type: "signal"; config: { condition: SignalCondition; level: number | null; timeframe: "1h" | "4h" | "1d" } }
  | { id: string; type: "dataSource"; config: SourceAuth & { label: string; url: string } }
  | { id: string; type: "news"; config: SourceAuth & { url: string; keywords: string[] } }
  | { id: string; type: "quietHours"; config: { events: { label: string; at: string }[]; marginHours: number } }
  /** Where trading rules trade for real once the agent runs on the builder's own server. No key is ever here. */
  | {
      id: string;
      type: "binance";
      config: {
        account: "wallet" | "exchange";
        futures: boolean;
        maxLeverage: number;
        /** Binance's testnet (pretend funds) or live. Testnet unless chosen (convex/lib/agentBlocks.ts). */
        network?: "testnet" | "live";
        /** Names of the builder's saved Keys-tab entries - never the key itself. */
        keyName?: string | null;
        secretName?: string | null;
      };
    };

/** convex/lib/binanceTrade.ts ConnectionReport. */
export type BinanceConnection = {
  ok: boolean;
  network: "testnet" | "live";
  spotUsdt: number | null;
  futuresUsdt: number | null;
  canTradeSpot: boolean | null;
  canTradeFutures: boolean | null;
  canWithdraw: boolean | null;
  problem: string | null;
};

/** How a builder's data source takes its key (convex/lib/analyticalBlocks.ts). */
export type SourceAuth = { authMode: "none" | "bearer" | "header" | "query"; authParam: string | null; keyName: string | null };

/** What a Signal waits for. Mirrors SIGNAL_CONDITIONS in convex/lib/indicators.ts. */
export type SignalCondition = "rsiBelow" | "rsiAbove" | "maCrossUp" | "maCrossDown" | "macdCrossUp" | "macdCrossDown";
export const SIGNAL_OPTIONS: { value: SignalCondition; label: string }[] = [
  { value: "rsiBelow", label: "RSI falls below a level" },
  { value: "rsiAbove", label: "RSI rises above a level" },
  { value: "maCrossUp", label: "20 crosses above 50 (golden cross)" },
  { value: "maCrossDown", label: "20 crosses below 50 (death cross)" },
  { value: "macdCrossUp", label: "MACD crosses above its signal" },
  { value: "macdCrossDown", label: "MACD crosses below its signal" },
];

export type AgentDraftData = {
  name: string | null;
  description: string | null;
  instructions: string | null;
  tools: AgentDraftTool[];
  brain: AgentBrain | null;
  blocks: AgentBlockData[];
  /** Canvas connections the builder cut. */
  detached: string[];
  autopilot: { on: boolean; conversationKey: string } | null;
  /** Who it is for (see purpose in convex/schema.ts). Null until chosen. */
  purpose: AgentPurpose | null;
  hirePriceUsd: number | null;
  /** Absent or true: paper trading. */
  paperMode?: boolean;
  /** Switched-on document tools and trading rules, for the readiness check (convex/agentBuilder.ts getDraft). */
  knowledgeToolCount?: number;
  ruleCount?: number;
  updatedAt: number;
};

/** "Just for me", "others can use its tools", "others can hire it". */
export type AgentPurpose = "private" | "tools" | "hire";

/** One agent trade key as the panel sees it. Never key material. */
export type TradeKeySummary = {
  /** Allowances the grant set; a revoke zeroes them. */
  approvalTokens: string[];
  keyId: string;
  expiry: number;
  durationDays: number;
  sessionPublicKey: string;
  altanaWalletAddress: string;
  grantedAt: string | null;
  revokedAt: string | null;
};

/** convex/autotrade.ts - no-tap trading with a scoped session key. */
/** convex/agentMemoryCheck.ts - one recall against the builder's own memory server. */
export const agentMemoryApi = anyApi as unknown as {
  agentMemoryCheck: {
    test: Action<{ sessionToken: string; url: string; keyName: string | null }, { ok: boolean; text: string }>;
  };
};

export type PaperHolding = { symbol: string; address: string | null; decimals: number; amount: string };

/** convex/paperTrading.ts - pretend money, real prices. */
export const paperTradingApi = anyApi as unknown as {
  paperTrading: {
    forDraft: Query<
      { conversationKey: string },
      {
        paperMode: boolean;
        liveAcknowledged: boolean;
        startUsd: number;
        holdings: PaperHolding[];
        trades: { at: string; sellSymbol: string; sellAmount: string; buySymbol: string; buyAmount: string; route: string; gasBnb: string }[];
      } | null
    >;
    setMode: Mutation<{ conversationKey: string; paperMode: boolean; acknowledge?: boolean }, null>;
    reset: Mutation<{ conversationKey: string }, null>;
    valuation: Action<{ conversationKey: string }, { valueUsd: number | null; startUsd: number; checkedAt: number } | null>;
  };
};

export const autotradeApi = anyApi as unknown as {
  autotrade: {
    prepare: Action<
      { sessionToken: string; conversationKey: string; altanaWalletAddress: string; durationDays: number },
      {
        keyId: string;
        sessionPublicKey: string;
        sessionAddress: string;
        permissionsJson: string;
        expiry: number;
        dailyUsd: number;
        approvals: { token: string; spender: string; amount: string; symbol: string }[];
        worstCaseUsdPerToken: number;
      }
    >;
    confirmGrant: Mutation<{ sessionToken: string; keyId: string; transactionHash: string | null }, null>;
    stop: Mutation<
      { sessionToken: string; conversationKey: string },
      { keyId: string; sessionPublicKey: string; altanaWalletAddress: string }[]
    >;
    markRevoked: Mutation<{ sessionToken: string; keyId: string }, null>;
    forDraft: Query<
      { conversationKey: string },
      | null
      | { status: "none"; unrevoked: TradeKeySummary[] }
      | (TradeKeySummary & { status: "active" | "stopped" | "expired" | "pending"; unrevoked: TradeKeySummary[] })
    >;
  };
};

/** convex/autopilot.ts - arm or disarm a draft's triggers. */
export const autopilotApi = anyApi as unknown as {
  autopilot: {
    setAutopilot: Mutation<
      { conversationKey: string; sessionToken: string; on: boolean },
      { on: boolean; triggers: number; conversationKey?: string }
    >;
  };
};

/**
 * convex/agentBuilder.ts. Build mode of /dolphin: draft an agent in chat, then
 * try it privately. Nothing here is on-chain. Progress arrives the same way as
 * the chat's, through dolphin.getConversation; the draft through getDraft.
 */
export const agentBuilderApi = anyApi as unknown as {
  agentBuilder: {
    getDraft: Query<
      { conversationKey: string },
      {
        mode: DolphinConversationMode;
        /** The build conversation's own draft, or for a try-run the one under test. */
        draft: AgentDraftData | null;
        /** Where "back to the draft" goes. Null for a chat. */
        buildConversationKey: string | null;
      } | null
    >;
    /** Refused until the draft has a name, description, instructions and a tool. */
    startTry: Mutation<
      { buildConversationKey: string; sessionToken?: string; userAddress?: string },
      { conversationKey: string }
    >;
    ask: Action<
      { conversationKey: string; text: string; userAddress?: string },
      { messageId: string }
    >;
    tryAsk: Action<
      { conversationKey: string; text: string; userAddress?: string },
      { messageId: string }
    >;
    /** Read-only tools of live MCP agents, for the canvas's tool picker. */
    toolPalette: Query<
      { search?: string },
      {
        agentKey: string;
        agentName: string;
        tools: { name: string; description: string | null }[];
      }[]
    >;
    /** A person's own edit from the canvas. Validated by the same rules as the builder's. */
    updateDraft: Mutation<
      {
        conversationKey: string;
        name?: string;
        description?: string;
        instructions?: string;
        tools?: { agentKey: string; toolName: string }[];
        brain?: AgentBrain | null;
        sessionToken?: string;
        blocks?: AgentBlockData[];
        detached?: string[];
        purpose?: AgentPurpose;
        hirePriceUsd?: number | null;
      },
      { gaps: string[] }
    >;
  };
};

/** One Discover shelf, agents resolved and live-only. See convex/lib/shelves.ts. */
export type AgentShelfData = {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  agents: Agent[];
};

/** convex/shelves.ts - Discover's store-front rows. */
export const shelvesApi = anyApi as unknown as {
  shelves: {
    list: Query<Record<string, never>, { shelves: AgentShelfData[]; updatedAt: string | null }>;
  };
};

/** Mirrors ENGAGEMENT_KINDS in convex/engagement.ts. */
export type EngagementKind =
  | "impression"
  | "open"
  | "view"
  | "toolPreview"
  | "hireStart"
  | "hireCompletion"
  | "hireFailure";

export type EngagementCounters = {
  impressions: number;
  opens: number;
  views: number;
  toolPreviews: number;
  hireStarts: number;
  hireCompletions: number;
  hireFailures: number;
};

/** convex/engagement.ts - the anonymous per-agent funnel. */
export const engagementApi = anyApi as unknown as {
  engagement: {
    record: Mutation<
      { events: { agentKey: string; kind: EngagementKind }[] },
      { accepted: number }
    >;
    summary: Query<
      { days?: number },
      {
        days: number;
        since: string;
        overall: EngagementCounters;
        agents: ({ agentKey: string } & EngagementCounters)[];
        truncated: boolean;
      }
    >;
  };
};

/** convex/envVars.ts - a wallet's encrypted API keys. No function returns a value. */
export const envVarsApi = anyApi as unknown as {
  envVars: {
    list: Query<{ sessionToken: string | null }, { name: string; last4: string; updatedAt: string }[]>;
    set: Action<{ sessionToken: string; name: string; value: string }, { name: string; last4: string }>;
    remove: Mutation<{ sessionToken: string; name: string }, null>;
  };
};

/** convex/brainModels.ts - which provider a saved key is for, and its models. Never returns the key. */
export const brainModelsApi = anyApi as unknown as {
  brainModels: {
    detect: Action<
      { sessionToken: string; keyName: string; provider?: string },
      { provider: BrainProviderId | null; label: string | null; models: string[]; note: string | null }
    >;
  };
};

/** convex/favorites.ts - agents a signed-in wallet starred. */
export const favoritesApi = anyApi as unknown as {
  favorites: {
    set: Mutation<
      { sessionToken: string; agentKey: string; favorite: boolean },
      { favorite: boolean }
    >;
    mine: Query<
      { sessionToken: string | null },
      { agentKeys: string[]; agents: Agent[] }
    >;
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

/**
 * convex/healthAlerts.ts. Liquidation alerts - the one path by which Dolphin
 * can reach a person.
 *
 * `alertsAvailable` is checked BEFORE the form is offered. A deployment with
 * no RESEND_API_KEY accepting a subscription would be promising a delivery it
 * cannot perform, which is the same fault as a metric that reads "syncing"
 * forever. See the note on the healthAlerts table in convex/schema.ts.
 */
/**
 * convex/census.ts. The discovery funnel, as four integers.
 *
 * Deliberately NOT `adminApi.getOverview`, which would drag a hundred agent
 * documents and the whole verification matrix onto a landing page to render
 * three numbers — and which is an ungated query whose exposure should stay
 * accidental rather than become a dependency.
 */
export const censusApi = anyApi as unknown as {
  census: {
    funnel: Query<
      Record<string, never>,
      {
        assessed: number;
        candidates: number;
        live: number;
        publishers: number;
        lastRunAt: string | null;
      }
    >;
  };
};

export const healthAlertsApi = anyApi as unknown as {
  healthAlerts: {
    /** Whether this deployment can send at all. Gate the form on it. */
    alertsAvailable: Query<Record<string, never>, boolean>;
    getAlertForWallet: Query<
      { sessionToken: string },
      {
        email: string;
        threshold: number;
        active: boolean;
        lastHealthFactor: number | null;
        lastCheckedAt: number | null;
        lastNotifiedAt: number | null;
      } | null
    >;
    /**
     * The address is taken from the session, never from an argument. An alert
     * creatable against someone else's address would be a way to mail a
     * stranger about their own loan.
     */
    subscribe: Mutation<
      { sessionToken: string; email: string; threshold: number },
      { ok: boolean; reason: string | null }
    >;
    unsubscribe: Mutation<{ sessionToken: string }, { ok: boolean }>;
    /** Stops the mail from the mail itself, with no sign-in. */
    unsubscribeByToken: Mutation<{ token: string }, { ok: boolean }>;
  };
};

/**
 * convex/agentTrials.ts. Running an agent before committing to anything.
 *
 * One click, no wallet, no signature, no payment — the agent's own output on
 * its listing. Fenced four ways (zero-argument tools only, no write tools,
 * cached per tool, globally capped); the reasoning is in the module header and
 * in the `agentToolTrials` note in convex/schema.ts.
 *
 * `resultText` is A STRANGER'S PROSE. Render it attributed to the agent, never
 * as Dolphin's own statement — mcpClient.ts's header has the precedent where a
 * `collectFees` tool reported success having collected nothing.
 */
export type AgentTrialOutcome = {
  agentName: string;
  toolName: string;
  resultText: string;
  /** The agent answered and said the call failed. Still an answer. */
  isError: boolean;
  /** The call could not be made at all, which is a different fact. */
  transportError: string | null;
  latencyMs: number;
  calledAt: number;
  /** Served from Dolphin's cache. Say so; never imply it is live. */
  cached: boolean;
};

export const agentTrialsApi = anyApi as unknown as {
  agentTrials: {
    /** The last thing this tool said, or null if nothing has run it. */
    lastTrial: Query<
      { agentKey: string; toolName: string },
      {
        resultText: string;
        isError: boolean;
        transportError: string | null;
        latencyMs: number;
        calledAt: number;
      } | null
    >;
    tryAgentTool: Action<
      { agentKey: string; toolName: string },
      AgentTrialOutcome
    >;
  };
};

/** A built agent as the public sees it. See convex/builtAgents.ts publicView. */
export type BuiltAgentPublic = {
  hash: string;
  name: string;
  description: string;
  category: string;
  tools: AgentDraftTool[];
  links: { website: string | null; x: string | null; email: string | null };
  ownerAddress: string;
  network: "bsc" | "bsc-testnet";
  networkLabel: string;
  chainId: number;
  registry: string;
  status: "awaiting-signature" | "registered" | "unpublished";
  tokenId: string | null;
  agentKey: string | null;
  registeredAt: string | null;
  iconUrl: string | null;
  registrationUrl: string;
  mcpUrl: string;
  /** How it is called (2026-10-02): "mcp" tool server or "a2a" agent. */
  protocol: "mcp" | "a2a";
  /** The MCP server, or the A2A agent card. */
  endpointUrl: string;
  /** Price per call in U base units, paid with x402; null is free. */
  priceRaw: string | null;
  priceDisplay: string | null;
  /** Its documents' tools as published, each with its own price (knowledge, step 3); null for other agents. */
  knowledgeTools: { name: string; description: string; priceU: string | null }[] | null;
  /** Whether any call costs U - its single price or any priced knowledge tool. */
  paid: boolean;
  pageUrl: string;
  registerTxUrl: string | null;
  /** The owner's latest confirmed setAgentURI, if any. */
  uriUpdatedAt: string | null;
  uriTxUrl: string | null;
};

/**
 * convex/builtAgents.ts and convex/iconProcessing.ts. Putting a built agent
 * on ERC-8004: icon, checks, the owner's own registration, then confirmation
 * against the chain.
 */
export const builtAgentsApi = anyApi as unknown as {
  builtAgents: {
    iconUploadUrl: Mutation<{ sessionToken: string }, { uploadUrl: string }>;
    prepareListing: Mutation<
      {
        sessionToken: string;
        buildConversationKey: string;
        network: "bsc" | "bsc-testnet";
        iconStorageId: string;
        category: string;
        website?: string;
        x?: string;
        email?: string;
        /** Where its payments go; defaults to the signed-in wallet. */
        payoutAddress?: string;
        /** Make public (anyone can use it) or just for me (registered to your wallet, never listed). */
        visibility?: "public" | "private";
        /** Price per job for a public agent; absent means free. */
        priceUsd?: number | null;
        protocol?: "mcp" | "a2a";
        /** Decimal U per call, e.g. "0.01". */
        priceU?: string | null;
        /** What a buyer gives it; defaults from its blocks. */
        inputs?: Array<"wallet" | "token">;
      },
      { hash: string; tokenURI: string; registry: string; chainId: number; pageUrl: string }
    >;
    confirmRegistration: Action<
      { sessionToken: string; hash: string; transactionHash: string },
      { tokenId: string; agentKey: string }
    >;
    unpublish: Mutation<{ sessionToken: string; hash: string }, null>;
    publicByHash: Query<{ hash: string }, BuiltAgentPublic | null>;
    /** The Hire form's fields for a catalog agent built on Dolphin; null for other agents. */
    inputsForAgentKey: Query<{ agentKey: string }, Array<"wallet" | "token"> | null>;
    forOwner: Query<{ ownerAddress: string }, BuiltAgentPublic[]>;
    forDraft: Query<{ buildConversationKey: string }, BuiltAgentPublic[]>;
  };
  builtAgentMoves: {
    /** The owner repointed their token; the server checks the chain before recording it. */
    confirmUriUpdate: Action<
      { sessionToken: string; hash: string; transactionHash: string },
      { tokenURI: string }
    >;
  };
  iconProcessing: {
    process: Action<
      { sessionToken: string; storageId: string },
      { iconId: string; url: string | null; contentType: string }
    >;
  };
};

/** Each built agent's own wallet (convex/x402.ts, 2026-10-02). It holds gas money only. */
export const x402Api = anyApi as unknown as {
  x402: {
    agentWallet: Query<{ hash: string }, { address: string } | null>;
    createAgentWallet: Action<{ sessionToken: string; hash: string }, { address: string }>;
    /** Before register(): a paid agent's own wallet, so its registration file names it from the start. */
    prepareAgentWallet: Action<{ sessionToken: string; hash: string }, { address: string }>;
    /** Sends the agent wallet's BNB back to the agent's owner - the only destination there is. */
    withdrawAgentGas: Action<{ sessionToken: string; hash: string }, { transactionHash: string; sentWei: string }>;
  };
  erc8183Seller: {
    /** The agent wallet's consent for the owner's registry.setAgentWallet. */
    walletLinkProof: Action<
      { sessionToken: string; hash: string },
      { agentWallet: string; tokenId: string; deadline: string; signature: string; registry: string }
    >;
    jobsForAgent: Query<
      { hash: string },
      Array<{
        jobId: string;
        status: "accepted" | "submitted" | "settled" | "forwarded" | "failed";
        budgetRaw: string;
        detail: string | null;
        submitTx: string | null;
        forwardTx: string | null;
        createdAt: number;
      }>
    >;
  };
};

/** Mirrors BUILT_AGENT_CATEGORIES in convex/builtAgents.ts. */
export const BUILT_AGENT_CATEGORIES = [
  { value: "trading", label: "Trading" },
  { value: "yield", label: "Yield" },
  { value: "health-factor", label: "Lending health" },
  { value: "rebalancing", label: "Liquidity" },
  { value: "security", label: "Security" },
  { value: "monitoring", label: "Monitoring" },
  { value: "payments", label: "Payments" },
  { value: "general", label: "General" },
] as const;

/** A draft's documents (convex/knowledge.ts, convex/knowledgeIngest.ts): knowledge, step 1. */
export type KnowledgeDocument = {
  id: string;
  name: string;
  kind: "markdown" | "text" | "pdf";
  textChars: number;
  storedBytes: number;
  sections: { title: string; slug: string; chars: number }[];
  flags: { reason: string; excerpt: string }[];
};

/** A tool a knowledge agent offers buyers (convex/lib/knowledgeTools.ts). */
export type KnowledgeTool = {
  name: string;
  kind: "list" | "get" | "get_any" | "search" | "ask" | "described";
  description: string;
  section: { documentId: string; slug: string } | null;
  /** A described tool (step 5): its text inputs and instructions. */
  inputs?: { name: string; description: string }[];
  instructions?: string;
  /** Price per call in U ("0.01"); null is free. */
  priceU: string | null;
  enabled: boolean;
  edited?: boolean;
};

export const knowledgeApi = anyApi as unknown as {
  knowledge: {
    documents: Query<{ conversationKey: string }, KnowledgeDocument[]>;
    removeDocument: Mutation<{ conversationKey: string; documentId: string }, null>;
    /** The browser reads the file; only its text is sent. */
    addDocument: Action<
      { conversationKey: string; fileName: string; kind: "markdown" | "text" | "pdf"; text: string },
      { name: string; textChars: number; storedBytes: number; sections: string[]; flags: { reason: string; excerpt: string }[] }
    >;
    tools: Query<{ conversationKey: string }, { tools: KnowledgeTool[]; hasBrain: boolean }>;
    setTool: Mutation<{ conversationKey: string; name: string; price?: string; enabled?: boolean; description?: string }, null>;
    removeTool: Mutation<{ conversationKey: string; name: string }, null>;
  };
};

/** A trading rule as the draft panel shows it (convex/strategy.ts forConversation). */
export type TradingRuleView = {
  id: string;
  /** Copied from a trading setup: its conditions stay on Dolphin's servers; `words` and reasons leave them out. */
  locked: boolean;
  words: string;
  venue: "dolphin-wallet" | "binance-wallet" | "binance-spot" | "binance-futures";
  market: string;
  action: "buy" | "short";
  sizeUsd: number;
  leverage: number;
  stopLossPct: number | null;
  takeProfitPct: number | null;
  warnings: string[];
  position: { side: "long" | "short"; entryPrice: number; openedAt: number } | null;
  lastCheckedAt: number | null;
  lastError: string | null;
  /** What the last check saw and decided, with its values. Null before the first check. */
  lastReason: string | null;
  /** How long after the candle closed that check ran, in ms. */
  lastLagMs: number | null;
  /** Paused by the owner: no new entries; an open position still closes by its exits. */
  paused: boolean;
  /** Entries a UTC day at most: with sizeUsd, what its trade key is limited to. */
  maxTradesPerDay: number;
  /** The amount a real position holds (e.g. BNB), or null on paper or when flat. */
  heldQty: string | null;
  timeframe: string;
};

/** A strategy template for the picker (convex/lib/ruleTemplates.ts). */
export type RuleTemplateView = { id: string; name: string; idea: string; timeframe: string; stopLossPct: number; takeProfitPct: number };

/** A candle for the rule chart: open time in ms. */
/** `v`: traded value in USDT, when Binance gave it. */
export type ChartCandle = { t: number; o: number; h: number; l: number; c: number; v?: number };

/** convex/lib/strategy.ts SimResult. */
export type RuleBacktest = {
  trades: { kind: "enter" | "exit"; side: "long" | "short"; time: number; price: number; reason: string; pnlPct?: number; pnlUsd?: number }[];
  equity: { time: number; usd: number }[];
  totalUsd: number;
  returnPct: number;
  wins: number;
  losses: number;
  maxDrawdownUsd: number;
  feesUsd: number;
  buyHoldPct: number;
  open: { side: "long" | "short"; entryPrice: number; time: number } | null;
};

export type TradingRuleTrade = {
  _id: string;
  ruleId: string;
  ruleName: string;
  market: string;
  side: "long" | "short";
  kind: "enter" | "exit";
  price: number;
  sizeUsd: number;
  leverage: number;
  paper: boolean;
  pnlPct: number | null;
  reason: string;
  /** The judged candle's open time, ms. */
  candleTime: number;
  at: number;
  /** "runner": reported by the builder's own server (phase 4); absent or "dolphin": Dolphin's paper run. */
  source?: "dolphin" | "runner";
  /** A real order's network; absent on paper. */
  network?: "testnet" | "live" | "bsc";
  orderId?: string;
  latencyMs?: number | null;
};

export const strategyApi = anyApi as unknown as {
  strategy: {
    forConversation: Query<
      { conversationKey: string },
      { rules: TradingRuleView[]; trades: TradingRuleTrade[]; running: boolean; dailyLossLimitUsd: number | null; lossTodayUsd: number }
    >;
    setDailyLossLimit: Mutation<{ conversationKey: string; usd: number | null }, null>;
    /** The rule replayed over Binance's history by the live engine's own decisions. */
    backtestRule: Action<
      { conversationKey: string; ruleId: string },
      { candles: ChartCandle[]; result: RuleBacktest; feeBps: number; market: string; timeframe: string } | { error: string }
    >;
    /** A market's recent closed candles (the chart then streams the rest live). */
    marketCandles: Action<{ venue: string; market: string; timeframe: string; limit?: number }, ChartCandle[] | { error: string }>;
    /** Checks the Binance block's saved key against Binance (its balance, and on live that it cannot withdraw). */
    checkBinance: Action<{ sessionToken: string; conversationKey: string }, BinanceConnection | { error: string }>;
    updateRule: Mutation<{ conversationKey: string; ruleId: string; sizeUsd?: number; leverage?: number; stopLossPct?: number | null }, { warnings: string[] }>;
    removeRule: Mutation<{ conversationKey: string; ruleId: string }, null>;
    setRulePaused: Mutation<{ conversationKey: string; ruleId: string; paused: boolean }, null>;
    templates: Query<Record<string, never>, RuleTemplateView[]>;
    addTemplate: Mutation<
      { conversationKey: string; templateId: string; market: string; venue: "dolphin-wallet" | "binance-spot"; sizeUsd: number },
      { added: string[]; problems: string[]; warnings: string[] }
    >;
    /** agent.json for the runner: the rules and a fresh report token (the old one stops working). */
    exportForRunner: Mutation<{ conversationKey: string }, { version: number; agent: { name: string }; rules: unknown[]; report: { url: string; token: string } }>;
  };
};

/** One rule of a listed trading setup, as anyone may see it: no conditions (convex/setups.ts publicRule). */
export type SetupRule = {
  words: string;
  market: string;
  timeframe: string;
  venue: TradingRuleView["venue"];
  action: "buy" | "short";
  sizeUsd: number;
  leverage: number;
  stopLossPct: number | null;
  takeProfitPct: number | null;
  maxTradesPerDay: number;
};

/** Dolphin's own backtest of a listed rule, run when it was listed. */
export type SetupRuleStats =
  | { market: string; timeframe: string; error: string }
  | { market: string; timeframe: string; from: number; to: number; resultPct: number; holdPct: number; trades: number; winPct: number | null; worstDropUsd: number; sizeUsd: number };

export type SetupCard = {
  id: string;
  title: string;
  summary: string;
  seller: string;
  rules: SetupRule[];
  stats: { at: number; rules: SetupRuleStats[] } | null;
  copies: number;
  listedAt: number;
};

export const setupsApi = anyApi as unknown as {
  setups: {
    list: Query<Record<string, never>, SetupCard[]>;
    get: Query<{ listingId: string }, (SetupCard & { sinceListed: { trades: number; closed: number; won: number; real: number; sumPct: number } }) | null>;
    mine: Query<{ sessionToken: string }, SetupCard[]>;
    publish: Mutation<{ sessionToken: string; conversationKey: string; title: string; summary: string }, string>;
    withdraw: Mutation<{ sessionToken: string; listingId: string }, null>;
    copy: Mutation<{ sessionToken: string; listingId: string }, { conversationKey: string }>;
  };
};
