import { formatUsdCents } from "@/wallet/bnb-price";

/**
 * What one token is worth in US dollars, for DISPLAY.
 *
 * ===========================================================================
 * WHY THIS EXISTS
 * ===========================================================================
 * Agents quote hire prices in whatever token they like — the catalog's paid
 * agents quote in $U — and "1200000000000000000 U" is not a price a person can
 * act on. Showing dollars is the difference between a number and a decision.
 *
 * It is also the single easiest place in this product to print a lie, so every
 * rate here is READ, never assumed, and the chain of custody for each one is
 * written down below.
 *
 * ===========================================================================
 * NOTHING IS ASSUMED TO BE WORTH A DOLLAR.
 * ===========================================================================
 * The tempting shortcut is "$U is a stablecoin, call it $1.00". Measured
 * 2026-09-12, $U was $0.999679 and USDT was $0.999803. Both are inside any
 * reasonable peg band and both are NOT one dollar. A 0.03% lie is still a
 * number nobody read, and pegs are exactly the thing that stops being true on
 * the day it matters (AGENTS.md §5).
 *
 * So even the stable leg is a live read.
 *
 * ===========================================================================
 * VERIFIED ADDRESSES (AGENTS.md §9 — never hardcode one unverified)
 * ===========================================================================
 * Every address below was checked against an official source AND called. The
 * call is the part that settles it; a docs page and an explorer label are both
 * somebody else's page.
 *
 *   BNB/USD feed   0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE
 *     data.chain.link/feeds/bsc/mainnet/bnb-usd; BscScan label.
 *     description() -> "BNB / USD", decimals() -> 8.
 *     Cross-checked: feed $736.53, Binance $736.75, CoinGecko $736.83.
 *
 *   USDT/USD feed  0xB97Ad0E74fa7d920791E90258A6E2085088b4320
 *     description() -> "USDT / USD", decimals() -> 8, answer $0.999803.
 *
 *   USDT (BSC)     0x55d398326f99059fF775485246999027B3197955
 *     symbol() -> "USDT", decimals() -> 18. NOTE THE 18: BSC's USDT is not
 *     the 6-decimal token it is on Ethereum, and assuming 6 would misprice
 *     everything by a factor of a trillion.
 *
 *   PancakeSwap V3 factory
 *                  0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865
 *     developer.pancakeswap.finance/contracts/v3/pancakev3factory; BscScan
 *     label. Verified by USE rather than by reading: getPool(U, USDT, 100)
 *     returned 0xa0909f81785f87f3e79309f0e73a7d82208094e4, whose token0() is
 *     USDT, token1() is $U and fee() is 100. A wrong factory could not have
 *     produced that.
 *
 * POOL ADDRESSES ARE NEVER WRITTEN DOWN. They are derived through the factory
 * at read time, which is what makes this safe to extend to a token nobody has
 * thought of yet — and removes the single most likely place to paste a wrong
 * address.
 *
 * CONFIDENCE: high, with one honest caveat. A V3 spot price is a single-block
 * quantity and can be pushed around by someone willing to spend money. That is
 * acceptable HERE because this value is only ever displayed beside the real
 * token amount, never used to decide what gets paid — the escrow moves the
 * token amount the quote names, and nothing in this file touches that path.
 * ===========================================================================
 */

export const USDT_BSC = "0x55d398326f99059fF775485246999027B3197955" as const;
export const USDT_DECIMALS = 18;
export const WBNB_BSC = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" as const;
export const BNB_USD_FEED = "0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE" as const;
export const USDT_USD_FEED = "0xB97Ad0E74fa7d920791E90258A6E2085088b4320" as const;
export const PANCAKE_V3_FACTORY = "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865" as const;

/**
 * Fee tiers to try, cheapest spread first.
 *
 * 100 (0.01%) is PancakeSwap's stable tier and is where $U actually lives;
 * 500 and 2500 catch a volatile token quoted by some future agent. The first
 * tier with a pool AND non-zero liquidity wins — a deployed-but-empty pool
 * returns a nonsense spot price, and there are plenty of those.
 */
export const FEE_TIERS = [100, 500, 2500] as const;

/**
 * USD per ONE WHOLE token, as an exact fraction.
 *
 * A fraction rather than a scaled integer because these get COMPOSED: the
 * route for an arbitrary token is token→USDT through a pool, then USDT→USD
 * through a feed, and multiplying two fractions is exact while multiplying two
 * pre-rounded decimals is not. Nothing here is ever a float.
 */
export type UsdRate = Readonly<{ num: bigint; den: bigint }>;

const Q96 = BigInt(2) ** BigInt(96);
const Q192 = Q96 * Q96;

function pow10(n: number): bigint {
  return BigInt(10) ** BigInt(n);
}

/** A Chainlink `answer` at `decimals` → USD per whole token. */
export function rateFromFeed(answer: bigint, decimals: number): UsdRate {
  return { num: answer, den: pow10(decimals) };
}

/**
 * A Uniswap-V3-style pool → how much of the STABLE side one whole token buys.
 *
 * `sqrtPriceX96` encodes `sqrt(raw token1 per raw token0) * 2^96`, so the raw
 * price is `sqrtPriceX96² / 2^192`. Which way up that is depends on whether the
 * token we are pricing sorted into slot 0 or slot 1 — pools order their tokens
 * by address, which is arbitrary, so this cannot be assumed and is read from
 * the pool.
 *
 * Getting this inverted is the classic V3 mistake and it does not look wrong:
 * for a token near a dollar, 1/0.9997 is 1.0003, and both are plausible.
 * Hence the test that walks both orderings.
 */
export function rateFromPool(input: {
  sqrtPriceX96: bigint;
  tokenIsToken0: boolean;
  tokenDecimals: number;
  stableDecimals: number;
}): UsdRate {
  const squared = input.sqrtPriceX96 * input.sqrtPriceX96;
  const tokenScale = pow10(input.tokenDecimals);
  const stableScale = pow10(input.stableDecimals);

  // token0 → stable is token1: raw stable per raw token = squared / 2^192.
  if (input.tokenIsToken0) {
    return { num: squared * tokenScale, den: Q192 * stableScale };
  }
  // token1 → stable is token0: the reciprocal.
  return { num: Q192 * tokenScale, den: squared * stableScale };
}

/** Chain two legs (token→USDT, then USDT→USD). Exact. */
export function composeRates(first: UsdRate, second: UsdRate): UsdRate {
  return { num: first.num * second.num, den: first.den * second.den };
}

/**
 * An atomic token amount → whole US cents.
 *
 * Multiplies before it divides, so precision survives to the last step. The
 * float version of this line loses precision above 2^53 and then rounds a
 * money figure by an amount nobody can predict.
 *
 * ---------------------------------------------------------------------------
 * ROUNDS TO THE NEAREST CENT, and does not truncate (changed 2026-09-12).
 *
 * Truncation was the first implementation and it looked harmless until a real
 * price went through it: an agent charging 0.10 $U is worth 9.99 cents, and
 * truncating rendered that as "$0.09" — a 10% understatement of a small price.
 * Systematically rounding a COST down is the wrong direction to be wrong in;
 * the user pays the higher number.
 *
 * Nearest-cent has no bias in either direction and is what every other
 * currency display does. The half is added before the divide so it all stays
 * in integer arithmetic — no float touches a money value anywhere in here.
 * ---------------------------------------------------------------------------
 */
export function usdCents(
  amountRaw: bigint,
  tokenDecimals: number,
  rate: UsdRate,
): bigint {
  const numerator = amountRaw * rate.num * BigInt(100);
  const denominator = rate.den * pow10(tokenDecimals);
  return (numerator + denominator / BigInt(2)) / denominator;
}

/**
 * The display string for a token amount in dollars.
 *
 * `<$0.01` rather than `$0.00` for a positive amount below a cent — agent
 * hires are genuinely this small, and "$0.00" beside a visible token amount
 * reads as free when it is not.
 */
export function formatUsd(
  amountRaw: bigint,
  tokenDecimals: number,
  rate: UsdRate,
): string {
  const cents = usdCents(amountRaw, tokenDecimals, rate);
  if (cents === BigInt(0) && amountRaw > BigInt(0)) return "<$0.01";
  return formatUsdCents(cents);
}
