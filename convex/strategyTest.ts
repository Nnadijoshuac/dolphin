import { ConvexError, v } from "convex/values";

import { action } from "./_generated/server";
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
  handler: async (_ctx, args) => {
    if (!(TEST_COINS as readonly string[]).includes(args.coin)) throw new ConvexError("Unknown coin.");
    if (!(args.entry in TEST_ENTRIES)) throw new ConvexError("Unknown entry.");
    const entry = args.entry as Entry;
    const level = pick(TEST_ENTRIES[entry], args.level, "entry level");
    const target = args.target === null ? null : pick(TEST_TARGETS, args.target, "target");
    const stop = args.stop === null ? null : pick(TEST_STOPS, args.stop, "stop");
    if (target === null && stop === null) throw new ConvexError("Choose a target or a stop.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.to)) throw new ConvexError("Unknown date.");
    const end = Date.parse(`${args.to}T00:00:00Z`) + 86_400_000;
    if (!Number.isFinite(end) || end > Date.now() + 86_400_000 || end < Date.now() - 32 * 86_400_000) throw new ConvexError("That date is out of range.");
    // A day that has not finished yet is cut at the last closed 4h candle, so today's answer is stable too.
    const now = Math.min(end, Math.floor(Date.now() / TIMEFRAME_MS[TIMEFRAME]) * TIMEFRAME_MS[TIMEFRAME]);

    const made = cleanRule(
      {
        venue: "dolphin-wallet",
        market: `${args.coin}USDT`,
        timeframe: TIMEFRAME,
        when: entryConditions(entry, level),
        until: [],
        action: "buy",
        sizeUsd: SIZE_USD,
        takeProfitPct: target,
        stopLossPct: stop,
        maxTradesPerDay: 2,
      },
      "test",
    );
    if ("problems" in made) throw new ConvexError(made.problems.join("; "));
    const rule = made.rule as Rule;
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
