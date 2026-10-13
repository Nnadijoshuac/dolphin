import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { askJev, jevState } from "../convex/lib/jev";
import { cleanRule, describeLocked, describeRule, type Rule } from "../convex/lib/strategy";

const base = {
  venue: "dolphin-wallet",
  market: "BNBUSDT",
  timeframe: "1h",
  when: [{ kind: "rsi", op: "below", value: 30, period: 14 }],
  action: "buy",
  sizeUsd: 30,
  until: [],
  stopLossPct: 6,
  takeProfitPct: 5,
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("a rule keeps a valid brain check and refuses a bad one", () => {
  const made = cleanRule({ ...base, confirm: { brain: "jev", minPct: 70 } }, "r1");
  assert.ok("rule" in made);
  assert.deepEqual(made.rule.confirm, { brain: "jev", minPct: 70 });
  assert.ok("problems" in cleanRule({ ...base, confirm: { brain: "gpt", minPct: 70 } }, "r2"));
  assert.ok("problems" in cleanRule({ ...base, confirm: { brain: "jev", minPct: 20 } }, "r3"));
  const plain = cleanRule(base, "r4");
  assert.ok("rule" in plain && plain.rule.confirm === undefined);
});

test("the rule's words say Jev must agree, locked or not", () => {
  const made = cleanRule({ ...base, confirm: { brain: "jev", minPct: 60 } }, "r1") as { rule: Rule };
  assert.match(describeRule(made.rule), /and Jev agrees, at least 60% sure, buy \$30/);
  assert.match(describeLocked(made.rule), /locked conditions hold and Jev agrees/);
});

test("Jev's take with its probability is read; anything malformed throws", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ model: "jev-1.13.0", answers: { entry: { type: "choice", choice: "take", probabilities: { take: 0.72, skip: 0.28 }, confidence: 0.6 } } }), { status: 200 })) as typeof fetch;
  assert.deepEqual(await askJev("k", "state"), { take: true, pct: 72, model: "jev-1.13.0" });

  globalThis.fetch = (async () => new Response(JSON.stringify({ answers: {} }), { status: 200 })) as typeof fetch;
  await assert.rejects(askJev("k", "state"), /no probability/);

  globalThis.fetch = (async () => new Response("no", { status: 401 })) as typeof fetch;
  await assert.rejects(askJev("k", "state"), /refused the key/);
});

test("the state Jev reads is plain text with the recent closes", () => {
  const candles = Array.from({ length: 60 }, (_, index) => ({ openTime: index, open: 600, high: 610, low: 590, close: 600 + index, quoteVolume: 0 }));
  const state = jevState("BNBUSDT", "1h", candles, "Entry rule met: RSI was 28.", "buy");
  assert.match(state, /Last 48 closes/);
  assert.match(state, /wants to buy now/);
});
