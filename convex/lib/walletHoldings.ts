/**
 * What a wallet holds of BNB and Dolphin's verified tokens, read live, with
 * dollar values where a price can be read (a stablecoin counts as $1). Shared
 * by the Wallet block's panel (agentWallet.balances) and the Brain's
 * block_wallet_holdings tool, so both say the same thing.
 */

import { erc20Abi, formatUnits, getAddress, type Address } from "viem";

import { bscPairFor } from "./agentBlocks";
import { bscPublicClient } from "./bscClient";
import { WBNB_BSC } from "./pancakeswapTrade";
import { verifiedTokens } from "./tradeTokens";

const STABLE_SYMBOLS = new Set(["USDT", "USDC", "U"]);

export type Holding = { symbol: string; address: string | null; decimals: number; amount: string; usd: number | null };

export async function readHoldings(address: Address): Promise<Holding[]> {
  const tokens = verifiedTokens();
  const rows = await Promise.all(
    tokens.map(async (token) => {
      const raw = token.address
        ? await bscPublicClient
            .readContract({ address: getAddress(token.address) as Address, abi: erc20Abi, functionName: "balanceOf", args: [address] })
            .catch(() => null)
        : await bscPublicClient.getBalance({ address }).catch(() => null);
      return { token, raw };
    }),
  );
  const held = rows.filter((row) => row.raw !== null && row.raw > BigInt(0));
  return Promise.all(
    held.map(async ({ token, raw }) => {
      const amount = formatUnits(raw as bigint, token.decimals);
      const price = STABLE_SYMBOLS.has(token.symbol)
        ? 1
        : ((await bscPairFor(token.address ?? WBNB_BSC).catch(() => null))?.priceUsd ?? null);
      return { symbol: token.symbol, address: token.address, decimals: token.decimals, amount, usd: price === null ? null : Number(amount) * price };
    }),
  );
}

