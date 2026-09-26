import { erc20Abi, formatUnits, getAddress, isAddress, type Address } from "viem";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { parseBalanceIntent } from "./lib/balanceIntent";
import { bscPublicClient } from "./lib/bscClient";
import { resolveTradeToken, verifiedTokens, type TradeToken } from "./lib/tradeTokens";

/**
 * BALANCES IN THE CHAT, READ FROM THE CHAIN. (2026-09-26)
 *
 * "How much BNB do I have?" is answered here, before any model call, from
 * the chain itself - so it works on a day the model's calls are spent. See
 * lib/balanceIntent.ts for what counts as a balance question.
 *
 * Both wallets the person has on this device are read: the connected wallet
 * and the Dolphin Wallet. A number that could not be read is never shown as
 * zero.
 */

/** 18.172882236573356408 -> 18.172882; below 1, four significant digits. */
function formatAmount(raw: bigint, decimals: number): string {
  const text = formatUnits(raw, decimals);
  if (raw === BigInt(0)) return "0";
  if (!text.startsWith("0.")) {
    const [whole, fraction = ""] = text.split(".");
    const kept = fraction.slice(0, 6).replace(/0+$/, "");
    return kept ? `${whole}.${kept}` : whole;
  }
  const fraction = text.slice(2);
  const zeros = fraction.length - fraction.replace(/^0+/, "").length;
  return `0.${fraction.slice(0, zeros + 4).replace(/0+$/, "")}`;
}

async function readBalance(owner: Address, token: TradeToken): Promise<bigint> {
  if (token.address === null) return bscPublicClient.getBalance({ address: owner });
  return bscPublicClient.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
}

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Answers the turn if it asks for a balance, and returns true. False when it
 * is not a balance question, so the chat answers it.
 */
export async function answerBalanceTurn(
  ctx: ActionCtx,
  input: {
    text: string;
    messageId: Id<"dolphinMessages">;
    connectedAddress: string | null;
    dolphinWalletAddress: string | null;
  },
): Promise<boolean> {
  const intent = parseBalanceIntent(input.text);
  if (!intent) return false;

  const say = async (content: string) => {
    await ctx.runMutation(internal.dolphin.setMessageStatus, {
      messageId: input.messageId,
      status: "complete",
      content,
      /* No model wrote this; null also keeps it out of answer reuse, which a live balance must never be. */
      model: null,
    });
  };

  /* Which token: asked for by name (typos read the closest verified one - reading is harmless), or all of them. */
  let tokens: TradeToken[];
  let note = "";
  if (intent.token) {
    const resolved = await resolveTradeToken(intent.token);
    if (resolved.ok) {
      tokens = [resolved.token];
    } else if (resolved.suggestion) {
      const token = verifiedTokens().find((candidate) => candidate.symbol === resolved.suggestion);
      if (!token) return false;
      tokens = [token];
      note = `Reading ${token.symbol} for "${intent.token}". `;
    } else {
      await say(resolved.reason);
      return true;
    }
  } else {
    tokens = verifiedTokens();
  }

  const wallets = [
    { label: "Your wallet", address: input.connectedAddress },
    { label: "Your Dolphin Wallet", address: input.dolphinWalletAddress },
  ]
    .filter((wallet): wallet is { label: string; address: string } => Boolean(wallet.address && isAddress(wallet.address)))
    .map((wallet) => ({ ...wallet, address: getAddress(wallet.address) }))
    .filter((wallet, index, all) => all.findIndex((other) => other.address === wallet.address) === index);

  if (wallets.length === 0) {
    await say(
      "I can't see a wallet on this device yet. Connect your wallet at the top, or set up your Dolphin Wallet on the [Wallet](/wallet) page, then ask again.",
    );
    return true;
  }

  const lines: string[] = [];
  for (const wallet of wallets) {
    const reads = await Promise.allSettled(tokens.map((token) => readBalance(wallet.address, token)));
    const failed = reads.some((read) => read.status === "rejected");
    const held = tokens
      .map((token, index) => ({ token, read: reads[index] }))
      .filter(
        (entry): entry is { token: TradeToken; read: PromiseFulfilledResult<bigint> } =>
          entry.read.status === "fulfilled" && (tokens.length === 1 || entry.read.value > BigInt(0)),
      )
      .map(({ token, read }) => `${formatAmount(read.value, token.decimals)} ${token.symbol}`);

    const heading = `**${wallet.label}** (${short(wallet.address)})`;
    if (held.length > 0) {
      lines.push(`${heading}: ${held.join(", ")}${failed && tokens.length > 1 ? " (some tokens couldn't be read just now)" : ""}`);
    } else if (failed) {
      lines.push(`${heading}: couldn't be read just now. Try again in a moment.`);
    } else {
      lines.push(`${heading}: none of ${tokens.length === 1 ? tokens[0].symbol : "the tokens I track"}.`);
    }
  }

  await say(`${note}${lines.join("\n\n")}`);
  return true;
}
