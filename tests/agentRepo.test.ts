import assert from "node:assert/strict";
import { test } from "node:test";

import { agentJson, readme, repoName, type RepoListing } from "../convex/lib/agentRepo";
import { planGrid } from "../convex/lib/grid";
import { cleanRule, type Rule } from "../convex/lib/strategy";

const listing: RepoListing = {
  hash: "abc",
  name: "BNB Range Grid!",
  description: "Grid trades BNB in a range.",
  instructions: "Trade the grid.",
  category: "grid-trading",
  protocol: "a2a",
  priceRaw: "50000000000000000",
  chainId: 56,
  registry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  tokenId: "365001",
  agentKey: "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:365001",
  ownerAddress: "0x13450a106568D011D25D8AC222b489B098Df9196",
  registerTxHash: "0x93fb33d967395ed3d1499978e3df9da75bca7665fa0e03022fd36d50d256b6e1",
  registeredAt: "2026-10-04T20:00:00.000Z",
  blocks: [{ type: "market", config: { symbol: "BNB" } }],
  tools: [],
};
const context = { registrationUrl: "https://x/registration.json", agentPageUrl: "https://www.dolphinamp.xyz/agent/365001", mcpUrl: "https://x/agent-card.json" };

function gridRules(): Rule[] {
  const plan = planGrid({ market: "BNBUSDT", venue: "dolphin-wallet", lower: 770, upper: 820, levels: 5, totalUsd: 50, stopBelowPct: 5 }, "grid-abc123");
  assert.ok(!("problems" in plan));
  return plan.rules.map((raw, index) => {
    const made = cleanRule(raw, `r${index}`);
    assert.ok(!("problems" in made));
    return { ...made.rule, grid: (raw as { grid: Rule["grid"] }).grid };
  });
}

test("the repository is named per agent and chain", () => {
  assert.equal(repoName(listing), "bnb-range-grid-56-365001");
});

test("the README shows the registry id and chain, as Set and Earn asks", () => {
  const text = readme(listing, gridRules(), context);
  assert.match(text, /Agent ID \| \*\*365001\*\*/);
  assert.match(text, /BNB Smart Chain mainnet \(56\)/);
  assert.match(text, /0x8004A169FB4a3325136EB29fA0ceB6D2e539a432/);
  // A grid is one line, not five.
  assert.equal((text.match(/^- Grid on BNBUSDT/gm) ?? []).length, 1);
  assert.match(text, /0\.05 U per job/);
});

test("a locked rule's conditions never reach the public repository", () => {
  const locked: Rule = { ...gridRules()[0], grid: undefined, locked: "listing-1", when: [{ kind: "rsi", op: "below", value: 27, period: 14 }] };
  const json = agentJson(listing, [locked], context);
  assert.doesNotMatch(json, /"rsi"/);
  assert.doesNotMatch(json, /27/);
  assert.match(json, /"locked": true/);
  assert.doesNotMatch(readme(listing, [locked], context), /RSI/);
});
