"use client";

import { useMemo } from "react";

import { usePaymentRates } from "@/hooks/use-payment-rates";
import { WALLET_TOKENS, useWalletTokens } from "@/hooks/use-wallet-tokens";
import { formatBnb } from "@/wallet/altana-policy";
import { formatUsdCents } from "@/wallet/bnb-price";
import { WBNB_BSC, type UsdRate } from "@/wallet/token-usd";

/**
 * EVERY ASSET IN THE WALLETS IN VIEW, AND WHAT IT ALL IS WORTH - shared by the phone wallet
 * (components/mobile-wallet.tsx) and the desktop one (altana-wallet-panel.tsx).
 *
 * Moved here from the phone screen (owner, 2026-10-03: four USDT sent to the Dolphin Wallet showed
 * on the phone, $5.15 in total, while the desktop total counted BNB alone and said about $1 and
 * listed no USDT). One computation, so the two screens cannot disagree again.
 *
 * The headline is printed only when every held token has a read rate: a sum missing a token is a
 * wrong total, not a small one (AGENTS.md §5).
 */

export const HIDDEN = "••••";

export type Holding = { token: (typeof WALLET_TOKENS)[number]; raw: bigint; read: boolean };
export type Headline = { figure: string; unit: string | null } | "reading" | "unavailable";

/** The USD rate for a token, keyed the way usePaymentRates keys it. BNB reads the BNB feed via WBNB. */
export function rateKey(address: string | null) {
  return (address ?? WBNB_BSC).toLowerCase();
}

export function useWalletHoldings(addresses: readonly string[], currency: "USD" | "BNB", hidden: boolean) {
  const tokens = useWalletTokens(addresses as string[]);
  const rates = usePaymentRates(useMemo(() => WALLET_TOKENS.map((t) => ({ token: t.address ?? WBNB_BSC, decimals: t.decimals })), []));

  /* Per token, summed over the wallets in view. */
  const holdings = useMemo((): Holding[] | null => {
    if (!tokens.data) return null;
    return WALLET_TOKENS.map((token) => {
      let raw = BigInt(0);
      let read = true;
      for (const address of addresses) {
        const balance = tokens.data.get(address.toLowerCase())?.get(token.symbol);
        if (balance === undefined) read = false;
        else raw += balance;
      }
      return { token, raw, read };
    });
  }, [tokens.data, addresses]);

  const headline = useMemo((): Headline => {
    if (!holdings) return tokens.isError ? "unavailable" : "reading";
    if (holdings.some((h) => !h.read)) return "unavailable";
    if (hidden) return { figure: HIDDEN, unit: null };
    const SCALE = BigInt(10) ** BigInt(18);
    const bnbRate = rates.get(rateKey(null));
    // Native BNB counts as itself in BNB; only the OTHER assets need a rate.
    let bnbWei = BigInt(0);
    let otherUsd18 = BigInt(0); // USD with 18 decimals, so nothing rounds to cents early
    for (const h of holdings) {
      if (h.raw === BigInt(0)) continue;
      if (h.token.address === null) {
        bnbWei += h.raw;
        continue;
      }
      const rate = rates.get(rateKey(h.token.address));
      if (!rate) return "reading";
      otherUsd18 += (h.raw * rate.num * SCALE) / (rate.den * BigInt(10) ** BigInt(h.token.decimals));
    }
    if (currency === "USD") {
      if (!bnbRate) return bnbWei === BigInt(0) ? { figure: formatUsdCents(otherUsd18 / BigInt(10) ** BigInt(16)), unit: null } : "reading";
      const bnbUsd18 = (bnbWei * bnbRate.num) / bnbRate.den;
      return { figure: formatUsdCents((bnbUsd18 + otherUsd18) / BigInt(10) ** BigInt(16)), unit: null };
    }
    if (otherUsd18 === BigInt(0)) return { figure: formatBnb(bnbWei), unit: "BNB" };
    if (!bnbRate) return "reading";
    // The other assets expressed in BNB at the same BNB rate the USD side uses.
    return { figure: formatBnb(bnbWei + (otherUsd18 * bnbRate.den) / bnbRate.num), unit: "BNB" };
  }, [holdings, rates, currency, hidden, tokens.isError]);

  return { holdings, rates, headline, isError: tokens.isError };
}

export type Rates = ReadonlyMap<string, UsdRate>;
