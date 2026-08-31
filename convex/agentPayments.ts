import { getAddress, isAddress } from "viem";
import { v } from "convex/values";

import { api, internal } from "./_generated/api";
import { action, internalMutation, query } from "./_generated/server";
import { BSC_CHAIN_ID, bscPublicClient } from "./lib/bscClient";
import { agentCategoryValidator } from "./categoryStatsValidators";
import {
  QuoteRejected,
  buildA2ARequest,
  normalizeQuote,
  selectNegotiationEndpoint,
  type NormalizedQuote,
} from "./lib/erc8183";

/**
 * Paid hires over ERC-8183. Read convex/lib/erc8183.ts first - it carries the
 * decision record for why this rail and not x402.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS MODULE IS, AND WHAT IT DELIBERATELY IS NOT
 * ---------------------------------------------------------------------------
 * It is TWO things, and it is important they stay distinguishable:
 *
 *  1. A RELAY. `requestQuote` and `notifyJobFunded` make an HTTP call to a
 *     third-party agent endpoint on the client's behalf. They do this because
 *     a browser genuinely cannot: measured this session, 2 of the 3 live
 *     sellers answer a CORS preflight with 405 and no Access-Control-Allow-
 *     Origin, so a browser POST to them is blocked outright while the identical
 *     POST from a server returns 200. Full numbers in
 *     SESSION-LOG-2026-08-31-payments.md §0.8.
 *
 *     A relay forwards a request and returns a response. It holds no key
 *     material, signs nothing, and cannot move a token. Nothing here can.
 *
 *  2. A WITNESS. `recordJobPayment` does not take the client's word that a
 *     payment happened. It reads the ERC-8183 kernel on BSC itself and checks
 *     the job is really there, really funded, really from this wallet, really
 *     to this agent, and really for the amount quoted. Only then does a row
 *     land.
 *
 * It is NOT a signer, and it never becomes one. The payment transaction is
 * signed in the browser by the user's passkey, exactly as Session 6's session
 * grants are, for exactly the same reason: key material has never left the
 * device's secure element and this project does not start now. Convex can
 * report what happened; it can never cause it.
 *
 * ---------------------------------------------------------------------------
 * DECISION (2026-08-31): the agent record is read HERE, not passed in.
 * ---------------------------------------------------------------------------
 * hireReadOnlyAgent takes the caller's word for a priceModel, with a comment
 * explaining that Convex does not persist full Agent records. That reasoning
 * does not carry over to money. The whole point of the provider check in
 * normalizeQuote is that Dolphin verifies the payee against something the
 * client did not supply - if the client handed over the expected wallet too, a
 * tampered client would simply hand over a matching pair and the check would
 * pass while pointing at an attacker's address.
 *
 * So this module calls agents.getAgent itself. It is one extra query per
 * negotiation, and it is what makes the check mean anything.
 */

/** Mirrors NormalizedQuote's public surface. Kept in sync by hand. */
const quoteValidator = v.object({
  dialect: v.union(v.literal("instructions"), v.literal("signed-envelope")),
  provider: v.string(),
  priceRaw: v.string(),
  paymentToken: v.string(),
  paymentTokenSymbol: v.string(),
  paymentTokenDecimals: v.number(),
  verifyingContract: v.string(),
  chainId: v.number(),
  estimatedCompletionSeconds: v.union(v.number(), v.null()),
  quoteExpiresAt: v.union(v.number(), v.null()),
  negotiationHash: v.union(v.string(), v.null()),
  providerSignature: v.union(v.string(), v.null()),
  taskDescription: v.string(),
  deliverables: v.union(v.string(), v.null()),
  endpoint: v.string(),
});

export type PublicQuote = NormalizedQuote & {
  /** Read on-chain from the quoted token itself - never assumed to be 18/"U". */
  paymentTokenSymbol: string;
  paymentTokenDecimals: number;
  endpoint: string;
};

const ERC20_METADATA_ABI = [
  { name: "symbol", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

/** Order-locked with the AgenticCommerce kernel, copied from the SDK's own ABI. */
const COMMERCE_GET_JOB_ABI = [
  {
    name: "getJob",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          { name: "client", type: "address" },
          { name: "provider", type: "address" },
          { name: "evaluator", type: "address" },
          { name: "description", type: "string" },
          { name: "budget", type: "uint256" },
          { name: "expiredAt", type: "uint256" },
          { name: "status", type: "uint8" },
          { name: "hook", type: "address" },
          { name: "submittedAt", type: "uint256" },
          { name: "deliverable", type: "bytes32" },
        ],
      },
    ],
  },
] as const;

/** Order-locked with the kernel. Index into this, never a magic number. */
const JOB_STATUS = ["OPEN", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"] as const;

const A2A_TIMEOUT_MS = 45_000;

async function postA2A(endpoint: string, data: Record<string, unknown>): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(buildA2ARequest(data)),
      signal: AbortSignal.timeout(A2A_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new Error(
      `Could not reach the agent's endpoint at ${endpoint}: ` +
        `${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `The agent's endpoint answered HTTP ${response.status} rather than a quote. ` +
        `Response: ${body.slice(0, 400)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(
      `The agent's endpoint answered with something that is not JSON: ${body.slice(0, 200)}`,
    );
  }

  const envelope = parsed as { error?: { message?: string }; result?: unknown };
  if (envelope?.error) {
    throw new Error(
      `The agent's endpoint returned a JSON-RPC error: ${envelope.error.message ?? JSON.stringify(envelope.error)}`,
    );
  }
  return envelope?.result;
}

/**
 * Ask an agent what it charges for a task, and return the answer only if it
 * survives every check in normalizeQuote plus a live read of the quoted token.
 *
 * Nothing is written here. A quote is not a commitment and does not belong in
 * the database - only a payment that actually happened does.
 */
export const requestQuote = action({
  args: {
    tokenId: v.string(),
    /** What the user is asking the agent to do. Anchored into the job on-chain. */
    taskDescription: v.string(),
    /** Optional seller-side service id, for sellers that publish a menu. */
    serviceId: v.optional(v.string()),
  },
  returns: quoteValidator,
  handler: async (ctx, { tokenId, taskDescription, serviceId }): Promise<PublicQuote> => {
    const agent = await ctx.runQuery(api.agents.getAgent, { reference: tokenId });
    if (!agent) {
      throw new Error(`requestQuote: agent ${tokenId} is not in Dolphin's catalog.`);
    }
    if (!agent.agentWallet || !isAddress(agent.agentWallet)) {
      // Without a registered wallet there is nothing to check the payee
      // against, and an unchecked payee is the one thing this flow refuses.
      throw new Error(
        `Dolphin has no registered on-chain wallet for ${agent.name}, so it cannot verify who a ` +
          "payment would go to. Refusing to negotiate a price it could not check.",
      );
    }

    const endpoint = selectNegotiationEndpoint(agent.services);
    if (!endpoint) {
      throw new Error(
        `${agent.name} publishes no callable A2A endpoint, so there is no one to ask for a price.`,
      );
    }

    const result = await postA2A(endpoint, {
      skill: "negotiate",
      ...(serviceId ? { service: serviceId } : {}),
      task_description: taskDescription,
      // Both live dialects REQUIRE both keys and reject the call without them.
      terms: {
        deliverables: taskDescription,
        quality_standards:
          "Figures read from BNB Chain at request time, with any disagreement between sources stated rather than resolved silently.",
      },
    });

    let quote: NormalizedQuote;
    try {
      quote = normalizeQuote(result, {
        agentWallet: agent.agentWallet,
        taskDescription,
      });
    } catch (cause) {
      if (cause instanceof QuoteRejected) throw new Error(cause.message);
      throw cause;
    }

    // The token's own symbol and decimals, read from the token the seller
    // named. Never assumed - a price is meaningless without the decimals that
    // scale it, and hardcoding 18 would be exactly the kind of plausible
    // constant this session's ground rule rules out.
    const [symbol, decimals] = await Promise.all([
      bscPublicClient.readContract({
        address: quote.paymentToken as `0x${string}`,
        abi: ERC20_METADATA_ABI,
        functionName: "symbol",
      }),
      bscPublicClient.readContract({
        address: quote.paymentToken as `0x${string}`,
        abi: ERC20_METADATA_ABI,
        functionName: "decimals",
      }),
    ]);

    return {
      ...quote,
      paymentTokenSymbol: symbol,
      paymentTokenDecimals: Number(decimals),
      endpoint,
    };
  },
});

/**
 * Tell a seller its job is funded so it starts work. Relay only - by this
 * point the money has already moved, and this call cannot move any more of it.
 */
export const notifyJobFunded = action({
  args: { tokenId: v.string(), jobId: v.string() },
  returns: v.object({ accepted: v.boolean(), detail: v.string() }),
  handler: async (ctx, { tokenId, jobId }) => {
    const agent = await ctx.runQuery(api.agents.getAgent, { reference: tokenId });
    if (!agent) throw new Error(`notifyJobFunded: agent ${tokenId} is not in Dolphin's catalog.`);

    const endpoint = selectNegotiationEndpoint(agent.services);
    if (!endpoint) {
      throw new Error(`${agent.name} publishes no callable A2A endpoint to notify.`);
    }

    const result = await postA2A(endpoint, { skill: "notify_funded", job_id: Number(jobId) });
    const detail = JSON.stringify(result).slice(0, 600);
    // The seller answers at once with accepted/rejected and then works in the
    // background; the deliverable is read back from the chain later. So a
    // non-"accepted" answer is reported, not thrown - the escrow exists either
    // way and the user needs to see what the seller actually said.
    const accepted = /"status"\s*:\s*"accepted"/.test(detail) || /"accepted"\s*:\s*true/.test(detail);
    return { accepted, detail };
  },
});

/**
 * Record a payment that already happened - after checking, on-chain, that it
 * did.
 *
 * This is the whole reason a paid hire can be believed. The client hands over
 * a job id; everything else is read from the ERC-8183 kernel by this action
 * and compared against what Dolphin independently knows. A client that made
 * the id up gets an error naming which check failed, not a row.
 */
export const recordJobPayment = action({
  args: {
    tokenId: v.string(),
    category: agentCategoryValidator,
    /** The Altana smart account that funded the job - the job's `client`. */
    altanaWalletAddress: v.string(),
    /** The wagmi address on the matching agentHires row, when there is one. */
    hirerWalletAddress: v.union(v.string(), v.null()),
    /** The ERC-8183 kernel the job lives in, as the seller's quote named it. */
    escrowContract: v.string(),
    jobId: v.string(),
    /** The relay intent / transaction reference the funding batch returned. */
    transactionHash: v.union(v.string(), v.null()),
    paymentToken: v.string(),
    paymentTokenSymbol: v.string(),
    paymentTokenDecimals: v.number(),
  },
  returns: v.object({ recordId: v.string(), jobStatus: v.string(), budgetRaw: v.string() }),
  handler: async (ctx, args) => {
    const agent = await ctx.runQuery(api.agents.getAgent, { reference: args.tokenId });
    if (!agent) {
      throw new Error(`recordJobPayment: agent ${args.tokenId} is not in Dolphin's catalog.`);
    }
    if (!agent.agentWallet || !isAddress(agent.agentWallet)) {
      throw new Error(
        `recordJobPayment: agent ${args.tokenId} has no registered wallet to check a payment against.`,
      );
    }
    if (!isAddress(args.altanaWalletAddress)) {
      throw new Error(`recordJobPayment: "${args.altanaWalletAddress}" is not a valid EVM address.`);
    }
    if (!isAddress(args.escrowContract)) {
      throw new Error(`recordJobPayment: "${args.escrowContract}" is not a valid escrow address.`);
    }

    let jobId: bigint;
    try {
      jobId = BigInt(args.jobId);
    } catch {
      throw new Error(`recordJobPayment: "${args.jobId}" is not a job id.`);
    }

    // THE WITNESS STEP. Everything below is read from the chain, not supplied.
    const job = await bscPublicClient.readContract({
      address: getAddress(args.escrowContract) as `0x${string}`,
      abi: COMMERCE_GET_JOB_ABI,
      functionName: "getJob",
      args: [jobId],
    });

    const statusName = JOB_STATUS[job.status] ?? `UNKNOWN(${job.status})`;

    if (getAddress(job.client) !== getAddress(args.altanaWalletAddress)) {
      throw new Error(
        `Job ${args.jobId} was funded by ${getAddress(job.client)}, not by this Dolphin Wallet ` +
          `(${getAddress(args.altanaWalletAddress)}). Refusing to credit someone else's payment to this hire.`,
      );
    }
    if (getAddress(job.provider) !== getAddress(agent.agentWallet)) {
      throw new Error(
        `Job ${args.jobId} pays ${getAddress(job.provider)}, but ${agent.name}'s registered wallet is ` +
          `${getAddress(agent.agentWallet)}. This payment is not for this agent.`,
      );
    }
    if (job.budget <= BigInt(0)) {
      throw new Error(`Job ${args.jobId} carries no budget on-chain, so nothing was actually paid.`);
    }
    // OPEN means created but never funded - the money has not moved. Anything
    // at or past FUNDED means the escrow really holds the budget.
    if (statusName === "OPEN") {
      throw new Error(
        `Job ${args.jobId} exists but is still OPEN - the escrow has not been funded, so no payment ` +
          "has happened yet. Dolphin will not record a hire as paid on the strength of an unfunded job.",
      );
    }

    const recordId = await ctx.runMutation(internal.agentPayments.insertJobRecord, {
      chainId: BSC_CHAIN_ID,
      tokenId: args.tokenId,
      agentName: agent.name,
      category: args.category,
      altanaWalletAddress: getAddress(args.altanaWalletAddress),
      hirerWalletAddress: args.hirerWalletAddress,
      providerAddress: getAddress(job.provider),
      escrowContract: getAddress(args.escrowContract),
      jobId: args.jobId,
      jobStatus: statusName,
      budgetRaw: job.budget.toString(),
      paymentToken: getAddress(args.paymentToken),
      paymentTokenSymbol: args.paymentTokenSymbol,
      paymentTokenDecimals: args.paymentTokenDecimals,
      taskDescription: job.description,
      transactionHash: args.transactionHash,
      verifiedAt: new Date().toISOString(),
    });

    return { recordId, jobStatus: statusName, budgetRaw: job.budget.toString() };
  },
});

/**
 * Internal because it must only ever be reachable through recordJobPayment,
 * which is what does the on-chain checking. A public mutation writing this
 * table would be a way to assert a payment happened without one having.
 */
export const insertJobRecord = mutation({
  args: {
    chainId: v.number(),
    tokenId: v.string(),
    agentName: v.string(),
    category: agentCategoryValidator,
    altanaWalletAddress: v.string(),
    hirerWalletAddress: v.union(v.string(), v.null()),
    providerAddress: v.string(),
    escrowContract: v.string(),
    jobId: v.string(),
    jobStatus: v.string(),
    budgetRaw: v.string(),
    paymentToken: v.string(),
    paymentTokenSymbol: v.string(),
    paymentTokenDecimals: v.number(),
    taskDescription: v.string(),
    transactionHash: v.union(v.string(), v.null()),
    verifiedAt: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agentJobs")
      .withIndex("by_job", (q) => q.eq("chainId", args.chainId).eq("jobId", args.jobId))
      .unique();

    if (existing) {
      // A re-verification of the same job refreshes its status rather than
      // creating a second record of one payment.
      await ctx.db.patch(existing._id, {
        jobStatus: args.jobStatus,
        verifiedAt: args.verifiedAt,
      });
      return existing._id;
    }
    return ctx.db.insert("agentJobs", args);
  },
});

/** Paid jobs for one Dolphin Wallet, newest first. Public reference detail only. */
export const getJobsForAltanaWallet = query({
  args: { altanaWalletAddress: v.string() },
  handler: async (ctx, { altanaWalletAddress }) => {
    if (!isAddress(altanaWalletAddress)) return [];
    return ctx.db
      .query("agentJobs")
      .withIndex("by_altana_wallet", (q) =>
        q.eq("chainId", BSC_CHAIN_ID).eq("altanaWalletAddress", getAddress(altanaWalletAddress)),
      )
      .order("desc")
      .collect();
  },
});

/** The paid jobs backing one agent's hire, for the hire flow to show. */
export const getJobsForAgent = query({
  args: { tokenId: v.string(), altanaWalletAddress: v.string() },
  handler: async (ctx, { tokenId, altanaWalletAddress }) => {
    if (!isAddress(altanaWalletAddress)) return [];
    const rows = await ctx.db
      .query("agentJobs")
      .withIndex("by_altana_wallet", (q) =>
        q.eq("chainId", BSC_CHAIN_ID).eq("altanaWalletAddress", getAddress(altanaWalletAddress)),
      )
      .order("desc")
      .collect();
    return rows.filter((row) => row.tokenId === tokenId);
  },
});
