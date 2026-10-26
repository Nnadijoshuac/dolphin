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
import { action, internalAction, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { bscPairFor } from "./lib/agentBlocks";
import { bscPublicClient } from "./lib/bscClient";
import { describeRoute, quoteTrade, WBNB_BSC, type TradeSide } from "./lib/pancakeswapTrade";
import { resultPct, resultUsd, type Rule, type RuleState } from "./lib/strategy";
import { verifiedTokens } from "./lib/tradeTokens";

export const PAPER_START_USD = 1_000;
/** A V2/V3 swap's gas, generously rounded; priced at the chain's live gas price. */
const SWAP_GAS_UNITS = BigInt(220_000);
const STABLES = new Set(["USDT", "USDC", "U"]);
/** One demo deposit or withdrawal, at most. */
const MAX_MOVE_USD = 100_000;
const MOVES_CAP = 30;

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
      moves: [...(row?.moves ?? [])].reverse().slice(0, 10),
      putInUsd: (row?.startUsd ?? PAPER_START_USD) + netMoved(row),
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
    // A public run is paper or real for its whole life: switching modes ends it, so a paper run never goes on showing real trades.
    const runs = await ctx.db.query("liveRuns").withIndex("by_draft", (q) => q.eq("draftId", draft._id)).take(10);
    for (const run of runs) {
      if (run.status === "running" && (run.paper === true) !== paperMode) await ctx.db.patch(run._id, { status: "ended", endedAt: now });
    }
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
    // A fresh start: rule trades before now no longer count, and deposits are forgotten.
    const fresh = { holdings: [usdtHolding(PAPER_START_USD)], startUsd: PAPER_START_USD, updatedAt: now, resetAt: Date.now(), drawnUsd: 0, moves: [] };
    if (row) await ctx.db.patch(row._id, fresh);
    else await ctx.db.insert("paperAccounts", { draftId: draft._id, ...fresh, createdAt: now });
  },
});

/** What the paper account is worth now, at live prices - holdings, rule results and open rule positions. On demand only. */
export const valuation = action({
  args: { conversationKey: v.string() },
  handler: async (ctx, { conversationKey }): Promise<{ valueUsd: number | null; startUsd: number; checkedAt: number } | null> => {
    const state: { draftId: Id<"agentDrafts">; startUsd: number } | null = await ctx.runQuery(internal.paperTrading.stateFor, { conversationKey });
    if (!state) return null;
    const ledger: Ledger = await ctx.runQuery(internal.paperTrading.ledger, { draftId: state.draftId });
    const valueUsd = await valueOf(ledger).catch(() => null);
    return { valueUsd, startUsd: state.startUsd, checkedAt: Date.now() };
  },
});

export const stateFor = internalQuery({
  args: { conversationKey: v.string() },
  handler: async (ctx, { conversationKey }): Promise<{ draftId: Id<"agentDrafts">; startUsd: number } | null> => {
    const draft = await draftFor(ctx, conversationKey);
    if (!draft) return null;
    const row = await ctx.db
      .query("paperAccounts")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id as Id<"agentDrafts">))
      .first();
    // What was put in - the starting money, plus deposits, less withdrawals - so the result is the trading alone.
    return { draftId: draft._id, startUsd: (row?.startUsd ?? PAPER_START_USD) + netMoved(row) };
  },
});

/* ── the whole demo account: holdings, rule results, open positions, deposits ─────────────────── */

/*
 * A DEMO ACCOUNT LIKE A BROKER'S (owner, 2026-10-26: "the way when you're trading in the demo accounts... you
 * can even withdraw demo, but it doesn't go anywhere. You can add demo currency, but it doesn't come from
 * anywhere"). Two things trade on paper: the Brain's swaps move `holdings` token by token (fill, above), and
 * trading rules record each paper trade in strategyTrades at the closed candle's price. The account is worth
 * both: its holdings at live prices, plus every paper rule trade's result since `resetAt`, plus what each open
 * paper rule position would close for now, less demo money drawn out of those results.
 */
type Ledger = {
  holdings: Holding[];
  realizedUsd: number;
  drawnUsd: number;
  open: { market: string; side: "long" | "short"; entryPrice: number; sizeUsd: number; leverage: number }[];
};

function netMoved(row: Doc<"paperAccounts"> | null): number {
  return (row?.moves ?? []).reduce((sum, move) => sum + (move.kind === "deposit" ? move.usd : -move.usd), 0);
}

async function ledgerOf(ctx: QueryCtx | MutationCtx, draftId: Id<"agentDrafts">): Promise<Ledger & { row: Doc<"paperAccounts"> | null }> {
  const row = await ctx.db
    .query("paperAccounts")
    .withIndex("by_draft", (q) => q.eq("draftId", draftId))
    .first();
  const trades = (
    await ctx.db
      .query("strategyTrades")
      .withIndex("by_draft", (q) => q.eq("draftId", draftId).gte("at", row?.resetAt ?? 0))
      .order("desc")
      .take(2000)
  ).filter((trade) => trade.paper && (trade.source ?? "dolphin") === "dolphin");
  const realizedUsd = trades
    .filter((trade) => trade.kind === "exit" && trade.pnlPct !== null)
    .reduce((sum, trade) => sum + resultUsd(trade.pnlPct as number, trade.sizeUsd), 0);
  const draft = await ctx.db.get(draftId);
  const rules = ((draft?.rules ?? []) as Rule[]).filter((rule) => rule && typeof rule.id === "string");
  const states = await ctx.db
    .query("strategyRuns")
    .withIndex("by_draft_rule", (q) => q.eq("draftId", draftId))
    .take(50);
  const open: Ledger["open"] = [];
  for (const rule of rules) {
    const position = ((states.find((state) => state.ruleId === rule.id)?.state ?? null) as RuleState | null)?.position;
    // Counted only when the latest buy of this rule is a paper trade this account counts (trades are newest first).
    const opener = trades.find((trade) => trade.ruleId === rule.id && trade.kind === "enter");
    if (position && opener) open.push({ market: rule.market, side: position.side, entryPrice: position.entryPrice, sizeUsd: rule.sizeUsd, leverage: rule.leverage ?? 1 });
  }
  return { row, holdings: row?.holdings ?? [usdtHolding(PAPER_START_USD)], realizedUsd, drawnUsd: row?.drawnUsd ?? 0, open };
}

export const ledger = internalQuery({
  args: { draftId: v.id("agentDrafts") },
  handler: async (ctx, { draftId }): Promise<Ledger> => {
    const { holdings, realizedUsd, drawnUsd, open } = await ledgerOf(ctx, draftId);
    return { holdings, realizedUsd, drawnUsd, open };
  },
});

/** Last prices of Binance markets: spot first, then futures for a market only futures lists. Throws rather than guess. */
async function binancePrices(markets: string[]): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  const wanted = [...new Set(markets)];
  if (!wanted.length) return prices;
  const spot = await fetch(`https://api.binance.com/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(wanted))}`, {
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (spot?.ok) for (const row of (await spot.json()) as { symbol: string; price: string }[]) prices.set(row.symbol, Number(row.price));
  for (const market of wanted.filter((m) => !prices.has(m))) {
    const response = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${encodeURIComponent(market)}`, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`No price for ${market}.`);
    prices.set(market, Number(((await response.json()) as { price: string }).price));
  }
  return prices;
}

/** The demo account in dollars, at live prices. Throws when anything in it cannot be priced. */
async function valueOf(ledger: Ledger): Promise<number> {
  let usd = ledger.realizedUsd - ledger.drawnUsd;
  for (const holding of ledger.holdings) {
    const amount = Number(holding.amount);
    if (!(amount > 0)) continue;
    const price = STABLES.has(holding.symbol) ? 1 : ((await bscPairFor(holding.address ?? WBNB_BSC).catch(() => null))?.priceUsd ?? null);
    if (price === null) throw new Error(`No price for paper ${holding.symbol}.`);
    usd += amount * price;
  }
  const prices = await binancePrices(ledger.open.map((position) => position.market));
  for (const position of ledger.open) {
    usd += resultUsd(resultPct(position.side, position.entryPrice, prices.get(position.market)!, position.leverage), position.sizeUsd);
  }
  return Math.round(usd * 100) / 100;
}

/** What a paper run is worth now (liveRuns.ts). */
export const value = internalAction({
  args: { draftId: v.id("agentDrafts") },
  handler: async (ctx, { draftId }): Promise<number> => valueOf(await ctx.runQuery(internal.paperTrading.ledger, { draftId })),
});

/**
 * Adds or withdraws demo money; nothing comes from anywhere or goes anywhere. A deposit lands as USDT. A
 * withdrawal takes USDT first, then rule profits, and never more than the account has free. A paper run that
 * is live moves its starting point by the same amount, so its result stays the trading alone, and says so.
 */
export const move = mutation({
  args: { conversationKey: v.string(), kind: v.union(v.literal("deposit"), v.literal("withdraw")), usd: v.number() },
  handler: async (ctx, { conversationKey, kind, usd }) => {
    const draft = await draftFor(ctx, conversationKey);
    if (!draft) throw new ConvexError("That draft is empty.");
    const amount = Math.round(usd * 100) / 100;
    if (!(amount >= 1) || amount > MAX_MOVE_USD) throw new ConvexError(`Enter between $1 and $${MAX_MOVE_USD.toLocaleString("en")}.`);
    const { row, holdings, realizedUsd, drawnUsd } = await ledgerOf(ctx, draft._id);
    const next = holdings.map((h) => ({ ...h }));
    let usdt = next.find((h) => h.symbol === "USDT");
    if (!usdt) {
      usdt = usdtHolding(0);
      next.push(usdt);
    }
    let drawn = drawnUsd;
    if (kind === "deposit") usdt.amount = (Number(usdt.amount) + amount).toFixed(2);
    else {
      const free = Number(usdt.amount) + realizedUsd - drawnUsd;
      if (amount > free + 0.001) throw new ConvexError(`The demo account has $${Math.max(free, 0).toFixed(2)} free to withdraw.`);
      const fromUsdt = Math.min(amount, Number(usdt.amount));
      usdt.amount = (Number(usdt.amount) - fromUsdt).toFixed(2);
      drawn = Math.round((drawnUsd + amount - fromUsdt) * 100) / 100;
    }
    const at = Date.now();
    const nowIso = new Date(at).toISOString();
    const moves = [...(row?.moves ?? []), { at, kind, usd: amount }].slice(-MOVES_CAP);
    const kept = next.filter((h) => h.symbol === "USDT" || Number(h.amount) > 0);
    if (row) await ctx.db.patch(row._id, { holdings: kept, drawnUsd: drawn, moves, updatedAt: nowIso });
    else await ctx.db.insert("paperAccounts", { draftId: draft._id, startUsd: PAPER_START_USD, holdings: kept, createdAt: nowIso, updatedAt: nowIso, drawnUsd: drawn, moves });

    const runs = await ctx.db.query("liveRuns").withIndex("by_draft", (q) => q.eq("draftId", draft._id)).take(10);
    const run = runs.find((r) => r.status === "running" && r.paper);
    if (run) {
      const delta = kind === "deposit" ? amount : -amount;
      const lastUsd = Math.round((run.lastUsd + delta) * 100) / 100;
      await ctx.db.patch(run._id, {
        startUsd: Math.round((run.startUsd + delta) * 100) / 100,
        lastUsd,
        history: [...run.history, { t: at, usd: lastUsd }].slice(-1500),
        thoughts: [...run.thoughts, { t: at, text: kind === "deposit" ? `Added $${amount.toFixed(2)} in demo money.` : `Withdrew $${amount.toFixed(2)} in demo money.` }].slice(-40),
      });
    }
  },
});
