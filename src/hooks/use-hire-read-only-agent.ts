import { useMutation, useQuery } from "convex/react";

import { api } from "../../convex/_generated/api";
import type { AgentCategory, AgentPriceModel } from "@/types/agent";

/**
 * Records (or reactivates) a "hired" relationship between a wallet and any
 * category of agent - what powers the My Agents list for free-tier agents
 * (see convex/agentHires.ts). Generalized from a monitoring-only mutation:
 * the underlying logic was already category-agnostic. Read-only hires are
 * subscriptions with no session grant, no spend cap, no call allowlist
 * (project-scope.md SS6/SS7) - only the identifiers below.
 *
 * `priceModel` must be the agent's resolved `priceModel.value` (i.e. its
 * LiveMetric status was already "live" or "stale" when read) or `null` if
 * that LiveMetric hasn't resolved yet. Passing `null` makes the mutation
 * reject the hire rather than guess it's free - resolve the price first.
 * A resolved price model with a non-zero amount also rejects: this backend
 * has no x402 seller-side integration wired up yet (no @x402/express
 * dependency, no facilitator configured), so it refuses to fake a payment
 * step for a paid agent instead of "hiring" it for free.
 */
export function useHireReadOnlyAgent() {
  const hire = useMutation(api.agentHires.hireReadOnlyAgent);

  return async (
    tokenId: string,
    category: AgentCategory,
    walletAddress: string,
    priceModel: AgentPriceModel | null,
  ) => {
    return hire({ tokenId, category, walletAddress, priceModel });
  };
}

/**
 * A wallet's active hires across every category, for the My Agents screen.
 * Returns undefined until the Convex client has data.
 *
 * Precondition: only call this from a subtree mounted under a configured
 * ConvexClientProvider, same as useAgentCategoryStats.
 */
export function useHiredAgents(walletAddress: string | null | undefined) {
  return useQuery(
    api.agentHires.getHiredAgentsForWallet,
    walletAddress ? { walletAddress } : "skip",
  );
}
