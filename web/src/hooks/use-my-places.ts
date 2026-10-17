"use client";

import { useQuery } from "convex/react";

import { myAgentsApi, tradersApi } from "@/convex/api";
import { useHiredAgents } from "@/hooks/use-hired-agents";
import { useWallet } from "@/wallet/wallet-provider";
import { useWalletSession } from "@/wallet/wallet-session";

/**
 * How many of each personal thing the connected wallet has: agents it hired,
 * agents it built, traders it started. The header shows a dropdown under a nav
 * item only when its count is above zero (owner, 2026-10-17: "it doesn't drop
 * down until there's something").
 *
 * The same three subscriptions My agents and /trade already open, so on those
 * pages Convex shares them and this costs nothing extra. Nothing is read
 * without a connected wallet; built agents and traders also need the signed
 * session, as they do on their own pages.
 */
export function useMyPlaces(): { hired: number; built: number; traders: number } {
  const wallet = useWallet();
  const session = useWalletSession();
  const address = wallet.isConnected ? wallet.address : null;
  const sessionArgs = address && session.sessionToken ? { sessionToken: session.sessionToken } : "skip";

  const hires = useHiredAgents(address);
  const built = useQuery(myAgentsApi.myAgents.built, sessionArgs);
  const traders = useQuery(tradersApi.traders.mine, sessionArgs);

  return {
    hired: hires?.length ?? 0,
    built: built?.length ?? 0,
    traders: traders?.length ?? 0,
  };
}
