import { describe, expect, it } from "vitest";

import {
  formatUsdCents,
  formatUsdFromWei,
  isFresh,
  MAX_PRICE_AGE_SECONDS,
  weiToUsdCents,
  type BnbPrice,
} from "@/wallet/bnb-price";

/**
 * The real round read from the feed on 2026-09-12, kept as the fixture so the
 * numbers below are checkable against a chain call rather than against
 * something invented to make the test pass:
 *
 *   eth_call latestRoundData() -> answer 73515852000, updatedAt 1789224468
 *   eth_call decimals()        -> 8            ($735.15852 per BNB)
 */
const PRICE: BnbPrice = {
  answer: BigInt("73515852000"),
  decimals: 8,
  updatedAt: 1789224468,
};

const ONE_BNB = BigInt("1000000000000000000");

describe("weiToUsdCents", () => {
  it("prices one BNB at the round that was actually read", () => {
    // $735.15852 → 73515.852 cents → 73516 at the nearest cent.
    expect(weiToUsdCents(ONE_BNB, PRICE)).toBe(BigInt(73516));
  });

  it("prices zero as zero", () => {
    expect(weiToUsdCents(BigInt(0), PRICE)).toBe(BigInt(0));
  });

  it("scales linearly", () => {
    const ten = weiToUsdCents(ONE_BNB * BigInt(10), PRICE);
    expect(ten).toBe(BigInt(735159));
  });

  /*
   * The reason this function exists. Number(wei) is lossy above 2^53, so a
   * float implementation drifts here; bigint arithmetic does not.
   */
  it("stays exact on a balance far above Number.MAX_SAFE_INTEGER", () => {
    const huge = ONE_BNB * BigInt(1_000_000);
    expect(weiToUsdCents(huge, PRICE)).toBe(BigInt(73515852000));
  });

  /*
   * Rounding is to the NEAREST cent, so a vanishing fraction still rounds to
   * zero — which is what keeps formatUsdFromWei's "<$0.01" branch reachable.
   */
  it("rounds a vanishing fraction of a cent down to zero", () => {
    expect(weiToUsdCents(BigInt(1), PRICE)).toBe(BigInt(0));
  });
});

describe("formatUsdCents", () => {
  it("groups thousands and always shows two decimals", () => {
    expect(formatUsdCents(BigInt(73515))).toBe("$735.15");
    expect(formatUsdCents(BigInt(100))).toBe("$1.00");
    expect(formatUsdCents(BigInt(5))).toBe("$0.05");
    expect(formatUsdCents(BigInt(123456789))).toBe("$1,234,567.89");
  });

  it("renders zero as zero", () => {
    expect(formatUsdCents(BigInt(0))).toBe("$0.00");
  });
});

describe("formatUsdFromWei", () => {
  /*
   * The case a naive formatter gets wrong. Every Dolphin Wallet starts empty
   * and these balances are small; "$0.00" beside a visibly non-zero BNB figure
   * reads as "you have nothing".
   */
  it("says <$0.01 rather than $0.00 for a positive amount below a cent", () => {
    expect(formatUsdFromWei(BigInt(1), PRICE)).toBe("<$0.01");
  });

  it("says $0.00 for an actual zero", () => {
    expect(formatUsdFromWei(BigInt(0), PRICE)).toBe("$0.00");
  });

  it("formats a real balance", () => {
    expect(formatUsdFromWei(ONE_BNB, PRICE)).toBe("$735.16");
  });
});

describe("isFresh", () => {
  it("accepts a round from seconds ago", () => {
    expect(isFresh(PRICE, PRICE.updatedAt + 30)).toBe(true);
  });

  it("accepts a round exactly at the age limit", () => {
    expect(isFresh(PRICE, PRICE.updatedAt + MAX_PRICE_AGE_SECONDS)).toBe(true);
  });

  it("refuses a round past the age limit", () => {
    expect(isFresh(PRICE, PRICE.updatedAt + MAX_PRICE_AGE_SECONDS + 1)).toBe(false);
  });

  /*
   * A far-future timestamp means the BROWSER's clock is wrong, not the feed's.
   * Either way Dolphin cannot tell how old the price is, so it does not quote
   * it — a wrong dollar figure is worse than falling back to BNB.
   */
  it("refuses a round that appears to come from the far future", () => {
    expect(isFresh(PRICE, PRICE.updatedAt - MAX_PRICE_AGE_SECONDS - 1)).toBe(false);
  });

  it("tolerates small clock skew in either direction", () => {
    expect(isFresh(PRICE, PRICE.updatedAt - 5)).toBe(true);
  });
});
