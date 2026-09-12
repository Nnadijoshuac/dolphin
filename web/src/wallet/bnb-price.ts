/**
 * BNB → USD, read from Chainlink on BNB Smart Chain.
 *
 * ===========================================================================
 * WHY AN ON-CHAIN FEED AND NOT A PRICE API
 * ===========================================================================
 * The wallet screen had no USD figure at all, because inventing one is exactly
 * what AGENTS.md §5 forbids and nothing here read a price. Adding the option
 * meant adding a real source, and there were two shapes available:
 *
 *   a price API (CoinGecko, Binance, CMC) — a key to hold, a rate limit, a
 *   server route to proxy it through, and a number whose provenance is "some
 *   endpoint said so";
 *
 *   Chainlink's aggregator, already deployed on the chain this product is
 *   already reading — no key, no proxy, no new transport, and the same viem
 *   client the rest of the wallet uses (the locked stack, AGENTS.md §1).
 *
 * The second one is strictly better here and it is also more honest: the
 * figure is a live on-chain read with a timestamp attached, so `updatedAt`
 * below can be shown to the user and a stale feed can be REFUSED rather than
 * rendered. A REST price has no equivalent.
 *
 * ===========================================================================
 * ADDRESS VERIFICATION (AGENTS.md §9 — never hardcode an address unverified)
 * ===========================================================================
 * 0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE — BNB/USD, BNB Smart Chain 56.
 *
 * Checked three ways on 2026-09-12, not one:
 *
 *   1. Chainlink's own feed portal lists it for bsc/mainnet:
 *      https://data.chain.link/feeds/bsc/mainnet/bnb-usd
 *   2. BscScan labels the contract "Chainlink: BNB/USD Price Feed".
 *   3. CALLED IT. This is the check that actually settles it, because the
 *      first two are both somebody else's page:
 *
 *        eth_call description()     -> "BNB / USD"
 *        eth_call decimals()        -> 8
 *        eth_call latestRoundData() -> answer 73515852000, updatedAt 1789224468
 *
 *      73515852000 / 1e8 = $735.15852, and the timestamp was minutes old.
 *
 * CONFIDENCE: high. A wrong address here does not move funds — it can only
 * mis-price a display — but a mis-priced display is still a fabricated number
 * by another route, which is the thing §5 is about.
 * ===========================================================================
 */

/** Chainlink AggregatorV3 BNB/USD on BNB Smart Chain. See the note above. */
export const BNB_USD_FEED = "0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE" as const;

/**
 * Only the two calls this needs. The full AggregatorV3Interface has six, and
 * carrying the four unused ones would be four more chances to be wrong about a
 * signature nothing exercises.
 */
export const AGGREGATOR_V3_ABI = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

/**
 * How old a round may be before Dolphin stops quoting it.
 *
 * Chainlink's BNB/USD feed on BSC has a 0.5% deviation threshold and a 60s
 * heartbeat, so a healthy round is seconds old and anything past an hour means
 * the feed has stopped, not that the price has held still. An hour is
 * deliberately generous: the cost of refusing a good price is that the user
 * sees BNB, and the cost of quoting a dead one is a wrong dollar figure.
 */
export const MAX_PRICE_AGE_SECONDS = 60 * 60;

export type BnbPrice = Readonly<{
  /** USD per 1 BNB, scaled by 10^decimals. Never a float. */
  answer: bigint;
  decimals: number;
  /** Seconds since epoch, from the feed itself — not from this machine. */
  updatedAt: number;
}>;

/**
 * Is this round fresh enough to quote?
 *
 * `nowSeconds` is a parameter rather than a `Date.now()` call so this is pure
 * and testable, and so the caller decides what "now" means.
 */
export function isFresh(price: BnbPrice, nowSeconds: number): boolean {
  const age = nowSeconds - price.updatedAt;
  /*
   * A round timestamped in the FUTURE is rejected too. That is not paranoia
   * about oracles: the comparison uses the browser's clock, and a device whose
   * clock is days behind would make every round look like it came from the
   * future. Either way Dolphin does not know how old the price is, so it does
   * not quote it.
   */
  return age >= -MAX_PRICE_AGE_SECONDS && age <= MAX_PRICE_AGE_SECONDS;
}

/**
 * wei of BNB × price → US cents, in integer arithmetic the whole way.
 *
 * ---------------------------------------------------------------------------
 * NO FLOATS, and this is the point of the function.
 *
 * The obvious version is `Number(formatEther(wei)) * (Number(answer) / 1e8)`,
 * and it is wrong twice: `Number(wei)` loses precision above 2^53, and
 * float multiplication then rounds a money figure by an amount nobody can
 * predict. Staying in bigint until the final division means the cents value is
 * exact and the only rounding is the one that is actually intended — truncation
 * to a cent.
 *
 * Returns cents (not dollars) so the caller formats a known integer rather than
 * re-deriving the decimal point.
 * ---------------------------------------------------------------------------
 */
const WEI_PER_BNB = BigInt("1000000000000000000");

export function weiToUsdCents(wei: bigint, price: BnbPrice): bigint {
  const scale = BigInt(10) ** BigInt(price.decimals);
  // × 100 for cents, before either division, so precision is kept.
  return (wei * price.answer * BigInt(100)) / (WEI_PER_BNB * scale);
}

/** Cents → "$1,234.56". Grouping via Intl on an integer, so no float anywhere. */
export function formatUsdCents(cents: bigint): string {
  const negative = cents < BigInt(0);
  const absolute = negative ? -cents : cents;
  const dollars = absolute / BigInt(100);
  const remainder = absolute % BigInt(100);
  const grouped = new Intl.NumberFormat("en-US").format(dollars);
  const padded = remainder.toString().padStart(2, "0");
  return `${negative ? "-" : ""}$${grouped}.${padded}`;
}

/**
 * "$736.53" — the rate itself, for showing WHERE a dollar figure came from.
 *
 * ---------------------------------------------------------------------------
 * Provenance is not a nicety here. A USD balance is the only number on this
 * screen that Dolphin computes rather than reads, so it is the only one a bug
 * can make plausibly wrong without anything looking broken. Printing the rate
 * and naming the oracle beside it means a wrong dollar figure is checkable in
 * two seconds against any exchange, instead of being taken on trust.
 *
 * Cross-checked 2026-09-12: the feed read $736.53017, Binance spot was $736.75
 * and CoinGecko $736.83 — 0.03% drift, inside the feed's 0.5% deviation band,
 * on a round 58 seconds old against a 60-second heartbeat.
 * ---------------------------------------------------------------------------
 */
export function formatPricePerBnb(price: BnbPrice): string {
  const scale = BigInt(10) ** BigInt(price.decimals);
  const cents = (price.answer * BigInt(100)) / scale;
  return formatUsdCents(cents);
}

/**
 * The sub-cent case, which a naive formatter gets embarrassingly wrong.
 *
 * Every Dolphin Wallet starts empty and the amounts here are small; a balance
 * worth a third of a cent formats as "$0.00", which reads as "you have
 * nothing" when the person can see a non-zero BNB figure directly above it.
 * "<$0.01" is the honest rendering of a positive amount below the resolution
 * of the format.
 */
export function formatUsdFromWei(wei: bigint, price: BnbPrice): string {
  const cents = weiToUsdCents(wei, price);
  if (cents === BigInt(0) && wei > BigInt(0)) return "<$0.01";
  return formatUsdCents(cents);
}
