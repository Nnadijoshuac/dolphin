import { useEffect } from "react";
import { AppState } from "react-native";
import { useAction, useQuery } from "convex/react";
import { useIsFocused } from "expo-router";

import { api } from "../../convex/_generated/api";
import type { AgentCategory } from "@/types/agent";

const REFRESH_INTERVAL_MS = 60_000;

/**
 * The categories that have a wired protocol reader.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS NARROWING EXISTS
 * ---------------------------------------------------------------------------
 * `AgentCategory` is an open string as of the 2026-09-07 rebuild, but live
 * stats are read by hand-written code against a specific contract - Venus's
 * comptroller, PancakeSwap V3's position manager, Aave's pool - so the set that
 * has any is finite and the Convex validator behind these queries is a closed
 * union.
 *
 * That is not an inconsistency, it is two different questions: "what drawer is
 * this agent in" must be open, "which reader do we run" is closed by fact. A
 * category with no reader returns null here, the hooks skip, and the detail
 * page shows no live-metric panel - which is the honest answer rather than a
 * permanently empty one.
 *
 * Mirrors statsCategoryFor in convex/lib/statsCategory.ts, by hand, the same
 * rule AGENTS.md §9 applies to the Convex validators.
 */
type StatsCategory =
  | "monitoring"
  | "rebalancing"
  | "grid-trading"
  | "health-factor"
  | "yield"
  | "trading";

const WIRED_STATS_CATEGORIES: ReadonlySet<string> = new Set<StatsCategory>([
  "monitoring",
  "rebalancing",
  "grid-trading",
  "health-factor",
  "yield",
  "trading",
]);

export function statsCategoryFor(
  category: AgentCategory | null | undefined,
): StatsCategory | null {
  return category && WIRED_STATS_CATEGORIES.has(category)
    ? (category as StatsCategory)
    : null;
}

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
  const statsCategory = statsCategoryFor(category);
  const isEnabled = Boolean(tokenId && statsCategory);
  const cached = useQuery(
    api.categoryStats.getAgentCategoryStats,
    isEnabled && statsCategory
      ? { agentKey: tokenId as string, category: statsCategory }
      : "skip",
  );
  const refresh = useAction(api.categoryStats.refreshAgentCategoryStats);
  const isFocused = useIsFocused();

  /*
   * ---------------------------------------------------------------------------
   * THE INTERVAL RUNS ONLY WHILE THIS SCREEN IS ACTUALLY IN FRONT OF SOMEONE
   * ---------------------------------------------------------------------------
   * It used to be cleared on unmount and nothing else, which sounds correct and
   * is not: Expo Router keeps previous screens MOUNTED as you push forward, so
   * browsing five agents left five of these running. Each tick is a real BSC RPC
   * read performed by a public Convex action, so the app was spending money and
   * battery on five screens nobody was looking at, indefinitely, until those
   * screens were popped.
   *
   * Focus alone is not enough either - a focused screen in a backgrounded app is
   * still nobody looking at it - so AppState gates the tick as well, and a
   * return to the foreground refreshes immediately rather than waiting out the
   * remainder of an interval.
   *
   * The dedupe-by-key ref this replaced is gone on purpose. It existed to stop a
   * redundant read on re-mount, and that is now the server's job: 2.3 added a
   * 60s freshness gate to refreshAgentCategoryStats, so an immediate tick on
   * focus costs one cheap cached response rather than a chain read.
   */
  useEffect(() => {
    if (!tokenId || !statsCategory || !isFocused) {
      return undefined;
    }

    const tick = () => {
      if (AppState.currentState !== "active") return;

      /*
       * The .catch is load-bearing, not decoration.
       *
       * `void` suppresses the floating-promise lint but does NOT handle a
       * rejection, so when the Convex websocket dropped mid-action this threw
       * "Uncaught (in promise) Connection lost while action was in flight" into
       * the user's face - observed 2026-09-06. A refresh that fails says
       * nothing about the agent: the last reading is still on screen, still
       * carrying its own `asOf` timestamp, so the UI already tells the truth
       * about how old it is. Turning a dropped socket into an error banner
       * would be reporting a transport problem as a data problem, which is the
       * same mistake use-job-delivery.ts documents refusing to make.
       */
      void refresh({ agentKey: tokenId, category: statsCategory, agentWallet }).catch(
        () => undefined,
      );
    };

    tick();
    const interval = setInterval(tick, REFRESH_INTERVAL_MS);
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") tick();
    });

    return () => {
      clearInterval(interval);
      appStateSubscription.remove();
    };
  }, [tokenId, statsCategory, agentWallet, refresh, isFocused]);

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
  const statsCategory = statsCategoryFor(category);
  return useQuery(
    api.categoryStats.getAgentStatsHistory,
    tokenId && statsCategory ? { agentKey: tokenId, category: statsCategory } : "skip",
  );
}

/**
 * Dolphin's own retention record for one agent: how many people who hired it
 * were still using it a week later, and a month later.
 *
 * See convex/agentRetention.ts for the definition and for why a percentage is
 * withheld below a minimum denominator. Same Convex-provider precondition as
 * the hooks above.
 */
export function useAgentRetention(tokenId: string | null | undefined) {
  return useQuery(
    api.agentRetention.getAgentRetention,
    tokenId ? { agentKey: tokenId } : "skip",
  );
}
