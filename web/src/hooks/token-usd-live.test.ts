import { describe, expect, it } from "vitest";
import { FEE_TIERS } from "@/wallet/token-usd";
describe("pricing pool tiers", () => {
  it("checks every PancakeSwap V3 tier, the 1% one included (bStocks keep liquidity there)", () => {
    expect([...FEE_TIERS]).toEqual([100, 500, 2500, 10000]);
  });
});
