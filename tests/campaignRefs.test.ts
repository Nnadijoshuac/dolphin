import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanRef } from "../convex/campaignRefs";

test("a ref tag is a short lowercase slug we wrote", () => {
  assert.equal(cleanRef("x-1004-thread"), "x-1004-thread");
  assert.equal(cleanRef("  IG-Bio "), "ig-bio");
  assert.equal(cleanRef(""), null);
  assert.equal(cleanRef("-leading"), null);
  assert.equal(cleanRef("has space"), null);
  assert.equal(cleanRef("0x13450a106568d011d25d8ac222b489b098df9196-wallet"), null);
  assert.equal(cleanRef("<script>"), null);
});
