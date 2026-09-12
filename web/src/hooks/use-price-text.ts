"use client";

import { useTokenUsd } from "@/hooks/use-token-usd";
import { formatUsd } from "@/wallet/token-usd";
import { formatTokenAmount } from "@/wallet/erc8183-policy";

/**
 * What a hire costs, as a person would say it.
 *
 * ===========================================================================
 * DOLLARS FIRST, TOKEN AS THE FALLBACK — NOT AS A SUFFIX.
 * ===========================================================================
 * "1200000000000000000 U" is not a price. Neither is "1.2 U", to anyone who
 * has not looked up what $U is worth. "$1.20" is a price: it is the only form
 * of this number a person can weigh against anything else they might buy.
 *
 * So when a rate is readable the dollar figure is shown ALONE. Not "$1.20
 * (1.2 U)" — that is the same number twice, and the token half is noise to
 * everyone except the handful of people who will check it on BscScan anyway.
 *
 * When a rate is NOT readable the token amount is shown, unchanged, exactly as
 * before. That is the whole fallback: no estimate, no "approximately", no
 * last-known price. A number Dolphin could not read does not get printed
 * (AGENTS.md §5).
 *
 * ===========================================================================
 * WHERE THE TOKEN AMOUNT STILL BELONGS
 * ===========================================================================
 * Two places, and they are both about ACTING on the token rather than judging
 * the price: funding instructions ("swap for $U and send it here") and
 * insufficient-balance errors. A person topping up a wallet needs the symbol
 * and the amount, because that is what they will type into a swap. Those call
 * sites keep `formatTokenAmount` and should not be converted.
 * ===========================================================================
 */

export type PriceText =
  /** A dollar figure, ready to render alone. */
  | { status: "usd"; text: string }
  /** No rate; the token amount, exactly as it was shown before. */
  | { status: "token"; text: string }
  /** Still reading. Callers should show their existing pending state. */
  | { status: "loading" }
  /** Decimals unknown, so neither form is safe to print. */
  | { status: "unknown" };

export function usePriceText(input: {
  amountRaw: string | bigint | null | undefined;
  token: string | null | undefined;
  decimals: number | null | undefined;
  symbol: string | null | undefined;
}): PriceText {
  const usd = useTokenUsd(input.token, input.decimals);

  /*
   * `decimals: 0` and `symbol: ""` are how convex/lib/probe.ts records "not
   * read yet" — it refuses to store a guess for either, because a fabricated
   * number on a PRICE is where §5 bites hardest. So falsy means MISSING here,
   * not a real zero-decimals token, and without decimals no amount can be
   * rendered in any denomination at all.
   */
  const decimals = input.decimals || null;
  if (input.amountRaw === null || input.amountRaw === undefined || decimals === null) {
    return { status: "unknown" };
  }

  let raw: bigint;
  try {
    raw = BigInt(input.amountRaw);
  } catch {
    return { status: "unknown" };
  }

  if (usd.status === "ready") {
    return { status: "usd", text: formatUsd(raw, decimals, usd.rate) };
  }
  if (usd.status === "loading") return { status: "loading" };

  const symbol = input.symbol?.trim();
  return {
    status: "token",
    text: symbol
      ? `${formatTokenAmount(raw, decimals)} ${symbol}`
      : formatTokenAmount(raw, decimals),
  };
}

/**
 * The same thing collapsed to one string, for the many call sites that have a
 * pending/unavailable string of their own already.
 */
export function priceTextOr(price: PriceText, fallback: string): string {
  return price.status === "usd" || price.status === "token" ? price.text : fallback;
}
