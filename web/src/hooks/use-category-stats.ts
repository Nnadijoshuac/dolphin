"use client";

import { useEffect, useRef } from "react";
import { useAction, useQuery } from "convex/react";

import {
  categoryStatsApi,
  type AgentCategoryStatsRow,
  type StatsCategory,
} from "@/convex/api";
import type { AgentCategory } from "@/types/agent";

const REFRESH_INTERVAL_MS = 60_000;

const WIRED_STATS_CATEGORIES: ReadonlySet<string> = new Set<StatsCategory>([
  "monitoring",
  "rebalancing",
  "grid-trading",
  "health-factor",
  "yield",
  "trading",
]);

/**
 * The stats category for a catalog category, or null when none is wired.
 *
 * `AgentCategory` is an open string as of 2026-09-07 while live stats are read
 * by hand-written code against a specific contract, so the set that has any is
 * finite. Mirrors statsCategoryFor in convex/lib/statsCategory.ts and the
 * mobile hook of the same name.
 */
export function statsCategoryFor(
  category: AgentCategory | null | undefined,
): StatsCategory | null {
  return category && WIRED_STATS_CATEGORIES.has(category)
    ? (category as StatsCategory)
    : null;
}

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
  agentKey: string | null | undefined,
  category: AgentCategory | null | undefined,
  agentWallet: string | null,
): AgentCategoryStatsRow | null | undefined {
  const statsCategory = statsCategoryFor(category);
  const isEnabled = Boolean(agentKey && statsCategory);
  const cached = useQuery(
    categoryStatsApi.categoryStats.getAgentCategoryStats,
    isEnabled && statsCategory
      ? { agentKey: agentKey as string, category: statsCategory }
      : "skip",
  );
  const refresh = useAction(
    categoryStatsApi.categoryStats.refreshAgentCategoryStats,
  );
  const lastRefreshedKey = useRef<string | null>(null);

  useEffect(() => {
    if (!agentKey || !statsCategory) {
      return undefined;
    }

    const key = `${agentKey}:${statsCategory}:${agentWallet ?? ""}`;
    if (lastRefreshedKey.current !== key) {
      lastRefreshedKey.current = key;
      void refresh({ agentKey, category: statsCategory, agentWallet });
    }

    /*
     * ===================================================================
     * GATED ON TAB VISIBILITY (2026-09-08)
     * ===================================================================
     * This was a bare setInterval. A backgrounded tab left open overnight
     * kept calling `refreshAgentCategoryStats` once a minute until it was
     * closed - 1,440 Convex action invocations, each one on behalf of
     * nobody, for a page no one was looking at. Multiply by every open tab.
     *
     * The action is also PUBLIC and unauthenticated (convex/categoryStats.ts),
     * so this is not only wasted spend - it is the largest caller of an
     * endpoint that anyone holding the deployment URL can also call, and the
     * URL is inlined into this bundle by design. Reducing our own traffic to
     * what a visible tab actually needs is the part of that we control.
     *
     * On becoming visible again it refreshes IMMEDIATELY rather than waiting
     * out the interval, so returning to a tab shows current numbers instead
     * of up-to-a-minute-old ones with a live badge on them.
     */
    let interval: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
    };

    const start = () => {
      if (interval !== null) return;
      interval = setInterval(() => {
        void refresh({ agentKey, category: statsCategory, agentWallet });
      }, REFRESH_INTERVAL_MS);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refresh({ agentKey, category: statsCategory, agentWallet });
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [agentKey, statsCategory, agentWallet, refresh]);

  return cached;
}
