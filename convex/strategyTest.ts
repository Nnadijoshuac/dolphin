import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { randomHex, requireWalletAddress } from "./lib/walletAuth";
import { historyCandles } from "./lib/binanceMarket";
import { DOLPHIN_SWAP_GAS_USD } from "./lib/grid";
import { cleanRule, describeRule, simulate, TIMEFRAME_MS, VENUE_FEE_BPS, type Rule } from "./lib/strategy";

/**
 * "WOULD YOUR STRATEGY HAVE SURVIVED?" (owner, 2026-10-13: "build it... this is the kind of thing that
 * goes viral"). Anyone picks a coin, an entry and an exit from fixed choices; Dolphin replays it on a
 * year of Binance prices with the same engine, fees and gas as a live rule, and shows it against just
 * holding the coin.
 *
 * Lean by construction (owner: "be careful" with read/writes): no table, no model call, no session.
 * The window ends on the day named in the request, so one set of choices always gives one answer; the
 * website serves it through a CDN-cached route (web/src/app/api/strategy-test), so a viral wave mostly
 * never reaches this action. Inputs are closed sets, so it cannot be used to run arbitrary rules.
 */

export const TEST_COINS = ["BNB", "BTC", "ETH", "SOL"] as const;
export const TEST_ENTRIES = {
  dip: [3, 5, 8, 12],
  rsi: [25, 30, 35, 40],
  trend: [35, 40, 45],
  momentum: [3, 5, 8],
} as const;
export const TEST_TARGETS = [2, 3, 5, 8, 12, 20] as const;
export const TEST_STOPS = [2, 3, 5, 8, 12] as const;
const DAYS = 365;
const TIMEFRAME = "4h" as const;
const WARMUP = 220;
const SIZE_USD = 100;
const CURVE_POINTS = 90;

type Entry = keyof typeof TEST_ENTRIES;

function entryConditions(entry: Entry, level: number) {
  switch (entry) {
    case "dip":
      return [{ kind: "change_pct", op: "below", value: -level, candles: 6 }];
    case "rsi":
      return [{ kind: "rsi", op: "below", value: level, period: 14 }];
    case "trend":
      return [
        { kind: "price_vs_ma", op: "above", ma: "ema", length: 100 },
        { kind: "rsi", op: "below", value: level, period: 14 },
      ];
    case "momentum":
      return [{ kind: "change_pct", op: "above", value: level, candles: 6 }];
  }
}

function pick<T extends number>(list: readonly T[], value: number, label: string): T {
  if (!(list as readonly number[]).includes(value)) throw new ConvexError(`Unknown ${label}.`);
  return value as T;
}

type Choices = { coin: string; entry: Entry; level: number; target: number | null; stop: number | null };

/** The closed choices, checked; anything else is refused before any work. */
function checkChoices(args: { coin: string; entry: string; level: number; target: number | null; stop: number | null }): Choices {
  if (!(TEST_COINS as readonly string[]).includes(args.coin)) throw new ConvexError("Unknown coin.");
  if (!(args.entry in TEST_ENTRIES)) throw new ConvexError("Unknown entry.");
  const entry = args.entry as Entry;
  const level = pick(TEST_ENTRIES[entry], args.level, "entry level");
  const target = args.target === null ? null : pick(TEST_TARGETS, args.target, "target");
  const stop = args.stop === null ? null : pick(TEST_STOPS, args.stop, "stop");
  if (target === null && stop === null) throw new ConvexError("Choose a target or a stop.");
  return { coin: args.coin, entry, level, target, stop };
}

/** The rule a set of choices means - the same one the backtest replays and a practice trader runs. */
function testRule(choices: Choices, sizeUsd: number, id: string): Rule {
  const made = cleanRule(
    {
      venue: "dolphin-wallet",
      market: `${choices.coin}USDT`,
      timeframe: TIMEFRAME,
      when: entryConditions(choices.entry, choices.level),
      until: [],
      action: "buy",
      sizeUsd,
      takeProfitPct: choices.target,
      stopLossPct: choices.stop,
      maxTradesPerDay: 2,
    },
    id,
  );
  if ("problems" in made) throw new ConvexError(made.problems.join("; "));
  return made.rule as Rule;
}

const choiceKey = (choices: Choices) => `${choices.coin}:${choices.entry}:${choices.level}:${choices.target ?? "-"}:${choices.stop ?? "-"}`;

export const run = action({
  args: {
    coin: v.string(),
    entry: v.string(),
    level: v.number(),
    target: v.union(v.number(), v.null()),
    stop: v.union(v.number(), v.null()),
    /** "YYYY-MM-DD": the window's last day (UTC). Within the last 31 days, never the future. */
    to: v.string(),
  },
  handler: async (ctx, args) => {
    const { coin, entry, level, target, stop } = checkChoices(args);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.to)) throw new ConvexError("Unknown date.");
    const end = Date.parse(`${args.to}T00:00:00Z`) + 86_400_000;
    if (!Number.isFinite(end) || end > Date.now() + 86_400_000 || end < Date.now() - 32 * 86_400_000) throw new ConvexError("That date is out of range.");
    // A day that has not finished yet is cut at the last closed 4h candle, so today's answer is stable too.
    const now = Math.min(end, Math.floor(Date.now() / TIMEFRAME_MS[TIMEFRAME]) * TIMEFRAME_MS[TIMEFRAME]);

    const rule = testRule({ coin, entry, level, target, stop }, SIZE_USD, "test");
    const need = Math.ceil((DAYS * 86_400_000) / TIMEFRAME_MS[TIMEFRAME]);
    const candles = await historyCandles(rule.venue, rule.market, TIMEFRAME, need + WARMUP, now);
    const from = Math.max(0, candles.length - need);
    const slice = candles.slice(Math.max(0, from - WARMUP));
    const warmup = Math.min(WARMUP, from);
    const result = simulate(rule, slice, { feeBps: VENUE_FEE_BPS[rule.venue], dailyLossLimitUsd: null, warmup });
    const gas = result.trades.length * DOLPHIN_SWAP_GAS_USD;
    const closed = result.wins + result.losses;

    // Both lines as % of the stake over the same candles, thinned to a size a phone draws instantly.
    const judged = slice.slice(warmup);
    const first = judged[0]?.close ?? 1;
    const step = Math.max(1, Math.floor(judged.length / CURVE_POINTS));
    const equityAt = new Map(result.equity.map((point) => [point.time, point.usd]));
    let lastEquity = 0;
    const curve: { t: number; you: number; hold: number }[] = [];
    let tradesSoFar = 0;
    for (let index = 0; index < judged.length; index++) {
      const candle = judged[index];
      const usd = equityAt.get(candle.openTime);
      if (usd !== undefined) lastEquity = usd;
      while (tradesSoFar < result.trades.length && result.trades[tradesSoFar].time <= candle.openTime) tradesSoFar++;
      if (index % step === 0 || index === judged.length - 1) {
        curve.push({
          t: candle.openTime,
          you: Math.round(((lastEquity - tradesSoFar * DOLPHIN_SWAP_GAS_USD) / SIZE_USD) * 1000) / 10,
          hold: Math.round(((candle.close - first) / first) * 1000) / 10,
        });
      }
    }

    await ctx.runMutation(internal.strategyTest.record, {
      key: choiceKey({ coin, entry, level, target, stop }),
      coin,
      entry,
      level,
      target,
      stop,
      resultPct: Math.round(((result.totalUsd - gas) / SIZE_USD) * 1000) / 10,
      holdPct: Math.round(result.buyHoldPct * 10) / 10,
      trades: closed,
      winPct: closed ? Math.round((result.wins / closed) * 100) : null,
    });
    return {
      coin: args.coin,
      words: describeRule(rule).replace(/ buy \$100/, " buy"),
      from: judged[0]?.openTime ?? null,
      to: judged[judged.length - 1]?.openTime ?? null,
      resultPct: Math.round(((result.totalUsd - gas) / SIZE_USD) * 1000) / 10,
      holdPct: Math.round(result.buyHoldPct * 10) / 10,
      trades: closed,
      winPct: closed ? Math.round((result.wins / closed) * 100) : null,
      worstDropPct: Math.round((result.maxDrawdownUsd / SIZE_USD) * 1000) / 10,
      stillHolding: result.open !== null,
      curve,
    };
  },
});

export const record = internalMutation({
  args: {
    key: v.string(),
    coin: v.string(),
    entry: v.string(),
    level: v.number(),
    target: v.union(v.number(), v.null()),
    stop: v.union(v.number(), v.null()),
    resultPct: v.number(),
    holdPct: v.number(),
    trades: v.number(),
    winPct: v.union(v.number(), v.null()),
  },
  handler: async (ctx, row) => {
    const existing = await ctx.db.query("testBoard").withIndex("by_key", (q) => q.eq("key", row.key)).unique();
    if (!existing) {
      await ctx.db.insert("testBoard", { ...row, at: Date.now() });
      // "Best of N tested" (a builder's point on Reddit, 2026-10-14: show how many configurations were tried).
      const counter = await ctx.db.query("counters").withIndex("by_key", (q) => q.eq("key", "testBoard")).unique();
      if (counter) await ctx.db.patch(counter._id, { n: counter.n + 1 });
      else await ctx.db.insert("counters", { key: "testBoard", n: (await ctx.db.query("testBoard").take(5000)).length });
    }
    else if (existing.resultPct !== row.resultPct || existing.trades !== row.trades) await ctx.db.patch(existing._id, { ...row, at: Date.now() });
  },
});

/** How many distinct strategies have been tested, so the board can say "best of N". */
export const boardCount = query({
  args: {},
  handler: async (ctx) => (await ctx.db.query("counters").withIndex("by_key", (q) => q.eq("key", "testBoard")).unique())?.n ?? 0,
});

/** The best strategies anyone has tested. One that barely traded is luck, not a strategy, so it needs 3 trades. */
export const board = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("testBoard").withIndex("by_result").order("desc").take(15);
    return rows
      .filter((row) => row.trades >= 3)
      .slice(0, 5)
      .map(({ coin, entry, level, target, stop, resultPct, holdPct, trades, winPct }) => ({ coin, entry, level, target, stop, resultPct, holdPct, trades, winPct }));
  },
});

const ENTRY_NAMES: Record<Entry, string> = { dip: "dip buyer", rsi: "oversold buyer", trend: "trend dip buyer", momentum: "pump chaser" };

/**
 * "Run it on practice money" (owner, 2026-10-14: the old button copied text and dropped people in the
 * builder). Makes the trader from exactly these choices - no AI, no pasting - on pretend money at live
 * prices, and it shows under Your traders on /trade at once. Practice only: real money starts from /trade.
 */
export const startPractice = mutation({
  args: {
    sessionToken: v.string(),
    coin: v.string(),
    entry: v.string(),
    level: v.number(),
    target: v.union(v.number(), v.null()),
    stop: v.union(v.number(), v.null()),
    amountUsd: v.number(),
  },
  handler: async (ctx, { sessionToken, amountUsd, ...args }): Promise<{ conversationKey: string }> => {
    const wallet = (await requireWalletAddress(ctx, sessionToken, "Starting a practice trader")).toLowerCase();
    if (!(Number.isFinite(amountUsd) && amountUsd >= 10 && amountUsd <= 10_000)) throw new ConvexError("Choose $10 to $10,000 of practice money.");
    const choices = checkChoices(args);
    const rule = testRule(choices, Math.floor(amountUsd * 100) / 100, `rule-${randomHex(4)}`);
    const name = `${choices.coin} ${ENTRY_NAMES[choices.entry]}`;
    const now = Date.now();
    const conversationKey = randomHex(32);
    const conversationId = await ctx.db.insert("dolphinConversations", {
      conversationKey,
      ownerAddress: wallet,
      title: name,
      seedAgentKey: null,
      mode: "build",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("agentDrafts", {
      conversationId,
      ownerAddress: wallet,
      trader: `test:${choiceKey(choices)}`,
      name,
      description: describeRule(rule),
      instructions: describeRule(rule),
      tools: [],
      blocks: [{ id: `market-${randomHex(3)}`, type: "market", config: { symbol: choices.coin, everyMinutes: null, direction: null, priceUsd: null, maxTradeUsd: null, maxTradesPerDay: null } }],
      rules: [rule],
      paperMode: true,
      autopilot: { on: true, conversationKey, walletAddress: wallet, runsDay: new Date().toISOString().slice(0, 10), runs: 0 },
      createdAt: now,
      updatedAt: now,
    });
    return { conversationKey };
  },
});
