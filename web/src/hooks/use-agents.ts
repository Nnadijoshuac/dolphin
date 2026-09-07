"use client";

import { useMemo } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";

import { AGENT_DATA_SOURCES } from "@/constants/agents";
import { api } from "@/convex/api";
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

export interface UseAgentListOptions {
  category?: string;
  search?: string;
  enabled?: boolean;
}

export function useAgentList(options: UseAgentListOptions = {}) {
  const search = options.search?.trim() ?? "";
  const isSearching = search.length > 0;
  const enabled = options.enabled !== false && convexClient !== null;

  const browse = usePaginatedQuery(
    api.agents.list,
    enabled && !isSearching ? { category: options.category } : "skip",
    { initialNumItems: PAGE_SIZE },
  );

  const found = usePaginatedQuery(
    api.agents.search,
    enabled && isSearching ? { text: search, category: options.category } : "skip",
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
 * The browse chips, from the catalog rather than a hardcoded list.
 *
 * `categorySlug` is an open string on the backend, so which categories exist is
 * a property of the data. One with no agents in it does not appear.
 */
export function useCategoryFacets() {
  const data = useQuery(api.facets.list, convexClient ? {} : "skip");
  return {
    categories: data?.categories ?? [],
    totalLive: data?.totalLive ?? 0,
    isLoading: data === undefined,
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

/** Hire and review signals for the agents currently on the page. */
export function useAgentSignals(agents: readonly Agent[]) {
  const agentKeys = useMemo(
    () => [...new Set(agents.map((agent) => agent.id))].sort(),
    [agents],
  );

  const rows = useQuery(
    api.agents.signals,
    convexClient && agentKeys.length > 0 ? { agentKeys } : "skip",
  );

  return useMemo(() => {
    const map = new Map<string, (typeof rows extends undefined ? never : NonNullable<typeof rows>)[number]>();
    for (const row of rows ?? []) map.set(row.agentKey, row);
    return map;
  }, [rows]);
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

  const row = useQuery(
    api.agents.get,
    convexClient && enabled ? { reference: normalizedReference } : "skip",
  );

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
    /** Distinguishes "still loading" from "the backend says there is no such agent". */
    notFound: row === null,
  };
}

export function useAgentDetail(
  reference: string | null | undefined,
  options: UseAgentOptions = {},
) {
  return useAgent(reference, options);
}
