import { getAddress, isAddress } from "viem";
import { v } from "convex/values";

import { api, internal } from "./_generated/api";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { BSC_CHAIN_ID, bscPublicClient } from "./lib/bscClient";
import { safeFetch } from "./lib/safeFetch";
import {
  QuoteRejected,
  TEXT_PARTS_ONLY,
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
  /** The seller's signed envelope, anchored into the job description. */
  signedEnvelope: v.union(v.string(), v.null()),
  deliverables: v.union(v.string(), v.null()),
  endpoint: v.string(),
  /**
   * The seller's untouched response. Returned rather than dropped so a
   * disagreement between what Dolphin rendered and what the agent actually
   * said is settleable after the fact, by looking rather than by arguing.
   */
  rawResponse: v.string(),
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

async function sendA2A(
  endpoint: string,
  data: Record<string, unknown>,
  partKind: "data" | "text",
): Promise<{ result?: unknown; error?: { message?: string } }> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(buildA2ARequest(data, partKind)),
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

  try {
    return JSON.parse(body) as { result?: unknown; error?: { message?: string } };
  } catch {
    throw new Error(
      `The agent's endpoint answered with something that is not JSON: ${body.slice(0, 200)}`,
    );
  }
}

/**
 * One A2A call, in whichever part dialect the endpoint accepts.
 *
 * Data parts first, because every seller in this catalog that returns a real
 * quote wants them. A `TEXT_PARTS_ONLY` refusal is retried as text rather than
 * surfaced, since it is a statement about encoding and not about the agent's
 * willingness to sell - reporting it to a user as a failure would blame the
 * seller for Dolphin speaking the wrong half of the spec.
 *
 * Any other error is returned as-is: it is the agent's actual answer.
 */
async function postA2A(endpoint: string, data: Record<string, unknown>): Promise<unknown> {
  let envelope = await sendA2A(endpoint, data, "data");

  if (envelope?.error && TEXT_PARTS_ONLY.test(envelope.error.message ?? "")) {
    envelope = await sendA2A(endpoint, data, "text");
  }

  if (envelope?.error) {
    throw new Error(
      `The agent's endpoint returned a JSON-RPC error: ${envelope.error.message ?? JSON.stringify(envelope.error)}`,
    );
  }
  return envelope?.result;
}

/**
 * Asks a seller's `list` skill what it sells, for use in an error message when
 * it declines to quote. Best-effort by design: a seller that does not publish
 * a menu, or fails this call, simply produces no extra sentence. Never throws -
 * the caller is already reporting a different failure and must not lose it.
 */
async function describeMenu(endpoint: string): Promise<string> {
  try {
    const listed = await postA2A(endpoint, { skill: "list" });
    const services = (listed as { services?: unknown })?.services;
    if (!Array.isArray(services) || services.length === 0) return "";

    const lines = services
      .map((entry) => {
        const service = entry as { id?: unknown; name?: unknown; price_display?: unknown };
        const id = typeof service.id === "string" ? service.id : null;
        const name = typeof service.name === "string" ? service.name : null;
        if (!id && !name) return null;
        const price =
          typeof service.price_display === "string" ? ` (${service.price_display})` : "";
        return `“${name ?? id}”${price}`;
      })
      .filter((line): line is string => line !== null);

    if (lines.length === 0) return "";
    return ` This agent does sell: ${lines.join("; ")}. Rewrite the task to ask for one of those.`;
  } catch {
    return "";
  }
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
    agentKey: v.string(),
    /** What the user is asking the agent to do. Anchored into the job on-chain. */
    taskDescription: v.string(),
    /** Optional seller-side service id, for sellers that publish a menu. */
    serviceId: v.optional(v.string()),
  },
  returns: quoteValidator,
  handler: async (ctx, { agentKey, taskDescription, serviceId }): Promise<PublicQuote> => {
    const agent = await ctx.runQuery(api.agents.get, { reference: agentKey });
    if (!agent) {
      throw new Error(`requestQuote: agent ${agentKey} is not in Dolphin's catalog.`);
    }
    if (!agent.agentWallet || !isAddress(agent.agentWallet)) {
      // Without a registered wallet there is nothing to check the payee
      // against, and an unchecked payee is the one thing this flow refuses.
      throw new Error(
        `Dolphin has no registered on-chain wallet for ${agent.name}, so it cannot verify who a ` +
          "payment would go to. Refusing to negotiate a price it could not check.",
      );
    }

    /*
     * Prefer the endpoint the sellability probe RESOLVED FROM THE AGENT'S CARD
     * over one derived from the registered URL by path-stripping.
     *
     * Measured 2026-09-06: for most of this catalog the registered `a2a` value
     * is the discovery document, and the real JSON-RPC url lives in the card's
     * `url` field at a path no string manipulation could produce
     * (/agents/1/agent-card.json -> /api/a2a). Deriving it here while the probe
     * used the card would mean the hire knocks on a different door than the one
     * that answered, so the catalog and the checkout would disagree.
     *
     * Falls back to the heuristic when no probe has stored one yet.
     */
    const endpoint =
      (agent as { a2aEndpoint?: string | null }).a2aEndpoint ??
      selectNegotiationEndpoint(agent.services);
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
      if (cause instanceof QuoteRejected) {
        // A decline is a dead end unless the user is told what this agent
        // DOES sell. Verified live: Brain on BNB declines a task that does not
        // match one of its services and quotes 0.10 $U the moment it does. The
        // menu comes from the seller's own `list` skill, so this adds no
        // guess of Dolphin's - it just stops relaying a "no" without the
        // "but here is what I do" the seller already publishes beside it.
        throw new Error(`${cause.message}${await describeMenu(endpoint)}`);
      }
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

/** Keeps the seller's answer to "your job is funded" with the job (schema: sellerReply). */
export const recordSellerReply = internalMutation({
  args: { jobId: v.string(), accepted: v.boolean(), reason: v.union(v.string(), v.null()) },
  handler: async (ctx, { jobId, accepted, reason }) => {
    const row = await ctx.db
      .query("agentJobs")
      .withIndex("by_job", (q) => q.eq("chainId", BSC_CHAIN_ID).eq("jobId", jobId))
      .unique();
    if (!row) return;
    await ctx.db.patch(row._id, { sellerReply: { accepted, reason, at: new Date().toISOString() } });
  },
});

/**
 * Tell a seller its job is funded so it starts work. Relay only - by this
 * point the money has already moved, and this call cannot move any more of it.
 */
export const notifyJobFunded = action({
  args: { agentKey: v.string(), jobId: v.string() },
  returns: v.object({ accepted: v.boolean(), detail: v.string() }),
  handler: async (ctx, { agentKey, jobId }) => {
    const agent = await ctx.runQuery(api.agents.get, { reference: agentKey });
    if (!agent) throw new Error(`notifyJobFunded: agent ${agentKey} is not in Dolphin's catalog.`);

    // Same resolution as requestQuote - notifying a different endpoint than the
    // one that quoted would tell the wrong server its job was funded.
    const endpoint =
      (agent as { a2aEndpoint?: string | null }).a2aEndpoint ??
      selectNegotiationEndpoint(agent.services);
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
    const refused = /"status"\s*:\s*"rejected"/.test(detail) || /"accepted"\s*:\s*false/.test(detail);
    // Kept with the job so the card can say what happened (schema: sellerReply).
    if (accepted || refused) {
      const reason = /"reason"\s*:\s*"([^"]{1,300})"/.exec(detail)?.[1] ?? null;
      await ctx.runMutation(internal.agentPayments.recordSellerReply, { jobId, accepted, reason });
    }
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
    agentKey: v.string(),
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
  // Annotated explicitly: this handler calls ctx.runMutation on a function in
  // its OWN module, so inferring its type needs the module's type, which needs
  // this handler's type. TS7022/7023. The annotation breaks the cycle.
  handler: async (
    ctx,
    args,
  ): Promise<{ recordId: string; jobStatus: string; budgetRaw: string }> => {
    const agent = await ctx.runQuery(api.agents.get, { reference: args.agentKey });
    if (!agent) {
      throw new Error(`recordJobPayment: agent ${args.agentKey} is not in Dolphin's catalog.`);
    }
    if (!agent.agentWallet || !isAddress(agent.agentWallet)) {
      throw new Error(
        `recordJobPayment: agent ${args.agentKey} has no registered wallet to check a payment against.`,
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
      agentKey: args.agentKey,
      chainId: BSC_CHAIN_ID,
      agentName: agent.name,
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
export const insertJobRecord = internalMutation({
  args: {
    chainId: v.number(),
    agentKey: v.string(),
    agentName: v.string(),
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

/**
 * Records the refund of a paid job, so the wallet's history can link to it.
 *
 * ---------------------------------------------------------------------------
 * WHY (2026-09-26)
 * ---------------------------------------------------------------------------
 * claimEscrowRefund sent the refund and threw the transaction hash away. The
 * refund of job 56783 that day went through (the job reads EXPIRED and the
 * 0.1 U is back in the wallet), but nothing in Dolphin could say which
 * transaction did it, and a free BSC RPC cannot find it afterwards: public
 * nodes cap eth_getLogs to recent blocks and refuse historical state. A
 * history has to be recorded when it happens.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS CHECKED, all of it on the chain, none of it taken from the caller
 * ---------------------------------------------------------------------------
 *   1. The job is one Dolphin already recorded as paid by this wallet.
 *   2. The receipt exists and succeeded.
 *   3. The transaction emitted an event FROM this job's kernel whose first
 *      indexed topic is this job id. Deliberately not a hardcoded Refunded
 *      topic0: the deployed kernel's JobFunded already differs from the
 *      ERC-8183 text (Agent/TRACKING-SUBMISSION.md), so the refund event's
 *      real signature is logged here for the record rather than assumed.
 *   4. The payment token moved FROM the kernel TO this wallet in the same
 *      transaction. Without this, the job's own FUNDING transaction passes
 *      checks 2, 3 and 5 once the job is refunded, and could be recorded as
 *      "the refund". Money coming back out of escrow is what only a refund does.
 *   5. The job itself now reads EXPIRED, with the same client.
 */
export const recordJobRefund = action({
  args: {
    jobId: v.string(),
    altanaWalletAddress: v.string(),
    transactionHash: v.string(),
  },
  returns: v.object({ jobStatus: v.string() }),
  handler: async (ctx, args): Promise<{ jobStatus: string }> => {
    if (!isAddress(args.altanaWalletAddress)) {
      throw new Error(`recordJobRefund: "${args.altanaWalletAddress}" is not a valid EVM address.`);
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(args.transactionHash)) {
      throw new Error(`recordJobRefund: "${args.transactionHash}" is not a transaction hash.`);
    }
    let jobId: bigint;
    try {
      jobId = BigInt(args.jobId);
    } catch {
      throw new Error(`recordJobRefund: "${args.jobId}" is not a job id.`);
    }

    const record: { escrowContract: string; altanaWalletAddress: string; paymentToken: string } | null =
      await ctx.runQuery(internal.agentPayments.jobRecordForRefund, { jobId: args.jobId });
    if (!record || getAddress(record.altanaWalletAddress) !== getAddress(args.altanaWalletAddress)) {
      throw new Error(`recordJobRefund: job ${args.jobId} is not a payment this wallet made through Dolphin.`);
    }
    const kernel = getAddress(record.escrowContract);

    const receipt = await bscPublicClient.getTransactionReceipt({
      hash: args.transactionHash as `0x${string}`,
    });
    if (receipt.status !== "success") {
      throw new Error(`recordJobRefund: transaction ${args.transactionHash} did not succeed.`);
    }
    const jobTopic = `0x${jobId.toString(16).padStart(64, "0")}`.toLowerCase();
    const jobLog = receipt.logs.find(
      (log) =>
        getAddress(log.address) === kernel && log.topics[1]?.toLowerCase() === jobTopic,
    );
    if (!jobLog) {
      throw new Error(
        `recordJobRefund: transaction ${args.transactionHash} emitted nothing from the escrow for job ${args.jobId}.`,
      );
    }
    const pad = (address: string) => `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
    const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
    const paidBack = receipt.logs.some(
      (log) =>
        getAddress(log.address) === getAddress(record.paymentToken) &&
        log.topics[0]?.toLowerCase() === TRANSFER_TOPIC &&
        log.topics[1]?.toLowerCase() === pad(kernel) &&
        log.topics[2]?.toLowerCase() === pad(getAddress(args.altanaWalletAddress)),
    );
    if (!paidBack) {
      throw new Error(
        `recordJobRefund: transaction ${args.transactionHash} did not move the payment token from the escrow back to this wallet, so it is not the refund.`,
      );
    }

    // The observed signature, so the tracking document can say "observed".
    console.log(`[recordJobRefund] job ${args.jobId} refund event topic0 ${jobLog.topics[0]}`);

    const job = await bscPublicClient.readContract({
      address: kernel as `0x${string}`,
      abi: COMMERCE_GET_JOB_ABI,
      functionName: "getJob",
      args: [jobId],
    });
    const statusName = JOB_STATUS[job.status] ?? `UNKNOWN(${job.status})`;
    if (statusName !== "EXPIRED" || getAddress(job.client) !== getAddress(args.altanaWalletAddress)) {
      throw new Error(
        `recordJobRefund: job ${args.jobId} reads ${statusName} for ${getAddress(job.client)}, not a refund to this wallet.`,
      );
    }

    /*
     * The BLOCK's time, not the time this ran. Recording can happen long
     * after the refund (job 56783's was recorded hours later, from a hash the
     * owner looked up on BscScan), and the history must show when the money
     * actually came back.
     */
    const block = await bscPublicClient.getBlock({ blockNumber: receipt.blockNumber });
    const refundedAt = new Date(Number(block.timestamp) * 1000).toISOString();

    await ctx.runMutation(internal.agentPayments.markJobRefunded, {
      jobId: args.jobId,
      jobStatus: statusName,
      refundTransactionHash: args.transactionHash,
      refundedAt,
    });
    return { jobStatus: statusName };
  },
});

export const jobRecordForRefund = internalQuery({
  args: { jobId: v.string() },
  handler: async (ctx, { jobId }) => {
    const row = await ctx.db
      .query("agentJobs")
      .withIndex("by_job", (q) => q.eq("chainId", BSC_CHAIN_ID).eq("jobId", jobId))
      .unique();
    return row
      ? {
          escrowContract: row.escrowContract,
          altanaWalletAddress: row.altanaWalletAddress,
          paymentToken: row.paymentToken,
        }
      : null;
  },
});

/** Internal: only recordJobRefund, which checked the chain, may call it. */
export const markJobRefunded = internalMutation({
  args: {
    jobId: v.string(),
    jobStatus: v.string(),
    refundTransactionHash: v.string(),
    refundedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("agentJobs")
      .withIndex("by_job", (q) => q.eq("chainId", BSC_CHAIN_ID).eq("jobId", args.jobId))
      .unique();
    if (!row) return;
    await ctx.db.patch(row._id, {
      jobStatus: args.jobStatus,
      refundTransactionHash: args.refundTransactionHash,
      refundedAt: args.refundedAt,
      verifiedAt: args.refundedAt,
    });
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
  args: { agentKey: v.string(), altanaWalletAddress: v.string() },
  handler: async (ctx, { agentKey, altanaWalletAddress }) => {
    if (!isAddress(altanaWalletAddress)) return [];
    return ctx.db
      .query("agentJobs")
      .withIndex("by_agent_wallet", (q) =>
        q
          .eq("agentKey", agentKey)
          .eq("altanaWalletAddress", getAddress(altanaWalletAddress)),
      )
      .order("desc")
      .collect();
  },
});

/* ───────────────────────── the delivered result ───────────────────────── */

const DELIVERABLE_MAX_BYTES = 64 * 1024;
const DELIVERABLE_TEXT_CHARS = 8000;

export const jobRowById = internalQuery({
  args: { jobId: v.string() },
  handler: async (ctx, { jobId }) =>
    ctx.db
      .query("agentJobs")
      .withIndex("by_job", (q) => q.eq("chainId", BSC_CHAIN_ID).eq("jobId", jobId))
      .unique(),
});

export const saveDeliverable = internalMutation({
  args: {
    jobId: v.string(),
    deliverable: v.object({
      url: v.string(),
      content: v.union(v.string(), v.null()),
      contentType: v.union(v.string(), v.null()),
      submitTx: v.union(v.string(), v.null()),
      fetchedAt: v.string(),
    }),
  },
  handler: async (ctx, { jobId, deliverable }) => {
    const row = await ctx.db
      .query("agentJobs")
      .withIndex("by_job", (q) => q.eq("chainId", BSC_CHAIN_ID).eq("jobId", jobId))
      .unique();
    if (row) await ctx.db.patch(row._id, { deliverable });
  },
});

/** The URL a seller's submit transaction names, read from the transaction's own input. */
function urlInInput(input: string): string | null {
  const hex = input.startsWith("0x") ? input.slice(2) : input;
  let text = "";
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const code = parseInt(hex.slice(i, i + 2), 16);
    text += code >= 32 && code < 127 ? String.fromCharCode(code) : " ";
  }
  return /https:\/\/[^\s"'\<>]{4,500}/.exec(text)?.[0] ?? null;
}

/**
 * WHAT THE AGENT ACTUALLY DELIVERED (owner, 2026-10-02: "I don't understand
 * what it delivered"). The kernel stores a 32-byte commitment and nothing a
 * person can read. Sellers built on bnbagent-studio write the result's URL into
 * their `submit` transaction ("read the deliverable back from the CHAIN ... the
 * submit tx carries the deliverable_url" - recurring-monitoring-service-agent's
 * own card), and serve {response: {content, content_type}} there.
 *
 * So: find the submit transaction by its timestamp (binary search on block
 * times, then the few blocks around it - public nodes refuse log queries), take
 * the URL from its input, fetch it through safeFetch (a stranger's URL), keep
 * the text. Measured on job 56872: block 125249548, the URL answered with the
 * seller's report. Read once and stored; later views read the row.
 */
export const fetchDeliverable = action({
  args: { jobId: v.string() },
  handler: async (ctx, { jobId }): Promise<{ url: string; content: string | null; contentType: string | null } | null> => {
    const row = await ctx.runQuery(internal.agentPayments.jobRowById, { jobId });
    if (!row) return null;
    if (row.deliverable?.content) return row.deliverable;

    let id: bigint;
    try {
      id = BigInt(jobId);
    } catch {
      return null;
    }
    const job = await bscPublicClient.readContract({
      address: getAddress(row.escrowContract) as `0x${string}`,
      abi: COMMERCE_GET_JOB_ABI,
      functionName: "getJob",
      args: [id],
    });
    if (job.submittedAt === BigInt(0)) return null;

    // The block of the submit, by time.
    let hi = await bscPublicClient.getBlockNumber();
    let lo = hi - BigInt(2_000_000);
    while (hi - lo > BigInt(1)) {
      const mid = (lo + hi) / BigInt(2);
      const block = await bscPublicClient.getBlock({ blockNumber: mid });
      if (block.timestamp < job.submittedAt) lo = mid;
      else hi = mid;
    }
    const idHex = id.toString(16).padStart(64, "0");
    const provider = job.provider.toLowerCase();
    let submitTx: string | null = null;
    let url: string | null = null;
    for (let offset = -4; offset <= 4 && !url; offset++) {
      const block = await bscPublicClient.getBlock({ blockNumber: hi + BigInt(offset), includeTransactions: true });
      for (const tx of block.transactions) {
        if (tx.from.toLowerCase() !== provider || !tx.input.toLowerCase().includes(idHex)) continue;
        submitTx = tx.hash;
        url = urlInInput(tx.input);
        if (url) break;
      }
    }
    if (!url) return null;

    let content: string | null = null;
    let contentType: string | null = null;
    try {
      const response = await safeFetch(url, { method: "GET", timeoutMs: 10_000, maxBytes: DELIVERABLE_MAX_BYTES });
      if (response.ok) {
        try {
          const body = JSON.parse(response.text) as { response?: { content?: unknown; content_type?: unknown } };
          content = typeof body.response?.content === "string" ? body.response.content : JSON.stringify(body.response ?? body, null, 2);
          contentType = typeof body.response?.content_type === "string" ? body.response.content_type : null;
        } catch {
          content = response.text;
          contentType = response.contentType || null;
        }
        content = content.slice(0, DELIVERABLE_TEXT_CHARS);
      }
    } catch {
      /* the URL is kept; the text can be fetched again later */
    }

    const deliverable = { url, content, contentType, submitTx, fetchedAt: new Date().toISOString() };
    await ctx.runMutation(internal.agentPayments.saveDeliverable, { jobId, deliverable });
    return { url, content, contentType };
  },
});
