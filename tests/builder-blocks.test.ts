/**
 * The builder places blocks (convex/lib/builderBlocks.ts). Run from the repo root:
 *   npx tsx --test tests/builder-blocks.test.ts
 * Owner, 2026-10-02: the builder must be able to set up every block it can
 * configure, Memory included (placed not connected).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TOKEN_VERDICT_RULES, gradesTokens, mergeBuilderBlocks, withVerdictRules, type BuilderBlock } from "../convex/lib/builderBlocks";

const block = (over: Partial<BuilderBlock>): BuilderBlock => ({
  type: "safety", symbol: null, everyMinutes: null, direction: null, priceUsd: null, maxTradeUsd: null, maxTradesPerDay: null, ...over,
});

describe("mergeBuilderBlocks", () => {
  it("places Memory not connected, and never twice", async () => {
    const first = await mergeBuilderBlocks([], [block({ type: "memory" })]);
    const memory = first.blocks.find((b) => b.type === "memory");
    assert.ok(memory && memory.type === "memory");
    assert.equal(memory.config.url, null);
    const again = await mergeBuilderBlocks(first.blocks, [block({ type: "memory" })]);
    assert.equal(again.blocks.filter((b) => b.type === "memory").length, 1);
  });

  it("places Indicators and a Signal next to a Price feed", async () => {
    const result = await mergeBuilderBlocks([], [
      block({ type: "market", symbol: "CAKE" }),
      block({ type: "indicators", timeframe: "4h" }),
      block({ type: "signal", condition: "rsiBelow", level: 25, timeframe: "1h" }),
    ]);
    const types = result.blocks.map((b) => b.type).sort();
    assert.deepEqual(types, ["indicators", "market", "signal"]);
    const signal = result.blocks.find((b) => b.type === "signal");
    assert.ok(signal && signal.type === "signal" && signal.config.level === 25);
  });

  it("drops Indicators and a Signal that have no Price feed, and says why", async () => {
    const result = await mergeBuilderBlocks([], [block({ type: "indicators" }), block({ type: "signal", condition: "maCrossUp" })]);
    assert.equal(result.blocks.length, 0);
    assert.ok(result.skipped.some((line) => /needs a Price feed/.test(line)));
  });

  it("builds the token checker recipe: Safety only", async () => {
    const result = await mergeBuilderBlocks([], [block({ type: "safety" })]);
    assert.deepEqual(result.blocks.map((b) => b.type), ["safety"]);
  });
});

describe("token-verdict agents always carry real conditions", () => {
  // What the free builder model wrote on 2026-10-02: a promise of rules, and none.
  const empty = "You check BNB Chain tokens. Apply these verdict rules in order: Avoid, Caution, or Safe, using the exact numbers below. Never guess.";

  it("writes the rules into a draft that only names the verdicts", () => {
    const fixed = withVerdictRules(empty);
    assert.ok(fixed && fixed.includes(TOKEN_VERDICT_RULES));
  });

  it("leaves a draft that already states its Avoid conditions alone", () => {
    assert.equal(withVerdictRules("Token checker. Avoid if it is a honeypot; Caution if tax above 5%; otherwise Safe."), null);
  });

  it("does not touch agents that do not grade tokens", () => {
    assert.equal(gradesTokens("You trade CAKE on the daily trend."), false);
    assert.equal(withVerdictRules("You trade CAKE on the daily trend."), null);
  });

  it("never condemns a token for minting when it is trusted", () => {
    assert.match(TOKEN_VERDICT_RULES, /trusted list, only mention these powers/);
    assert.doesNotMatch(TOKEN_VERDICT_RULES.split("CAUTION")[0], /mint/);
  });
});
