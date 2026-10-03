"use client";

/**
 * WHAT HIRING AN AGENT COSTS, ONE NUMBER, EVERYWHERE (owner, 2026-10-02).
 *
 * A search card said "0.05 U" and the hire card beside the button said
 * "0.11 U" for the same agent - which reads as broken. Every surface that
 * shows a hire's price now calls this hook, so a card, the agent page and the
 * hire button can never disagree.
 *
 * The total is what the person pays: the agent's price, plus the network fees
 * on the relayed steps (two when BNB must be swapped for U first, one when the
 * wallet already holds the U), plus the one-time wallet setup on a wallet's
 * first payment - shown in U, the token the agent charges. The swap itself is
 * not added: it only turns the person's BNB into the U being paid.
 *
 * Fees use what the relay actually charges per step (TYPICAL_RELAYED_STEP_GAS),
 * not the 1.5M-gas ceiling the pre-check holds back - that ceiling decides
 * whether the wallet has enough, not what the price is.
 *
 * Every input is read live (U and BNB rates, gas price, the wallet's U and its
 * setup state). Until they are read, `text` is null and callers show their own
 * pending state - never a guessed number.
 */

import { useGasPrice } from "wagmi";

import { priceLabel } from "@/components/agent-shelf";
import { useDolphinUBalance } from "@/components/wallet-withdraw";
import { useBnbPrice } from "@/hooks/use-bnb-price";
import { useTokenUsd } from "@/hooks/use-token-usd";
import type { Agent } from "@/types/agent";
import { useAltanaWallet } from "@/wallet/altana-provider";
import { weiToUsdCents } from "@/wallet/bnb-price";
import { usdCents } from "@/wallet/token-usd";

const BNB_CHAIN_ID = 56;

/*
 * What one relayed step really costs: the relay's fee (BNB sent to its fee
 * collector) divided by the transaction's gas price. Measured on real hires:
 *   swap BNB->U   652,854 (2026-10-01), 632,374 (2026-10-02, job 56880)
 *   escrow pay  1,501,636 (2026-10-02 07:06), 1,571,180 (job 56880)
 * Each sits just above what was billed, so the fee charged lands at or under
 * the figure on screen. The payment step was 2,200,000 until 2026-10-02,
 * which showed the token checker at 0.14 U when the hire really cost 0.114 U
 * (0.03 U + 0.0001102 BNB); every paid agent's total was inflated the same way.
 */
export const TYPICAL_RELAYED_STEP_GAS = BigInt(700_000);
export const TYPICAL_PAYMENT_STEP_GAS = BigInt(1_650_000);

export type HireTotal = {
  /** "0.11 U", "Free", or null while still reading. */
  text: string | null;
  /** The agent's own price, for the details. */
  agentPrice: string | null;
  /** Whether paying needs BNB swapped for U first. */
  converting: boolean;
  /** Network fees for the steps this hire takes, in wei; null until read. */
  feeWei: bigint | null;
  /** One-time wallet setup in wei (0 when not due); null until read. */
  setupWei: bigint | null;
};

export function useHireTotal(agent: Agent): HireTotal {
  const pricing = agent.protocol === "a2a" ? agent.pricing : null;
  const label = priceLabel(agent);
  const paid = Boolean(pricing && !/^0+$/.test(pricing.amountRaw));
  const decimals = pricing?.tokenDecimals || null;

  // Hooks run unconditionally; their inputs are null when there is nothing to price.
  const uRate = useTokenUsd(paid ? pricing!.token : null, paid ? decimals : null);
  const bnb = useBnbPrice();
  const gas = useGasPrice({ chainId: BNB_CHAIN_ID, query: { enabled: paid } });
  const altana = useAltanaWallet();
  const uBalance = useDolphinUBalance();

  if (!paid || !pricing || decimals === null) {
    // A tool server's price IS the total (knowledge, step 4): the caller's own app pays each
    // call with x402, so no Dolphin Wallet relay fees ride along. Null when it publishes none.
    return { text: label, agentPrice: label, converting: false, feeWei: null, setupWei: null };
  }

  let priceRaw: bigint;
  try {
    priceRaw = BigInt(pricing.amountRaw);
  } catch {
    return { text: label, agentPrice: label, converting: false, feeWei: null, setupWei: null };
  }

  const heldU = uBalance.data?.raw ?? null;
  const converting = heldU === null || heldU < priceRaw;
  // The payment itself, plus the swap first when the U has to be bought.
  const feeWei =
    gas.data !== undefined ? (TYPICAL_PAYMENT_STEP_GAS + (converting ? TYPICAL_RELAYED_STEP_GAS : BigInt(0))) * gas.data : null;
  const setupWei =
    altana.recoverability === "unregistered" ? altana.registrationFeeWei ?? null : BigInt(0);

  let text: string | null = null;
  if (uRate.status === "ready" && bnb.status === "ready" && feeWei !== null && setupWei !== null) {
    const centsPerToken = usdCents(BigInt(10) ** BigInt(decimals), decimals, uRate.rate);
    if (centsPerToken > BigInt(0)) {
      const totalCents = usdCents(priceRaw, decimals, uRate.rate) + weiToUsdCents(feeWei + setupWei, bnb.price);
      const tokens = Number(totalCents) / Number(centsPerToken);
      const symbol = pricing.tokenSymbol || "U";
      text = `${tokens < 0.01 ? "<0.01" : tokens.toLocaleString("en", { maximumFractionDigits: 2, minimumFractionDigits: 2 })} ${symbol}`;
    }
  }

  // A rate that cannot be read never becomes ready: show the agent's own
  // price rather than a pending state that never ends.
  if (text === null && (uRate.status === "unavailable" || bnb.status === "unavailable")) text = label;

  return { text, agentPrice: label, converting, feeWei, setupWei };
}
