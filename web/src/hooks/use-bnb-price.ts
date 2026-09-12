"use client";

import { useQuery } from "@tanstack/react-query";
import { createPublicClient, http } from "viem";
import { bsc } from "viem/chains";

import { BSC_RPC_URL } from "@/constants/agents";
import { useNow } from "@/hooks/use-now";
import {
  AGGREGATOR_V3_ABI,
  BNB_USD_FEED,
  isFresh,
  type BnbPrice,
} from "@/wallet/bnb-price";

/**
 * Reads Chainlink's BNB/USD round. See wallet/bnb-price.ts for why the feed is
 * on-chain rather than a price API, and for the address verification.
 *
 * A module-level client, like altana-provider's keystoreReader: this is a
 * read-only transport with no per-render state, and rebuilding it every render
 * would throw away viem's own request batching.
 */
const feedReader = createPublicClient({
  chain: bsc,
  transport: http(BSC_RPC_URL),
});

export type BnbPriceState =
  /** A fresh round. `price` may be used to quote USD. */
  | { status: "ready"; price: BnbPrice }
  /** First read in flight. Show BNB, not a stale or blank dollar figure. */
  | { status: "loading" }
  /** Read failed, or the round is too old to quote. USD must be refused. */
  | { status: "unavailable"; reason: string };

/**
 * ---------------------------------------------------------------------------
 * THE ONLY RULE HERE: a price is quotable or it is not. There is no third
 * state where Dolphin shows a dollar figure it is unsure about.
 *
 * `refetchInterval` is 60s because the feed's heartbeat is 60s — polling
 * faster would burn RPC calls to re-read the same round. `staleTime` is 30s so
 * a component mounting mid-cycle reuses the round already in cache rather than
 * firing its own request; every consumer shares one query key and therefore
 * one round, which also guarantees two figures on one screen cannot be priced
 * differently.
 * ---------------------------------------------------------------------------
 */
export function useBnbPrice(): BnbPriceState {
  /*
   * Time comes from the shared ticker, not from `Date.now()`.
   *
   * Reading the clock during render is impure — React may re-render at any
   * moment and get a different answer — and this repo's lint rules reject it
   * outright (react-hooks/purity caught exactly this here). useNow is also the
   * better behaviour: it buckets to 30s, so a freshness verdict is stable
   * between ticks instead of flickering, and every clock-dependent thing on the
   * page moves off one timer.
   */
  const nowMs = useNow();

  const query = useQuery({
    queryKey: ["bnb-usd-chainlink", BNB_USD_FEED],
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
    queryFn: async (): Promise<BnbPrice> => {
      const [round, decimals] = await Promise.all([
        feedReader.readContract({
          abi: AGGREGATOR_V3_ABI,
          address: BNB_USD_FEED,
          functionName: "latestRoundData",
        }),
        feedReader.readContract({
          abi: AGGREGATOR_V3_ABI,
          address: BNB_USD_FEED,
          functionName: "decimals",
        }),
      ]);

      const answer = round[1];
      const updatedAt = round[3];

      /*
       * A non-positive answer is a broken feed, not a free BNB. Chainlink's
       * aggregator returns int256 precisely because some feeds can go
       * negative; this one cannot meaningfully, so a zero or negative round is
       * a malfunction and must not be priced.
       */
      if (answer <= BigInt(0)) {
        throw new Error("The price feed returned a non-positive answer.");
      }

      return { answer, decimals, updatedAt: Number(updatedAt) };
    },
  });

  if (query.data) {
    /*
     * useNow returns 0 until the client knows the time (its server snapshot).
     * Without a clock there is no way to judge a round's age, and an unjudged
     * round is not a quotable one — so this reports "loading" rather than
     * assuming the price is good.
     */
    if (nowMs === 0) return { status: "loading" };

    if (!isFresh(query.data, Math.floor(nowMs / 1000))) {
      return {
        status: "unavailable",
        reason: "The price feed has not updated recently enough to quote.",
      };
    }
    return { status: "ready", price: query.data };
  }

  if (query.isLoading) return { status: "loading" };

  return {
    status: "unavailable",
    reason: "The BNB price could not be read just now.",
  };
}
