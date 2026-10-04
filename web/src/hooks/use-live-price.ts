"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";

import { WALLET_TOKENS } from "@/hooks/use-wallet-tokens";
import { bscPublicClient } from "@/services/chain";
import { tokenUsdPricer } from "@/wallet/pool-live-price";

/**
 * A market's live price for the panel's gain and loss (owner, 2026-10-04: "how much is gaining in
 * real time, how much is losing in real time"). Read from the token's own pool on BNB Chain every
 * 2 s while the tab is visible - in the browser, so it works on networks that block Binance and costs
 * no Convex call. "BNBUSDT" reads WBNB, "BTCUSDT" BTCB; a market Dolphin has no verified token for
 * gives null and the panel shows no live figure rather than a guess.
 */

const BASES: Record<string, string> = { BNB: "WBNB", BTC: "BTCB" };

export function tokenForMarket(market: string): Address | null {
  const base = market.toUpperCase().replace(/(USDT|USDC|FDUSD|BUSD|USD1)$/, "");
  const symbol = BASES[base] ?? base;
  return (WALLET_TOKENS.find((token) => token.symbol === symbol)?.address as Address | undefined) ?? null;
}

export function useLivePrice(market: string | null): number | null {
  const [price, setPrice] = useState<{ market: string; value: number } | null>(null);
  useEffect(() => {
    const token = market ? tokenForMarket(market) : null;
    if (!market || !token) return;
    let cancelled = false;
    let timer = 0;
    void (async () => {
      const pricer = await tokenUsdPricer(bscPublicClient, token).catch(() => null);
      if (!pricer || cancelled) return;
      const tick = async () => {
        if (!document.hidden) {
          const value = await pricer.read().catch(() => null);
          if (!cancelled && value !== null && Number.isFinite(value) && value > 0) setPrice({ market, value });
        }
        if (!cancelled) timer = window.setTimeout(tick, 2_000);
      };
      void tick();
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [market]);
  return price && price.market === market ? price.value : null;
}

/** An open position's result at `now`: in dollars from the amount held when known, else from the rule's size. */
export function openResult(position: { side: "long" | "short"; entryPrice: number }, now: number, leverage: number, sizeUsd: number, heldQty: string | null) {
  const sign = position.side === "long" ? 1 : -1;
  const pct = ((now - position.entryPrice) / position.entryPrice) * 100 * sign * leverage;
  const qty = heldQty ? Number(heldQty) : NaN;
  const usd = Number.isFinite(qty) && qty > 0 ? qty * (now - position.entryPrice) * sign : (sizeUsd * pct) / 100;
  return { pct, usd };
}
