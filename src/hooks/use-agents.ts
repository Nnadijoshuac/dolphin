import { useMemo } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";

import { api } from "../../convex/_generated/api";
import { convexClient } from "@/providers/convex-provider";
import type { Agent } from "@/types/agent";

/**
 * THE CATALOG, PAGE BY PAGE.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS STOPPED BEING ONE QUERY
 * ---------------------------------------------------------------------------
 * `useAgents()` used to call `listAgents` with no arguments, receive the ENTIRE
 * catalog, and hand it to screens that filtered by category and searched over it
 * in JavaScript. Every screen loaded every agent before it could draw one row.
 *
 * That is fine at 30 agents and impossible at 3,000, and the ceiling is not
 * about the device: a Convex query has a ONE SECOND execution limit, and the old
 * backend query performed one file-storage lookup per agent inside it. The same
 * shape had already taken the site down once, on 2026-09-02, by crossing
 * Convex's read-per-execution limit - `listAgents` threw for every caller and
 * both frontends rendered an empty catalog against a healthy deployment.
 *
 * So the list is a cursor-paginated Convex query, the category filter is an
 * index range, and search happens server-side against a search index.
 *
 * ---------------------------------------------------------------------------
 * TANSTACK QUERY IS NO LONGER IN THIS PATH, DELIBERATELY
 * ---------------------------------------------------------------------------
 * It still owns everything else (chain reads, quotes, job polling - see
 * src/providers/query-provider.tsx). But `usePaginatedQuery` is a Convex
 * subscription: it is already live, already cached, already invalidated by the
 * server when a row changes. Wrapping a subscription in a polling cache would
 * give the screen two sources of truth for the same rows and a staleTime that
 * fights the subscription.
 *
 * This is also why the backend takes such care not to write to `agents` unless
 * something a person would see changed: every write here is a re-render on every
 * subscribed device.
 */

/** How many agents a page holds. One screen of rows plus a little runway. */
const PAGE_SIZE = 24;

/**
 * How an agent is used. Named in user language at the UI layer ("Hire" /
 * "View"); the wire value is the protocol, because that is what the index is
 * keyed on and what the record actually stores.
 */
export type AgentProtocol = "a2a" | "mcp";

export interface UseAgentListOptions {
  /** An open category slug. Undefined browses everything. */
  category?: string;
  /** Undefined shows both kinds. */
  protocol?: AgentProtocol;
  /** When set, searches server-side instead of browsing. */
  search?: string;
  enabled?: boolean;
}

export interface AgentListResult {
  agents: Agent[];
  /** "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted" */
  status: ReturnType<typeof usePaginatedQuery>["status"];
  isLoading: boolean;
  loadMore: () => void;
  /** True once the backend has answered and returned nothing. */
  isEmpty: boolean;
}

/**
 * One paginated list, browsing or searching.
 *
 * The two are one hook because a screen switches between them as the user types
 * and having two hooks would mean mounting and unmounting subscriptions on every
 * keystroke.
 */
export function useAgentList(options: UseAgentListOptions = {}): AgentListResult {
  const search = options.search?.trim() ?? "";
  const isSearching = search.length > 0;
  const enabled = options.enabled !== false && convexClient !== null;

  const browse = usePaginatedQuery(
    api.agents.list,
    enabled && !isSearching
      ? { category: options.category, protocol: options.protocol }
      : "skip",
    { initialNumItems: PAGE_SIZE },
  );

  const found = usePaginatedQuery(
    api.agents.search,
    enabled && isSearching
      ? { text: search, category: options.category, protocol: options.protocol }
      : "skip",
    { initialNumItems: PAGE_SIZE },
  );

  const active = isSearching ? found : browse;

  return {
    agents: (active.results ?? []) as unknown as Agent[],
    status: active.status,
    isLoading: active.status === "LoadingFirstPage",
    loadMore: () => active.loadMore(PAGE_SIZE),
    isEmpty: active.status !== "LoadingFirstPage" && (active.results?.length ?? 0) === 0,
  };
}

/**
 * The category chips, from the catalog rather than from a hardcoded list.
 *
 * `categorySlug` is an open string on the backend, so the set of categories that
 * exists is a property of the data. A category with no agents in it does not
 * appear - a chip that leads to an empty list is a dead end, and the previous
 * hardcoded five produced exactly that for `trading` for two days.
 */
export interface CategoryFacet {
  slug: string;
  label: string;
  count: number;
}

export function useCategoryFacets(): {
  categories: CategoryFacet[];
  totalLive: number;
  isLoading: boolean;
} {
  const data = useQuery(api.facets.list, convexClient ? {} : "skip");
  return {
    categories: data?.categories ?? [],
    totalLive: data?.totalLive ?? 0,
    isLoading: data === undefined,
  };
}

/**
 * One agent, by agentKey or by bare tokenId.
 *
 * Accepts a bare tokenId because every deep link and route param that exists
 * today is one; the backend resolves it against the primary registry.
 *
 * NOT gated on status, matching the backend: someone holding a link, or a hire
 * they already paid for, must still be able to open the page. The record itself
 * carries `status` and `verification`, so the page can say the agent is not
 * currently hireable rather than 404ing.
 */
export function useAgent(reference: string | null | undefined) {
  const normalized = reference?.trim() ?? "";
  const data = useQuery(
    api.agents.get,
    convexClient && normalized.length > 0 ? { reference: normalized } : "skip",
  );

  return {
    data: (data ?? undefined) as Agent | undefined,
    isLoading: data === undefined && normalized.length > 0 && convexClient !== null,
    isError: false,
    /** Distinguishes "still loading" from "the backend says there is no such agent". */
    notFound: data === null,
  };
}

/** Kept as an alias: several screens import this name. */
export const useAgentDetail = useAgent;

/**
 * Several specific agents at once, keyed by agentKey or bare tokenId.
 *
 * For screens that already know which agents they need — My Agents renders the
 * wallet's hires; the activity feed renders the agents behind a set of escrow
 * jobs. Both used to call `useAgents()` for the entire catalog and `.find()`
 * through it, which cannot work once the list is paginated: the agent a user
 * hired may simply not be on page one.
 *
 * Returns a Map keyed by BOTH the agentKey and the bare tokenId, because
 * callers hold one or the other depending on how old the record they are
 * rendering is.
 */
export function useAgentsByKeys(references: readonly string[]): Map<string, Agent> {
  const keys = useMemo(
    () => [...new Set(references.filter((r) => r && r.length > 0))].sort(),
    [references],
  );

  const rows = useQuery(
    api.agents.getMany,
    convexClient && keys.length > 0 ? { references: keys } : "skip",
  );

  return useMemo(() => {
    const map = new Map<string, Agent>();
    for (const row of (rows ?? []) as unknown as Agent[]) {
      map.set(row.agentKey, row);
      map.set(row.tokenId, row);
    }
    return map;
  }, [rows]);
}

/**
 * Hire and review signals for the agents currently on screen.
 *
 * TAKES THE KEYS IT NEEDS. The previous `getCatalogSignals` read every hire and
 * every review in the database and bucketed them in memory - fine at four hires,
 * a full scan of two growing tables at any real size. A page of 24 rows should
 * cost a bounded number of indexed reads.
 */
export type AgentSignals = {
  hires: number;
  activeHires: number;
  paidHires: number;
  reviews: number;
  wouldHireAgain: number;
  wouldHireAgainRate: number | null;
  deliveredCount: number;
};

export function useAgentSignals(agents: readonly Agent[]): Map<string, AgentSignals> {
  // Sorted so the argument is stable across renders that reorder nothing -
  // otherwise every re-render would look like a new query to Convex.
  const agentKeys = useMemo(
    () => [...new Set(agents.map((agent) => agent.id))].sort(),
    [agents],
  );

  const rows = useQuery(
    api.agents.signals,
    convexClient && agentKeys.length > 0 ? { agentKeys } : "skip",
  );

  return useMemo(() => {
    const map = new Map<string, AgentSignals>();
    for (const row of rows ?? []) {
      const { agentKey, ...signals } = row;
      map.set(agentKey, signals);
    }
    return map;
  }, [rows]);
}
