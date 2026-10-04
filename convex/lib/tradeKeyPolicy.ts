/**
 * WHAT A TRADE KEY MAY DO - the whole policy, as one pure function, so it can
 * be tested for the attacks the mentor review named (2026-09-29) without a
 * chain or a database. convex/autotrade.ts grants exactly what this returns.
 *
 * Altana's wallet enforces a call's target and function, never its
 * arguments. So the policy is shaped by what that can and cannot hold:
 *   - calls: three swap functions on PancakeSwap's V2 router. No approve()
 *     (an approval to an attacker outlives the key), no V3 multicall (any
 *     inner call could ride in it).
 *   - allowances: set by the OWNER's passkey at grant time, to the V2 router
 *     only, capped at the daily limit x the key's days.
 *   - spend: a daily cap on BNB and on every allowed token.
 * The recipient of a swap is still an argument; see contracts/DolphinSwapGuard.sol.
 */

import { getAddress, parseUnits } from "viem";

import { PANCAKE_V2_ROUTER, WBNB_BSC } from "./pancakeswapTrade";
import type { TradeToken } from "./tradeTokens";

export const SESSION_SWAP_SIGNATURES = [
  "swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)",
  "swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256)",
  "swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)",
] as const;

/** Each cap is the daily limit x this, so a position bought at one price can still be sold after a move. */
export const SELL_HEADROOM = 1.25;
/** Native BNB also pays each swap's gas (measured ~0.00002-0.00003 BNB a swap): 0.001 BNB covers dozens. */
export const GAS_HEADROOM_WEI = BigInt(1_000_000_000_000_000);

export type TradeKeyPolicy = {
  calls: { to: string; signature?: string }[];
  spend: { limit: string; period: "day"; token?: string }[];
  approvals: { token: string; spender: string; amount: string; symbol: string }[];
};

/**
 * `priceOf` returns a token's USD price, or null when it cannot be read - and
 * a token with no price is left out entirely rather than left uncapped.
 */
export function tradeKeyPolicy({
  dailyUsd,
  durationDays,
  bnbPriceUsd,
  tokens,
  priceOf,
}: {
  dailyUsd: number;
  durationDays: number;
  bnbPriceUsd: number;
  tokens: readonly TradeToken[];
  priceOf: (token: TradeToken) => number | null;
}): TradeKeyPolicy {
  if (!(dailyUsd > 0) || !(durationDays > 0) || !(bnbPriceUsd > 0)) throw new Error("A trade key needs a positive daily limit, duration and BNB price.");
  const calls = SESSION_SWAP_SIGNATURES.map((signature) => ({ to: PANCAKE_V2_ROUTER as string, signature }));
  /*
   * ROOM TO SELL WHAT IT BOUGHT (measured on prod, 2026-10-04: BNB Pulse could not sell). The caps were
   * the daily dollars at the GRANT's prices, exactly. The rule bought $4 of BNB (0.005065) under a
   * 0.005077 BNB cap; selling it spends that BNB plus the swap's gas (~0.00003 BNB), over the cap, so
   * the wallet refused every sale and the relay left each one PENDING. A price move after the grant
   * does the same to any token. So each cap carries SELL_HEADROOM for price moves, and native BNB a
   * fixed GAS_HEADROOM_BNB on top.
   */
  const usd = dailyUsd * SELL_HEADROOM;
  const spend: TradeKeyPolicy["spend"] = [{ limit: (parseUnits((usd / bnbPriceUsd).toFixed(18), 18) + GAS_HEADROOM_WEI).toString(), period: "day" }];
  const approvals: TradeKeyPolicy["approvals"] = [];
  for (const token of tokens) {
    if (!token.address) continue;
    const address = getAddress(token.address);
    const priceUsd = address === WBNB_BSC ? bnbPriceUsd : priceOf(token);
    if (!priceUsd || !(priceUsd > 0)) continue;
    const decimals = Math.min(token.decimals, 18);
    spend.push({ limit: parseUnits((usd / priceUsd).toFixed(decimals), token.decimals).toString(), period: "day", token: address });
    approvals.push({
      token: address,
      spender: PANCAKE_V2_ROUTER,
      amount: parseUnits(((usd * durationDays) / priceUsd).toFixed(decimals), token.decimals).toString(),
      symbol: token.symbol,
    });
  }
  return { calls, spend, approvals };
}
