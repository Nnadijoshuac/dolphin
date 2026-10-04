import { simulate, VENUE_FEE_BPS, type Candle, type Condition, type SimResult, type SimTrade, type Venue } from "./strategy";

/**
 * GRID TRADING (owner, 2026-10-04: "you need to also make the grid agent"; it is one of Set and Earn's
 * four categories, and a grid earns in a sideways market - which is what BNB Pulse sat in for a day).
 *
 * A grid splits a price range into steps. Each step is a LEVEL: buy a slice when the price closes
 * below the level, sell that slice one step higher. A falling price fills levels on the way down; a
 * rising one sells them on the way up; a price that swings inside the range does both, over and over.
 *
 * BUILT FROM ORDINARY RULES, ON PURPOSE. Each level is a normal rule (one position, its own order lock,
 * the trade log as its second witness), so a grid runs through exactly the machinery that already
 * moves real money - nothing about execution is new. The levels carry a `grid` tag so the agent counts
 * the grid as one rule and the panel shows it as one card.
 *
 * Starting inside the range, every level ABOVE today's price buys at once: that is how any grid sets up
 * the coins it will sell on the way up. Said where it is added.
 */

export type GridTag = { id: string; level: number; of: number; lower: number; upper: number };

export type GridSpec = {
  market: string;
  venue: Extract<Venue, "dolphin-wallet" | "binance-spot">;
  lower: number;
  upper: number;
  levels: number;
  /** Spread evenly across the levels. */
  totalUsd: number;
  /** Close everything this % below the range, and stop buying until the price is back. Null: no stop. */
  stopBelowPct: number | null;
};

/** What one on-chain swap from the Dolphin Wallet costs in gas, generously: measured $0.014 on 2026-10-04 (345,764 gas at 0.05 gwei). */
export const DOLPHIN_SWAP_GAS_USD = 0.02;

export const GRID_LIMITS = { minLevels: 2, maxLevels: 10, minLevelUsd: 2, maxRangeRatio: 2 } as const;

/** Grids are judged on 5-minute candles: quick enough for a range, and the backtest runs the same candles. */
export const GRID_TIMEFRAME = "5m" as const;

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

/** A price with sensible precision for its size. */
export function gridPrice(value: number): number {
  return value >= 100 ? round(value, 2) : value >= 1 ? round(value, 4) : Number(value.toPrecision(5));
}

export type GridPlan = {
  /** Raw rules for addRulesTo, each carrying its `grid` tag. */
  rules: Record<string, unknown>[];
  buyPrices: number[];
  /** The % each level aims to make before costs (the step over its buy price), lowest level first. */
  stepPcts: number[];
  perLevelUsd: number;
  /** Fees and gas for one buy-and-sell of one level, in dollars. */
  costPerRoundTripUsd: number;
  /** What one buy-and-sell of the THINNEST step leaves after costs, in dollars. */
  worstNetPerRoundTripUsd: number;
  stopPrice: number | null;
  warnings: string[];
};

export function planGrid(spec: GridSpec, gridId: string): GridPlan | { problems: string[] } {
  const problems: string[] = [];
  const market = spec.market.trim().toUpperCase();
  if (!market) problems.push("it needs a market, like BNBUSDT");
  const { lower, upper, totalUsd } = spec;
  const levels = Math.round(spec.levels);
  if (!(Number.isFinite(lower) && lower > 0)) problems.push("the bottom of the range must be a price above 0");
  if (!(Number.isFinite(upper) && upper > lower)) problems.push("the top of the range must be above the bottom");
  else if (upper / lower > GRID_LIMITS.maxRangeRatio) problems.push("the top can be at most twice the bottom - a wider range is not a grid any more");
  if (!(levels >= GRID_LIMITS.minLevels && levels <= GRID_LIMITS.maxLevels)) problems.push(`a grid has ${GRID_LIMITS.minLevels} to ${GRID_LIMITS.maxLevels} levels`);
  const perLevelUsd = levels > 0 ? Math.floor((totalUsd / levels) * 100) / 100 : 0;
  if (!(Number.isFinite(totalUsd) && perLevelUsd >= GRID_LIMITS.minLevelUsd)) problems.push(`each level needs at least $${GRID_LIMITS.minLevelUsd} - with ${levels} levels that is $${GRID_LIMITS.minLevelUsd * Math.max(levels, 1)} in total`);
  const stop = spec.stopBelowPct;
  if (stop !== null && !(Number.isFinite(stop) && stop >= 1 && stop <= 50)) problems.push("the stop below the range must be 1% to 50%");
  if (problems.length > 0) return { problems };

  const spacing = (upper - lower) / levels;
  const stopPrice = stop === null ? null : gridPrice(lower * (1 - stop / 100));
  const feeBps = VENUE_FEE_BPS[spec.venue];
  const gasUsd = spec.venue === "dolphin-wallet" ? DOLPHIN_SWAP_GAS_USD : 0;
  const costPerRoundTripUsd = round((2 * perLevelUsd * feeBps) / 10_000 + 2 * gasUsd, 4);

  const buyPrices: number[] = [];
  const stepPcts: number[] = [];
  const rules: Record<string, unknown>[] = [];
  for (let level = 0; level < levels; level++) {
    const buyAt = gridPrice(lower + level * spacing);
    const sellAt = gridPrice(lower + (level + 1) * spacing);
    const stepPct = round(((sellAt - buyAt) / buyAt) * 100, 3);
    buyPrices.push(buyAt);
    stepPcts.push(stepPct);
    const when: Condition[] = [{ kind: "price", op: "below", value: buyAt }];
    // Below the stop, no level buys again until the price is back above it.
    if (stopPrice !== null) when.push({ kind: "price", op: "above", value: stopPrice });
    rules.push({
      name: `Grid ${level + 1}/${levels}: buy under $${buyAt}, sell at $${sellAt}`,
      venue: spec.venue,
      market,
      timeframe: GRID_TIMEFRAME,
      action: "buy",
      sizeUsd: perLevelUsd,
      when,
      until: [],
      stopLossPct: stopPrice === null ? null : round(((buyAt - stopPrice) / buyAt) * 100, 3),
      takeProfitPct: stepPct,
      leverage: 1,
      // Entries a day per level: it must sell before it buys again, so 6 is generous - and it sets the trade key's daily cap (size x entries, per level).
      maxTradesPerDay: 6,
      cooldownMinutes: 0,
      grid: { id: gridId, level: level + 1, of: levels, lower: gridPrice(lower), upper: gridPrice(upper) } satisfies GridTag,
    });
  }

  // The thinnest step is the top one (same dollar step, highest price).
  const thinnest = Math.min(...stepPcts);
  const grossUsd = (perLevelUsd * thinnest) / 100;
  const worstNetPerRoundTripUsd = round(grossUsd - costPerRoundTripUsd, 4);
  if (worstNetPerRoundTripUsd <= 0) {
    return {
      problems: [
        `each step is ${thinnest}% on $${perLevelUsd}, which makes $${round(grossUsd, 3)} - less than the $${costPerRoundTripUsd} a buy and a sell cost in fees${gasUsd ? " and gas" : ""}. Use fewer levels, a wider range or more money`,
      ],
    };
  }
  const warnings: string[] = [];
  if (worstNetPerRoundTripUsd < grossUsd / 2) {
    warnings.push(`Fees take more than half of each step: a full buy and sell makes about $${round(grossUsd, 3)} and costs $${costPerRoundTripUsd}. Fewer levels or more money per level keeps more of it.`);
  }
  warnings.push("Every level above today's price buys as soon as Autopilot starts - that is how a grid sets up the coins it sells on the way up.");
  if (stopPrice === null) warnings.push(`With no stop, a drop below $${gridPrice(lower)} leaves every level holding coins bought higher, until the price comes back.`);
  return { rules, buyPrices, stepPcts, perLevelUsd, costPerRoundTripUsd, worstNetPerRoundTripUsd, stopPrice, warnings };
}

/**
 * A GRID ASKED FOR IN WORDS ("grid trade BNB between 560 and 640 with $40, 8 levels"). Read by code,
 * not by the model: ten levels' prices are arithmetic, and a model that gets one wrong buys at the
 * wrong price. Null when the words do not ask for a grid; `missing` when they do but leave out the
 * range or the money - asked for, never guessed.
 */
export function parseGridRequest(text: string): { spec: GridSpec } | { missing: string[] } | null {
  if (!/\bgrid\b/i.test(text)) return null;
  // A question about grids, or about a grid agent someone else made, is not a request to build one.
  if (!/\b(make|build|create|set up|setup|add|run|start|want|grid[- ]?trad(e|ing)|trade)\b/i.test(text)) return null;
  const clean = text.replace(/,(?=\d{3}\b)/g, "");
  const symbol = (clean.match(/\b(BNB|ETH|BTC|CAKE|SOL|XRP|DOGE|ADA|LINK|TWT)\b/i)?.[1] ?? "BNB").toUpperCase();
  const range =
    clean.match(/between\s*\$?\s*(\d+(?:\.\d+)?)\s*(?:and|to|-|–)\s*\$?\s*(\d+(?:\.\d+)?)/i) ??
    clean.match(/(?:from|range)\s*\$?\s*(\d+(?:\.\d+)?)\s*(?:to|-|–)\s*\$?\s*(\d+(?:\.\d+)?)/i) ??
    clean.match(/\$\s*(\d+(?:\.\d+)?)\s*(?:to|-|–)\s*\$?\s*(\d+(?:\.\d+)?)/i);
  const levelsMatch = clean.match(/(\d{1,2})\s*(?:levels?|grids?|steps?|lines?|orders?)\b/i);
  const money =
    clean.match(/(?:with|using|invest(?:ing)?|total|budget|put in|spend)\s*(?:of\s*)?\$?\s*(\d+(?:\.\d+)?)\s*(?:usdt|usd|dollars|u)?\b/i) ??
    clean.match(/\b(\d+(?:\.\d+)?)\s*(?:usdt|usd|dollars)\b/i);
  const stop = /\bno stop\b/i.test(clean) ? null : Number(clean.match(/stop[^\d%]{0,20}(\d+(?:\.\d+)?)\s*%/i)?.[1] ?? 5);
  const missing: string[] = [];
  if (!range) missing.push("the price range (for example: between 560 and 640)");
  if (!money) missing.push("how much to put in (for example: with $40)");
  if (!range || !money) return { missing };
  const a = Number(range[1]);
  const b = Number(range[2]);
  return {
    spec: {
      market: `${symbol}USDT`,
      venue: /\bbinance\b/i.test(clean) ? "binance-spot" : "dolphin-wallet",
      lower: Math.min(a, b),
      upper: Math.max(a, b),
      levels: levelsMatch ? Number(levelsMatch[1]) : 5,
      totalUsd: Number(money[1]),
      stopBelowPct: stop,
    },
  };
}

/** Whether a stored rule's `grid` tag is well formed - the build chat's rules pass through the same door. */
export function gridTagOf(raw: unknown): GridTag | null {
  const tag = (raw as { grid?: unknown } | null)?.grid as Partial<GridTag> | undefined;
  if (!tag || typeof tag.id !== "string" || !/^grid-[a-z0-9]{4,12}$/.test(tag.id)) return null;
  const n = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  const level = n(tag.level);
  const of = n(tag.of);
  const lower = n(tag.lower);
  const upper = n(tag.upper);
  if (level === null || of === null || lower === null || upper === null || level < 1 || level > of || of > GRID_LIMITS.maxLevels) return null;
  return { id: tag.id, level, of, lower, upper };
}

/**
 * A GRID'S BACKTEST: every level replayed by the engine's own `simulate` over the same candles, then
 * added together. The levels are independent rules, so the sum is exactly what they would have done.
 */
export function simulateGrid(
  rules: Parameters<typeof simulate>[0][],
  candles: readonly Candle[],
  options: { feeBps: number; gasUsd: number; dailyLossLimitUsd: number | null },
): SimResult & { roundTrips: number; gasUsd: number; investedUsd: number } {
  const runs = rules.map((rule) => simulate(rule, candles, { feeBps: options.feeBps, dailyLossLimitUsd: options.dailyLossLimitUsd, warmup: 1 }));
  const fills = runs.reduce((sum, run) => sum + run.trades.length, 0);
  const gasUsd = round(fills * options.gasUsd, 2);
  const byTime = new Map<number, number>();
  for (const run of runs) for (const point of run.equity) byTime.set(point.time, (byTime.get(point.time) ?? 0) + point.usd);
  // Gas is spread over the run by fill count so the curve ends where the total does.
  let gasSoFar = 0;
  const fillTimes = new Map<number, number>();
  for (const run of runs) for (const trade of run.trades) fillTimes.set(trade.time, (fillTimes.get(trade.time) ?? 0) + 1);
  const equity = [...byTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, usd]) => {
      gasSoFar += (fillTimes.get(time) ?? 0) * options.gasUsd;
      return { time, usd: round(usd - gasSoFar, 2) };
    });
  let peak = 0;
  let maxDrawdown = 0;
  for (const point of equity) {
    peak = Math.max(peak, point.usd);
    maxDrawdown = Math.max(maxDrawdown, peak - point.usd);
  }
  const investedUsd = rules.reduce((sum, rule) => sum + rule.sizeUsd, 0);
  const totalUsd = equity.length ? equity[equity.length - 1].usd : 0;
  const trades: SimTrade[] = runs.flatMap((run) => run.trades).sort((a, b) => a.time - b.time);
  return {
    trades,
    equity,
    totalUsd,
    returnPct: investedUsd > 0 ? round((totalUsd / investedUsd) * 100, 2) + 0 : 0,
    wins: runs.reduce((sum, run) => sum + run.wins, 0),
    losses: runs.reduce((sum, run) => sum + run.losses, 0),
    maxDrawdownUsd: round(maxDrawdown, 2),
    feesUsd: round(runs.reduce((sum, run) => sum + run.feesUsd, 0), 2),
    buyHoldPct: runs[0]?.buyHoldPct ?? 0,
    open: null,
    roundTrips: runs.reduce((sum, run) => sum + run.wins + run.losses, 0),
    gasUsd,
    investedUsd,
  };
}
