import { useEffect, useRef } from "react";
import { anyApi, type FunctionReference } from "convex/server";
import { useAction, useQuery } from "convex/react";

import type { AgentCategory, AgentLiveStats } from "@/types/agent";

const REFRESH_INTERVAL_MS = 60_000;

/**
 * References convex/categoryStats.ts functions by string path via `anyApi`
 * instead of the generated `api` object, because this project hasn't run
 * `npx convex dev` yet - see that file's top comment for why. Swap these two
 * lines for `api.categoryStats.getAgentCategoryStats` /
 * `api.categoryStats.refreshAgentCategoryStats` once codegen has run; the
 * cast is only needed until then.
 */
const getAgentCategoryStatsRef = anyApi.categoryStats.getAgentCategoryStats as FunctionReference<
  "query",
  "public",
  { tokenId: string; category: AgentCategory },
  { stats: AgentLiveStats; checkedAt: string; agentWallet: string | null } | null
>;
const refreshAgentCategoryStatsRef = anyApi.categoryStats
  .refreshAgentCategoryStats as FunctionReference<
  "action",
  "public",
  { tokenId: string; category: AgentCategory; agentWallet: string | null },
  AgentLiveStats
>;

/**
 * Backend-aggregated live stats for one agent's category (Venus health
 * factor, PancakeSwap V3 positions, Aave TVL - see convex/protocols/).
 * Returns undefined until the Convex client has data, null if nothing has
 * been cached yet. Requires EXPO_PUBLIC_CONVEX_URL to be configured; callers
 * should treat a missing/undefined result the same as any other "syncing"
 * state rather than erroring.
 */
export function useAgentCategoryStats(
  tokenId: string | null | undefined,
  category: AgentCategory | null | undefined,
  agentWallet: string | null,
) {
  const isEnabled = Boolean(tokenId && category);
  const cached = useQuery(
    getAgentCategoryStatsRef,
    isEnabled ? { tokenId: tokenId as string, category: category as AgentCategory } : "skip",
  );
  const refresh = useAction(refreshAgentCategoryStatsRef);
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
