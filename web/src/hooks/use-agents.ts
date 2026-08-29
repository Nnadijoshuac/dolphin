"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  AGENT_DATA_SOURCES,
  AGENT_QUERY_TIMINGS,
} from "@/constants/agents";
import {
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

export function useAgents() {
  return useQuery({
    queryKey: agentQueryKeys.list(),
    queryFn: ({ signal }) => fetchAgents({ signal }),
    staleTime: AGENT_QUERY_TIMINGS.listStaleTimeMs,
    gcTime: AGENT_QUERY_TIMINGS.garbageCollectionTimeMs,
  });
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
      const agent = await fetchAgentById(normalizedReference, { signal });

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
