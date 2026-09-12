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

/**
 * THREE STATES, NOT ONE NULL.
 *
 * ---------------------------------------------------------------------------
 * WHY (2026-09-12)
 * ---------------------------------------------------------------------------
 * This hook returned `TokenMetadata | null` and swallowed read failures with a
 * bare `.catch(() => {})`. So "no token to read", "still reading" and "the read
 * failed" were the same value, and no caller could tell them apart.
 *
 * That is not theoretical. convex/lib/probe.ts deliberately stores
 * `tokenSymbol: ""` and `tokenDecimals: 0` for a priced agent - storing a guess
 * for either would be a fabricated number on a price, which is the one place
 * AGENTS.md §5 matters most - so for every paid agent in the catalog the price
 * a user sees comes ENTIRELY from this live read. When it failed, the hire
 * panel sat on "Syncing price…" forever while its Hire button stayed enabled:
 * a payment the user could start without ever being shown the amount.
 *
 * `unavailable` carries a reason for the same purpose LiveMetric's does - so
 * the screen can say what is missing instead of implying the read is still in
 * flight.
 */
export type TokenMetadataState =
  /** No address to read - not a failure, and not something to spin on. */
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; metadata: TokenMetadata }
  | { status: "unavailable"; reason: string };

/** Session cache populated exclusively by live on-chain reads from the ERC-20 contract */
const tokenCache = new Map<string, TokenMetadata>();

function initialState(normalized: string | null): TokenMetadataState {
  if (!normalized) return { status: "idle" };
  const cached = tokenCache.get(normalized);
  return cached ? { status: "ready", metadata: cached } : { status: "loading" };
}

export function useTokenMetadata(tokenAddress: string | null | undefined): TokenMetadataState {
  const normalized = tokenAddress && isAddress(tokenAddress) ? tokenAddress.toLowerCase() : null;
  const [state, setState] = useState<TokenMetadataState>(() => initialState(normalized));
  const [readFor, setReadFor] = useState<string | null>(normalized);

  /*
   * Resynced on every address change rather than only at mount, using React's
   * documented "adjusting state when a prop changes" pattern - a setState
   * during render, which re-renders this component alone before anything is
   * committed, rather than an effect that would paint the wrong token first.
   *
   * The previous version seeded state from the cache in `useState` - which runs
   * once - and then returned early from its effect whenever the cache already
   * held the address. Pointing the hook at a DIFFERENT token that was already
   * cached therefore kept rendering the previous token's symbol and decimals.
   * One agent per page hid it; it is still the wrong token's price.
   */
  if (readFor !== normalized) {
    setReadFor(normalized);
    setState(initialState(normalized));
  }

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
        const metadata = { symbol: String(symbol), decimals: Number(decimals) };
        tokenCache.set(normalized, metadata);
        if (active) setState({ status: "ready", metadata });
      })
      .catch(() => {
        // Deliberately not cached: a failed read is a statement about this
        // moment's RPC, not about the token, and caching it would make one
        // blip permanent for the rest of the session.
        if (active) {
          setState({
            status: "unavailable",
            reason:
              "Dolphin could not read this token's symbol and decimals from BNB Chain, so it " +
              "cannot state the price.",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [normalized]);

  return state;
}
