/**
 *   npx tsx --test tests/chat-titles.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cleanTitle } from "../convex/chatTitles";

describe("chat titles from the model", () => {
  it("takes a plain title as it is", () => {
    assert.equal(cleanTitle("Venus health factor agents"), "Venus health factor agents");
  });
  it("strips quotes, labels, markdown and a trailing full stop", () => {
    assert.equal(cleanTitle('Title: "Comparing yield agents."'), "Comparing yield agents");
    assert.equal(cleanTitle("**best grid bots**"), "Best grid bots");
  });
  it("drops a reasoning model's thinking", () => {
    assert.equal(cleanTitle("<think>the user asks about CAKE</think>\nBuying CAKE on dips"), "Buying CAKE on dips");
  });
  it("refuses what is not a title", () => {
    assert.equal(cleanTitle(""), null);
    assert.equal(cleanTitle("x".repeat(90)), null);
  });
});
