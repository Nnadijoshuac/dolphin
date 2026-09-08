import { useEffect, useState } from "react";
import { isAddress } from "viem";

import { bscPublicClient } from "@/services/chain";

const ERC20_METADATA_ABI = [
  {
    name: "symbol",
    type: "function",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
  {
    name: "decimals",
    type: "function",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
] as const;

export interface TokenMetadata {
  symbol: string;
  decimals: number;
}

/** Session cache populated exclusively by live on-chain reads from the ERC-20 contract */
const tokenCache = new Map<string, TokenMetadata>();

export function useTokenMetadata(tokenAddress: string | null | undefined): TokenMetadata | null {
  const normalized = tokenAddress && isAddress(tokenAddress) ? tokenAddress.toLowerCase() : null;
  const cached = normalized && tokenCache.has(normalized) ? tokenCache.get(normalized)! : null;
  const [metadata, setMetadata] = useState<TokenMetadata | null>(cached);

  useEffect(() => {
    if (!normalized || tokenCache.has(normalized)) return;

    let active = true;
    Promise.all([
      bscPublicClient.readContract({
        address: normalized as `0x${string}`,
        abi: ERC20_METADATA_ABI,
        functionName: "symbol",
      }),
      bscPublicClient.readContract({
        address: normalized as `0x${string}`,
        abi: ERC20_METADATA_ABI,
        functionName: "decimals",
      }),
    ])
      .then(([symbol, decimals]) => {
        const result = { symbol: String(symbol), decimals: Number(decimals) };
        tokenCache.set(normalized, result);
        if (active) setMetadata(result);
      })
      .catch(() => {
        // Leave null if unreadable
      });

    return () => {
      active = false;
    };
  }, [normalized]);

  return metadata;
}
