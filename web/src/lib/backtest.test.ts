import { describe, expect, it } from "vitest";

import { rsiAt, runBacktest, sma, type Candle } from "./backtest";

const day = 86_400;
/** Candles whose open is the previous close, so fills are easy to reason about. */
function series(closes: number[]): Candle[] {
  return closes.map((c, i) => ({ t: i * day, o: i === 0 ? c : closes[i - 1], h: c, l: c, c, v: 1 }));
}
const noCosts = { feeBps: 0, slippageBps: 0, gasUsd: 0 };

describe("backtest", () => {
  it("computes a simple moving average from closes up to the index, not beyond", () => {
    expect(sma([1, 2, 3, 100], 2, 3)).toBe(2);
    expect(sma([1, 2], 1, 3)).toBeNull();
  });

  it("RSI is 100 for a series that only rises", () => {
    expect(rsiAt([1, 2, 3, 4, 5, 6], 5, 3)).toBe(100);
  });

  it("never acts on the candle it reads: the fill is at the next candle's open", () => {
    const candles = series([10, 10, 10, 20, 40]);
    const result = runBacktest(candles, { kind: "trend", fast: 1, slow: 2 }, noCosts);
    // Uptrend is first visible on candle 3's close (20 > avg(10,20)=15); the buy fills at candle 4's open, which is 20.
    expect(result.fills[0]).toMatchObject({ side: "buy", price: 20, t: 4 * day });
  });

  it("charges fee, slippage and gas on every fill", () => {
    const candles = series([10, 10, 20, 20, 5, 5]);
    const free = runBacktest(candles, { kind: "trend", fast: 1, slow: 2 }, noCosts);
    const paid = runBacktest(candles, { kind: "trend", fast: 1, slow: 2 }, { feeBps: 25, slippageBps: 50, gasUsd: 0.05 });
    expect(paid.finalUsd).toBeLessThan(free.finalUsd);
    expect(paid.costsUsd).toBeGreaterThan(0);
    expect(paid.fills.every((fill) => fill.costUsd > 0)).toBe(true);
  });

  it("DCA buys the set amount on schedule and holds", () => {
    const candles = series([10, 10, 10, 10, 10, 10, 10]);
    const result = runBacktest(candles, { kind: "dca", everyCandles: 2, amountUsd: 100 }, noCosts);
    expect(result.fills.every((fill) => fill.side === "buy" && fill.usd === 100)).toBe(true);
    expect(result.finalUsd).toBeCloseTo(1_000, 6);
  });

  it("reports buy-and-hold over the same candles", () => {
    const result = runBacktest(series([10, 10, 20]), { kind: "dca", everyCandles: 99, amountUsd: 0 }, noCosts);
    expect(result.buyHoldPct).toBeCloseTo(100, 6);
  });
});
