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

/** Pre-seeded verified BSC tokens for instant synchronous rendering */
const tokenCache = new Map<string, TokenMetadata>([
  ["0xce24439f2d9c6a2289f741120fe202248b666666", { symbol: "$U", decimals: 18 }],
  ["0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", { symbol: "WBNB", decimals: 18 }],
  ["0x55d398326f99059ff775485246999027b3197955", { symbol: "USDT", decimals: 18 }],
  ["0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", { symbol: "USDC", decimals: 18 }],
]);

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
