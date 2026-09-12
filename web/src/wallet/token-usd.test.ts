import { describe, expect, it } from "vitest";

import {
  composeRates,
  formatUsd,
  rateFromFeed,
  rateFromPool,
  usdCents,
} from "@/wallet/token-usd";

/**
 * Every fixture is a value READ FROM THE CHAIN on 2026-09-12, not a number
 * invented to make an assertion pass. If one of these ever has to change, the
 * question to ask first is whether the code or the fixture is wrong.
 *
 *   BNB/USD  0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE
 *     latestRoundData().answer = 73653017297, decimals() = 8  -> $736.53017
 *
 *   USDT/USD 0xB97Ad0E74fa7d920791E90258A6E2085088b4320
 *     latestRoundData().answer = 99980330,    decimals() = 8  -> $0.999803
 *
 *   U/USDT 0.01% pool 0xa0909f81785f87f3e79309f0e73a7d82208094e4
 *     (derived: PancakeV3Factory.getPool(U, USDT, 100))
 *     token0() = USDT (18dp), token1() = $U (18dp)
 *     slot0().sqrtPriceX96 = 79240901306318568366569121503
 *     -> 1 $U = 0.99967851 USDT
 */
const BNB_ANSWER = BigInt("73653017297");
const USDT_ANSWER = BigInt("99980330");
const U_POOL_SQRT = BigInt("79240901306318568366569121503");

const ONE = BigInt("1000000000000000000"); // 1e18 — 18dp is right for BNB, $U and BSC USDT

describe("rateFromFeed", () => {
  it("prices one BNB at the round that was actually read", () => {
    const rate = rateFromFeed(BNB_ANSWER, 8);
    // $736.53017 -> 73653.017 cents -> 73653 at the nearest cent.
    expect(usdCents(ONE, 18, rate)).toBe(BigInt(73653));
    expect(formatUsd(ONE, 18, rate)).toBe("$736.53");
  });

  /*
   * Two things at once.
   *
   * BSC's USDT has EIGHTEEN decimals, not Ethereum's six — assuming six would
   * misprice every hire by a factor of a trillion, which is the kind of bug
   * that is obvious in production and invisible in review.
   *
   * And USDT is $0.999803, which rounds to $1.00 at two decimals, so the
   * assertion also checks CENTS at scale where the difference from a hardcoded
   * peg is still visible. The point is not that the display differs; it is
   * that the number was read rather than assumed.
   */
  it("prices BSC USDT from the feed, not from an assumed peg", () => {
    const rate = rateFromFeed(USDT_ANSWER, 8);
    expect(formatUsd(ONE, 18, rate)).toBe("$1.00");
    expect(usdCents(ONE * BigInt(10_000), 18, rate)).toBe(BigInt(999803));
  });
});

describe("rateFromPool", () => {
  /*
   * In the real pool $U sorted into slot 1 and USDT into slot 0, so this is
   * the orientation the app actually uses.
   */
  it("prices $U from the live pool, with $U as token1", () => {
    const rate = rateFromPool({
      sqrtPriceX96: U_POOL_SQRT,
      tokenIsToken0: false,
      tokenDecimals: 18,
      stableDecimals: 18,
    });
    // 1 $U = 0.99967851 USDT -> 99.97 cents -> 100 at the nearest cent.
    expect(usdCents(ONE, 18, rate)).toBe(BigInt(100));
    // 1000 $U is where the difference from a $1 peg becomes visible.
    expect(usdCents(ONE * BigInt(1000), 18, rate)).toBe(BigInt(99968));
  });

  /*
   * THE CLASSIC V3 MISTAKE, and the reason this function takes tokenIsToken0
   * rather than guessing. Inverting the price does not look wrong: for a token
   * near a dollar, 1/0.99968 is 1.00032, and both are perfectly plausible on
   * screen. Only a test catches it.
   */
  it("inverts when the token sorts into slot 0 instead", () => {
    const asToken1 = rateFromPool({
      sqrtPriceX96: U_POOL_SQRT,
      tokenIsToken0: false,
      tokenDecimals: 18,
      stableDecimals: 18,
    });
    const asToken0 = rateFromPool({
      sqrtPriceX96: U_POOL_SQRT,
      tokenIsToken0: true,
      tokenDecimals: 18,
      stableDecimals: 18,
    });

    expect(usdCents(ONE * BigInt(1000), 18, asToken1)).toBe(BigInt(99968));
    expect(usdCents(ONE * BigInt(1000), 18, asToken0)).toBe(BigInt(100032));
    // And they really are reciprocals, not merely different.
    expect(asToken1.num * asToken0.num).toBe(asToken1.den * asToken0.den);
  });

  /*
   * Decimals coherence, stated the way the pool actually works.
   *
   * sqrtPriceX96 encodes a RAW ratio, so it already carries both tokens'
   * decimals inside it — the same human price on a 6-decimal token is a
   * DIFFERENT sqrtPriceX96, smaller by sqrt(1e12) = 1e6. (My first version of
   * this test held sqrtPriceX96 fixed and changed only tokenDecimals, which
   * asserts that two different prices are equal. The code was right and the
   * test was wrong.)
   *
   * So: shrink the encoded price by 1e6 and shrink the decimals by 12, and one
   * whole token must still be worth the same number of cents.
   */
  it("stays coherent when the token's decimals differ from the stable's", () => {
    const eighteen = rateFromPool({
      sqrtPriceX96: U_POOL_SQRT,
      tokenIsToken0: false,
      tokenDecimals: 18,
      stableDecimals: 18,
    });
    const six = rateFromPool({
      sqrtPriceX96: U_POOL_SQRT / BigInt(1_000_000),
      tokenIsToken0: false,
      tokenDecimals: 6,
      stableDecimals: 18,
    });

    const thousandWhole18 = ONE * BigInt(1000);
    const thousandWhole6 = BigInt(1_000_000) * BigInt(1000);
    expect(usdCents(thousandWhole6, 6, six)).toBe(
      usdCents(thousandWhole18, 18, eighteen),
    );
  });
});

describe("composeRates", () => {
  /*
   * The real route for a hire priced in $U: pool gives $U -> USDT, feed gives
   * USDT -> USD. Composing is exact; multiplying two pre-rounded decimals is
   * not, which is why UsdRate is a fraction.
   */
  it("chains $U -> USDT -> USD", () => {
    const pool = rateFromPool({
      sqrtPriceX96: U_POOL_SQRT,
      tokenIsToken0: false,
      tokenDecimals: 18,
      stableDecimals: 18,
    });
    const feed = rateFromFeed(USDT_ANSWER, 8);
    const composed = composeRates(pool, feed);

    // 0.99967851 * 0.99980330 = 0.99948185 -> $999.48 for a thousand $U.
    expect(usdCents(ONE * BigInt(1000), 18, composed)).toBe(BigInt(99948));
    /*
     * The case that made rounding necessary at all: a real agent charging
     * 0.10 $U. Truncation rendered 9.99 cents as "$0.09", understating a
     * price by 10%.
     */
    expect(formatUsd(ONE / BigInt(10), 18, composed)).toBe("$0.10");
  });

  it("is order-independent, as multiplication should be", () => {
    const a = rateFromFeed(BNB_ANSWER, 8);
    const b = rateFromFeed(USDT_ANSWER, 8);
    expect(usdCents(ONE, 18, composeRates(a, b))).toBe(
      usdCents(ONE, 18, composeRates(b, a)),
    );
  });
});

describe("usdCents precision", () => {
  it("stays exact far above Number.MAX_SAFE_INTEGER", () => {
    const rate = rateFromFeed(BNB_ANSWER, 8);
    expect(usdCents(ONE * BigInt(1_000_000), 18, rate)).toBe(BigInt(73653017297));
  });

  it("rounds a vanishing fraction of a cent down to zero", () => {
    const rate = rateFromFeed(BNB_ANSWER, 8);
    expect(usdCents(BigInt(1), 18, rate)).toBe(BigInt(0));
  });
});

describe("formatUsd", () => {
  /*
   * Agent hires really are this small. "$0.00" beside a visible token amount
   * reads as free when it is not.
   */
  it("says <$0.01 for a positive amount below a cent", () => {
    const rate = rateFromFeed(BNB_ANSWER, 8);
    expect(formatUsd(BigInt(1), 18, rate)).toBe("<$0.01");
  });

  it("says $0.00 only for an actual zero", () => {
    const rate = rateFromFeed(BNB_ANSWER, 8);
    expect(formatUsd(BigInt(0), 18, rate)).toBe("$0.00");
  });

  it("groups thousands", () => {
    const rate = rateFromFeed(BNB_ANSWER, 8);
    expect(formatUsd(ONE * BigInt(10), 18, rate)).toBe("$7,365.30");
  });
});
