import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { api } from "../../convex/_generated/api";
import {
  AGENT_DATA_SOURCES,
  AGENT_QUERY_TIMINGS,
} from "@/constants/agents";
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
 * Convex hands back addresses as plain `string`, because a Convex validator
 * cannot express viem's `0x${string}` template-literal type. The values really
 * are checksummed addresses (convex/lib/agentCatalog.ts and the 8004scan
 * decode both only ever store what the registry/indexer published), so this is
 * a type-level widening, not an unchecked claim about the data. Kept to this
 * one boundary function rather than scattered casts at each call site.
 */
function asAgents(rows: unknown): Agent[] {
  return rows as Agent[];
}

/**
 * The agent catalog, from convex/agents.ts's `listAgents` - the single
 * authoritative source both this app and the website under web/ read.
 * Curation, category taxonomy, hire price, the 8004scan overlay and the
 * editorial/discovered merge all happen there, so neither frontend can shape
 * the list differently from the other.
 *
 * FALLBACK when EXPO_PUBLIC_CONVEX_URL is unset: the original client-side path
 * (src/services/agents-api.ts, editorial agents refreshed per agent straight
 * from 8004scan). It returns the eight curated agents without the discovered
 * ones, which is the honest degraded answer for a build with no backend
 * configured - the same reasoning convex-provider.tsx already applies. It is
 * NOT a second implementation of the rules: it predates them, and Convex wins
 * whenever it is available, which is every deployed build (the CI workflow
 * sets EXPO_PUBLIC_CONVEX_URL).
 */
async function fetchAgentCatalog(options: {
  signal?: AbortSignal;
}): Promise<Agent[]> {
  if (!convexClient) {
    return fetchAgents(options);
  }

  return asAgents(await convexClient.query(api.agents.listAgents, {}));
}

async function fetchCatalogAgent(
  reference: string,
  options: { signal?: AbortSignal },
): Promise<Agent> {
  if (!convexClient) {
    return fetchAgentById(reference, options);
  }

  const row = await convexClient.query(api.agents.getAgent, { reference });

  if (!row) {
    throw new AgentsApiError(
      "This agent is not in Dolphin's explicitly classified BSC discovery set.",
    );
  }

  return asAgents([row])[0];
}

export function useAgents() {
  return useQuery({
    queryKey: agentQueryKeys.list(),
    queryFn: ({ signal }) => fetchAgentCatalog({ signal }),
    staleTime: AGENT_QUERY_TIMINGS.listStaleTimeMs,
    gcTime: AGENT_QUERY_TIMINGS.garbageCollectionTimeMs,
  });
}

/**
 * One agent, from the same Convex catalog as the list, plus a live on-chain
 * registry check. The registry read stays client-side deliberately: it is a
 * cheap direct viem call against the ERC-8004 identity contract and it is the
 * app's own independent verification of what the indexer claims - routing it
 * through the backend would make it a second-hand assertion.
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
      normalizedReference.length > 0 && (options.enabled === undefined || options.enabled),
    queryFn: async ({ signal }) => {
      const agent = await fetchCatalogAgent(normalizedReference, { signal });

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
