import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { AgentBlock } from "./lib/agentBlocks";
import { historyCandles } from "./lib/binanceMarket";
import { describeLocked, simulate, VENUE_FEE_BPS, type Rule } from "./lib/strategy";
import { randomHex, requireWalletAddress } from "./lib/walletAuth";

/**
 * TRADING SETUPS (owner, 2026-10-04: "a new category... you can actually sell your whole setup...
 * the strategy will be locked... nobody can see it").
 *
 * A builder lists an agent's whole setup - its trading rules and the blocks around them. A buyer
 * COPIES it into their own agent, trading their own money from their own wallet; the seller never
 * touches a buyer's funds. The copied rules are LOCKED (Rule.locked): their conditions stay on
 * Dolphin's servers - the buyer's panel, backtests and trade reasons leave them out
 * (lib/strategy.ts describeLocked, redactReason) and "Run it on your own server" refuses them.
 *
 * What a buyer can judge it by is all Dolphin's own: the public parts of each rule, a backtest Dolphin
 * runs itself on Binance's history when it is listed, and the source agent's trades since listing.
 * Nothing a seller types becomes a number. Free while Set and Quest runs (owner, 2026-10-04): there
 * is no price field until payment is switched on.
 */

/** Blocks a setup carries. Personal ones - a memory server, a data source, its keys, a wallet watch - stay with the seller. */
const COPYABLE = new Set(["market", "indicators", "safety", "risk", "quietHours", "schedule", "price", "signal", "binance"]);

export function sanitizeBlocks(blocks: readonly AgentBlock[]): AgentBlock[] {
  return blocks
    .filter((block) => COPYABLE.has(block.type))
    .map((block) =>
      block.type === "binance"
        ? // The buyer connects their own Binance: the seller's key names and network are not carried.
          { ...block, config: { account: block.config.account, futures: block.config.futures, maxLeverage: block.config.maxLeverage } }
        : block,
    );
}

/** What anyone may see of a rule: everything but its conditions. */
export function publicRule(rule: Rule) {
  return {
    words: describeLocked(rule),
    market: rule.market,
    timeframe: rule.timeframe,
    venue: rule.venue,
    action: rule.action,
    sizeUsd: rule.sizeUsd,
    leverage: rule.leverage,
    stopLossPct: rule.stopLossPct,
    takeProfitPct: rule.takeProfitPct,
    maxTradesPerDay: rule.maxTradesPerDay,
  };
}

/** Whether this wallet runs the draft: the brain's wallet, else Autopilot's, else the builder's. */
function runsDraft(draft: Doc<"agentDrafts">, wallet: string): boolean {
  const owner = draft.brain?.walletAddress ?? draft.autopilot?.walletAddress ?? draft.ownerAddress ?? null;
  return Boolean(owner) && owner!.toLowerCase() === wallet.toLowerCase();
}

/** Lists an agent's setup. Its rules are snapshotted as they are now; its backtest is run once listed. */
export const publish = mutation({
  args: { sessionToken: v.string(), conversationKey: v.string(), title: v.string(), summary: v.string() },
  handler: async (ctx, { sessionToken, conversationKey, title, summary }): Promise<Id<"setupListings">> => {
    const wallet = await requireWalletAddress(ctx, sessionToken, "Listing a setup");
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
    if (!draft) throw new ConvexError("That agent is not one you are building.");
    if (!runsDraft(draft, wallet)) throw new ConvexError("Only the wallet that runs this agent can list its setup.");
    const rules = ((draft.rules ?? []) as Rule[]).filter((rule) => rule && typeof rule.id === "string");
    if (rules.length === 0) throw new ConvexError("A setup needs at least one trading rule.");
    if (rules.some((rule) => rule.locked)) throw new ConvexError("This agent includes a setup copied from someone else; it cannot be listed again.");
    const cleanTitle = title.trim().slice(0, 80);
    const cleanSummary = summary.trim().slice(0, 600);
    if (cleanTitle.length < 3) throw new ConvexError("Give the setup a title.");

    const now = Date.now();
    const existing = await ctx.db
      .query("setupListings")
      .withIndex("by_source", (q) => q.eq("sourceDraftId", draft._id))
      .first();
    const fields = {
      ownerAddress: wallet.toLowerCase(),
      title: cleanTitle,
      summary: cleanSummary,
      snapshot: {
        name: draft.name ?? cleanTitle,
        description: draft.description ?? null,
        instructions: draft.instructions ?? null,
        blocks: sanitizeBlocks((draft.blocks ?? []) as AgentBlock[]),
        rules,
      },
      publicRules: rules.map(publicRule),
      stats: null,
      status: "listed" as const,
      updatedAt: now,
    };
    const id = existing ? existing._id : await ctx.db.insert("setupListings", { ...fields, sourceDraftId: draft._id, copies: 0, createdAt: now, listedAt: now });
    if (existing) await ctx.db.patch(existing._id, { ...fields, listedAt: now });
    await ctx.scheduler.runAfter(0, internal.setups.backtest, { listingId: id });
    return id;
  },
});

export const withdraw = mutation({
  args: { sessionToken: v.string(), listingId: v.id("setupListings") },
  handler: async (ctx, { sessionToken, listingId }) => {
    const wallet = await requireWalletAddress(ctx, sessionToken, "Withdrawing a setup");
    const listing = await ctx.db.get(listingId);
    if (!listing || listing.ownerAddress !== wallet.toLowerCase()) throw new ConvexError("That setup is not yours.");
    await ctx.db.patch(listingId, { status: "withdrawn", updatedAt: Date.now() });
  },
});

export const listingRules = internalQuery({
  args: { listingId: v.id("setupListings") },
  handler: async (ctx, { listingId }) => ((await ctx.db.get(listingId))?.snapshot.rules ?? null) as Rule[] | null,
});

export const saveStats = internalMutation({
  args: { listingId: v.id("setupListings"), stats: v.any() },
  handler: async (ctx, { listingId, stats }) => {
    if (await ctx.db.get(listingId)) await ctx.db.patch(listingId, { stats, updatedAt: Date.now() });
  },
});

/** Dolphin's own backtest of each listed rule on Binance's history - the numbers a buyer sees. */
export const backtest = internalAction({
  args: { listingId: v.id("setupListings") },
  handler: async (ctx, { listingId }) => {
    const rules = await ctx.runQuery(internal.setups.listingRules, { listingId });
    if (!rules) return;
    const stats = [];
    for (const rule of rules) {
      try {
        const candles = await historyCandles(rule.venue, rule.market, rule.timeframe, 1_000);
        if (candles.length < 80) {
          stats.push({ market: rule.market, timeframe: rule.timeframe, error: "Not enough history to test on." });
          continue;
        }
        const result = simulate(rule, candles, { feeBps: VENUE_FEE_BPS[rule.venue], dailyLossLimitUsd: null });
        const closed = result.wins + result.losses;
        stats.push({
          market: rule.market,
          timeframe: rule.timeframe,
          from: candles[0].openTime,
          to: candles[candles.length - 1].openTime,
          resultPct: result.returnPct,
          holdPct: result.buyHoldPct,
          trades: closed,
          winPct: closed ? Math.round((result.wins / closed) * 1000) / 10 : null,
          worstDropUsd: result.maxDrawdownUsd,
          sizeUsd: rule.sizeUsd,
        });
      } catch {
        stats.push({ market: rule.market, timeframe: rule.timeframe, error: "Binance's history did not answer." });
      }
    }
    await ctx.runMutation(internal.setups.saveStats, { listingId, stats: { at: Date.now(), rules: stats } });
  },
});

/** What a buyer sees of a listing - never the snapshot. */
function card(listing: Doc<"setupListings">) {
  return {
    id: listing._id,
    title: listing.title,
    summary: listing.summary,
    seller: listing.ownerAddress,
    rules: listing.publicRules,
    stats: listing.stats ?? null,
    copies: listing.copies,
    listedAt: listing.listedAt,
  };
}

export const list = query({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("setupListings").withIndex("by_status_listed", (q) => q.eq("status", "listed")).order("desc").take(60)).map(card),
});

/** One listing, with the source agent's trades since it was listed - from Dolphin's own trade log. */
export const get = query({
  args: { listingId: v.string() },
  handler: async (ctx, { listingId }) => {
    const id = ctx.db.normalizeId("setupListings", listingId);
    const listing = id ? await ctx.db.get(id) : null;
    if (!listing || listing.status !== "listed") return null;
    const trades = (await ctx.db.query("strategyTrades").withIndex("by_draft", (q) => q.eq("draftId", listing.sourceDraftId)).order("desc").take(200)).filter(
      (trade) => trade.at >= listing.listedAt,
    );
    const exits = trades.filter((trade) => trade.kind === "exit" && trade.pnlPct !== null);
    return {
      ...card(listing),
      sinceListed: {
        trades: trades.length,
        closed: exits.length,
        won: exits.filter((trade) => (trade.pnlPct ?? 0) > 0).length,
        real: trades.filter((trade) => trade.paper === false).length,
        sumPct: Math.round(exits.reduce((sum, trade) => sum + (trade.pnlPct ?? 0), 0) * 100) / 100,
      },
    };
  },
});

/** The setups a wallet has listed, for its own panel. */
export const mine = query({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    const wallet = await requireWalletAddress(ctx, sessionToken, "Your setups").catch(() => null);
    if (!wallet) return [];
    return (await ctx.db.query("setupListings").withIndex("by_owner", (q) => q.eq("ownerAddress", wallet.toLowerCase())).collect())
      .filter((listing) => listing.status === "listed")
      .map(card);
  },
});

/**
 * Copies a setup into a new agent for the signed-in buyer: its blocks, its rules LOCKED, on paper with
 * Autopilot off - nothing trades until the buyer chooses to. Returns the new build conversation's key.
 */
export const copy = mutation({
  args: { sessionToken: v.string(), listingId: v.id("setupListings") },
  handler: async (ctx, { sessionToken, listingId }): Promise<{ conversationKey: string }> => {
    const wallet = (await requireWalletAddress(ctx, sessionToken, "Copying a setup")).toLowerCase();
    const listing = await ctx.db.get(listingId);
    if (!listing || listing.status !== "listed") throw new ConvexError("That setup is no longer listed.");
    if (listing.ownerAddress === wallet) throw new ConvexError("This is your own setup.");
    const now = Date.now();
    const conversationKey = randomHex(32);
    const conversationId = await ctx.db.insert("dolphinConversations", {
      conversationKey,
      ownerAddress: wallet,
      title: listing.title,
      seedAgentKey: null,
      mode: "build",
      createdAt: now,
      updatedAt: now,
    });
    const snapshot = listing.snapshot as { name: string; description: string | null; instructions: string | null; blocks: AgentBlock[]; rules: Rule[] };
    await ctx.db.insert("agentDrafts", {
      conversationId,
      ownerAddress: wallet,
      name: snapshot.name,
      description: snapshot.description,
      instructions: snapshot.instructions,
      tools: [],
      blocks: snapshot.blocks,
      rules: snapshot.rules.map((rule) => ({ ...rule, id: `rule-${randomHex(4)}`, locked: listing._id })),
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(listing._id, { copies: listing.copies + 1 });
    return { conversationKey };
  },
});
