"use client";

import { useMemo } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";

import { AGENT_DATA_SOURCES } from "@/constants/agents";
import { api } from "@/convex/api";
import { CACHE_TTL, useCachedQuery } from "@/hooks/use-cached-query";
import { convexClient } from "@/providers/convex-provider";
import { verifyAgentRegistration } from "@/services/chain";
import { useQuery as useReactQuery } from "@tanstack/react-query";
import type { Agent } from "@/types/agent";

/**
 * THE CATALOG, PAGE BY PAGE.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS STOPPED BEING ONE QUERY (2026-09-07)
 * ---------------------------------------------------------------------------
 * `useAgents()` called `listAgents` with no arguments, received the ENTIRE
 * catalog, and handed it to pages that filtered by category and searched over
 * it in JavaScript. That shape has no version that scales - a Convex query has
 * a one-second execution budget, and the backend query behind it performed one
 * file-storage lookup per agent inside it. It had already thrown for every
 * caller once, on 2026-09-02, against Convex's read-per-execution limit.
 *
 * ---------------------------------------------------------------------------
 * TANSTACK QUERY LEAVES THE LIST PATH
 * ---------------------------------------------------------------------------
 * `usePaginatedQuery` is a Convex SUBSCRIPTION: already live, already cached,
 * already invalidated by the server when a row changes. Wrapping it in a
 * polling cache would give the page two sources of truth and a staleTime
 * fighting the subscription. TanStack still owns the on-chain registry read
 * below, which is a real fetch with no subscription behind it.
 */

const PAGE_SIZE = 24;

export class AgentsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentsUnavailableError";
  }
}

const NO_BACKEND =
  "NEXT_PUBLIC_CONVEX_URL is not configured, so the agent catalog cannot be read.";

/**
 * What kind of agent, not what it does.
 *
 * `a2a` agents are commissioned and paid for over an ERC-8183 escrow; `mcp`
 * agents publish tools you call directly. The backend has indexed this since
 * the rebuild and the website did not declare it - see the note on
 * `agents.list` in @/convex/api.
 */
export type AgentProtocol = "a2a" | "mcp";

export interface UseAgentListOptions {
  category?: string;
  protocol?: AgentProtocol;
  search?: string;
  enabled?: boolean;
}

export function useAgentList(options: UseAgentListOptions = {}) {
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
  const liveAgents = active.results as unknown as Agent[] | undefined;

  /*
   * Only the FIRST PAGE is cached, and only for browse - never for search.
   *
   * Browse is the page every visitor lands on and returns to, and its first
   * page is what stands between them and an empty grid. Later pages are not
   * cached because they are reached by an explicit "load more", by which point
   * the socket is long since connected and there is nothing to hide.
   *
   * Search is excluded outright: a result set for a query someone typed is not
   * something to replay from disk on a later visit, and the cache key would
   * grow one entry per distinct search string.
   *
   * `loadMore` and `status` stay live-only. A cached array is content to paint,
   * never pagination state to act on - handing back a stale cursor would page
   * from a position the server no longer agrees with.
   */
  const firstPageArgs = isSearching
    ? "skip"
    : { category: options.category, protocol: options.protocol };

  const cachedFirstPage = useCachedQuery<Agent[]>(
    // Only feed the cache once the first page is genuinely settled. Convex
    // grows `results` as pages stream in, and writing mid-stream would store a
    // half-filled page as though it were the whole of one.
    !isSearching && active.status !== "LoadingFirstPage" && liveAgents
      ? liveAgents.slice(0, PAGE_SIZE)
      : undefined,
    "agents.list.firstPage",
    firstPageArgs,
    CACHE_TTL.catalog,
  );

  const showingCache =
    active.status === "LoadingFirstPage" && (cachedFirstPage.data?.length ?? 0) > 0;
  const agents = showingCache ? (cachedFirstPage.data as Agent[]) : (liveAgents ?? []);

  return {
    agents,
    status: active.status,
    isLoading: active.status === "LoadingFirstPage" && !showingCache,
    loadMore: () => active.loadMore(PAGE_SIZE),
    /**
     * Still keyed off LIVE status. "Empty" is a claim about the catalog, and a
     * cache miss is not evidence for it - saying the marketplace is empty when
     * the socket simply has not answered is the same class of lie as saying it
     * is empty when the backend is down (see backend-status.tsx).
     */
    isEmpty: active.status !== "LoadingFirstPage" && (active.results?.length ?? 0) === 0,
    isFromCache: showingCache,
  };
}

/**
 * The browse chips, from the catalog rather than a hardcoded list.
 *
 * `categorySlug` is an open string on the backend, so which categories exist is
 * a property of the data. One with no agents in it does not appear.
 */
export function useCategoryFacets() {
  const args = convexClient ? {} : "skip";
  const live = useQuery(api.facets.list, args);

  /*
   * Cached, and this is the highest-value read on the site to cache: the chip
   * row sits above the fold on every page, it is one small document, and it
   * changes only when a category gains or loses its last agent. Without this it
   * was a websocket round trip before the reader could see what the marketplace
   * even contains.
   */
  const { data, isLoading, isFromCache } = useCachedQuery<{
    categories: { slug: string; label: string; count: number }[];
    totalLive: number;
  }>(live, "facets.list", args, CACHE_TTL.facets);

  return {
    categories: data?.categories ?? [],
    totalLive: data?.totalLive ?? 0,
    isLoading,
    isFromCache,
  };
}

/** Several specific agents by key, for pages that already know which they need. */
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

export type AgentSignals = {
  agentKey: string;
  hires: number;
  activeHires: number;
  paidHires: number;
  reviews: number;
  wouldHireAgain: number;
  wouldHireAgainRate: number | null;
  deliveredCount: number;
};

/**
 * Hire and review signals for the agents currently on the page.
 *
 * ---------------------------------------------------------------------------
 * DEFINED SINCE THE BACKEND REBUILD, CALLED FROM NOWHERE UNTIL 2026-09-08
 * ---------------------------------------------------------------------------
 * This hook and the batched `agents.signals` query behind it both existed and
 * neither had a caller on the website. The consequence was a catalog grid where
 * every record looked identical: a name, a category and a source label, with
 * nothing to prefer one agent over another by. The marketplace had no
 * comparison signal on the surface where comparison happens.
 *
 * BATCHED, and that is the load-bearing part: one query for every agent on the
 * page, not one per rendered row. The mobile app's note on the same query
 * records why - the version before it read every row of `agentHires` and
 * `agentReviews` and bucketed them in memory, which is a full scan of two
 * growing tables on every render.
 *
 * `agent.id` is the agentKey - see convex/lib/publicAgent.ts, which sets them
 * to the same value.
 */
export function useAgentSignals(
  agents: readonly Agent[],
): Map<string, AgentSignals> {
  const agentKeys = useMemo(
    () => [...new Set(agents.map((agent) => agent.agentKey))].sort(),
    [agents],
  );

  const rows = useQuery(
    api.agents.signals,
    convexClient && agentKeys.length > 0 ? { agentKeys } : "skip",
  );

  return useMemo(() => {
    const map = new Map<string, AgentSignals>();
    // The server omits keys with no hires or reviews and caps reads at 100.
    // Only a completed response establishes zero; missing response stays unknown.
    if (rows !== undefined) {
      for (const agentKey of agentKeys.slice(0, 100)) {
        map.set(agentKey, { agentKey, hires: 0, activeHires: 0, paidHires: 0, reviews: 0, wouldHireAgain: 0, wouldHireAgainRate: null, deliveredCount: 0 });
      }
    }
    for (const row of rows ?? []) map.set(row.agentKey, row);
    return map;
  }, [rows, agentKeys]);
}

export interface UseAgentOptions {
  enabled?: boolean;
  verifyOnChain?: boolean;
}

function withRegistryVerification(
  agent: Agent,
  registryVerification: Agent["registryVerification"],
): Agent {
  const owner =
    registryVerification.owner.status === "live"
      ? registryVerification.owner.value
      : agent.publisherAddress;
  const agentWallet =
    registryVerification.agentWallet.status === "live"
      ? registryVerification.agentWallet.value
      : agent.agentWallet;

  return {
    ...agent,
    publisherAddress: owner,
    agentWallet,
    registryVerification,
    sourceLabels: [
      ...agent.sourceLabels.filter(({ id }) => id !== AGENT_DATA_SOURCES.registry.id),
      AGENT_DATA_SOURCES.registry,
    ],
  };
}

/**
 * One agent, plus the site's own first-hand on-chain registry read.
 *
 * The Convex record is a live subscription; the chain read is a one-shot fetch,
 * so it keeps its TanStack query. The registry check stays client-side
 * deliberately - it is the site's OWN verification of what an indexer claims,
 * and routing it through the backend would make it second-hand.
 */
export function useAgent(
  reference: string | null | undefined,
  options: UseAgentOptions = {},
) {
  const normalizedReference = reference?.trim() ?? "";
  const verifyOnChain = options.verifyOnChain ?? true;
  const enabled =
    normalizedReference.length > 0 && (options.enabled === undefined || options.enabled);

  const getArgs = convexClient && enabled ? { reference: normalizedReference } : "skip";
  const liveRow = useQuery(api.agents.get, getArgs);

  /*
   * The detail page is the one most often arrived at from outside - a shared
   * link, a search result - and the one where an empty frame is most obvious,
   * because it is a whole page rather than one row in a grid.
   *
   * Only a POSITIVE result seeds from cache. A cached `null` is not replayed:
   * "no such agent" is a strong claim, and flashing it at someone following a
   * link to an agent that has since been relisted is worse than a spinner.
   * `notFound` below is therefore read from live data only.
   */
  const cached = useCachedQuery<Agent | null>(
    liveRow as Agent | null | undefined,
    "agents.get",
    getArgs,
    CACHE_TTL.agent,
  );
  const row = liveRow !== undefined ? liveRow : (cached.data ?? undefined);

  const verification = useReactQuery({
    queryKey: ["agent-registry", normalizedReference],
    enabled: enabled && verifyOnChain && Boolean(row),
    queryFn: () => verifyAgentRegistration((row as Agent).tokenId),
    staleTime: 10 * 60 * 1000,
  });

  const agent = useMemo(() => {
    if (!row) return undefined;
    const base = row as unknown as Agent;
    return verification.data ? withRegistryVerification(base, verification.data) : base;
  }, [row, verification.data]);

  return {
    data: agent,
    isLoading: convexClient !== null && enabled && row === undefined,
    isError: !convexClient && enabled,
    error: !convexClient && enabled ? new AgentsUnavailableError(NO_BACKEND) : null,
    /**
     * Distinguishes "still loading" from "the backend says there is no such
     * agent". Read from LIVE data, never from cache - see the note above.
     */
    notFound: liveRow === null,
    isFromCache: liveRow === undefined && row !== undefined,
  };
}

export function useAgentDetail(
  reference: string | null | undefined,
  options: UseAgentOptions = {},
) {
  return useAgent(reference, options);
}
