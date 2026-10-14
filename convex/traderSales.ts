import { ConvexError, v } from "convex/values";
import { erc20Abi, getAddress, isAddress, parseEventLogs, parseUnits } from "viem";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { bscPublicClient } from "./lib/bscClient";
import { randomHex, requireWalletAddress } from "./lib/walletAuth";
import { U_DECIMALS, U_TOKEN } from "./lib/x402";

/**
 * SELLING A TRADER (owner, 2026-10-13: "they can give it out there for free... or sell"). A builder
 * puts a price in U on running their published trader. The buyer pays it ONCE, from their Dolphin
 * Wallet straight to the builder's payout wallet - Dolphin never holds the money and funds no gas -
 * and then runs the strategy LOCKED in their own wallet (convex/traders.ts startFromAgent), on their
 * own keys for any brain it asks (lib/strategy.ts Rule.confirm).
 *
 * How a payment is tied to its buyer without trusting the browser: `reserve` fixes an exact amount,
 * the price plus a dust fingerprint below a millionth of a U; `confirm` reads the BNB Chain receipt
 * itself and accepts only a U transfer of exactly that amount to the payout wallet; the transaction
 * hash is unique, so one transfer unlocks one purchase. The row and the receipt are the two witnesses.
 */

export const MIN_RUN_PRICE_U = 0.5;
export const MAX_RUN_PRICE_U = 500;
/** Dust below 1e-12 U: invisible in any wallet, unique enough to tell two reservations apart. */
const DUST_MAX = 999_999;

async function listingOf(ctx: QueryCtx, agentKey: string): Promise<Doc<"builtAgents"> | null> {
  const listing = await ctx.db
    .query("builtAgents")
    .withIndex("by_agent_key", (q) => q.eq("agentKey", agentKey.toLowerCase()))
    .first();
  return listing && listing.status === "registered" ? listing : null;
}

function payToOf(listing: Doc<"builtAgents">): string {
  return getAddress(listing.payoutAddress ?? listing.ownerAddress);
}

async function paidRow(ctx: QueryCtx, buyer: string, agentKey: string) {
  const rows = await ctx.db
    .query("traderPurchases")
    .withIndex("by_buyer_agent", (q) => q.eq("buyer", buyer).eq("agentKey", agentKey.toLowerCase()))
    .take(20);
  return rows.find((row) => row.status === "paid") ?? null;
}

/** Whether this wallet may run the trader: free, its own, or paid for. Used by startFromAgent. */
export async function mayRun(ctx: QueryCtx, listing: Doc<"builtAgents">, wallet: string): Promise<boolean> {
  if (!listing.runPriceU) return true;
  if (listing.ownerAddress.toLowerCase() === wallet.toLowerCase()) return true;
  return (await paidRow(ctx, wallet.toLowerCase(), listing.agentKey ?? "")) !== null;
}

/** The builder prices their trader, or makes it free again (null). */
export const setRunPrice = mutation({
  args: { sessionToken: v.string(), agentKey: v.string(), priceU: v.union(v.number(), v.null()) },
  handler: async (ctx, { sessionToken, agentKey, priceU }) => {
    const wallet = await requireWalletAddress(ctx, sessionToken, "Pricing a trader");
    const listing = await listingOf(ctx, agentKey);
    if (!listing) throw new ConvexError("That trader is not published.");
    if (listing.ownerAddress.toLowerCase() !== wallet.toLowerCase()) throw new ConvexError("Only its builder can price it.");
    if (priceU !== null && !(Number.isFinite(priceU) && priceU >= MIN_RUN_PRICE_U && priceU <= MAX_RUN_PRICE_U)) {
      throw new ConvexError(`Choose ${MIN_RUN_PRICE_U} to ${MAX_RUN_PRICE_U} U, or make it free.`);
    }
    const rounded = priceU === null ? null : Math.round(priceU * 100) / 100;
    await ctx.db.patch(listing._id, { runPriceU: rounded, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.traders.rebuildHub, { force: true });
    return { priceU: rounded };
  },
});

/** What the trader page needs to show the buy step. Anyone may look; a session adds "own" and "paid". */
export const access = query({
  args: { agentKey: v.string(), sessionToken: v.optional(v.string()) },
  handler: async (ctx, { agentKey, sessionToken }) => {
    const listing = await listingOf(ctx, agentKey);
    if (!listing) return null;
    let own = false;
    let paid = false;
    if (sessionToken) {
      try {
        const wallet = (await requireWalletAddress(ctx, sessionToken, "Checking a purchase")).toLowerCase();
        own = listing.ownerAddress.toLowerCase() === wallet;
        paid = (await paidRow(ctx, wallet, agentKey)) !== null;
      } catch {
        // An expired session reads as signed out: the page asks them to connect again.
      }
    }
    return { priceU: listing.runPriceU ?? null, payTo: payToOf(listing), own, paid };
  },
});

/** Fixes the exact amount this buyer pays. A second call before paying returns the same reservation. */
export const reserve = mutation({
  args: { sessionToken: v.string(), agentKey: v.string() },
  handler: async (ctx, { sessionToken, agentKey }) => {
    const buyer = (await requireWalletAddress(ctx, sessionToken, "Buying a trader")).toLowerCase();
    const listing = await listingOf(ctx, agentKey);
    if (!listing || !listing.runPriceU) throw new ConvexError("That trader is free to run.");
    if (listing.ownerAddress.toLowerCase() === buyer) throw new ConvexError("It is yours: run it for free.");
    if (await paidRow(ctx, buyer, agentKey)) throw new ConvexError("You have already paid for this trader.");
    const payTo = payToOf(listing);
    const base = parseUnits(String(listing.runPriceU), U_DECIMALS);
    const open = (
      await ctx.db
        .query("traderPurchases")
        .withIndex("by_buyer_agent", (q) => q.eq("buyer", buyer).eq("agentKey", agentKey.toLowerCase()))
        .take(20)
    ).find((row) => row.status === "reserved" && row.payTo === payTo && BigInt(row.amountRaw) / BigInt(10 ** 6) === base / BigInt(10 ** 6));
    if (open) return { purchaseId: open._id, payTo, token: U_TOKEN, amountRaw: open.amountRaw, priceU: listing.runPriceU };
    const dust = BigInt((parseInt(randomHex(3), 16) % DUST_MAX) + 1);
    const amountRaw = (base + dust).toString();
    const purchaseId = await ctx.db.insert("traderPurchases", { agentKey: agentKey.toLowerCase(), buyer, payTo, amountRaw, status: "reserved", createdAt: Date.now() });
    return { purchaseId, payTo, token: U_TOKEN, amountRaw, priceU: listing.runPriceU };
  },
});

export const reservationFor = internalQuery({
  args: { sessionToken: v.string(), purchaseId: v.id("traderPurchases") },
  handler: async (ctx, { sessionToken, purchaseId }) => {
    const buyer = (await requireWalletAddress(ctx, sessionToken, "Confirming a purchase")).toLowerCase();
    const row = await ctx.db.get(purchaseId);
    return row && row.buyer === buyer ? row : null;
  },
});

export const markPaid = internalMutation({
  args: { purchaseId: v.id("traderPurchases"), txHash: v.string() },
  handler: async (ctx, { purchaseId, txHash }) => {
    const used = await ctx.db.query("traderPurchases").withIndex("by_tx", (q) => q.eq("txHash", txHash)).first();
    if (used && used._id !== purchaseId) throw new ConvexError("That transaction already paid for a trader.");
    const row = await ctx.db.get(purchaseId);
    if (!row) throw new ConvexError("That reservation is gone.");
    if (row.status === "paid") return;
    await ctx.db.patch(purchaseId, { status: "paid", txHash, paidAt: Date.now() });
  },
});

/** Reads the receipt itself: a successful U transfer of exactly the reserved amount to the payout wallet. */
export const confirm = action({
  args: { sessionToken: v.string(), purchaseId: v.id("traderPurchases"), txHash: v.string() },
  handler: async (ctx, { sessionToken, purchaseId, txHash }): Promise<{ paid: true }> => {
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new ConvexError("That is not a transaction hash.");
    const row: Doc<"traderPurchases"> | null = await ctx.runQuery(internal.traderSales.reservationFor, { sessionToken, purchaseId: purchaseId as Id<"traderPurchases"> });
    if (!row) throw new ConvexError("That reservation is not yours.");
    if (row.status === "paid") return { paid: true };
    const receipt = await bscPublicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
    if (receipt.status !== "success") throw new ConvexError("That transaction did not succeed on BNB Chain, so nothing was paid.");
    const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs }).filter(
      (log) => log.address.toLowerCase() === U_TOKEN.toLowerCase(),
    );
    const match = transfers.some((log) => isAddress(log.args.to) && getAddress(log.args.to) === row.payTo && log.args.value === BigInt(row.amountRaw));
    if (!match) throw new ConvexError("That transaction is not this purchase's payment: no U transfer of the reserved amount to the builder.");
    await ctx.runMutation(internal.traderSales.markPaid, { purchaseId, txHash: txHash.toLowerCase() });
    return { paid: true };
  },
});

/** The builder names themselves on /trade - 2 to 32 letters, digits, spaces, dots, dashes or underscores. */
export const setCreatorName = mutation({
  args: { sessionToken: v.string(), agentKey: v.string(), name: v.union(v.string(), v.null()) },
  handler: async (ctx, { sessionToken, agentKey, name }) => {
    const wallet = await requireWalletAddress(ctx, sessionToken, "Naming yourself");
    const listing = await listingOf(ctx, agentKey);
    if (!listing) throw new ConvexError("That trader is not published.");
    if (listing.ownerAddress.toLowerCase() !== wallet.toLowerCase()) throw new ConvexError("Only its builder can do that.");
    const clean = name === null ? null : name.trim().replace(/\s+/g, " ");
    if (clean !== null && !/^[\p{L}\p{N} ._-]{2,32}$/u.test(clean)) throw new ConvexError("Use 2 to 32 letters, numbers, spaces, dots, dashes or underscores.");
    await ctx.db.patch(listing._id, { creatorName: clean, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.traders.rebuildHub, { force: true });
    return { name: clean };
  },
});

/** Operators: name a listing's builder (the owner asked his own traders to read "Serenity"). */
export const setCreatorNameInternal = internalMutation({
  args: { agentKey: v.string(), name: v.union(v.string(), v.null()) },
  handler: async (ctx, { agentKey, name }) => {
    const listing = await listingOf(ctx, agentKey);
    if (!listing) throw new ConvexError("Not published.");
    await ctx.db.patch(listing._id, { creatorName: name, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.traders.rebuildHub, { force: true });
  },
});
