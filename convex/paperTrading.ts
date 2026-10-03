/**
 * PAPER TRADING - an agent practises with pretend money against real prices.
 * (Mentor review, 2026-09-29: "without paper trading and realistic backtests,
 * every indicator block is a toy." Owner: do it.)
 *
 * On by default for every agent. A paper trade takes a LIVE PancakeSwap quote
 * - the same quoteTrade a real trade uses, so the pool fee and price impact
 * are real - and charges an estimated gas cost read from the chain's current
 * gas price. Nothing is signed; no real balance moves. Each agent has its own
 * paper account, $1,000 in USDT to start.
 *
 * One row per account and one per simulated trade: small, on purpose (the
 * database I/O budget is shared).
 */

import { ConvexError, v } from "convex/values";
import { formatUnits, parseUnits } from "viem";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalAction, internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { bscPairFor } from "./lib/agentBlocks";
import { bscPublicClient } from "./lib/bscClient";
import { describeRoute, quoteTrade, WBNB_BSC, type TradeSide } from "./lib/pancakeswapTrade";
import { verifiedTokens } from "./lib/tradeTokens";

export const PAPER_START_USD = 1_000;
/** A V2/V3 swap's gas, generously rounded; priced at the chain's live gas price. */
const SWAP_GAS_UNITS = BigInt(220_000);
const STABLES = new Set(["USDT", "USDC", "U"]);

type Holding = { symbol: string; address: string | null; decimals: number; amount: string };

function usdtHolding(amountUsd: number): Holding {
  const usdt = verifiedTokens().find((token) => token.symbol === "USDT")!;
  return { symbol: "USDT", address: usdt.address, decimals: usdt.decimals, amount: amountUsd.toFixed(2) };
}

async function draftFor(ctx: QueryCtx, conversationKey: string) {
  const conversation = await ctx.db
    .query("dolphinConversations")
    .withIndex("by_key", (q) => q.eq("conversationKey", conversationKey))
    .unique();
  if (!conversation || (conversation.mode ?? "chat") !== "build") return null;
  return ctx.db
    .query("agentDrafts")
    .withIndex("by_conversation", (q) => q.eq("conversationId", conversation._id))
    .unique();
}

export const account = internalQuery({
  args: { draftId: v.id("agentDrafts") },
  handler: async (ctx, { draftId }) =>
    ctx.db
      .query("paperAccounts")
      .withIndex("by_draft", (q) => q.eq("draftId", draftId))
      .first(),
});

export const store = internalMutation({
  args: {
    draftId: v.id("agentDrafts"),
    holdings: v.array(v.object({ symbol: v.string(), address: v.union(v.string(), v.null()), decimals: v.number(), amount: v.string() })),
    trade: v.object({
      sellSymbol: v.string(),
      sellAmount: v.string(),
      buySymbol: v.string(),
      buyAmount: v.string(),
      route: v.string(),
      gasBnb: v.string(),
      sellUsd: v.union(v.number(), v.null()),
    }),
  },
  handler: async (ctx, { draftId, holdings, trade }) => {
    const now = new Date().toISOString();
    const existing = await ctx.db
      .query("paperAccounts")
      .withIndex("by_draft", (q) => q.eq("draftId", draftId))
      .first();
    if (existing) await ctx.db.patch(existing._id, { holdings, updatedAt: now });
    else await ctx.db.insert("paperAccounts", { draftId, startUsd: PAPER_START_USD, holdings, createdAt: now, updatedAt: now });
    await ctx.db.insert("paperTrades", { draftId, ...trade, at: now });
  },
});

/**
 * Simulates one swap the Risk block already passed. Never throws for a normal
 * refusal: the agent is told why, the same way a real trade reports it.
 */
export const fill = internalAction({
  args: {
    draftId: v.id("agentDrafts"),
    ticket: v.object({
      kind: v.literal("swap"),
      amountIn: v.string(),
      tokenIn: v.object({ address: v.union(v.string(), v.null()), symbol: v.string(), decimals: v.number(), verified: v.boolean() }),
      tokenOut: v.object({ address: v.union(v.string(), v.null()), symbol: v.string(), decimals: v.number(), verified: v.boolean() }),
      safety: v.any(),
    }),
  },
  handler: async (ctx, { draftId, ticket }): Promise<{ text: string }> => {
    const existing: Doc<"paperAccounts"> | null = await ctx.runQuery(internal.paperTrading.account, { draftId });
    const holdings: Holding[] = existing ? existing.holdings.map((h) => ({ ...h })) : [usdtHolding(PAPER_START_USD)];
    const tokenIn: TradeSide = { address: ticket.tokenIn.address, symbol: ticket.tokenIn.symbol, decimals: ticket.tokenIn.decimals };
    const tokenOut: TradeSide = { address: ticket.tokenOut.address, symbol: ticket.tokenOut.symbol, decimals: ticket.tokenOut.decimals };
    const find = (symbol: string) => holdings.find((h) => h.symbol === symbol);

    let amountInRaw: bigint;
    try {
      amountInRaw = parseUnits(ticket.amountIn, tokenIn.decimals);
    } catch {
      return { text: "Paper trade refused: the amount could not be read." };
    }
    const held = find(tokenIn.symbol);
    const heldRaw = held ? parseUnits(held.amount, held.decimals) : BigInt(0);
    if (heldRaw < amountInRaw) {
      return { text: `Paper trade refused: the paper account holds ${held?.amount ?? "0"} ${tokenIn.symbol}, less than ${ticket.amountIn}.` };
    }

    const route = (await quoteTrade({ publicClient: bscPublicClient as never, tokenIn, tokenOut, amountInRaw }))[0];
    if (!route) return { text: "Paper trade refused: PancakeSwap had no route for that swap right now." };
    const gasPrice = await bscPublicClient.getGasPrice().catch(() => null);
    const gasBnb = gasPrice ? formatUnits(gasPrice * SWAP_GAS_UNITS, 18) : "0";

    // Move the pretend balances exactly as the quote says the real trade would.
    held!.amount = formatUnits(heldRaw - amountInRaw, tokenIn.decimals);
    const outAmount = formatUnits(route.amountOutRaw, tokenOut.decimals);
    const into = find(tokenOut.symbol);
    if (into) into.amount = formatUnits(parseUnits(into.amount, into.decimals) + route.amountOutRaw, into.decimals);
    else holdings.push({ symbol: tokenOut.symbol, address: tokenOut.address, decimals: tokenOut.decimals, amount: outAmount });
    // Gas comes out of paper BNB when there is some; otherwise it is recorded against the result.
    const bnb = find("BNB");
    if (bnb && gasPrice) {
      const next = parseUnits(bnb.amount, 18) - gasPrice * SWAP_GAS_UNITS;
      bnb.amount = formatUnits(next > BigInt(0) ? next : BigInt(0), 18);
    }
    const nonZero = holdings.filter((h) => Number(h.amount) > 0);

    const sellPrice = STABLES.has(tokenIn.symbol) ? 1 : ((await bscPairFor(tokenIn.address ?? WBNB_BSC).catch(() => null))?.priceUsd ?? null);
    await ctx.runMutation(internal.paperTrading.store, {
      draftId,
      holdings: nonZero,
      trade: {
        sellSymbol: tokenIn.symbol,
        sellAmount: ticket.amountIn,
        buySymbol: tokenOut.symbol,
        buyAmount: outAmount,
        route: describeRoute(route),
        gasBnb,
        sellUsd: sellPrice === null ? null : Number(ticket.amountIn) * sellPrice,
      },
    });
    return {
      text:
        `PAPER trade (simulated - no real funds moved): sold ${ticket.amountIn} ${tokenIn.symbol} for ${Number(outAmount).toPrecision(6)} ` +
        `${tokenOut.symbol} at a live ${describeRoute(route)} quote, with an estimated ${Number(gasBnb).toPrecision(2)} BNB gas. ` +
        `Paper account now: ${nonZero.map((h) => `${Number(h.amount).toPrecision(6)} ${h.symbol}`).join(", ")}.`,
    };
  },
});

/** The agent's paper portfolio, for its Brain at the start of a run. */
export const brief = internalQuery({
  args: { draftId: v.id("agentDrafts") },
  handler: async (ctx, { draftId }): Promise<string> => {
    const row = await ctx.db
      .query("paperAccounts")
      .withIndex("by_draft", (q) => q.eq("draftId", draftId))
      .first();
    const holdings = row?.holdings ?? [usdtHolding(PAPER_START_USD)];
    return `YOUR PAPER PORTFOLIO (simulated money, real prices): ${holdings.map((h) => `${Number(h.amount).toPrecision(6)} ${h.symbol}`).join(", ")}. Started with $${(row?.startUsd ?? PAPER_START_USD).toLocaleString()} in USDT.`;
  },
});

/** The paper account and its latest trades, for the Draft tab. Public: the conversation key is the capability. */
export const forDraft = query({
  args: { conversationKey: v.string() },
  handler: async (ctx, { conversationKey }) => {
    const draft = await draftFor(ctx, conversationKey);
    if (!draft) return null;
    const row = await ctx.db
      .query("paperAccounts")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
      .first();
    const trades = await ctx.db
      .query("paperTrades")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
      .order("desc")
      .take(20);
    return {
      paperMode: draft.paperMode !== false,
      liveAcknowledged: Boolean(draft.liveAcknowledgedAt),
      startUsd: row?.startUsd ?? PAPER_START_USD,
      holdings: row?.holdings ?? [usdtHolding(PAPER_START_USD)],
      trades: trades.map(({ at, sellSymbol, sellAmount, buySymbol, buyAmount, route, gasBnb }) => ({ at, sellSymbol, sellAmount, buySymbol, buyAmount, route, gasBnb })),
    };
  },
});

/** Paper on or off, and a fresh start. Holding the conversation key is the capability, as for the draft itself. */
export const setMode = mutation({
  args: { conversationKey: v.string(), paperMode: v.boolean(), acknowledge: v.optional(v.boolean()) },
  handler: async (ctx, { conversationKey, paperMode, acknowledge }) => {
    const draft = await draftFor(ctx, conversationKey);
    if (!draft) throw new ConvexError("That draft is empty.");
    // Real money only after the owner accepted, once, that every trade is their own responsibility.
    if (!paperMode && !acknowledge && !draft.liveAcknowledgedAt) throw new ConvexError("Accept the real-money disclaimer to switch to Live.");
    const now = Date.now();
    await ctx.db.patch(draft._id, { paperMode, updatedAt: now, ...(!paperMode && acknowledge ? { liveAcknowledgedAt: now } : {}) });
  },
});

export const reset = mutation({
  args: { conversationKey: v.string() },
  handler: async (ctx, { conversationKey }) => {
    const draft = await draftFor(ctx, conversationKey);
    if (!draft) throw new ConvexError("That draft is empty.");
    const row = await ctx.db
      .query("paperAccounts")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
      .first();
    const now = new Date().toISOString();
    if (row) await ctx.db.patch(row._id, { holdings: [usdtHolding(PAPER_START_USD)], startUsd: PAPER_START_USD, updatedAt: now });
  },
});

/** What the paper account is worth now, at live prices. On demand only. */
export const valuation = action({
  args: { conversationKey: v.string() },
  handler: async (ctx, { conversationKey }): Promise<{ valueUsd: number | null; startUsd: number; checkedAt: number } | null> => {
    const state: { startUsd: number; holdings: Holding[] } | null = await ctx.runQuery(internal.paperTrading.stateFor, { conversationKey });
    if (!state) return null;
    let total = 0;
    for (const holding of state.holdings) {
      const price = STABLES.has(holding.symbol) ? 1 : ((await bscPairFor(holding.address ?? WBNB_BSC).catch(() => null))?.priceUsd ?? null);
      if (price === null) return { valueUsd: null, startUsd: state.startUsd, checkedAt: Date.now() };
      total += Number(holding.amount) * price;
    }
    return { valueUsd: total, startUsd: state.startUsd, checkedAt: Date.now() };
  },
});

export const stateFor = internalQuery({
  args: { conversationKey: v.string() },
  handler: async (ctx, { conversationKey }): Promise<{ startUsd: number; holdings: Holding[] } | null> => {
    const draft = await draftFor(ctx, conversationKey);
    if (!draft) return null;
    const row = await ctx.db
      .query("paperAccounts")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id as Id<"agentDrafts">))
      .first();
    return { startUsd: row?.startUsd ?? PAPER_START_USD, holdings: row?.holdings ?? [usdtHolding(PAPER_START_USD)] };
  },
});
