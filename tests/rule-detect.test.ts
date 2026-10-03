import assert from "node:assert/strict";
import { test } from "node:test";

import { asksForRule, RULES_ONLY_SCHEMA } from "../convex/lib/agentSpec";

test("a described trading rule is recognised, a token checker is not", () => {
  assert.equal(asksForRule("Trading rule: on BNBUSDT 1-minute candles, when the 14-period RSI drops below 50, buy $2 of BNB from my Dolphin Wallet."), true);
  assert.equal(asksForRule("short BNB on futures when three 4-hour candles close lower"), true);
  assert.equal(asksForRule("Check any BNB Chain token for honeypot risk and give a verdict"), false);
  assert.equal(RULES_ONLY_SCHEMA.schema.properties.rules.type, "array");
});
