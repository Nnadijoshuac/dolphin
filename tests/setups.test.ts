import assert from "node:assert/strict";
import { test } from "node:test";

import { publicRule, sanitizeBlocks } from "../convex/setups";
import { cleanRule, type Rule } from "../convex/lib/strategy";
import type { AgentBlock } from "../convex/lib/agentBlocks";

const secret = (cleanRule(
  { venue: "binance-futures", market: "ETHUSDT", timeframe: "1h", action: "short", sizeUsd: 40, leverage: 2, when: [{ kind: "rsi", op: "above", value: 71, period: 9 }], until: [{ kind: "rsi", op: "below", value: 33 }], stopLossPct: 3, takeProfitPct: 7 },
  "s",
) as { rule: Rule }).rule;

test("what anyone may see of a listed rule carries no condition", () => {
  const shown = JSON.stringify(publicRule(secret));
  assert.doesNotMatch(shown, /rsi|71|33|"when"|"until"|period/i);
  for (const field of ["ETHUSDT", "1h", "binance-futures", "40", "3", "7"]) assert.ok(shown.includes(field), field);
});

test("a setup carries no personal block and no seller's key names", () => {
  const blocks = [
    { id: "m", type: "market", config: { tokenAddress: "0xbb4C", symbol: "WBNB", name: "WBNB", poolAddress: null } },
    { id: "b", type: "binance", config: { account: "exchange", futures: true, maxLeverage: 2, network: "live", keyName: "MY_BINANCE_KEY", secretName: "MY_BINANCE_SECRET" } },
    { id: "mem", type: "memory", config: { url: "https://seller.example/memory", keyName: "MEM" } },
    { id: "d", type: "dataSource", config: { url: "https://seller.example/api", keyName: "SRC" } },
  ] as unknown as AgentBlock[];
  const copied = sanitizeBlocks(blocks);
  assert.deepEqual(copied.map((block) => block.type), ["market", "binance"]);
  const shown = JSON.stringify(copied);
  assert.doesNotMatch(shown, /MY_BINANCE|seller\.example|"network"/);
});
