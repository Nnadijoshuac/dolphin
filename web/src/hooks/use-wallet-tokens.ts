"use client";

import { useQuery } from "@tanstack/react-query";
import { createPublicClient, erc20Abi, http, type Address } from "viem";
import { bsc } from "viem/chains";

import { BSC_RPC_URL } from "@/constants/agents";

/**
 * EVERY TOKEN A WALLET HOLDS, for the phone wallet's Tokens tab (owner,
 * 2026-10-02: "you see how much BNB I have, how much U, and in case any of the
 * wallets holds any other kind of currency it's going to be there").
 *
 * "Any other kind" is bounded by Dolphin's verified token list. A wallet is
 * airdropped spam (one landed in the owner's), and listing an unverified token
 * reads as if the person bought it - the same rule Wallet history follows.
 *
 * The list MIRRORS convex/lib/tradeTokens.ts (VERIFIED), whose addresses were
 * each checked against official sources and called on-chain; web/ cannot import
 * convex/ (npm run check:isolation). Symbols and decimals are the ones that
 * file records from symbol()/decimals().
 */
export type WalletToken = Readonly<{ address: Address | null; symbol: string; decimals: number }>;

export const WALLET_TOKENS: readonly WalletToken[] = [
  { address: null, symbol: "BNB", decimals: 18 },
  { address: "0xcE24439F2D9C6a2289F741120FE202248B666666", symbol: "U", decimals: 18 },
  { address: "0x55d398326f99059fF775485246999027B3197955", symbol: "USDT", decimals: 18 },
  { address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", symbol: "USDC", decimals: 18 },
  { address: "0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409", symbol: "FDUSD", decimals: 18 },
  { address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", symbol: "WBNB", decimals: 18 },
  { address: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", symbol: "BTCB", decimals: 18 },
  { address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", symbol: "ETH", decimals: 18 },
  { address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", symbol: "CAKE", decimals: 18 },
  { address: "0xcF6BB5389c92Bdda8a3747Ddb454cB7a64626C63", symbol: "XVS", decimals: 18 },
];

const client = createPublicClient({ chain: bsc, transport: http(BSC_RPC_URL) });

/** symbol -> raw balance, for one wallet. A token that failed to read is absent. */
export type TokenBalances = ReadonlyMap<string, bigint>;

async function readWallet(owner: Address): Promise<TokenBalances> {
  const erc20 = WALLET_TOKENS.filter((token) => token.address !== null);
  const [native, results] = await Promise.all([
    client.getBalance({ address: owner }),
    client.multicall({
      allowFailure: true,
      contracts: erc20.map((token) => ({
        address: token.address as Address,
        abi: erc20Abi,
        functionName: "balanceOf" as const,
        args: [owner] as const,
      })),
    }),
  ]);
  const balances = new Map<string, bigint>([["BNB", native]]);
  erc20.forEach((token, index) => {
    const result = results[index];
    if (result?.status === "success") balances.set(token.symbol, result.result as bigint);
  });
  return balances;
}

/**
 * Balances for each address given, keyed by lowercased address. One multicall
 * per wallet; re-read every minute like the other wallet balances.
 */
export function useWalletTokens(addresses: readonly string[]) {
  const key = addresses.map((a) => a.toLowerCase()).sort();
  return useQuery({
    queryKey: ["wallet-tokens", ...key],
    enabled: key.length > 0,
    staleTime: 15_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const entries = await Promise.all(key.map(async (a) => [a, await readWallet(a as Address)] as const));
      return new Map<string, TokenBalances>(entries);
    },
  });
}
