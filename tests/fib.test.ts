import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanRule, describe as describeCondition, fibLevel, holds, observe, type Candle, type Condition } from "../convex/lib/strategy";

const candle = (i: number, close: number, high = close, low = close): Candle => ({ openTime: i * 60_000, open: close, high, low, close });

test("an up-swing's 61.8% level is that far back down from the high", () => {
  // Low 100 first, high 200 later: 61.8% pullback = 200 - 0.618 * 100 = 138.2.
  const candles = [candle(0, 100, 100, 100), candle(1, 150), candle(2, 200, 200, 200), candle(3, 138.5)];
  const level = fibLevel(candles, 4, 0.618)!;
  assert.equal(Math.round(level.price * 10) / 10, 138.2);
  assert.ok(level.upSwing);
  assert.ok(holds({ kind: "fib", op: "near", value: 0.618, candles: 4 }, candles)); // 138.5 is within 0.5% of 138.2
  assert.ok(!holds({ kind: "fib", op: "near", value: 0.382, candles: 4 }, candles));
  assert.match(observe({ kind: "fib", op: "near", value: 0.618, candles: 4 }, candles), /61\.8% level \$138\.2/);
});

test("a down-swing's level is measured back up from the low", () => {
  const candles = [candle(0, 200, 200, 200), candle(1, 150), candle(2, 100, 100, 100), candle(3, 160)];
  assert.equal(Math.round(fibLevel(candles, 4, 0.5)!.price), 150);
  assert.ok(holds({ kind: "fib", op: "above", value: 0.5, candles: 4 }, candles));
});

test("the rule checker accepts a level as a ratio or a percent, and refuses nonsense", () => {
  const rule = (c: Record<string, unknown>) =>
    cleanRule({ venue: "dolphin-wallet", market: "BNBUSDT", timeframe: "1h", action: "buy", sizeUsd: 20, when: [c], until: [], stopLossPct: 1.5, takeProfitPct: 3 }, "r");
  const a = rule({ kind: "fib", op: "near", value: 61.8, candles: 50 });
  assert.ok(!("problems" in a));
  assert.deepEqual(a.rule.when[0], { kind: "fib", op: "near", value: 0.618, candles: 50 } satisfies Condition);
  assert.match(describeCondition(a.rule.when[0]), /at the 61\.8% Fibonacci level of the last 50 candles/);
  assert.ok("problems" in rule({ kind: "fib", op: "near", value: 3, candles: 50 }));
});
