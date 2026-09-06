import { useEffect, useRef } from "react";
import { useAction, useQuery } from "convex/react";

import { api } from "../../convex/_generated/api";
import type { AgentCategory } from "@/types/agent";

const REFRESH_INTERVAL_MS = 60_000;

/**
 * Backend-aggregated live stats for one agent's category (Venus health
 * factor, PancakeSwap V3 positions, Aave TVL - see convex/protocols/).
 * Returns undefined until the Convex client has data, null if nothing has
 * been cached yet. Treat a missing/undefined result the same as any other
 * "syncing" state rather than erroring.
 *
 * Precondition: only call this from a subtree actually mounted under a
 * configured ConvexClientProvider (see src/providers/convex-provider.tsx).
 * When EXPO_PUBLIC_CONVEX_URL is unset, ConvexClientProvider renders no
 * provider at all - convex/react's hooks throw without one - so a caller
 * must check `convexClient !== null` before rendering any component that
 * uses this hook, the same way WalletConnectButton checks
 * `wallet.isAvailable` before enabling itself.
 */
export function useAgentCategoryStats(
  tokenId: string | null | undefined,
  category: AgentCategory | null | undefined,
  agentWallet: string | null,
) {
  const isEnabled = Boolean(tokenId && category);
  const cached = useQuery(
    api.categoryStats.getAgentCategoryStats,
    isEnabled ? { tokenId: tokenId as string, category: category as AgentCategory } : "skip",
  );
  const refresh = useAction(api.categoryStats.refreshAgentCategoryStats);
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

/**
 * The agent's charted track record: every real on-chain reading Dolphin has
 * kept for this agent-category, oldest first, with the name of the metric being
 * charted.
 *
 * The points are written by convex/categoryStats.ts as a by-product of the
 * refresh above - each one is a protocol read that actually happened, at the
 * timestamp it happened, carrying its own source label. Nothing is
 * interpolated or seeded, so an agent that has been observed once has one
 * point and no chart, which is the honest state rather than a flat line.
 *
 * Same precondition as useAgentCategoryStats: only call this under a
 * configured ConvexClientProvider.
 */
export function useAgentStatsHistory(
  tokenId: string | null | undefined,
  category: AgentCategory | null | undefined,
) {
  return useQuery(
    api.categoryStats.getAgentStatsHistory,
    tokenId && category
      ? { tokenId, category }
      : "skip",
  );
}
