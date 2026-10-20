import { describe, expect, it } from "vitest";

import { applyKline, type RuleCandles } from "@/app/live/desk-feeds";

const candle = (t: number, c: number) => ({ t, o: c, h: c, l: c, c, v: 1, closeTime: t + 899_999 });
const k = (t: number, c: number, closed: boolean) => ({ t, T: t + 899_999, o: String(c), h: String(c), l: String(c), c: String(c), v: "1", x: closed });
const base: RuleCandles = { closed: [candle(0, 100), candle(900_000, 101)], forming: null };

describe("applyKline (candles pushed by Binance's kline stream)", () => {
  it("a tick moves the forming candle and leaves the closed ones alone", () => {
    const next = applyKline(base, k(1_800_000, 102, false))!;
    expect(next.closed).toHaveLength(2);
    expect(next.forming?.c).toBe(102);
  });
  it("a close appends the candle the engine will judge, and clears the forming one", () => {
    const next = applyKline(applyKline(base, k(1_800_000, 102, false)), k(1_800_000, 103, true))!;
    expect(next.closed.map((row) => row.c)).toEqual([100, 101, 103]);
    expect(next.forming).toBeNull();
  });
  it("a repeated or late message for a closed candle changes nothing", () => {
    expect(applyKline(base, k(900_000, 999, true))).toBe(base);
  });
  it("keeps the engine's 200-candle window", () => {
    const full: RuleCandles = { closed: Array.from({ length: 200 }, (_, i) => candle(i * 900_000, i)), forming: null };
    const next = applyKline(full, k(200 * 900_000, 500, true))!;
    expect(next.closed).toHaveLength(200);
    expect(next.closed[199]!.c).toBe(500);
  });
  it("before the history loads there is nothing to patch", () => {
    expect(applyKline(undefined, k(0, 1, true))).toBeUndefined();
  });
});
