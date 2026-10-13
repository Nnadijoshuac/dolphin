import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { historyCandles } from "./lib/binanceMarket";
import { DOLPHIN_SWAP_GAS_USD } from "./lib/grid";
import { cleanRule, describeLocked, describeRule, simulate, TIMEFRAME_MS, VENUE_FEE_BPS, type Rule, type RuleState } from "./lib/strategy";
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
    // A changed rule (lib/traders.ts) re-runs at once instead of showing the old rule's record for 6 h.
    const signature = JSON.stringify(TRADERS.map((trader) => [trader.id, trader.when, trader.until, trader.stopLossPct, trader.takeProfitPct]));
    const storedSignature = (row?.stats as { __signature?: string } | undefined)?.__signature;
    if (row && storedSignature === signature && Date.now() - row.at < STATS_FRESH_MS) return { refreshed: false };
    const out: Record<string, WindowStats[] | string> = { __signature: signature };
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


/* ── Any trading agent built on Dolphin, run in your own wallet (owner, 2026-10-05: "Hire = it runs in your own wallet") ── */

/** The built agent behind a catalog key, with the rules its draft trades by - or null when it trades nothing. */
async function runnable(ctx: QueryCtx, agentKey: string) {
  const listing = await ctx.db
    .query("builtAgents")
    .withIndex("by_agent_key", (q) => q.eq("agentKey", agentKey.toLowerCase()))
    .first();
  if (!listing || listing.status !== "registered") return null;
  const draft = await ctx.db.get(listing.draftId);
  const rules = ((draft?.rules ?? []) as Rule[]).filter((rule) => rule && typeof rule.id === "string" && rule.venue === "dolphin-wallet" && !rule.grid);
  if (!draft || rules.length === 0) return null;
  return { listing, draft, rules };
}

/**
 * What a hirer sees before running a Dolphin-built trading agent: each rule's public parts, never its
 * conditions (the builder's strategy stays theirs - lib/strategy.ts describeLocked).
 */
export const runnableFor = query({
  args: { agentKey: v.string() },
  handler: async (ctx, { agentKey }) => {
    const found = await runnable(ctx, agentKey);
    if (!found) return null;
    return {
      name: found.listing.name,
      traderId: found.draft.trader ?? null,
      minUsd: TRADER_MIN_USD,
      rules: found.rules.map((rule) => ({
        // The hirer chooses the amount, so the builder's own size is not shown as theirs.
        words: describeLocked(rule).replace(/(buy|short) \$[\d,.]+( at \d+x)?/, "$1 with your amount$2"),
        market: rule.market,
        timeframe: rule.timeframe,
        stopLossPct: rule.stopLossPct,
        takeProfitPct: rule.takeProfitPct,
        maxTradesPerDay: rule.maxTradesPerDay,
      })),
    };
  },
});

/**
 * HIRE A TRADING AGENT: copies a Dolphin-built agent's rules into the hirer's own agents, its strategy
 * locked, sized to the hirer's amount (split evenly across its rules). Same paper/real path as Steady
 * and Bold: paper runs at once; real money arms after the trade key (`arm`).
 */
export const startFromAgent = mutation({
  args: { sessionToken: v.string(), agentKey: v.string(), amountUsd: v.number(), real: v.boolean(), acknowledge: v.optional(v.boolean()) },
  handler: async (ctx, { sessionToken, agentKey, amountUsd, real, acknowledge }): Promise<{ conversationKey: string }> => {
    const wallet = (await requireWalletAddress(ctx, sessionToken, "Hiring a trading agent")).toLowerCase();
    const found = await runnable(ctx, agentKey);
    if (!found) throw new ConvexError("That agent has no trading rules to run.");
    if (!(Number.isFinite(amountUsd) && amountUsd >= TRADER_MIN_USD && amountUsd <= TRADER_MAX_USD)) {
      throw new ConvexError(`Choose $${TRADER_MIN_USD} to $${TRADER_MAX_USD.toLocaleString("en")}.`);
    }
    if (real && !acknowledge) throw new ConvexError("Accept the real-money terms first.");
    const each = Math.floor((amountUsd / found.rules.length) * 100) / 100;
    if (each < 1) throw new ConvexError("That amount is too small to split across this agent's rules.");
    // Its builder, and Dolphin's own traders (their rules are public on /trade), run unlocked.
    const own = found.listing.ownerAddress.toLowerCase() === wallet || traderById(found.draft.trader ?? "") !== null;
    const rules: Rule[] = [];
    for (const rule of found.rules) {
      const made = cleanRule({ ...rule, sizeUsd: each }, `rule-${randomHex(4)}`);
      if ("problems" in made) throw new ConvexError(`This agent's rules could not be copied: ${made.problems.join("; ")}.`);
      // Locked for anyone but its builder: the hirer runs it without seeing its conditions.
      rules.push(own ? made.rule : { ...made.rule, locked: `built:${found.listing.hash}` });
    }
    const now = Date.now();
    const conversationKey = randomHex(32);
    const conversationId = await ctx.db.insert("dolphinConversations", {
      conversationKey,
      ownerAddress: wallet,
      title: found.listing.name,
      seedAgentKey: found.listing.agentKey,
      mode: "build",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("agentDrafts", {
      conversationId,
      ownerAddress: wallet,
      trader: found.draft.trader ?? `agent:${found.listing.agentKey}`,
      name: found.listing.name,
      description: found.listing.description,
      instructions: null,
      tools: [],
      blocks: [],
      rules,
      paperMode: !real,
      ...(real ? { liveAcknowledgedAt: now } : {}),
      ...(real ? {} : { autopilot: { on: true, conversationKey, walletAddress: wallet, runsDay: new Date().toISOString().slice(0, 10), runs: 0 } }),
      createdAt: now,
      updatedAt: now,
    });
    return { conversationKey };
  },
});

/**
 * Dolphin's own Steady and Bold as ordinary agents for the owner to put on-chain (owner, 2026-10-05:
 * "list those agents as our agents in the marketplace... arrange it so I can sign it"). Creates two
 * build drafts in the given wallet; the owner opens each and presses Put on-chain. Run by an operator:
 *   npx convex run --prod traders:seedHouseDrafts '{"wallet":"0x..."}'
 */
export const seedHouseDrafts = internalMutation({
  args: { wallet: v.string() },
  handler: async (ctx, { wallet }) => {
    const owner = wallet.toLowerCase();
    const out: { name: string; conversationKey: string }[] = [];
    for (const trader of TRADERS) {
      const made = cleanRule(traderRule(trader, 50), `rule-${randomHex(4)}`);
      if ("problems" in made) throw new ConvexError(made.problems.join("; "));
      const now = Date.now();
      const conversationKey = randomHex(32);
      const conversationId = await ctx.db.insert("dolphinConversations", {
        conversationKey,
        ownerAddress: owner,
        title: `Dolphin ${trader.name}`,
        seedAgentKey: null,
        mode: "build",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("agentDrafts", {
        conversationId,
        ownerAddress: owner,
        trader: trader.id,
        name: `Dolphin ${trader.name}`,
        description: `${trader.tagline} Trades BNB from your own wallet by fixed rules: ${trader.desk.buys} ${trader.desk.protects}`,
        instructions: describeRule(made.rule),
        tools: [],
        blocks: [{ id: `market-${randomHex(3)}`, type: "market", config: { symbol: "BNB", everyMinutes: null, direction: null, priceUsd: null, maxTradeUsd: null, maxTradesPerDay: null } }],
        rules: [made.rule],
        paperMode: true,
        createdAt: now,
        updatedAt: now,
      });
      out.push({ name: `Dolphin ${trader.name}`, conversationKey });
    }
    return out;
  },
});

/* ── The trading hub (owner, 2026-10-13: beebots' substance in Guild Agent Hub's calm) ── */

/**
 * Who made Steady and Bold. The owner asked that they read as made by him, not as a special house
 * product ("created by @Joshua, use my wallet as the creator").
 */
// Owner, 2026-10-13: a builder name, not his full name ("I just use Serenity instead").
const HOUSE_CREATOR = { name: "Serenity", handle: null as string | null, address: "0x13450a106568d011d25d8ac222b489b098df9196" };

type HubTrade = { at: number; kind: "enter" | "exit"; side: "long" | "short"; price: number; sizeUsd: number; pnlPct: number | null; paper: boolean; reason: string; txHash: string | null };

function record(trades: Doc<"strategyTrades">[]) {
  const exits = trades.filter((trade) => trade.kind === "exit" && trade.pnlPct !== null);
  const resultUsd = exits.reduce((sum, trade) => sum + ((trade.pnlPct ?? 0) * trade.sizeUsd) / 100, 0);
  const staked = exits.reduce((sum, trade) => sum + trade.sizeUsd, 0);
  return {
    closed: exits.length,
    won: exits.filter((trade) => (trade.pnlPct ?? 0) > 0).length,
    resultUsd: Math.round(resultUsd * 100) / 100,
    resultPct: staked > 0 ? Math.round((resultUsd / (staked / Math.max(exits.length, 1))) * 1000) / 10 : null,
    paper: trades.length > 0 ? trades.every((trade) => trade.paper) : null,
    lastAt: trades[0]?.at ?? null,
    lastReason: trades[0]?.reason ?? null,
  };
}

function hubTrades(trades: Doc<"strategyTrades">[]): HubTrade[] {
  return trades.map((trade) => ({
    at: trade.at,
    kind: trade.kind,
    side: trade.side,
    price: trade.price,
    sizeUsd: trade.sizeUsd,
    pnlPct: trade.pnlPct,
    paper: trade.paper,
    reason: trade.reason,
    txHash: trade.txHash ?? null,
  }));
}

/** Registered Dolphin-built agents that trade from a Dolphin Wallet, with their builder's own record. */
async function communityTraders(ctx: QueryCtx, tradesEach: number) {
  const listings = (
    await ctx.db
      .query("builtAgents")
      .withIndex("by_status_network", (q) => q.eq("status", "registered").eq("network", "bsc"))
      .take(200)
  ).filter((listing) => listing.agentKey);
  const out = [];
  for (const listing of listings) {
    const draft = await ctx.db.get(listing.draftId);
    if (!draft || draft.trader === "steady" || draft.trader === "bold") continue;
    const rules = ((draft.rules ?? []) as Rule[]).filter((rule) => rule && rule.venue === "dolphin-wallet" && !rule.grid);
    if (rules.length === 0) continue;
    const trades = await ctx.db.query("strategyTrades").withIndex("by_draft", (q) => q.eq("draftId", draft._id)).order("desc").take(tradesEach);
    const quietFor = Date.now() - (trades[0]?.at ?? draft.updatedAt);
    // The seabed (owner, 2026-10-13): a trader whose builder stopped it, or that has not traded in 14 days.
    const active = Boolean(draft.autopilot?.on) && quietFor < 14 * 86_400_000;
    out.push({ listing, draft, rules, trades, active });
  }
  return out;
}

export const hub = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("traderStats").first();
    const stats = (row?.stats ?? {}) as Record<string, WindowStats[]>;
    const house = TRADERS.map((trader) => ({
      id: trader.id as string,
      kind: "house" as const,
      name: trader.name,
      tagline: trader.tagline,
      risk: trader.risk,
      market: TRADER_MARKET,
      timeframe: trader.timeframe,
      creator: HOUSE_CREATOR,
      backtest: stats[trader.id] ?? null,
      live: null,
      priceUsd: null,
      active: true,
    }));
    const community = (await communityTraders(ctx, 60)).map(({ listing, rules, trades, active }) => ({
      active,
      id: listing.agentKey as string,
      kind: "community" as const,
      name: listing.name,
      tagline: listing.description.length > 140 ? `${listing.description.slice(0, 137)}…` : listing.description,
      risk: null,
      market: rules[0].market,
      timeframe: rules[0].timeframe,
      creator: { name: null, handle: listing.links.x ? listing.links.x.replace(/^.*\//, "").replace(/^@/, "") : null, address: listing.ownerAddress },
      backtest: null,
      live: record(trades),
      priceUsd: listing.hirePriceUsd ?? null,
    }));
    return { minUsd: TRADER_MIN_USD, statsAt: row?.at ?? null, traders: [...house, ...community] };
  },
});

/** One trader's page: its rules in words, its record and its trade history. */
export const trader = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const houseTrader = traderById(id);
    if (houseTrader) {
      const row = await ctx.db.query("traderStats").first();
      const stats = (row?.stats ?? {}) as Record<string, WindowStats[]>;
      return {
        id,
        kind: "house" as const,
        name: houseTrader.name,
        tagline: houseTrader.tagline,
        risk: houseTrader.risk,
        market: TRADER_MARKET,
        timeframe: houseTrader.timeframe,
        creator: HOUSE_CREATOR,
        desk: houseTrader.desk,
        rules: [] as string[],
        stopLossPct: houseTrader.stopLossPct,
        takeProfitPct: houseTrader.takeProfitPct,
        backtest: stats[houseTrader.id] ?? null,
        statsAt: row?.at ?? null,
        live: null,
        trades: [] as HubTrade[],
        priceUsd: null,
        minUsd: TRADER_MIN_USD,
      };
    }
    const found = await runnable(ctx, id);
    if (!found) return null;
    const trades = await ctx.db.query("strategyTrades").withIndex("by_draft", (q) => q.eq("draftId", found.draft._id)).order("desc").take(100);
    const rule = found.rules[0];
    return {
      id: found.listing.agentKey as string,
      kind: "community" as const,
      name: found.listing.name,
      tagline: found.listing.description,
      risk: null,
      market: rule.market,
      timeframe: rule.timeframe,
      creator: { name: null, handle: found.listing.links.x ? found.listing.links.x.replace(/^.*\//, "").replace(/^@/, "") : null, address: found.listing.ownerAddress },
      desk: null,
      rules: found.rules.map((each) => describeLocked(each).replace(/(buy|short) \$[\d,.]+( at \d+x)?/, "$1 with your amount$2")),
      stopLossPct: rule.stopLossPct,
      takeProfitPct: rule.takeProfitPct,
      backtest: null,
      statsAt: null,
      live: record(trades),
      trades: hubTrades(trades),
      priceUsd: found.listing.hirePriceUsd ?? null,
      minUsd: TRADER_MIN_USD,
    };
  },
});
