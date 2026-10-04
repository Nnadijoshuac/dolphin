import assert from "node:assert/strict";
import { test } from "node:test";

import { gridTagOf, parseGridRequest, planGrid, simulateGrid } from "../convex/lib/grid";
import { cleanRule, VENUE_FEE_BPS, type Candle, type Rule } from "../convex/lib/strategy";

const spec = { market: "bnbusdt", venue: "dolphin-wallet" as const, lower: 560, upper: 640, levels: 4, totalUsd: 200, stopBelowPct: 5 };

test("a grid splits the range into levels that buy below and sell one step up", () => {
  const plan = planGrid(spec, "grid-abc123");
  assert.ok(!("problems" in plan));
  assert.deepEqual(plan.buyPrices, [560, 580, 600, 620]);
  assert.equal(plan.perLevelUsd, 50);
  assert.equal(plan.stopPrice, 532);
  const top = plan.rules[3] as { when: unknown; takeProfitPct: number; market: string; grid: { level: number; of: number } };
  assert.equal(top.market, "BNBUSDT");
  assert.equal(top.takeProfitPct, 3.226); // 620 -> 640
  assert.deepEqual(top.grid, { id: "grid-abc123", level: 4, of: 4, lower: 560, upper: 640 });
  // Every level passes the engine's own rule checks - a grid adds nothing the engine does not already run.
  for (const raw of plan.rules) assert.ok(!("problems" in cleanRule(raw, "x")), JSON.stringify(raw));
});

test("a grid whose steps cannot beat their fees and gas is refused", () => {
  const thin = planGrid({ ...spec, levels: 10, totalUsd: 20, lower: 600, upper: 606 }, "grid-abc123");
  assert.ok("problems" in thin);
  assert.match(thin.problems[0], /less than/);
});

test("ranges, levels and money out of bounds are refused in words", () => {
  const bad = planGrid({ ...spec, lower: 600, upper: 590, levels: 40, totalUsd: 1, stopBelowPct: 90 }, "grid-abc123");
  assert.ok("problems" in bad);
  assert.ok(bad.problems.length >= 3);
});

test("only a well-formed grid tag is trusted", () => {
  assert.equal(gridTagOf({ grid: { id: "grid-abc123", level: 2, of: 4, lower: 1, upper: 2 } })?.level, 2);
  assert.equal(gridTagOf({ grid: { id: "evil", level: 2, of: 4, lower: 1, upper: 2 } }), null);
  assert.equal(gridTagOf({ grid: { id: "grid-abc123", level: 5, of: 4, lower: 1, upper: 2 } }), null);
  assert.equal(gridTagOf({}), null);
});

test("a price swinging inside the range makes the grid trade both ways and earn", () => {
  const plan = planGrid({ ...spec, venue: "binance-spot", stopBelowPct: null }, "grid-abc123");
  assert.ok(!("problems" in plan));
  const rules = plan.rules.map((raw, index) => {
    const made = cleanRule(raw, `r${index}`);
    assert.ok(!("problems" in made));
    return made.rule as Rule;
  });
  // 650 -> 555 -> 645, three times, on 5-minute candles.
  const path: number[] = [];
  for (let cycle = 0; cycle < 3; cycle++) {
    for (let p = 650; p >= 555; p -= 5) path.push(p);
    for (let p = 555; p <= 645; p += 5) path.push(p);
  }
  const candles: Candle[] = path.map((close, index) => ({ openTime: index * 300_000, open: close, high: close, low: close, close }));
  const result = simulateGrid(rules, candles, { feeBps: VENUE_FEE_BPS["binance-spot"], gasUsd: 0, dailyLossLimitUsd: null });
  assert.equal(result.roundTrips, 12); // 4 levels x 3 swings
  assert.equal(result.losses, 0);
  assert.ok(result.totalUsd > 0, String(result.totalUsd));
  assert.equal(result.investedUsd, 200);
});

test("a grid asked for in words is read by code", () => {
  const ask = parseGridRequest("Grid trade BNB between 560 and 640 with $40, 8 levels");
  assert.ok(ask && "spec" in ask);
  assert.deepEqual(ask.spec, { market: "BNBUSDT", venue: "dolphin-wallet", lower: 560, upper: 640, levels: 8, totalUsd: 40, stopBelowPct: 5 });
  const eth = parseGridRequest("make a grid bot for ETH from 2,400 to 2,700 using 100 usdt, 6 levels, no stop, on binance");
  assert.ok(eth && "spec" in eth);
  assert.deepEqual(eth.spec, { market: "ETHUSDT", venue: "binance-spot", lower: 2400, upper: 2700, levels: 6, totalUsd: 100, stopBelowPct: null });
});

test("a grid with no range or money is asked about, never guessed", () => {
  const ask = parseGridRequest("build me a grid trading agent for BNB");
  assert.ok(ask && "missing" in ask);
  assert.equal(ask.missing.length, 2);
});

test("words that are not a grid request are left to the model", () => {
  assert.equal(parseGridRequest("buy BNB when RSI is below 30 on 1h candles"), null);
  assert.equal(parseGridRequest("what is a grid?"), null);
});
