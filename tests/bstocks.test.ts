import assert from "node:assert/strict";
import { test } from "node:test";

import { BSTOCK_SYMBOLS, BSTOCK_WARNING, bstockOfMarket } from "../convex/lib/bstocks";
import { cleanRule } from "../convex/lib/strategy";
import { tradeKeyPolicy } from "../convex/lib/tradeKeyPolicy";
import { verifiedTokenBySymbol, verifiedTokens } from "../convex/lib/tradeTokens";

test("a bStock market resolves to its verified token, by ticker or company", () => {
  assert.equal(bstockOfMarket("TSLABUSDT")?.symbol, "TSLAB");
  assert.equal(bstockOfMarket("BNBUSDT"), null);
  assert.equal(verifiedTokenBySymbol("tesla")?.symbol, "TSLAB");
  assert.equal(verifiedTokenBySymbol("NVDAB")?.address, "0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436");
  assert.equal(verifiedTokenBySymbol("micron")?.decimals, 18);
});

test("a bStock rule is accepted and carries the who-may-hold and 24/7 warning", () => {
  const made = cleanRule({
    venue: "dolphin-wallet", market: "NVDABUSDT", timeframe: "1h",
    when: [{ kind: "rsi", op: "below", value: 30 }], until: [], action: "buy", sizeUsd: 10, stopLossPct: 4, takeProfitPct: 5,
  });
  assert.ok("rule" in made, JSON.stringify(made));
  assert.ok(made.warnings.includes(BSTOCK_WARNING));
  const crypto = cleanRule({ venue: "dolphin-wallet", market: "BNBUSDT", timeframe: "1h", when: [{ kind: "rsi", op: "below", value: 30 }], until: [], action: "buy", sizeUsd: 10, stopLossPct: 4 });
  assert.ok("rule" in crypto && !crypto.warnings.includes(BSTOCK_WARNING));
});

test("a trade key approves bStocks only when it is given them", () => {
  const base = verifiedTokens().filter((token) => !BSTOCK_SYMBOLS.has(token.symbol));
  const policy = (tokens: typeof base) =>
    tradeKeyPolicy({ dailyUsd: 10, durationDays: 7, bnbPriceUsd: 600, tokens, priceOf: () => 100 });
  const without = policy(base).approvals.map((a) => a.symbol);
  const withStocks = policy(verifiedTokens()).approvals.map((a) => a.symbol);
  assert.ok(!without.includes("TSLAB"));
  assert.ok(withStocks.includes("TSLAB") && withStocks.includes("SNDKB"));
});
