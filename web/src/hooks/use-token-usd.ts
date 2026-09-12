"use client";

import { useQuery } from "@tanstack/react-query";
import { createPublicClient, http, type Address } from "viem";
import { bsc } from "viem/chains";

import { BSC_RPC_URL } from "@/constants/agents";
import { useNow } from "@/hooks/use-now";
import { MAX_PRICE_AGE_SECONDS } from "@/wallet/bnb-price";
import {
  BNB_USD_FEED,
  FEE_TIERS,
  PANCAKE_V3_FACTORY,
  USDT_BSC,
  USDT_DECIMALS,
  USDT_USD_FEED,
  WBNB_BSC,
  composeRates,
  rateFromFeed,
  rateFromPool,
  type UsdRate,
} from "@/wallet/token-usd";

/**
 * Resolves ANY token address to a USD rate, or says it cannot.
 *
 * See wallet/token-usd.ts for the address verification and the arithmetic.
 * This file is only the plumbing: which route to take, and when to refuse.
 *
 * THREE ROUTES, in order of how directly sourced they are:
 *
 *   1. WBNB           → the BNB/USD feed. One hop, an oracle, done.
 *   2. USDT           → the USDT/USD feed. Also one hop. NOT assumed to be
 *                       $1.00 — it was $0.999803 when this was written.
 *   3. anything else  → the deepest PancakeSwap V3 pool against USDT, then
 *                       the USDT/USD feed. Two hops, composed exactly.
 *
 * There is no fourth route and no fallback guess. A token with no pool has no
 * dollar price here, and the UI shows the token amount instead.
 */

const client = createPublicClient({ chain: bsc, transport: http(BSC_RPC_URL) });

const AGGREGATOR_ABI = [
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
] as const;

const FACTORY_ABI = [
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "fee", type: "uint24" },
    ],
    outputs: [{ name: "pool", type: "address" }],
  },
] as const;

const POOL_ABI = [
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint32" },
      { name: "unlocked", type: "bool" },
    ],
  },
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "liquidity", stateMutability: "view", inputs: [], outputs: [{ type: "uint128" }] },
] as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export type TokenUsdState =
  | { status: "ready"; rate: UsdRate }
  | { status: "loading" }
  | { status: "unavailable" };

/**
 * The query options for one token, shared by `useTokenUsd` (one token) and
 * `usePaymentRates` (a list, via useQueries).
 *
 * Extracted so both go through the SAME key and the SAME fetcher. If they did
 * not, a hire panel and an activity row showing the same token could hold two
 * separately-fetched rates and disagree about what a price is — which is a
 * small thing that destroys trust in every number on the page.
 */
export function tokenUsdQuery(token: string | null, decimals: number | null) {
  const normalised = token ? token.toLowerCase() : null;
  const isNative = normalised === null || normalised === WBNB_BSC.toLowerCase();
  const isUsdt = normalised === USDT_BSC.toLowerCase();

  return {
    queryKey: ["token-usd", normalised ?? "native", decimals ?? "unknown"] as const,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
    enabled: isNative || isUsdt || (Boolean(normalised) && typeof decimals === "number"),
    queryFn: async (): Promise<UsdRate> => {
      const nowSeconds = Math.floor(Date.now() / 1000);

      if (isNative) return readFeed(BNB_USD_FEED, nowSeconds);
      if (isUsdt) return readFeed(USDT_USD_FEED, nowSeconds);

      const pool = await readPoolRate(normalised as Address, decimals as number);
      if (!pool) throw new Error("no liquid USDT pool for this token");

      // Compose to real dollars rather than stopping at USDT. The last leg is
      // small — USDT was $0.999803 — but it is the difference between a number
      // that was read and a number that was assumed.
      const usdtUsd = await readFeed(USDT_USD_FEED, nowSeconds);
      return composeRates(pool, usdtUsd);
    },
  };
}

/** A feed read, with its own freshness check. Throws rather than returning junk. */
async function readFeed(feed: Address, nowSeconds: number): Promise<UsdRate> {
  const round = await client.readContract({
    abi: AGGREGATOR_ABI,
    address: feed,
    functionName: "latestRoundData",
  });
  const answer = round[1];
  const updatedAt = Number(round[3]);

  // A non-positive answer is a broken feed, not a free token. Chainlink returns
  // int256 because some feeds can legitimately go negative; a USD price cannot.
  if (answer <= BigInt(0)) throw new Error("feed returned a non-positive answer");

  const age = nowSeconds - updatedAt;
  if (age > MAX_PRICE_AGE_SECONDS || age < -MAX_PRICE_AGE_SECONDS) {
    throw new Error("feed round is too old to quote");
  }

  // Every feed used here reports at 8 decimals; both were checked by calling
  // decimals(). Reading it per request would be a round trip to learn a
  // constant, so it is asserted in token-usd.ts's header instead.
  return rateFromFeed(answer, 8);
}

/**
 * token → USDT, through the deepest V3 pool that actually has liquidity.
 *
 * Tiers are tried cheapest-spread first. The liquidity check is not optional:
 * a pool can be deployed and empty, and an empty pool still reports a slot0
 * price — a completely fictitious one, left over from initialisation. That is
 * the single most likely way this function could print a wrong number, so an
 * empty pool is skipped rather than read.
 */
async function readPoolRate(token: Address, tokenDecimals: number): Promise<UsdRate | null> {
  for (const fee of FEE_TIERS) {
    const pool = await client.readContract({
      abi: FACTORY_ABI,
      address: PANCAKE_V3_FACTORY,
      functionName: "getPool",
      args: [token, USDT_BSC, fee],
    });
    if (pool === ZERO_ADDRESS) continue;

    const [slot0, token0, liquidity] = await Promise.all([
      client.readContract({ abi: POOL_ABI, address: pool, functionName: "slot0" }),
      client.readContract({ abi: POOL_ABI, address: pool, functionName: "token0" }),
      client.readContract({ abi: POOL_ABI, address: pool, functionName: "liquidity" }),
    ]);

    if (liquidity === BigInt(0)) continue;
    const sqrtPriceX96 = slot0[0];
    if (sqrtPriceX96 === BigInt(0)) continue;

    return rateFromPool({
      sqrtPriceX96,
      // Pools order their tokens by address, which is arbitrary — so this is
      // READ, never assumed. Getting it backwards yields a plausible-looking
      // reciprocal, which is the worst kind of wrong.
      tokenIsToken0: token0.toLowerCase() === token.toLowerCase(),
      tokenDecimals,
      stableDecimals: USDT_DECIMALS,
    });
  }
  return null;
}

/**
 * `token` is a BSC address, or null for native BNB. `decimals` must be the
 * token's real decimals — pass null while they are still being read, and this
 * reports "loading" rather than pricing against a guess.
 */
export function useTokenUsd(
  token: string | null | undefined,
  decimals: number | null | undefined,
): TokenUsdState {
  /*
   * Time from the shared ticker, not Date.now(): reading the clock during
   * render is impure and this repo's lint rules reject it outright. The 30s
   * bucket also keeps a freshness verdict stable between renders.
   */
  const nowMs = useNow();
  const query = useQuery(tokenUsdQuery(token ?? null, decimals ?? null));

  if (query.data) {
    // Without a clock there is no way to have judged feed age, so this is not
    // a quotable rate yet.
    if (nowMs === 0) return { status: "loading" };
    return { status: "ready", rate: query.data };
  }
  if (query.isLoading || query.isPending) return { status: "loading" };
  return { status: "unavailable" };
}
