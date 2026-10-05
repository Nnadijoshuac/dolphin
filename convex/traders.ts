import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { historyCandles } from "./lib/binanceMarket";
import { DOLPHIN_SWAP_GAS_USD } from "./lib/grid";
import { cleanRule, describeRule, simulate, TIMEFRAME_MS, VENUE_FEE_BPS, type Rule, type RuleState } from "./lib/strategy";
import { TRADER_MARKET, TRADER_MAX_USD, TRADER_MIN_USD, traderById, traderRule, TRADERS } from "./lib/traders";
import { randomHex, requireWalletAddress } from "./lib/walletAuth";

/**
 * HIRE A TRADER (owner + mentor, 2026-10-05; lib/traders.ts). Starting one makes an ordinary rules agent
 * in the hirer's own agents - so the engine, the order lock, the trade key, live P&L and the Wallet's
 * Trades tab all work unchanged. On paper it runs at once; with real money it arms only after the
 * hirer's passkey grants its trade key (web: the trader page calls `arm` after the grant).
 */

/** Backtests are re-run at most this often; between runs the page shows the stored result with its date. */
const STATS_FRESH_MS = 6 * 3_600_000;
const WINDOWS_DAYS = [90, 365] as const;
const SAMPLE_USD = 100;

type WindowStats = { days: number; resultPct: number; trades: number; winPct: number | null; worstDropPct: number; holdPct: number };

export const statsRow = internalQuery({
  args: {},
  handler: async (ctx) => ctx.db.query("traderStats").first(),
});

export const saveStats = internalMutation({
  args: { stats: v.any() },
  handler: async (ctx, { stats }) => {
    const row = await ctx.db.query("traderStats").first();
    if (row) await ctx.db.patch(row._id, { stats, at: Date.now() });
    else await ctx.db.insert("traderStats", { stats, at: Date.now() });
  },
});

/** The traders, with their last backtest. Plain data: no wallet needed to look. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("traderStats").first();
    const stats = (row?.stats ?? {}) as Record<string, WindowStats[]>;
    return {
      market: TRADER_MARKET,
      minUsd: TRADER_MIN_USD,
      statsAt: row?.at ?? null,
      traders: TRADERS.map((trader) => ({
        id: trader.id,
        name: trader.name,
        tagline: trader.tagline,
        risk: trader.risk,
        desk: trader.desk,
        timeframe: trader.timeframe,
        stopLossPct: trader.stopLossPct,
        takeProfitPct: trader.takeProfitPct,
        backtest: stats[trader.id] ?? null,
      })),
    };
  },
});

/**
 * Dolphin's own backtest of each trader over the last 90 and 365 days of Binance history: PancakeSwap's
 * fee each way and Dolphin Wallet gas on every swap included, on a sample $100 trade. Re-run when the
 * stored one is older than STATS_FRESH_MS; anyone may ask (it is cheap and changes nothing).
 */
export const refreshStats = action({
  args: {},
  handler: async (ctx): Promise<{ refreshed: boolean }> => {
    const row: Doc<"traderStats"> | null = await ctx.runQuery(internal.traders.statsRow, {});
    if (row && Date.now() - row.at < STATS_FRESH_MS) return { refreshed: false };
    const out: Record<string, WindowStats[]> = {};
    for (const trader of TRADERS) {
      const made = cleanRule(traderRule(trader, SAMPLE_USD), "backtest");
      if ("problems" in made) continue;
      const rule = made.rule as Rule;
      const warmup = 220;
      const longest = Math.max(...WINDOWS_DAYS);
      const candles = await historyCandles("binance-spot", TRADER_MARKET, rule.timeframe, Math.ceil((longest * 86_400_000) / TIMEFRAME_MS[rule.timeframe]) + warmup);
      out[trader.id] = WINDOWS_DAYS.map((days) => {
        const from = candles.length - Math.ceil((days * 86_400_000) / TIMEFRAME_MS[rule.timeframe]);
        const slice = candles.slice(Math.max(0, from - warmup));
        const result = simulate(rule, slice, { feeBps: VENUE_FEE_BPS[rule.venue], dailyLossLimitUsd: null, warmup: Math.min(warmup, from) });
        const net = result.totalUsd - result.trades.length * DOLPHIN_SWAP_GAS_USD;
        const closed = result.wins + result.losses;
        return {
          days,
          resultPct: Math.round((net / SAMPLE_USD) * 1000) / 10,
          trades: closed,
          winPct: closed ? Math.round((result.wins / closed) * 100) : null,
          worstDropPct: Math.round((result.maxDrawdownUsd / SAMPLE_USD) * 1000) / 10,
          holdPct: result.buyHoldPct,
        };
      });
    }
    await ctx.runMutation(internal.traders.saveStats, { stats: out });
    return { refreshed: true };
  },
});

async function traderDraft(ctx: QueryCtx, conversationKey: string, wallet: string) {
  const conversation = await ctx.db
    .query("dolphinConversations")
    .withIndex("by_key", (q) => q.eq("conversationKey", conversationKey))
    .unique();
  const draft = conversation
    ? await ctx.db
        .query("agentDrafts")
        .withIndex("by_conversation", (q) => q.eq("conversationId", conversation._id))
        .unique()
    : null;
  if (!draft || !draft.trader || draft.ownerAddress !== wallet.toLowerCase()) throw new ConvexError("That trader is not yours.");
  return draft;
}

/**
 * Starts a trader for the signed-in wallet. Paper: armed at once, no funds. Real money: needs the
 * disclaimer accepted here, and stays off until `arm` - after the trade key is granted.
 */
export const start = mutation({
  args: {
    sessionToken: v.string(),
    traderId: v.string(),
    amountUsd: v.number(),
    real: v.boolean(),
    acknowledge: v.optional(v.boolean()),
  },
  handler: async (ctx, { sessionToken, traderId, amountUsd, real, acknowledge }): Promise<{ conversationKey: string }> => {
    const wallet = (await requireWalletAddress(ctx, sessionToken, "Starting a trader")).toLowerCase();
    const trader = traderById(traderId);
    if (!trader) throw new ConvexError("That trader does not exist.");
    if (!(Number.isFinite(amountUsd) && amountUsd >= TRADER_MIN_USD && amountUsd <= TRADER_MAX_USD)) {
      throw new ConvexError(`Choose $${TRADER_MIN_USD} to $${TRADER_MAX_USD.toLocaleString("en")}.`);
    }
    if (real && !acknowledge) throw new ConvexError("Accept the real-money terms first.");
    const made = cleanRule(traderRule(trader, Math.floor(amountUsd * 100) / 100), `rule-${randomHex(4)}`);
    if ("problems" in made) throw new ConvexError(`The trader could not be set up: ${made.problems.join("; ")}.`);

    const now = Date.now();
    const conversationKey = randomHex(32);
    const conversationId = await ctx.db.insert("dolphinConversations", {
      conversationKey,
      ownerAddress: wallet,
      title: `${trader.name} trader`,
      seedAgentKey: null,
      mode: "build",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("agentDrafts", {
      conversationId,
      ownerAddress: wallet,
      trader: trader.id,
      name: `${trader.name} trader`,
      description: trader.tagline,
      instructions: describeRule(made.rule),
      tools: [],
      blocks: [{ id: `market-${randomHex(3)}`, type: "market", config: { symbol: "BNB", everyMinutes: null, direction: null, priceUsd: null, maxTradeUsd: null, maxTradesPerDay: null } }],
      rules: [made.rule],
      paperMode: !real,
      ...(real ? { liveAcknowledgedAt: now } : {}),
      // Paper runs at once. Real money waits for the trade key (`arm`).
      ...(real ? {} : { autopilot: { on: true, conversationKey, walletAddress: wallet, runsDay: new Date().toISOString().slice(0, 10), runs: 0 } }),
      createdAt: now,
      updatedAt: now,
    });
    return { conversationKey };
  },
});

/** Switches a real-money trader on, once its trade key is granted. */
export const arm = mutation({
  args: { sessionToken: v.string(), conversationKey: v.string() },
  handler: async (ctx, { sessionToken, conversationKey }) => {
    const wallet = (await requireWalletAddress(ctx, sessionToken, "Starting a trader")).toLowerCase();
    const draft = await traderDraft(ctx, conversationKey, wallet);
    await ctx.db.patch(draft._id, {
      autopilot: { on: true, conversationKey, walletAddress: wallet, runsDay: new Date().toISOString().slice(0, 10), runs: 0 },
      updatedAt: Date.now(),
    });
  },
});

/** Stops a trader buying. What it holds is kept; sell it from the Trades tab. */
export const stop = mutation({
  args: { sessionToken: v.string(), conversationKey: v.string() },
  handler: async (ctx, { sessionToken, conversationKey }) => {
    const wallet = (await requireWalletAddress(ctx, sessionToken, "Stopping a trader")).toLowerCase();
    const draft = await traderDraft(ctx, conversationKey, wallet);
    if (draft.autopilot) await ctx.db.patch(draft._id, { autopilot: { ...draft.autopilot, on: false }, updatedAt: Date.now() });
  },
});

/** The signed-in wallet's traders: what each holds, what it last saw, and its closed trades. */
export const mine = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    const wallet = await requireWalletAddress(ctx, sessionToken, "Your traders").catch(() => null);
    if (!wallet) return null;
    const drafts = (
      await ctx.db
        .query("agentDrafts")
        .withIndex("by_owner", (q) => q.eq("ownerAddress", wallet.toLowerCase()))
        .order("desc")
        .take(100)
    ).filter((draft) => draft.trader);
    const out = [];
    for (const draft of drafts) {
      const rule = ((draft.rules ?? []) as Rule[])[0];
      const conversation = await ctx.db.get(draft.conversationId);
      if (!rule || !conversation) continue;
      const run = await ctx.db
        .query("strategyRuns")
        .withIndex("by_draft_rule", (q) => q.eq("draftId", draft._id).eq("ruleId", rule.id))
        .unique();
      const trades = await ctx.db.query("strategyTrades").withIndex("by_draft", (q) => q.eq("draftId", draft._id)).order("desc").take(50);
      const exits = trades.filter((trade) => trade.kind === "exit" && trade.pnlPct !== null);
      out.push({
        conversationKey: conversation.conversationKey,
        traderId: draft.trader as string,
        name: draft.name ?? "Trader",
        sizeUsd: rule.sizeUsd,
        real: draft.paperMode === false,
        on: Boolean(draft.autopilot?.on),
        startedAt: draft.createdAt,
        position: ((run?.state as RuleState | undefined)?.position ?? null) as RuleState["position"],
        heldQty: typeof (run?.held as { qty?: unknown } | undefined)?.qty === "string" ? (run?.held as { qty: string }).qty : null,
        lastCheckedAt: run?.lastCheckedAt ?? null,
        lastReason: run?.lastReason ?? null,
        lastError: run?.lastError ?? null,
        closed: exits.length,
        won: exits.filter((trade) => (trade.pnlPct ?? 0) > 0).length,
        resultUsd: Math.round(exits.reduce((sum, trade) => sum + ((trade.pnlPct ?? 0) * trade.sizeUsd) / 100, 0) * 100) / 100,
        // What the live P&L widget needs (web/src/components/live-pnl.tsx).
        market: rule.market,
        venue: rule.venue,
        leverage: rule.leverage,
        ruleId: rule.id,
        draftId: draft._id,
      });
    }
    return out;
  },
});
