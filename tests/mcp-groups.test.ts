import assert from "node:assert/strict";
import { test } from "node:test";

import { GROUP_NAMES, GROUPS, groupsFrom, handleMarketplaceMcp } from "../convex/marketplaceMcp";
import { checkRule } from "../convex/lib/mcpMarket";
import type { ActionCtx } from "../convex/_generated/server";

/** tools/list and initialize touch no database: a bare ctx is enough. */
const ctx = {} as ActionCtx;
const names = async (groups = GROUP_NAMES) => {
  const reply = (await handleMarketplaceMcp(ctx, { jsonrpc: "2.0", id: 1, method: "tools/list" }, groups)) as { result: { tools: { name: string }[] } };
  return reply.result.tools.map((tool) => tool.name);
};

test("one address serves every group unless the URL names some", async () => {
  assert.deepEqual(groupsFrom(null), GROUP_NAMES);
  assert.deepEqual(groupsFrom(""), GROUP_NAMES);
  assert.deepEqual(groupsFrom("nonsense"), GROUP_NAMES);
  assert.deepEqual(groupsFrom("market, RULES,market"), ["market", "rules"]);
  const all = await names();
  for (const tool of ["search_agents", "get_agent", "call_agent", "list_categories", "get_reviews", "get_price", "get_candles", "get_indicators", "check_rule", "backtest_rule", "get_escrow_job"]) {
    assert.ok(all.includes(tool), tool);
  }
  assert.equal(new Set(all).size, all.length, "no tool name appears twice");
  assert.deepEqual(await names(["rules"]), ["check_rule", "backtest_rule"]);
});

test("every tool says it only reads, except call_agent which runs a publisher's read tool", () => {
  for (const group of GROUP_NAMES) {
    for (const tool of GROUPS[group]) {
      const hints = tool.annotations as { readOnlyHint?: boolean; destructiveHint?: boolean } | undefined;
      assert.equal(hints?.destructiveHint, false, tool.name);
      if (tool.name !== "call_agent") assert.equal(hints?.readOnlyHint, true, tool.name);
    }
  }
});

test("a tool outside the connection's groups is refused, not run", async () => {
  const reply = (await handleMarketplaceMcp(ctx, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_price", arguments: { symbol: "BNBUSDT" } } }, ["rules"])) as {
    result: { isError: boolean; content: { text: string }[] };
  };
  assert.equal(reply.result.isError, true);
  assert.match(reply.result.content[0].text, /not|groups/i);
});

test("check_rule cleans a good rule and names what is wrong with a bad one", () => {
  const good = checkRule({
    rule: { venue: "binance-futures", market: "BNBUSDT", timeframe: "4h", action: "short", when: [{ kind: "trend", direction: "down", candles: 3 }], sizeUsd: 50, leverage: 4, stopLossPct: 5 },
  });
  assert.equal(good.isError, false);
  const body = JSON.parse(good.content[0].text) as { ok: boolean; warnings: string[]; inWords: string };
  assert.equal(body.ok, true);
  assert.ok(body.warnings.some((warning) => /liquidate/.test(warning)), "4x carries the liquidation warning");

  const bad = checkRule({ rule: { venue: "binance-spot", market: "BNBUSDT", timeframe: "4h", action: "short", when: [], sizeUsd: 50 } });
  assert.equal(bad.isError, true);
  const problems = (JSON.parse(bad.content[0].text) as { problems: string[] }).problems.join(" ");
  assert.match(problems, /Futures/);
  assert.match(problems, /at least one condition/);
});

test("initialize describes only the groups asked for, and never claims a payment", async () => {
  const reply = (await handleMarketplaceMcp(ctx, { jsonrpc: "2.0", id: 3, method: "initialize" }, ["market"])) as { result: { instructions: string } };
  assert.match(reply.result.instructions, /get_price/);
  assert.doesNotMatch(reply.result.instructions, /search_agents/);
  assert.match(reply.result.instructions, /Nothing here is financial advice/);
});
