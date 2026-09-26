import {
  encodeFunctionData,
  erc20Abi,
  getAddress,
  isAddress,
  parseUnits,
  type Address,
  type Hex,
} from "viem";

/**
 * Moving money OUT of the Dolphin Wallet, back to the person's own wallet.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS (2026-09-26)
 * ---------------------------------------------------------------------------
 * Money could go into the Dolphin Wallet (a deposit, a BNB->U swap, an escrow
 * refund) and could only leave it to pay an agent. The owner's refund of job
 * 56783 put 0.1 U back there with no way to spend it anywhere else, and the
 * wallet screen did not even show a U balance. Users who deposit during the
 * Set and Earn quest must be able to take their money back.
 *
 * ---------------------------------------------------------------------------
 * THE ONE DESTINATION RULE
 * ---------------------------------------------------------------------------
 * A withdrawal goes to the person's own CONNECTED wallet and nowhere else.
 * There is no free-text address field: a pasted address is how people are
 * phished and how a typo sends money to nobody. The UI passes the connected
 * address; `withdrawRefusal` refuses anything that is not a real, different
 * address.
 *
 * Pure functions only, so every rule here is unit-tested without a passkey.
 */

export type WithdrawAsset =
  | { kind: "native"; symbol: "BNB"; decimals: 18 }
  | { kind: "token"; token: Address; symbol: string; decimals: number };

export type WithdrawCall = { to: Address; value?: bigint; data?: Hex };

const ZERO = BigInt(0);

/**
 * The most BNB that can leave. Every intent pays its own gas in BNB from this
 * same wallet, and a wallet's first action also pays a one-time KeyStore
 * registration, so both stay behind. Never negative.
 */
export function maxNativeWithdrawal(balanceWei: bigint, reserveWei: bigint): bigint {
  return balanceWei > reserveWei ? balanceWei - reserveWei : ZERO;
}

/**
 * A typed amount -> atomic units, or null if it is not a positive amount the
 * token can represent. Commas are not accepted as decimal separators: "1,5"
 * meaning 1.5 or 15 is a guess, and a guess about money is refused.
 */
export function parseWithdrawAmount(input: string, decimals: number): bigint | null {
  const trimmed = input.trim();
  if (!/^\d*\.?\d+$|^\d+\.$/.test(trimmed)) return null;
  const fraction = trimmed.split(".")[1] ?? "";
  if (fraction.length > decimals) return null;
  try {
    const value = parseUnits(trimmed.replace(/\.$/, ""), decimals);
    return value > ZERO ? value : null;
  } catch {
    return null;
  }
}

/** Why this withdrawal cannot go ahead, as a sentence; null when it can. */
export function withdrawRefusal({
  amountRaw,
  available,
  from,
  to,
  symbol,
}: {
  amountRaw: bigint | null;
  available: bigint | null;
  from: string | null;
  to: string | null;
  symbol: string;
}): string | null {
  if (!to || !isAddress(to)) return "Connect your wallet first. Withdrawals only go to your own connected wallet.";
  if (from && getAddress(to) === getAddress(from)) return "That is the Dolphin Wallet itself. Connect your own wallet to withdraw to it.";
  if (amountRaw === null) return "Enter an amount.";
  if (available === null) return `Your ${symbol} balance could not be read. Refresh and try again.`;
  if (amountRaw > available) return `That is more ${symbol} than the Dolphin Wallet can send.`;
  return null;
}

/** The single call that moves the money. */
export function buildWithdrawCall(asset: WithdrawAsset, to: Address, amountRaw: bigint): WithdrawCall {
  const recipient = getAddress(to);
  if (asset.kind === "native") return { to: recipient, value: amountRaw };
  return {
    to: getAddress(asset.token),
    data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, amountRaw] }),
  };
}
