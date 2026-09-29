/**
 * The indicator maths the Indicators block and the Signal trigger rely on.
 *   npx tsx --test tests/indicators.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { conditionMet, emaSeries, indicatorReport, macdSeries, rsiSeries, smaSeries } from "../convex/lib/indicators";

describe("indicators", () => {
  it("SMA and EMA line up with hand-computed values", () => {
    assert.deepEqual(smaSeries([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
    const ema = emaSeries([2, 4, 6, 8], 2);
    assert.equal(ema[1], 3); // seeded with the SMA
    assert.equal(ema[2], 6 * (2 / 3) + 3 * (1 / 3)); // then k = 2/(n+1)
  });

  it("RSI is 100 when a series only rises, and near 0 when it only falls", () => {
    const up = Array.from({ length: 30 }, (_, i) => 10 + i);
    const down = Array.from({ length: 30 }, (_, i) => 100 - i);
    assert.equal(rsiSeries(up).at(-1), 100);
    assert.ok((rsiSeries(down).at(-1) ?? 100) < 1);
  });

  it("detects a golden cross on the candle it happens, and not the one after", () => {
    // 60 falling closes, then a sharp rally that lifts the 20-average through the 50-average.
    const closes = [...Array.from({ length: 60 }, (_, i) => 100 - i * 0.5), ...Array.from({ length: 40 }, (_, i) => 70 + i * 3)];
    let crossAt = -1;
    for (let end = 51; end <= closes.length; end++) {
      if (conditionMet(closes.slice(0, end), "maCrossUp", null)) {
        crossAt = end - 1;
        break;
      }
    }
    assert.ok(crossAt > 60, "the cross comes after the rally starts");
    assert.equal(conditionMet(closes.slice(0, crossAt + 2), "maCrossUp", null), false, "the next candle is not a new cross");
  });

  it("MACD histogram is line minus signal", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 50 + Math.sin(i / 4) * 5);
    const { line, signal, histogram } = macdSeries(closes);
    const i = closes.length - 1;
    assert.ok(Math.abs(histogram[i]! - (line[i]! - signal[i]!)) < 1e-12);
  });

  it("the report says how many CLOSED candles it used and never guesses with too few", () => {
    const candles = Array.from({ length: 10 }, (_, i) => [i * 3600, 1, 1, 1, 1, 1] as [number, number, number, number, number, number]);
    assert.match(indicatorReport(candles, "1-hour"), /not enough closed candles/);
  });
});
