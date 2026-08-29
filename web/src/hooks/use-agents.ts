"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { AGENT_DATA_SOURCES, AGENT_QUERY_TIMINGS } from "@/constants/agents";
import { api } from "@/convex/api";
import { convexClient } from "@/providers/convex-provider";
import { searchAgentsLocally } from "@/services/agents-api";
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

export class AgentsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentsUnavailableError";
  }
}

const NO_BACKEND =
  "NEXT_PUBLIC_CONVEX_URL is not configured, so the agent catalog cannot be read.";

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
 * The agent catalog, straight from convex/agents.ts's `listAgents`.
 *
 * This site deliberately does NOT fetch 8004scan, curate an editorial list,
 * assign categories, apply a price policy, or merge/dedupe anything. All of
 * that is decided once in convex/lib/agentCatalog.ts and read identically here
 * and in the mobile app, so the two surfaces cannot drift. Before 2026-08-29
 * this file had its own copy of all of it, and had already drifted a category
 * taxonomy behind.
 */
async function fetchAgentCatalog(): Promise<Agent[]> {
  if (!convexClient) {
    throw new AgentsUnavailableError(NO_BACKEND);
  }

  return convexClient.query(api.agents.listAgents, {});
}

export function useAgents() {
  return useQuery({
    queryKey: agentQueryKeys.list(),
    queryFn: fetchAgentCatalog,
    staleTime: AGENT_QUERY_TIMINGS.listStaleTimeMs,
    gcTime: AGENT_QUERY_TIMINGS.garbageCollectionTimeMs,
  });
}

/**
 * One agent from the same catalog, plus a live on-chain ERC-8004 registry read
 * (services/chain.ts) - the site's own first-hand check on what the indexer
 * claims, exactly as the mobile app does it.
 */
export function useAgent(
  reference: string | null | undefined,
  options: UseAgentOptions = {},
) {
  const normalizedReference = reference?.trim() ?? "";
  const verifyOnChain = options.verifyOnChain ?? true;

  return useQuery({
    queryKey: agentQueryKeys.detail(normalizedReference, verifyOnChain),
    enabled:
      normalizedReference.length > 0 &&
      (options.enabled === undefined || options.enabled),
    queryFn: async () => {
      if (!convexClient) {
        throw new AgentsUnavailableError(NO_BACKEND);
      }

      const agent = await convexClient.query(api.agents.getAgent, {
        reference: normalizedReference,
      });

      if (!agent) {
        throw new AgentsUnavailableError(
          "This agent is not in Dolphin's explicitly classified BSC discovery set.",
        );
      }

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
