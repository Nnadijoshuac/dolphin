import { anyApi } from "convex/server";

import type {
  Agent,
  AgentCategory,
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
    /** convex/agents.ts -> listAgents */
    listAgents: Query<Record<string, never>, Agent[]>;
    /** convex/agents.ts -> getAgent */
    getAgent: Query<{ reference: string }, Agent | null>;
  };
};

/** One agentLiveStats row - convex/categoryStats.ts's cache table. */
export interface AgentCategoryStatsRow {
  chainId: number;
  tokenId: string;
  category: AgentCategory;
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
      { tokenId: string; category: AgentCategory },
      AgentCategoryStatsRow | null
    >;
    /** convex/categoryStats.ts -> refreshAgentCategoryStats */
    refreshAgentCategoryStats: Action<
      { tokenId: string; category: AgentCategory; agentWallet: string | null },
      unknown
    >;
  };
};

/**
 * convex/agentHires.ts. A hire is a subscription row - no signature, no spend
 * cap, no transaction of its own. `priceModel` must be the agent's ALREADY
 * RESOLVED priceModel.value, or null; passing null makes the mutation reject
 * rather than assume free.
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
        tokenId: string;
        category: AgentCategory;
        walletAddress: string;
        priceModel: AgentPriceModel | null;
        paymentJobId?: string | null;
      },
      string
    >;
    getHiredAgentsForWallet: Query<
      { walletAddress: string },
      {
        tokenId: string;
        category: AgentCategory;
        walletAddress: string;
        status: "active" | "cancelled";
        hiredAt: string;
      }[]
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
  tokenId: string;
  agentName: string;
  category: AgentCategory;
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
        tokenId: string;
        agentName: string;
        category: AgentCategory;
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
    markSessionRevoked: Mutation<{ sessionPublicKey: string }, string | null>;
    getSessionsForAltanaWallet: Query<
      { altanaWalletAddress: string },
      AgentSessionRow[]
    >;
    getActiveSessionForAgent: Query<
      { tokenId: string; altanaWalletAddress: string },
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
  /** The seller's own words about what it will deliver. */
  deliverables: string | null;
  endpoint: string;
  rawResponse: string;
};

export type AgentJobRow = {
  tokenId: string;
  agentName: string;
  category: AgentCategory;
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
      { tokenId: string; taskDescription: string; serviceId?: string },
      AgentQuote
    >;
    notifyJobFunded: Action<
      { tokenId: string; jobId: string },
      { accepted: boolean; detail: string }
    >;
    recordJobPayment: Action<
      {
        tokenId: string;
        category: AgentCategory;
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
      { tokenId: string; altanaWalletAddress: string },
      AgentJobRow[]
    >;
    getJobsForAltanaWallet: Query<{ altanaWalletAddress: string }, AgentJobRow[]>;
  };
};
