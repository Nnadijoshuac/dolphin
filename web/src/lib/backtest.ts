/**
 * BACKTESTING A RULE - with the costs a real trade pays, and no look-ahead.
 * (Mentor review, 2026-09-29: "realistic backtesting and paper trading,
 * including fees, slippage and gas. Without it, every indicator block is a
 * toy." And: "only evaluate on closed candles".)
 *
 * What it tests is a RULE, never the Brain: a language model that has read
 * price history cannot be tested on it honestly. Three rules, each simple
 * enough to state in a sentence:
 *
 *   trend  hold while the close is above the slow average and the fast one is
 *          above the slow one; otherwise hold USDT. Long or cash, never short.
 *   rsi    buy when RSI falls below a level; sell when it rises above another.
 *   dca    buy a fixed dollar amount every N candles, and hold.
 *
 * NO LOOK-AHEAD: a signal is read on candle i's CLOSE and filled at candle
 * i+1's OPEN. Every fill pays the pool fee, slippage and gas. Always reported
 * beside buy-and-hold over the same candles.
 *
 * Pure: no network, no clock. Callers pass closed candles only, oldest first.
 */

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

export type Rule =
  | { kind: "trend"; fast: number; slow: number }
  | { kind: "rsi"; period: number; buyBelow: number; sellAbove: number }
  | { kind: "dca"; everyCandles: number; amountUsd: number };

export type Costs = {
  /** Pool fee per fill, in basis points. PancakeSwap v2 charges 25. */
  feeBps: number;
  /** Price you lose to slippage per fill, in basis points. */
  slippageBps: number;
  /** Gas per fill, in dollars. */
  gasUsd: number;
};

export type Fill = { t: number; side: "buy" | "sell"; price: number; usd: number; costUsd: number };

export type BacktestResult = {
  equity: { t: number; value: number }[];
  buyHold: { t: number; value: number }[];
  fills: Fill[];
  startUsd: number;
  finalUsd: number;
  returnPct: number;
  buyHoldPct: number;
  maxDrawdownPct: number;
  /** Round trips that closed at a profit, of those that closed. */
  winRate: number | null;
  costsUsd: number;
};

export function sma(closes: readonly number[], end: number, length: number): number | null {
  if (end + 1 < length) return null;
  let sum = 0;
  for (let i = end - length + 1; i <= end; i++) sum += closes[i];
  return sum / length;
}

/** Wilder's RSI at index `end`, from closes up to and including it. */
export function rsiAt(closes: readonly number[], end: number, period: number): number | null {
  if (end < period) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gain += change;
    else loss -= change;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i <= end; i++) {
    const change = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(change, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

function maxDrawdown(values: readonly number[]): number {
  let peak = -Infinity;
  let worst = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    if (peak > 0) worst = Math.min(worst, (value - peak) / peak);
  }
  return worst * 100;
}

export function runBacktest(candles: readonly Candle[], rule: Rule, costs: Costs, startUsd = 1_000): BacktestResult {
  if (candles.length < 3) throw new Error("Not enough candles to test.");
  const closes = candles.map((candle) => candle.c);
  const costRate = (costs.feeBps + costs.slippageBps) / 10_000;
  let cash = startUsd;
  let units = 0;
  let entryUsd = 0;
  let wins = 0;
  let closed = 0;
  let costsUsd = 0;
  const fills: Fill[] = [];
  const equity: { t: number; value: number }[] = [];

  const buy = (t: number, price: number, usd: number) => {
    const spend = Math.min(usd, cash);
    if (spend <= costs.gasUsd) return;
    const cost = spend * costRate + costs.gasUsd;
    units += (spend - cost) / price;
    cash -= spend;
    costsUsd += cost;
    entryUsd += spend;
    fills.push({ t, side: "buy", price, usd: spend, costUsd: cost });
  };
  const sellAll = (t: number, price: number) => {
    if (units <= 0) return;
    const gross = units * price;
    const cost = gross * costRate + costs.gasUsd;
    cash += gross - cost;
    costsUsd += cost;
    closed++;
    if (gross - cost > entryUsd) wins++;
    fills.push({ t, side: "sell", price, usd: gross, costUsd: cost });
    units = 0;
    entryUsd = 0;
  };

  // A signal read on candle i's close is acted on at candle i+1's open.
  for (let i = 0; i < candles.length; i++) {
    if (i > 0) {
      const decisionIndex = i - 1;
      const open = candles[i].o;
      if (rule.kind === "trend") {
        const fast = sma(closes, decisionIndex, rule.fast);
        const slow = sma(closes, decisionIndex, rule.slow);
        if (fast !== null && slow !== null) {
          const want = closes[decisionIndex] > slow && fast > slow;
          if (want && units === 0) buy(candles[i].t, open, cash);
          if (!want && units > 0) sellAll(candles[i].t, open);
        }
      } else if (rule.kind === "rsi") {
        const rsi = rsiAt(closes, decisionIndex, rule.period);
        if (rsi !== null) {
          if (rsi < rule.buyBelow && units === 0) buy(candles[i].t, open, cash);
          else if (rsi > rule.sellAbove && units > 0) sellAll(candles[i].t, open);
        }
      } else if (decisionIndex % Math.max(1, rule.everyCandles) === 0) {
        buy(candles[i].t, open, rule.amountUsd);
      }
    }
    equity.push({ t: candles[i].t, value: cash + units * candles[i].c });
  }

  const firstOpen = candles[1].o;
  const holdUnits = (startUsd * (1 - costRate) - costs.gasUsd) / firstOpen;
  const buyHold = candles.map((candle, index) => ({ t: candle.t, value: index === 0 ? startUsd : holdUnits * candle.c }));
  const finalUsd = equity[equity.length - 1].value;
  return {
    equity,
    buyHold,
    fills,
    startUsd,
    finalUsd,
    returnPct: ((finalUsd - startUsd) / startUsd) * 100,
    buyHoldPct: ((buyHold[buyHold.length - 1].value - startUsd) / startUsd) * 100,
    maxDrawdownPct: maxDrawdown(equity.map((point) => point.value)),
    winRate: closed > 0 ? wins / closed : null,
    costsUsd,
  };
}
