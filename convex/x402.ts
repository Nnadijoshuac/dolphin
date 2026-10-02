/**
 * x402 FOR AGENTS BUILT ON DOLPHIN - records and the on-chain half (2026-10-02).
 *
 * lib/x402.ts decides whether a payment is well-formed; this file:
 *   - reserves each (payer, nonce) once, before any work runs,
 *   - simulates the payer's authorization against U itself (balance and
 *     signature, EOA or ERC-1271 smart wallet, in one eth_call),
 *   - submits it after the work succeeded, from Dolphin's own gas wallet,
 *   - and keeps the gas wallet's key sealed (it is generated here and never
 *     leaves: no function returns it).
 *
 * ORDER, AND WHY. verify -> work -> settle, the order x402 servers use:
 *   - The payer is never charged for a call that failed: an errored result
 *     releases the reservation instead of settling it.
 *   - Settling after the work risks the payer moving their U in between, so
 *     the result is withheld when settlement fails - the builder loses one
 *     call's compute, never their payment.
 */

import { v } from "convex/values";
import { createWalletClient, http, parseAbi, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type ActionCtx } from "./_generated/server";
import { BSC_RPC_URL, bscPublicClient } from "./lib/bscClient";
import { open, seal } from "./lib/secretBox";
import { U_TOKEN, type DecodedPayment } from "./lib/x402";

const U_AUTH_ABI = parseAbi([
  // The bytes form: an EOA's 65-byte signature or a smart wallet's ERC-1271 signature.
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature)",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
]);

/** Below this the gas wallet cannot settle; paid calls are refused before any work. ~20 settlements at 0.1 gwei. */
const MIN_RELAYER_WEI = BigInt("200000000000000"); // 0.0002 BNB

/* ───────── the gas wallet ───────── */

export const relayerRow = internalQuery({
  args: {},
  handler: async (ctx) => await ctx.db.query("x402Relayer").first(),
});

export const storeRelayer = internalMutation({
  args: { address: v.string(), ciphertext: v.string(), iv: v.string() },
  handler: async (ctx, args) => {
    // First writer wins: two concurrent ensureRelayer calls must not make two wallets.
    const existing = await ctx.db.query("x402Relayer").first();
    if (existing) return existing.address;
    await ctx.db.insert("x402Relayer", { ...args, createdAt: Date.now() });
    return args.address;
  },
});

/**
 * Creates the gas wallet if there is none and returns ONLY its address, for
 * the owner to fund with a little BNB. Run once per deployment:
 *   npx convex run x402:ensureRelayer [--prod]
 */
export const ensureRelayer = internalAction({
  args: {},
  handler: async (ctx): Promise<{ address: string; balanceBnbWei: string }> => {
    const existing = await ctx.runQuery(internal.x402.relayerRow, {});
    let address = existing?.address ?? null;
    if (!address) {
      const privateKey = generatePrivateKey();
      const box = await seal(privateKey);
      address = await ctx.runMutation(internal.x402.storeRelayer, {
        address: privateKeyToAccount(privateKey).address,
        ...box,
      });
    }
    const balance = await bscPublicClient.getBalance({ address: address as Address });
    return { address, balanceBnbWei: balance.toString() };
  },
});

async function relayerAccount(ctx: ActionCtx) {
  const row = await ctx.runQuery(internal.x402.relayerRow, {});
  if (!row) return null;
  return privateKeyToAccount((await open(row)) as Hex);
}

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
export async function checkPayment(ctx: ActionCtx, payment: DecodedPayment): Promise<string | null> {
  const relayer = await relayerAccount(ctx);
  if (!relayer) return "Paid calls are not open on this deployment yet.";
  const gas = await bscPublicClient.getBalance({ address: relayer.address });
  if (gas < MIN_RELAYER_WEI) return "Paid calls are paused for a moment. Try again later.";

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
      account: relayer,
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

/** Submits the authorization and waits for it. Returns the transaction hash, or throws. */
export async function settlePayment(ctx: ActionCtx, payment: DecodedPayment): Promise<string> {
  const relayer = await relayerAccount(ctx);
  if (!relayer) throw new Error("No gas wallet.");
  const wallet = createWalletClient({ account: relayer, chain: bsc, transport: http(BSC_RPC_URL) });
  const hash = await wallet.writeContract({
    address: U_TOKEN,
    abi: U_AUTH_ABI,
    functionName: "transferWithAuthorization",
    args: authArgs(payment),
  });
  const receipt = await bscPublicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status !== "success") throw new Error(`Settlement reverted: ${hash}`);
  return hash;
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
