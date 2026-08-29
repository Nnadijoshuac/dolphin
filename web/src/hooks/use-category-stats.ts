"use client";

import { useEffect, useRef } from "react";
import { useAction, useQuery } from "convex/react";

import { categoryStatsApi, type AgentCategoryStatsRow } from "@/convex/api";
import { convexClient } from "@/providers/convex-provider";
import type { AgentCategory } from "@/types/agent";

const REFRESH_INTERVAL_MS = 60_000;

/**
 * Backend-aggregated live stats for one agent's category - the real Venus /
 * PancakeSwap V3 / Aave reads in convex/protocols/, cached in agentLiveStats
 * and refreshed on view.
 *
 * Mirrors src/hooks/use-category-stats.ts in the mobile app exactly, including
 * its refresh cadence, so an agent opened on the website and the same agent
 * opened in the app read the same row and show the same numbers. Without this
 * the site's Live signals were permanently "Unavailable" while the app showed
 * real on-chain values for the same agent - the exact divergence the Convex
 * centralization exists to prevent.
 *
 * Precondition, same as the mobile hook: only call this from a subtree mounted
 * under a configured ConvexClientProvider. When NEXT_PUBLIC_CONVEX_URL is
 * unset that provider renders nothing, and convex/react's hooks throw without
 * one - so callers must check `convexClient !== null` first. `convexClient` is
 * a module constant, so branching on it never changes hook order.
 */
export function useAgentCategoryStats(
  tokenId: string | null | undefined,
  category: AgentCategory | null | undefined,
  agentWallet: string | null,
): AgentCategoryStatsRow | null | undefined {
  const isEnabled = Boolean(tokenId && category);
  const cached = useQuery(
    categoryStatsApi.categoryStats.getAgentCategoryStats,
    isEnabled
      ? { tokenId: tokenId as string, category: category as AgentCategory }
      : "skip",
  );
  const refresh = useAction(
    categoryStatsApi.categoryStats.refreshAgentCategoryStats,
  );
  const lastRefreshedKey = useRef<string | null>(null);

  useEffect(() => {
    if (!tokenId || !category) {
      return undefined;
    }

    const key = `${tokenId}:${category}:${agentWallet ?? ""}`;
    if (lastRefreshedKey.current !== key) {
      lastRefreshedKey.current = key;
      void refresh({ tokenId, category, agentWallet });
    }

    const interval = setInterval(() => {
      void refresh({ tokenId, category, agentWallet });
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [tokenId, category, agentWallet, refresh]);

  return cached;
}
