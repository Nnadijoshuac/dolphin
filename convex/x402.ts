/**
 * x402 FOR AGENTS BUILT ON DOLPHIN - the agent's own wallet, the on-chain
 * half, and the records (2026-10-02). lib/x402.ts decides whether a payment
 * is well-formed.
 *
 * WHO PAYS WHAT (owner, 2026-10-02: "I don't want to fund gas for anybody").
 * The standard x402 split, measured on SwapGod on BNB Chain: the buyer only
 * signs; the SELLER submits the signed authorization and pays the gas out of
 * what it earns. Here the seller is the published agent, so each agent has
 * its OWN wallet (agentWallets, option A), topped up with BNB by its builder.
 * Dolphin funds nothing. Guardrails, enforced below:
 *   1. The money goes buyer -> builder's payout wallet (decodePayment refuses
 *      any other recipient). The agent wallet only submits and pays gas.
 *   2. (Escrow payouts are forwarded on - see the ERC-8183 seller.)
 *   3. The agent wallet can only send BNB back to the builder.
 *
 * ORDER: verify -> work -> settle, the order x402 servers use. A failed call
 * is never charged; a call whose payment cannot be settled gets no result.
 */

import { ConvexError, v } from "convex/values";
import { createWalletClient, http, parseAbi, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction, internalMutation, internalQuery, query, type ActionCtx } from "./_generated/server";
import { BSC_RPC_URL, bscPublicClient } from "./lib/bscClient";
import { open, seal } from "./lib/secretBox";
import { U_TOKEN, type DecodedPayment } from "./lib/x402";

const U_AUTH_ABI = parseAbi([
  // The bytes form: an EOA's 65-byte signature or a smart wallet's ERC-1271 signature.
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature)",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
]);

/**
 * Gas one settlement needs, generously: transferWithAuthorization is ~70-90k
 * gas; 120k leaves room for a smart-wallet (ERC-1271) signature check.
 */
const SETTLE_GAS = BigInt(120_000);

/* ───────── each agent's own wallet ───────── */

export const walletRow = internalQuery({
  args: { hash: v.string() },
  handler: async (ctx, { hash }) => await ctx.db.query("agentWallets").withIndex("by_hash", (q) => q.eq("hash", hash)).first(),
});

export const storeWallet = internalMutation({
  args: { hash: v.string(), address: v.string(), ciphertext: v.string(), iv: v.string() },
  handler: async (ctx, args) => {
    // First writer wins: two concurrent calls must not make two wallets for one agent.
    const existing = await ctx.db.query("agentWallets").withIndex("by_hash", (q) => q.eq("hash", args.hash)).first();
    if (existing) return existing.address;
    await ctx.db.insert("agentWallets", { ...args, createdAt: Date.now() });
    return args.address;
  },
});

/** Creates the agent's wallet if it has none; returns only its address. */
export async function ensureAgentWallet(ctx: ActionCtx, hash: string): Promise<string> {
  const existing = await ctx.runQuery(internal.x402.walletRow, { hash });
  if (existing) return existing.address;
  const privateKey = generatePrivateKey();
  const box = await seal(privateKey);
  return await ctx.runMutation(internal.x402.storeWallet, { hash, address: privateKeyToAccount(privateKey).address, ...box });
}

export async function agentAccount(ctx: ActionCtx, hash: string) {
  const row = await ctx.runQuery(internal.x402.walletRow, { hash });
  if (!row) return null;
  return privateKeyToAccount((await open(row)) as Hex);
}

/** The agent's wallet address, for its page. Public: an address is not a secret. */
export const agentWallet = query({
  args: { hash: v.string() },
  handler: async (ctx, { hash }) => {
    const row = await ctx.db.query("agentWallets").withIndex("by_hash", (q) => q.eq("hash", hash)).first();
    return row ? { address: row.address } : null;
  },
});

/** The owner creates the wallet for an agent published before wallets existed. */
export const createAgentWallet = action({
  args: { sessionToken: v.string(), hash: v.string() },
  handler: async (ctx, { sessionToken, hash }): Promise<{ address: string }> => {
    const owner: string = await ctx.runQuery(internal.builtAgents.sessionOwner, { sessionToken });
    const listing = await ctx.runQuery(internal.builtAgents.byHash, { hash });
    if (!listing || listing.ownerAddress !== owner) throw new ConvexError("That agent is not yours.");
    if (listing.status !== "registered" || listing.network !== "bsc") throw new ConvexError("Only an agent live on BNB Chain gets a wallet.");
    return { address: await ensureAgentWallet(ctx, hash) };
  },
});

/**
 * GUARDRAIL 3: the agent's gas money goes back to its builder, and only there.
 * Sends everything except the gas this transfer itself costs.
 */
export const withdrawAgentGas = action({
  args: { sessionToken: v.string(), hash: v.string() },
  handler: async (ctx, { sessionToken, hash }): Promise<{ transactionHash: string; sentWei: string }> => {
    const owner: string = await ctx.runQuery(internal.builtAgents.sessionOwner, { sessionToken });
    const listing = await ctx.runQuery(internal.builtAgents.byHash, { hash });
    if (!listing || listing.ownerAddress !== owner) throw new ConvexError("That agent is not yours.");
    const account = await agentAccount(ctx, hash);
    if (!account) throw new ConvexError("This agent has no wallet yet.");
    const [balance, gasPrice] = await Promise.all([
      bscPublicClient.getBalance({ address: account.address }),
      bscPublicClient.getGasPrice(),
    ]);
    const fee = BigInt(21_000) * gasPrice;
    if (balance <= fee) throw new ConvexError("There is nothing to withdraw: the balance would not cover the transfer's own gas.");
    const wallet = createWalletClient({ account, chain: bsc, transport: http(BSC_RPC_URL) });
    // The destination is the listing's owner, read here - never an argument.
    const transactionHash = await wallet.sendTransaction({ to: listing.ownerAddress as Address, value: balance - fee, gas: BigInt(21_000), gasPrice });
    const receipt = await bscPublicClient.waitForTransactionReceipt({ hash: transactionHash, timeout: 60_000 });
    if (receipt.status !== "success") throw new ConvexError("The withdrawal failed on-chain.");
    return { transactionHash, sentWei: (balance - fee).toString() };
  },
});

/* ───────── reservations ───────── */

export const reserve = internalMutation({
  args: { hash: v.string(), payer: v.string(), nonce: v.string(), payTo: v.string(), valueRaw: v.string(), resource: v.string() },
  handler: async (ctx, args): Promise<Id<"x402Payments"> | null> => {
    const payer = args.payer.toLowerCase();
    const nonce = args.nonce.toLowerCase();
    const used = await ctx.db
      .query("x402Payments")
      .withIndex("by_payer_nonce", (q) => q.eq("payer", payer).eq("nonce", nonce))
      .first();
    if (used) return null;
    return await ctx.db.insert("x402Payments", {
      ...args,
      payer,
      nonce,
      status: "reserved",
      txHash: null,
      detail: null,
      createdAt: Date.now(),
      settledAt: null,
    });
  },
});

export const finish = internalMutation({
  args: {
    id: v.id("x402Payments"),
    status: v.union(v.literal("settled"), v.literal("released"), v.literal("failed")),
    txHash: v.union(v.string(), v.null()),
    detail: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { id, status, txHash, detail }) => {
    await ctx.db.patch(id, { status, txHash, detail: detail?.slice(0, 300) ?? null, settledAt: status === "settled" ? Date.now() : null });
  },
});

/* ───────── verify and settle ───────── */

function authArgs(payment: DecodedPayment) {
  const a = payment.authorization;
  return [a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce, payment.signature] as const;
}

/** A reason a payment cannot be taken, worded for the caller - or null when it can. */
export async function checkPayment(ctx: ActionCtx, hash: string, payment: DecodedPayment): Promise<string | null> {
  const account = await agentAccount(ctx, hash);
  if (!account) return "This agent cannot take payments yet: its builder has not set up its wallet.";
  const [gas, gasPrice] = await Promise.all([bscPublicClient.getBalance({ address: account.address }), bscPublicClient.getGasPrice()]);
  if (gas < SETTLE_GAS * gasPrice) return "This agent is out of gas money for collecting payments. Its builder needs to top it up. Nothing was charged.";

  const used = await bscPublicClient.readContract({
    address: U_TOKEN,
    abi: U_AUTH_ABI,
    functionName: "authorizationState",
    args: [payment.authorization.from, payment.authorization.nonce],
  });
  if (used) return "That payment was already used.";

  try {
    // U itself checks the signature (ECDSA or ERC-1271), the balance and the nonce.
    await bscPublicClient.simulateContract({
      account,
      address: U_TOKEN,
      abi: U_AUTH_ABI,
      functionName: "transferWithAuthorization",
      args: authArgs(payment),
    });
  } catch (cause) {
    const text = cause instanceof Error ? cause.message : String(cause);
    if (/balance/i.test(text)) return "The paying wallet does not hold enough U.";
    if (/signature|invalid/i.test(text)) return "The payment signature is not valid for U.";
    return "U refused this payment.";
  }
  return null;
}

/** Submits the authorization from the agent's own wallet and waits for it. Returns the transaction hash, or throws. */
export async function settlePayment(ctx: ActionCtx, hash: string, payment: DecodedPayment): Promise<string> {
  const account = await agentAccount(ctx, hash);
  if (!account) throw new Error("No agent wallet.");
  const wallet = createWalletClient({ account, chain: bsc, transport: http(BSC_RPC_URL) });
  const txHash = await wallet.writeContract({
    address: U_TOKEN,
    abi: U_AUTH_ABI,
    functionName: "transferWithAuthorization",
    args: authArgs(payment),
  });
  const receipt = await bscPublicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });
  if (receipt.status !== "success") throw new Error(`Settlement reverted: ${txHash}`);
  return txHash;
}

/**
 * Sets a listing's price and door by hand, for operators (internal only):
 *   npx convex run x402:setListingPrice '{"hash":"d…","priceRaw":"10000000000000000","protocol":"mcp"}'
 * A null priceRaw makes it free again.
 */
export const setListingPrice = internalMutation({
  args: { hash: v.string(), priceRaw: v.union(v.string(), v.null()), protocol: v.optional(v.union(v.literal("mcp"), v.literal("a2a"))) },
  handler: async (ctx, { hash, priceRaw, protocol }) => {
    const row = await ctx.db.query("builtAgents").withIndex("by_hash", (q) => q.eq("hash", hash)).unique();
    if (!row) throw new Error(`No listing ${hash}.`);
    if (priceRaw !== null && !/^\d{1,40}$/.test(priceRaw)) throw new Error("priceRaw must be U base units.");
    await ctx.db.patch(row._id, { priceRaw, ...(protocol ? { protocol } : {}), updatedAt: Date.now() });
    return { hash, priceRaw, protocol: protocol ?? row.protocol ?? "mcp" };
  },
});

/** Operators: give an existing listing its wallet (internal only). `npx convex run x402:ensureWalletFor '{"hash":"d…"}'` */
export const ensureWalletFor = internalAction({
  args: { hash: v.string() },
  handler: async (ctx, { hash }): Promise<{ address: string }> => ({ address: await ensureAgentWallet(ctx, hash) }),
});
