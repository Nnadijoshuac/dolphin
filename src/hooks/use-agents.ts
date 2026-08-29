import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useQuery as useConvexQuery } from "convex/react";

import { api } from "../../convex/_generated/api";
import {
  AGENT_DATA_SOURCES,
  AGENT_QUERY_TIMINGS,
} from "@/constants/agents";
import { discoveredAgentToAgent } from "@/data/discovered-agents";
import { findEditorialAgent } from "@/data/editorial-agents";
import { convexClient } from "@/providers/convex-provider";
import {
  AgentsApiError,
  fetchAgentById,
  fetchAgents,
  searchAgentsLocally,
} from "@/services/agents-api";
import { verifyAgentRegistration } from "@/services/chain";
import type { Agent, AgentCategory } from "@/types/agent";

export const agentQueryKeys = {
  all: ["agents"] as const,
  list: () => [...agentQueryKeys.all, "list", "bsc"] as const,
  detail: (reference: string, verifyOnChain: boolean) =>
    [
      ...agentQueryKeys.all,
      "detail",
      "bsc",
      reference,
      { verifyOnChain },
    ] as const,
};

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
      ...agent.sourceLabels.filter(
        ({ id }) => id !== AGENT_DATA_SOURCES.registry.id,
      ),
      AGENT_DATA_SOURCES.registry,
    ],
  };
}

/**
 * Editorial (hand-vetted) agents plus, when Convex is configured, agents
 * discovered by the scheduled 8004scan sync (convex/discoveredAgents.ts) -
 * see discoveredAgentToAgent's doc comment for how those are classified
 * and labeled. A discovered agent that duplicates an editorial tokenId is
 * dropped in favor of the hand-vetted entry.
 */
export function useAgents() {
  const editorialQuery = useQuery({
    queryKey: agentQueryKeys.list(),
    queryFn: ({ signal }) => fetchAgents({ signal }),
    staleTime: AGENT_QUERY_TIMINGS.listStaleTimeMs,
    gcTime: AGENT_QUERY_TIMINGS.garbageCollectionTimeMs,
  });

  const discoveredRows = useConvexQuery(
    api.discoveredAgents.listDiscoveredAgents,
    convexClient ? {} : "skip",
  );

  const data = useMemo(() => {
    if (!editorialQuery.data || !discoveredRows || discoveredRows.length === 0) {
      return editorialQuery.data;
    }

    const knownTokenIds = new Set(editorialQuery.data.map((agent) => agent.tokenId));
    const discovered = discoveredRows
      .filter((row) => !knownTokenIds.has(row.tokenId))
      .map(discoveredAgentToAgent);

    return [...editorialQuery.data, ...discovered];
  }, [editorialQuery.data, discoveredRows]);

  return { ...editorialQuery, data };
}

const NOT_IN_DISCOVERY_SET_ERROR =
  "This agent is not in Dolphin's explicitly classified BSC discovery set.";

/**
 * Looks up a discovered (non-editorial) agent by tokenId. fetchAgentById
 * (agents-api.ts) only ever checked EDITORIAL_AGENTS - opening any
 * discovered agent's detail page threw and rendered "Agent Not Found"
 * (confirmed by hand for "BNB LP Range Rebalancer", tokenId 265375, on
 * 2026-08-29). This is the fallback useAgent() takes when the reference
 * isn't an editorial agent.
 */
async function fetchDiscoveredAgentById(reference: string): Promise<Agent> {
  const parts = reference.split(":");
  const tokenId = parts[parts.length - 1];

  if (!convexClient) {
    throw new AgentsApiError(NOT_IN_DISCOVERY_SET_ERROR);
  }

  const row = await convexClient.query(api.discoveredAgents.getDiscoveredAgentByTokenId, {
    tokenId,
  });

  if (!row) {
    throw new AgentsApiError(NOT_IN_DISCOVERY_SET_ERROR);
  }

  return discoveredAgentToAgent(row);
}

export function useAgent(
  reference: string | null | undefined,
  options: UseAgentOptions = {},
) {
  const normalizedReference = reference?.trim() ?? "";
  const verifyOnChain = options.verifyOnChain ?? true;

  return useQuery({
    queryKey: agentQueryKeys.detail(normalizedReference, verifyOnChain),
    enabled:
      normalizedReference.length > 0 && (options.enabled === undefined || options.enabled),
    queryFn: async ({ signal }) => {
      const isEditorial = findEditorialAgent(normalizedReference) !== undefined;
      const agent = isEditorial
        ? await fetchAgentById(normalizedReference, { signal })
        : await fetchDiscoveredAgentById(normalizedReference);

      if (!verifyOnChain) {
        return agent;
      }

      const registryVerification = await verifyAgentRegistration(agent.tokenId);
      return withRegistryVerification(agent, registryVerification);
    },
    staleTime: AGENT_QUERY_TIMINGS.detailStaleTimeMs,
    gcTime: AGENT_QUERY_TIMINGS.garbageCollectionTimeMs,
  });
}

export function useAgentDetail(
  reference: string | null | undefined,
  options: UseAgentOptions = {},
) {
  return useAgent(reference, options);
}

export function useAgentsByCategory(category: AgentCategory) {
  const query = useAgents();
  const data = useMemo(
    () => query.data?.filter((agent) => agent.category === category),
    [category, query.data],
  );

  return { ...query, data };
}

export function useSearchAgents(queryText: string) {
  const query = useAgents();
  const data = useMemo(
    () => searchAgentsLocally(query.data ?? [], queryText),
    [query.data, queryText],
  );

  return { ...query, data };
}
