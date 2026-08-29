"use client";

import { useQuery } from "convex/react";

import { agentHiresApi } from "@/convex/api";

/**
 * Active backend hire records for one wallet. This mirrors the mobile hook and
 * deliberately reports only what Convex stores: a read-only subscription, not
 * an onchain execution session.
 *
 * Only call this below a configured Convex provider.
 */
export function useHiredAgents(walletAddress: string | null | undefined) {
  return useQuery(
    agentHiresApi.agentHires.getHiredAgentsForWallet,
    walletAddress ? { walletAddress } : "skip",
  );
}
