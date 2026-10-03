import assert from "node:assert/strict";
import { test } from "node:test";

import { afterCandle, cleanRule, decide, describeRule, EMPTY_STATE, holds, observe, resultPct, resultUsd, venueProblem, type Candle, type Rule, type RuleState } from "../convex/lib/strategy";

const H4 = 4 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 1);
/** Candles from a list of closes, 4 hours apart. */
const candles = (closes: number[]): Candle[] =>
  closes.map((close, i) => ({ openTime: T0 + i * H4, open: close, high: close, low: close, close }));

/** The owner's example, 2026-10-03, as the AI would write it. */
const ownerRule = (() => {
  const made = cleanRule(
    {
      venue: "binance-futures",
      market: "BNBUSDT",
      timeframe: "4h",
      when: [{ kind: "trend", direction: "down", candles: 3 }],
      action: "short",
      sizeUsd: 50,
      until: [{ kind: "trend", direction: "up", candles: 2 }],
      stopLossPct: 5,
      leverage: 2,
      maxTradesPerDay: 2,
    },
    "r1",
  );
  assert.ok("rule" in made, JSON.stringify(made));
  return (made as { rule: Rule }).rule;
})();

/** Feeds closed candles one at a time, exactly as a runner would on each candle close. */
function replay(rule: Rule, closes: number[]) {
  const all = candles(closes);
  let state: RuleState = EMPTY_STATE;
  const events: string[] = [];
  for (let i = 1; i <= all.length; i++) {
    const seen = all.slice(0, i);
    const now = seen[i - 1].openTime + H4;
    const decision = decide(rule, seen, state, now);
    if (decision.type !== "none") events.push(`${decision.type}:${decision.side}@${decision.price}`);
    state = afterCandle(state, seen[i - 1].openTime, decision, true, now);
  }
  return { events, state };
}

test("the owner's rule: shorts when 4h candles turn down, holds, and closes when the trend turns up", () => {
  // Up, up, then three lower closes (enter short at 97), keeps falling (hold), then two higher closes (exit at 95).
  const { events, state } = replay(ownerRule, [100, 101, 102, 101, 99, 97, 95, 93, 94, 95]);
  assert.deepEqual(events, ["enter:short@97", "exit:short@95"]);
  assert.equal(state.position, null);
});

test("a short is stopped out when the market goes against it", () => {
  // Enter short at 97, then it climbs 5%+ without two higher closes in a row being needed.
  const { events } = replay(ownerRule, [100, 101, 102, 101, 99, 97, 102]);
  assert.deepEqual(events, ["enter:short@97", "exit:short@102"]);
});

test("the same closed candle is never judged twice, and the daily cap holds", () => {
  const seen = candles([102, 101, 99, 97]);
  const now = seen[3].openTime + H4;
  const first = decide(ownerRule, seen, EMPTY_STATE, now);
  assert.equal(first.type, "enter");
  const after = afterCandle(EMPTY_STATE, seen[3].openTime, first, true, now);
  assert.equal(decide(ownerRule, seen, after, now).type, "none");
  const capped: RuleState = { ...EMPTY_STATE, tradesToday: 2, tradesDay: new Date(now).toISOString().slice(0, 10) };
  assert.match(decide(ownerRule, seen, capped, now).reason, /Daily cap/);
});

test("a trade the venue refused leaves the position untouched", () => {
  const seen = candles([102, 101, 99, 97]);
  const now = seen[3].openTime + H4;
  const decision = decide(ownerRule, seen, EMPTY_STATE, now);
  assert.equal(afterCandle(EMPTY_STATE, seen[3].openTime, decision, false, now).position, null);
});

test("too little history never fires", () => {
  assert.equal(holds({ kind: "rsi", op: "below", value: 30 }, candles([1, 2, 3])), false);
  assert.equal(holds({ kind: "trend", direction: "down", candles: 3 }, candles([3, 2])), false);
  assert.equal(holds({ kind: "price_vs_ma", op: "above", ma: "sma", length: 50 }, candles([1, 2, 3])), false);
});

test("conditions read the last closed candle correctly", () => {
  const falling = candles(Array.from({ length: 40 }, (_, i) => 100 - i));
  assert.equal(holds({ kind: "rsi", op: "below", value: 30 }, falling), true);
  assert.equal(holds({ kind: "price_vs_ma", op: "below", ma: "ema", length: 20 }, falling), true);
  assert.equal(holds({ kind: "change_pct", op: "below", value: -5, candles: 10 }, falling), true);
  assert.equal(holds({ kind: "price", op: "below", value: 62 }, falling), true);
});

test("rules the AI writes are checked, never clamped silently", () => {
  const problems = (raw: Record<string, unknown>) => {
    const made = cleanRule({ venue: "binance-futures", market: "BNBUSDT", timeframe: "4h", when: [{ kind: "trend", direction: "down", candles: 3 }], action: "short", sizeUsd: 50, stopLossPct: 5, ...raw }, "x");
    return "problems" in made ? made.problems.join(" | ") : "";
  };
  assert.equal(problems({}), "");
  assert.match(problems({ leverage: 20 }), /leverage must be 1x to 5x/);
  assert.match(problems({ venue: "dolphin-wallet" }), /shorting needs the Binance Futures venue/);
  assert.match(problems({ stopLossPct: null, until: [] }), /a short needs a stop-loss or an exit condition/);
  assert.match(problems({ when: [{ kind: "run_my_code", code: "rm -rf /" }] }), /not a condition Dolphin knows/);
  assert.match(problems({ timeframe: "3s" }), /timeframe must be one of/);
  assert.match(problems({ sizeUsd: 0 }), /size must be/);
  assert.match(problems({ action: "sell" }), /buy or short/);
});

test("leverage: 1-3x is normal, 4-5x allowed with a liquidation warning, above 5x refused", () => {
  const base = { venue: "binance-futures", market: "BNBUSDT", timeframe: "4h", when: [{ kind: "trend", direction: "down", candles: 3 }], action: "short", sizeUsd: 50, stopLossPct: 5 };
  const at = (leverage: number) => cleanRule({ ...base, leverage }, "l");
  const three = at(3);
  assert.ok("rule" in three && three.warnings.length === 0);
  const five = at(5);
  assert.ok("rule" in five);
  if ("rule" in five) assert.match(five.warnings[0], /about 20% against the position would liquidate it/);
  assert.ok("problems" in at(6));
});

test("conditions written the ways models write them are understood, nonsense is still refused", () => {
  const rsi = (condition: Record<string, unknown>) =>
    cleanRule({ venue: "binance-futures", market: "BNBUSDT", timeframe: "1h", action: "buy", sizeUsd: 100, leverage: 5, takeProfitPct: 4, stopLossPct: 2, when: [{ kind: "rsi", ...condition }] }, "m");
  for (const variant of [{ op: "<", value: 30 }, { op: "less_than", value: 30 }, { op: "below", level: 30 }, { direction: "down", value: 30, op: null }, { op: "drops below", value: 30 }]) {
    const made = rsi(variant);
    assert.ok("rule" in made, `${JSON.stringify(variant)} -> ${JSON.stringify(made)}`);
    if ("rule" in made) assert.deepEqual(made.rule.when[0], { kind: "rsi", op: "below", value: 30, period: 14 });
  }
  assert.ok("problems" in rsi({ op: "sideways", value: 30 }));
  assert.ok("problems" in rsi({ op: "below", value: 300 }));
  const cross = cleanRule({ venue: "binance-spot", market: "BNBUSDT", timeframe: "1h", action: "buy", sizeUsd: 10, when: [{ kind: "macd_cross", direction: "bullish" }] }, "c");
  assert.ok("rule" in cross && cross.rule.when[0].kind === "macd_cross");
});

test("results include leverage, and a short gains when the price falls", () => {
  assert.equal(resultPct("short", 100, 95, 3), 15);
  assert.equal(resultPct("short", 100, 105, 3), -15);
  assert.equal(resultPct("long", 766.08, 772.21, 1), 0.8);
  assert.equal(resultPct("long", 100, 100, 1), 0);
  assert.ok(Object.is(resultPct("short", 100, 100, 3), 0), "a flat short is 0, never -0");
});

test("a rule may not reach past its Binance block", () => {
  const exchange = { account: "exchange" as const, futures: true, maxLeverage: 3 };
  assert.equal(venueProblem({ venue: "binance-futures", leverage: 2 }, exchange), null);
  assert.match(venueProblem({ venue: "binance-futures", leverage: 5 }, exchange) ?? "", /above the Binance block's 3x/);
  assert.match(venueProblem({ venue: "binance-futures", leverage: 1 }, { ...exchange, futures: false }) ?? "", /switch on futures/);
  assert.match(venueProblem({ venue: "binance-wallet", leverage: 1 }, exchange) ?? "", /set to the Exchange/);
  assert.match(venueProblem({ venue: "binance-spot", leverage: 1 }, null) ?? "", /no Binance block/);
  assert.equal(venueProblem({ venue: "dolphin-wallet", leverage: 1 }, null), null);
});

test("the daily loss limit stops new entries, never exits", () => {
  const seen = candles([102, 101, 99, 97]);
  const now = seen[3].openTime + H4;
  // $50 limit, $55 already lost today: no new short, with the reason.
  const blocked = decide(ownerRule, seen, EMPTY_STATE, now, { limitUsd: 50, lossTodayUsd: 55 });
  assert.equal(blocked.type, "none");
  assert.match(blocked.reason, /Daily loss limit reached: \$55 lost today, limit \$50/);
  // Under the limit it still trades; no limit set, it trades.
  assert.equal(decide(ownerRule, seen, EMPTY_STATE, now, { limitUsd: 50, lossTodayUsd: 20 }).type, "enter");
  assert.equal(decide(ownerRule, seen, EMPTY_STATE, now, { limitUsd: null, lossTodayUsd: 999 }).type, "enter");
  // An open short still exits when its exit rule holds, even past the limit.
  const holding: RuleState = { ...EMPTY_STATE, position: { side: "short", entryPrice: 97, openedAt: T0 } };
  const exit = decide(ownerRule, candles([97, 95, 93, 94, 95]), holding, now + H4, { limitUsd: 50, lossTodayUsd: 80 });
  assert.equal(exit.type, "exit");
  assert.equal(resultUsd(-15, 50), -7.5);
});

test("a rule reads in plain words", () => {
  assert.equal(
    describeRule(ownerRule),
    "On BNBUSDT 4h candles: when 3 candles in a row close lower, short $50 at 2x; get out when 2 candles in a row close higher, or at a 5% loss. At most 2 a day.",
  );
});

test("deciding is fast enough to run on every candle close", () => {
  const history = candles(Array.from({ length: 500 }, (_, i) => 100 + Math.sin(i / 7) * 10));
  const rule = (cleanRule({ venue: "binance-spot", market: "BNBUSDT", timeframe: "1m", action: "buy", sizeUsd: 10, when: [{ kind: "rsi", op: "below", value: 30 }, { kind: "ma_cross", direction: "up", fast: 20, slow: 50 }], until: [{ kind: "macd_cross", direction: "down" }] }, "f") as { rule: Rule }).rule;
  const started = performance.now();
  for (let i = 0; i < 100; i++) decide(rule, history, EMPTY_STATE, T0);
  const perDecision = (performance.now() - started) / 100;
  assert.ok(perDecision < 5, `${perDecision.toFixed(3)} ms per decision`);
});

test("Why? carries the values the engine saw, not only what the rule asks for", () => {
  const seen = candles([100, 101, 102, 101, 99, 97]);
  const entry = decide(ownerRule, seen, EMPTY_STATE, seen[5].openTime + H4);
  assert.equal(entry.type, "enter");
  assert.equal(entry.reason, "Entry rule met: the last 3 closes went $102 → $101 → $99 → $97, each lower.");
  // A stop-loss names the entry, the price and the stop it hit.
  const state = afterCandle(EMPTY_STATE, seen[5].openTime, entry, true, seen[5].openTime + H4);
  const later = candles([100, 101, 102, 101, 99, 97, 102]);
  const exit = decide(ownerRule, later, state, later[6].openTime + H4);
  assert.match(exit.reason, /^Stop-loss: in at \$97, now \$102 - 5\.15% against the position; your stop is 5%\.$/);
  // RSI reads its own value, to a tenth.
  const falling = candles(Array.from({ length: 30 }, (_, i) => 100 - i));
  assert.match(observe({ kind: "rsi", op: "below", value: 30 }, falling), /^RSI was \d+(\.\d)?, below 30$/);
  // A candle that does not trade says what it saw, too.
  const flat = candles([100, 101, 102]);
  const none = decide(ownerRule, flat, EMPTY_STATE, flat[2].openTime + H4);
  assert.equal(none.reason, "No trade: the last 3 closes went $100 → $101 → $102, not each lower.");
});
