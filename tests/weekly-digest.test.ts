import assert from "node:assert/strict";
import { test } from "node:test";

import { digestText } from "../convex/weeklyDigest";

test("the weekly email lists each trader with its week and links back with a ref tag", () => {
  const text = digestText([
    { name: "BNB dip buyer", real: false, closed: 2, won: 1, resultUsd: 3.4, running: true },
    { name: "Steady trader", real: true, closed: 0, won: 0, resultUsd: 0, running: false },
  ]);
  assert.match(text, /BNB dip buyer \(practice\): 2 closed, 1 won, \+\$3\.40/);
  assert.match(text, /Steady trader \(real money, stopped\): no closed trades/);
  assert.match(text, /trade\?ref=email-weekly#my-traders/);
});
