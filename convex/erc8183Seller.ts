/**
 * A BUILT AGENT AS AN ERC-8183 SELLER - quoting, delivering, collecting
 * (2026-10-02). Formats: lib/erc8183Seller.ts. Owner's option A: every
 * transaction here is sent by the AGENT'S OWN wallet (x402.ts) and paid from
 * the BNB its builder tops up. Dolphin funds nothing.
 *
 *   negotiate      A2A data part {skill:"negotiate", task_description, terms}
 *                  -> a quote signed by the agent wallet, stored here.
 *   notify_funded  {skill:"notify_funded", job_id} -> the job is read from the
 *                  chain and checked against our own quote; if it passes, the
 *                  work is scheduled and the buyer hears "accepted" at once.
 *   work           the agent answers (builder's own Brain, builtAgentServer.ask),
 *                  the manifest is served at /api/v1/built/<hash>/job-<id>, and
 *                  submit(jobId, keccak(manifest), {deliverable_url}) is sent.
 *   tick (cron)    after the policy's dispute window, router.settle pays the
 *                  agent wallet; then GUARDRAIL 2 forwards that U to the
 *                  builder's payout wallet straight away.
 *
 * ONLY JOBS JUDGED BY BNB AGENT STUDIO'S ROUTER ARE ACCEPTED. A job whose
 * evaluator is the buyer lets the buyer take the result and reject it for a
 * refund - BNB Chain's own SDK warns "client can self-reject and refund after
 * you submit". The 7-day window is the price of a judge that is not the buyer.
 */

import { ConvexError, v } from "convex/values";
import { createWalletClient, encodeFunctionData, erc20Abi, getAddress, http, parseAbi, toHex, type Address } from "viem";
import { bsc } from "viem/chains";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalAction, internalMutation, internalQuery, query, type ActionCtx } from "./_generated/server";
import { apiBase } from "./builtAgents";
import { ask } from "./builtAgentServer";
import { BSC_RPC_URL, bscPublicClient } from "./lib/bscClient";
import {
  KERNEL,
  MAX_DESCRIPTION_BYTES,
  POLICY,
  ROUTER,
  anchoredNegotiationHash,
  deliverableManifest,
  manifestHash,
  negotiationHash,
  pyJson,
  quoteContent,
  quoteEnvelope,
  quoteRefusal,
} from "./lib/erc8183Seller";
import { U_TOKEN } from "./lib/x402";
import { agentAccount } from "./x402";

type Listing = Doc<"builtAgents">;

const KERNEL_ABI = parseAbi([
  "function submit(uint256 jobId, bytes32 deliverable, bytes optParams)",
]);
const GET_JOB_ABI = [
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
const ROUTER_ABI = parseAbi(["function settle(uint256 jobId, bytes evidence)"]);
const POLICY_ABI = parseAbi(["function disputeWindow() view returns (uint64)"]);
const REGISTRY_ABI = parseAbi(["function getAgentWallet(uint256 agentId) view returns (address)"]);

const STATUS = { OPEN: 0, FUNDED: 1, SUBMITTED: 2, COMPLETED: 3, REJECTED: 4, EXPIRED: 5 } as const;
/** Gas the agent wallet must hold before it starts a step (submit or settle is ~150-250k). */
const STEP_GAS = BigInt(300_000);
const MAX_WORK_ATTEMPTS = 3;
const MAX_TASK_CHARS = 2_000;

const reply = (data: Record<string, unknown>) => ({
  kind: "message",
  role: "agent",
  messageId: crypto.randomUUID(),
  parts: [{ kind: "data", data }],
});

async function hasGas(address: Address): Promise<boolean> {
  const [balance, gasPrice] = await Promise.all([bscPublicClient.getBalance({ address }), bscPublicClient.getGasPrice()]);
  return balance >= STEP_GAS * gasPrice;
}

/** Whether the agent's on-chain identity names its own wallet - escrow buyers pay that address. */
async function walletLinked(listing: Listing, agentWallet: Address): Promise<boolean> {
  if (!listing.tokenId) return false;
  const named = await bscPublicClient
    .readContract({ address: getAddress(listing.registry), abi: REGISTRY_ABI, functionName: "getAgentWallet", args: [BigInt(listing.tokenId)] })
    .catch(() => null);
  return named !== null && getAddress(named) === agentWallet;
}

function sellable(listing: Listing): string | null {
  if (!listing.priceRaw) return "This agent is free to use. Ask it directly; there is no job to fund.";
  if (listing.network !== "bsc" || listing.status !== "registered") return "This agent is not live on BNB Chain.";
  return null;
}

/* ───────── negotiate ───────── */

export async function negotiate(ctx: ActionCtx, listing: Listing, data: Record<string, unknown>) {
  const blocked = sellable(listing);
  if (blocked) return reply(quoteRefusal("0x01", blocked));
  const account = await agentAccount(ctx, listing.hash);
  if (!account) return reply(quoteRefusal("0x01", "This agent has no wallet to be paid at yet."));
  if (!(await walletLinked(listing, account.address))) {
    return reply(quoteRefusal("0x01", "This agent's wallet is not linked to its on-chain identity yet, so a job could not be paid to it."));
  }

  const task = typeof data.task_description === "string" ? data.task_description.trim().slice(0, MAX_TASK_CHARS) : "";
  if (!task) return reply(quoteRefusal("0x02", "Send task_description: what you want done."));
  const terms = (data.terms && typeof data.terms === "object" ? data.terms : {}) as Record<string, unknown>;
  const input = {
    task,
    deliverables: typeof terms.deliverables === "string" && terms.deliverables.trim() ? terms.deliverables.slice(0, 1_000) : task,
    qualityStandards:
      typeof terms.quality_standards === "string" && terms.quality_standards.trim()
        ? terms.quality_standards.slice(0, 1_000)
        : "Answered by the agent's own instructions and tools, with figures read at request time.",
    priceRaw: listing.priceRaw as string,
    currency: U_TOKEN,
    negotiatedAt: Math.floor(Date.now() / 1000),
  };
  const hash = negotiationHash(quoteContent(input));
  const envelope = quoteEnvelope(input, await account.signMessage({ message: hash }), account.address);
  if (new TextEncoder().encode(pyJson({ ...quoteContent(input), negotiation_hash: hash, provider_sig: envelope.provider_sig })).length > MAX_DESCRIPTION_BYTES) {
    return reply(quoteRefusal("0x07", "The task is too long to anchor on-chain. Shorten it."));
  }
  await ctx.runMutation(internal.erc8183Seller.storeQuote, {
    hash: listing.hash,
    negotiationHash: hash.toLowerCase(),
    task: input.task,
    priceRaw: input.priceRaw,
    expiresAt: input.negotiatedAt + 900,
  });
  return reply(envelope);
}

export const storeQuote = internalMutation({
  args: { hash: v.string(), negotiationHash: v.string(), task: v.string(), priceRaw: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.insert("sellerQuotes", { ...args, usedByJob: null, createdAt: Date.now() });
  },
});

/* ───────── a funded job ───────── */

export async function notifyFunded(ctx: ActionCtx, listing: Listing, data: Record<string, unknown>) {
  const raw = data.job_id;
  const jobId = typeof raw === "number" && Number.isSafeInteger(raw) ? BigInt(raw) : typeof raw === "string" && /^\d{1,20}$/.test(raw) ? BigInt(raw) : null;
  if (jobId === null) return reply({ status: "rejected", reason: "Send job_id." });
  const refuse = (reason: string) => reply({ status: "rejected", job_id: Number(jobId), reason });

  const blocked = sellable(listing);
  if (blocked) return refuse(blocked);
  const account = await agentAccount(ctx, listing.hash);
  if (!account) return refuse("This agent has no wallet.");

  const job = await bscPublicClient.readContract({ address: KERNEL, abi: GET_JOB_ABI, functionName: "getJob", args: [jobId] });
  if (getAddress(job.provider) !== account.address) return refuse("This job names a different provider.");
  if (getAddress(job.evaluator) !== ROUTER) return refuse("Only jobs judged by the ERC-8183 router are accepted; a buyer-judged job can be rejected after delivery.");
  if (job.status !== STATUS.FUNDED) return refuse("The job is not funded.");
  const window = await bscPublicClient.readContract({ address: POLICY, abi: POLICY_ABI, functionName: "disputeWindow" });
  if (BigInt(Math.floor(Date.now() / 1000)) + BigInt(600) > job.expiredAt - window) return refuse("Too late to deliver this job before it expires.");

  const anchored = anchoredNegotiationHash(job.description);
  if (!anchored) return refuse("no signed quote anchored in job description");
  const accepted = await ctx.runMutation(internal.erc8183Seller.acceptJob, {
    hash: listing.hash,
    jobId: jobId.toString(),
    client: getAddress(job.client),
    budgetRaw: job.budget.toString(),
    negotiationHash: anchored,
  });
  if (accepted !== "accepted") return refuse(accepted);
  return reply({ status: "accepted", job_id: Number(jobId) });
}

/** Ties a funded job to one of our quotes, once, and schedules the work. Returns "accepted" or why not. */
export const acceptJob = internalMutation({
  args: { hash: v.string(), jobId: v.string(), client: v.string(), budgetRaw: v.string(), negotiationHash: v.string() },
  handler: async (ctx, args): Promise<string> => {
    const existing = await ctx.db.query("sellerJobs").withIndex("by_job", (q) => q.eq("jobId", args.jobId)).first();
    if (existing) return existing.hash === args.hash ? "accepted" : "This job belongs to another agent.";
    const quote = await ctx.db.query("sellerQuotes").withIndex("by_negotiation", (q) => q.eq("negotiationHash", args.negotiationHash)).first();
    if (!quote || quote.hash !== args.hash) return "This job's quote was not signed by this agent.";
    if (quote.usedByJob) return "That quote already paid for another job.";
    if (BigInt(args.budgetRaw) < BigInt(quote.priceRaw)) return "The escrowed budget is below the quoted price.";
    await ctx.db.patch(quote._id, { usedByJob: args.jobId });
    await ctx.db.insert("sellerJobs", {
      hash: args.hash,
      jobId: args.jobId,
      client: args.client,
      budgetRaw: args.budgetRaw,
      negotiationHash: args.negotiationHash,
      task: quote.task,
      status: "accepted",
      attempts: 0,
      detail: null,
      manifestJson: null,
      submitTx: null,
      submittedAt: null,
      settleTx: null,
      forwardTx: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.erc8183Seller.workJob, { jobId: args.jobId });
    return "accepted";
  },
});

export const jobRow = internalQuery({
  args: { jobId: v.string() },
  handler: async (ctx, { jobId }) => await ctx.db.query("sellerJobs").withIndex("by_job", (q) => q.eq("jobId", jobId)).first(),
});

export const patchJob = internalMutation({
  args: {
    id: v.id("sellerJobs"),
    patch: v.object({
      status: v.optional(v.union(v.literal("accepted"), v.literal("submitted"), v.literal("settled"), v.literal("forwarded"), v.literal("failed"))),
      attempts: v.optional(v.number()),
      detail: v.optional(v.union(v.string(), v.null())),
      manifestJson: v.optional(v.union(v.string(), v.null())),
      submitTx: v.optional(v.union(v.string(), v.null())),
      submittedAt: v.optional(v.union(v.number(), v.null())),
      settleTx: v.optional(v.union(v.string(), v.null())),
      forwardTx: v.optional(v.union(v.string(), v.null())),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, { ...patch, ...(patch.detail ? { detail: patch.detail.slice(0, 300) } : {}), updatedAt: Date.now() });
  },
});

/* ───────── deliver ───────── */

export const workJob = internalAction({
  args: { jobId: v.string() },
  handler: async (ctx, { jobId }) => {
    const row = await ctx.runQuery(internal.erc8183Seller.jobRow, { jobId });
    if (!row || row.status !== "accepted") return;
    const listing = await ctx.runQuery(internal.builtAgents.byHash, { hash: row.hash });
    const account = listing ? await agentAccount(ctx, listing.hash) : null;
    if (!listing || !account) return;
    const attempt = row.attempts + 1;

    let manifestJson = row.manifestJson;
    if (!manifestJson) {
      const answer = await ask(ctx, listing, row.task, null);
      const text = answer.content[0]?.text ?? "";
      if (answer.isError || !text) {
        await ctx.runMutation(internal.erc8183Seller.patchJob, {
          id: row._id,
          patch: { attempts: attempt, status: attempt >= MAX_WORK_ATTEMPTS ? "failed" : "accepted", detail: text || "The agent gave no answer." },
        });
        return;
      }
      manifestJson = pyJson(deliverableManifest(Number(jobId), text));
      await ctx.runMutation(internal.erc8183Seller.patchJob, { id: row._id, patch: { manifestJson } });
    }

    if (!(await hasGas(account.address))) {
      // Kept as accepted: the tick retries once the builder tops the wallet up.
      await ctx.runMutation(internal.erc8183Seller.patchJob, { id: row._id, patch: { attempts: attempt, detail: "The agent wallet needs BNB for gas to deliver." } });
      return;
    }
    try {
      const wallet = createWalletClient({ account, chain: bsc, transport: http(BSC_RPC_URL) });
      const deliverableUrl = `${apiBase()}/api/v1/built/${listing.hash}/job-${jobId}`;
      const tx = await wallet.writeContract({
        address: KERNEL,
        abi: KERNEL_ABI,
        functionName: "submit",
        args: [BigInt(jobId), manifestHash(JSON.parse(manifestJson)), toHex(JSON.stringify({ deliverable_url: deliverableUrl }))],
      });
      const receipt = await bscPublicClient.waitForTransactionReceipt({ hash: tx, timeout: 90_000 });
      if (receipt.status !== "success") throw new Error(`submit reverted: ${tx}`);
      await ctx.runMutation(internal.erc8183Seller.patchJob, {
        id: row._id,
        patch: { status: "submitted", submitTx: tx, submittedAt: Math.floor(Date.now() / 1000), attempts: attempt, detail: null },
      });
    } catch (cause) {
      await ctx.runMutation(internal.erc8183Seller.patchJob, {
        id: row._id,
        patch: { attempts: attempt, status: attempt >= MAX_WORK_ATTEMPTS ? "failed" : "accepted", detail: cause instanceof Error ? cause.message : String(cause) },
      });
    }
  },
});

/** The manifest a delivered job points at. Public: the buyer and any verifier re-hash it. */
export const manifestFor = internalQuery({
  args: { hash: v.string(), jobId: v.string() },
  handler: async (ctx, { hash, jobId }) => {
    const row = await ctx.db.query("sellerJobs").withIndex("by_job", (q) => q.eq("jobId", jobId)).first();
    return row && row.hash === hash ? row.manifestJson : null;
  },
});

/* ───────── collect and forward (cron) ───────── */

export const jobsInStatus = internalQuery({
  args: { status: v.union(v.literal("accepted"), v.literal("submitted"), v.literal("settled")) },
  handler: async (ctx, { status }) => await ctx.db.query("sellerJobs").withIndex("by_status", (q) => q.eq("status", status)).take(50),
});

async function forward(ctx: ActionCtx, listing: Listing, rows: Doc<"sellerJobs">[]) {
  const account = await agentAccount(ctx, listing.hash);
  if (!account) return;
  const balance = await bscPublicClient.readContract({ address: U_TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  if (balance === BigInt(0) || !(await hasGas(account.address))) return;
  const payout = getAddress(listing.payoutAddress ?? listing.ownerAddress);
  const wallet = createWalletClient({ account, chain: bsc, transport: http(BSC_RPC_URL) });
  // GUARDRAIL 2: the agent wallet keeps no earnings - every U it holds goes on to the builder.
  const tx = await wallet.sendTransaction({
    to: U_TOKEN,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [payout, balance] }),
  });
  const receipt = await bscPublicClient.waitForTransactionReceipt({ hash: tx, timeout: 90_000 });
  if (receipt.status !== "success") return;
  for (const row of rows) await ctx.runMutation(internal.erc8183Seller.patchJob, { id: row._id, patch: { status: "forwarded", forwardTx: tx } });
}

export const tick = internalAction({
  args: {},
  handler: async (ctx) => {
    // 1. Retry deliveries that waited on gas or a model error.
    for (const row of await ctx.runQuery(internal.erc8183Seller.jobsInStatus, { status: "accepted" })) {
      if (Date.now() - row.updatedAt > 120_000) await ctx.scheduler.runAfter(0, internal.erc8183Seller.workJob, { jobId: row.jobId });
    }

    // 2. Collect: settle once the dispute window has passed (anyone may; the agent does it itself).
    const window = Number(await bscPublicClient.readContract({ address: POLICY, abi: POLICY_ABI, functionName: "disputeWindow" }));
    for (const row of await ctx.runQuery(internal.erc8183Seller.jobsInStatus, { status: "submitted" })) {
      const job = await bscPublicClient.readContract({ address: KERNEL, abi: GET_JOB_ABI, functionName: "getJob", args: [BigInt(row.jobId)] });
      if (job.status === STATUS.COMPLETED) {
        await ctx.runMutation(internal.erc8183Seller.patchJob, { id: row._id, patch: { status: "settled" } });
        continue;
      }
      if (job.status === STATUS.REJECTED || job.status === STATUS.EXPIRED) {
        await ctx.runMutation(internal.erc8183Seller.patchJob, { id: row._id, patch: { status: "failed", detail: job.status === STATUS.REJECTED ? "Rejected after a dispute." : "Expired." } });
        continue;
      }
      if (Date.now() / 1000 < Number(job.submittedAt) + window + 60) continue;
      const account = await agentAccount(ctx, row.hash);
      if (!account || !(await hasGas(account.address))) continue;
      try {
        const wallet = createWalletClient({ account, chain: bsc, transport: http(BSC_RPC_URL) });
        const tx = await wallet.writeContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "settle", args: [BigInt(row.jobId), "0x"] });
        const receipt = await bscPublicClient.waitForTransactionReceipt({ hash: tx, timeout: 90_000 });
        if (receipt.status === "success") await ctx.runMutation(internal.erc8183Seller.patchJob, { id: row._id, patch: { status: "settled", settleTx: tx } });
      } catch (cause) {
        await ctx.runMutation(internal.erc8183Seller.patchJob, { id: row._id, patch: { detail: cause instanceof Error ? cause.message : String(cause) } });
      }
    }

    // 3. Forward: settled earnings go on to each builder's payout wallet.
    const settled = await ctx.runQuery(internal.erc8183Seller.jobsInStatus, { status: "settled" });
    const byListing = new Map<string, Doc<"sellerJobs">[]>();
    for (const row of settled) byListing.set(row.hash, [...(byListing.get(row.hash) ?? []), row]);
    for (const [hash, rows] of byListing) {
      const listing = await ctx.runQuery(internal.builtAgents.byHash, { hash });
      if (listing) await forward(ctx, listing, rows);
    }
  },
});

/* ───────── linking the agent wallet to its identity ───────── */

/**
 * Escrow buyers pay the address the agent's ERC-8004 identity names. That
 * defaults to the owner; the owner points it at the agent wallet once with
 * registry.setAgentWallet(agentId, wallet, deadline, signature), where the
 * signature is the agent wallet's consent. Format measured 2026-10-02 by
 * simulating the call on BSC: EIP-712 domain ERC8004IdentityRegistry v1,
 * AgentWalletSet(uint256 agentId,address newWallet,address owner,uint256 deadline).
 */
type LinkProof = { agentWallet: string; tokenId: string; deadline: string; signature: string; registry: string };

export const walletLinkProof = action({
  args: { sessionToken: v.string(), hash: v.string() },
  handler: async (ctx, { sessionToken, hash }): Promise<LinkProof> => {
    const owner: string = await ctx.runQuery(internal.builtAgents.sessionOwner, { sessionToken });
    return await linkProof(ctx, hash, owner);
  },
});

/** Operators: check a link proof against the registry by simulation (sends nothing). */
export const checkLinkProof = internalAction({
  args: { hash: v.string() },
  handler: async (ctx, { hash }): Promise<string> => {
    const listing = await ctx.runQuery(internal.builtAgents.byHash, { hash });
    if (!listing) return "no listing";
    const proof = await linkProof(ctx, hash, listing.ownerAddress);
    try {
      await bscPublicClient.simulateContract({
        account: getAddress(listing.ownerAddress),
        address: getAddress(proof.registry),
        abi: parseAbi(["function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes signature)"]),
        functionName: "setAgentWallet",
        args: [BigInt(proof.tokenId), getAddress(proof.agentWallet), BigInt(proof.deadline), proof.signature as `0x${string}`],
      });
      return `accepted by the registry: ${proof.agentWallet} for token ${proof.tokenId}`;
    } catch (cause) {
      return `refused: ${cause instanceof Error ? cause.message.split("\n")[0] : String(cause)}`;
    }
  },
});

async function linkProof(ctx: ActionCtx, hash: string, owner: string): Promise<LinkProof> {
  {
    const listing = await ctx.runQuery(internal.builtAgents.byHash, { hash });
    if (!listing || listing.ownerAddress !== owner) throw new ConvexError("That agent is not yours.");
    if (!listing.tokenId || listing.network !== "bsc") throw new ConvexError("Only an agent live on BNB Chain can be linked.");
    const account = await agentAccount(ctx, hash);
    if (!account) throw new ConvexError("Create the agent's wallet first.");
    // The registry refuses a deadline more than ~5 minutes out (measured: 600 s refused, 240 s accepted).
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 240);
    const signature = await account.signTypedData({
      domain: { name: "ERC8004IdentityRegistry", version: "1", chainId: 56, verifyingContract: getAddress(listing.registry) },
      types: {
        AgentWalletSet: [
          { name: "agentId", type: "uint256" },
          { name: "newWallet", type: "address" },
          { name: "owner", type: "address" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "AgentWalletSet",
      message: { agentId: BigInt(listing.tokenId), newWallet: account.address, owner: getAddress(owner), deadline },
    });
    return { agentWallet: account.address, tokenId: listing.tokenId, deadline: deadline.toString(), signature, registry: getAddress(listing.registry) };
  }
}

/** Escrow jobs this agent has taken, for its owner's page. */
export const jobsForAgent = query({
  args: { hash: v.string() },
  handler: async (ctx, { hash }) => {
    const rows = await ctx.db.query("sellerJobs").withIndex("by_hash", (q) => q.eq("hash", hash)).order("desc").take(20);
    return rows.map((row) => ({
      jobId: row.jobId,
      status: row.status,
      budgetRaw: row.budgetRaw,
      detail: row.detail,
      submitTx: row.submitTx,
      forwardTx: row.forwardTx,
      createdAt: row.createdAt,
    }));
  },
});

export type SellerJobId = Id<"sellerJobs">;
