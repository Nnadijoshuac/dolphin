"use client";

import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";

import { useNow } from "@/hooks/use-now";
import { tokenUsdQuery } from "@/hooks/use-token-usd";
import type { UsdRate } from "@/wallet/token-usd";

/**
 * USD rates for a LIST of payment tokens, keyed by lowercased address.
 *
 * ---------------------------------------------------------------------------
 * WHY A SEPARATE HOOK FROM useTokenUsd
 * ---------------------------------------------------------------------------
 * Rules of hooks. A list of paid jobs renders in a `for` loop, and a rate
 * cannot be fetched per row inside one. `useQueries` takes a variable-length
 * array and is the supported way to do exactly this.
 *
 * It is also the behaviour you would want regardless: twenty rows paid in $U
 * read the $U price ONCE, and two rows denominated in the same token cannot
 * disagree about what it is worth — they are literally the same cached value,
 * shared with useTokenUsd through the same query key.
 *
 * A token whose rate could not be read is simply absent from the map. Callers
 * fall back to the token amount; nothing is estimated (AGENTS.md §5).
 * ---------------------------------------------------------------------------
 */
export function usePaymentRates(
  tokens: ReadonlyArray<{ token: string | null | undefined; decimals: number | null | undefined }>,
): ReadonlyMap<string, UsdRate> {
  // Time from the shared ticker; reading the clock in render is impure and
  // this repo's lint rules reject it.
  const nowMs = useNow();

  /*
   * De-duplicated and SORTED, so the array `useQueries` receives is stable
   * between renders for the same set of tokens. An unstable array here would
   * re-subscribe on every render.
   */
  const distinct = useMemo(() => {
    const seen = new Map<string, number>();
    for (const entry of tokens) {
      if (!entry.token || typeof entry.decimals !== "number" || entry.decimals <= 0) continue;
      const key = entry.token.toLowerCase();
      if (!seen.has(key)) seen.set(key, entry.decimals);
    }
    return [...seen.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [tokens]);

  const results = useQueries({
    queries: distinct.map(([token, decimals]) => tokenUsdQuery(token, decimals)),
  });

  return useMemo(() => {
    const map = new Map<string, UsdRate>();
    if (nowMs === 0) return map;
    distinct.forEach(([token], index) => {
      const data = results[index]?.data;
      if (data) map.set(token, data);
    });
    return map;
    // `results` is a fresh array identity each render; the data inside it is
    // what matters, so the map is rebuilt whenever any entry's data changes.
  }, [distinct, results, nowMs]);
}
