import assert from "node:assert/strict";
import { test } from "node:test";

import { asksForRule, RULES_ONLY_SCHEMA } from "../convex/lib/agentSpec";

test("a described trading rule is recognised, a token checker is not", () => {
  assert.equal(asksForRule("Trading rule: on BNBUSDT 1-minute candles, when the 14-period RSI drops below 50, buy $2 of BNB from my Dolphin Wallet."), true);
  assert.equal(asksForRule("short BNB on futures when three 4-hour candles close lower"), true);
  assert.equal(asksForRule("Check any BNB Chain token for honeypot risk and give a verdict"), false);
  assert.equal(RULES_ONLY_SCHEMA.schema.properties.rules.type, "array");
});

test("plain words for a market move count as a rule (user test 2026-10-05)", () => {
  assert.equal(asksForRule("I want an agent that buys BNB when it drops a lot and sells when it goes back up. I have 30 dollars."), true);
  assert.equal(asksForRule("buy BNB when it is down 5%"), true);
  assert.equal(asksForRule("an agent that tells me the BNB price every morning"), false);
});
