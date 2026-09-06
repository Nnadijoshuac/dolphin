import { useMutation, useQuery } from "convex/react";

import { api } from "../../convex/_generated/api";
import type { AgentCategory, AgentPriceModel } from "@/types/agent";
import { requireSessionToken, useWalletSession } from "@/wallet/wallet-session";

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
 *
 * A resolved price model with a NON-ZERO amount additionally requires
 * `paymentJobId`: the id of an ERC-8183 escrow job that
 * convex/agentPayments.ts already read back off the chain and verified. The
 * mutation looks that record up itself, so passing an id nothing paid for is
 * an error rather than a hire. Neither refusal may be worked around here.
 */
export function useHireReadOnlyAgent() {
  const hire = useMutation(api.agentHires.hireReadOnlyAgent);
  const session = useWalletSession();

  return async (
    tokenId: string,
    category: AgentCategory,
    priceModel: AgentPriceModel | null,
    paymentJobId: string | null = null,
  ) => {
    /*
     * The wallet address is no longer a parameter. It used to be, and the
     * backend believed it - so this hook could record a hire against any
     * address a caller cared to name. The address now comes from the session
     * the token identifies, which exists only because a signature over a
     * server-chosen message verified. See src/wallet/wallet-session.tsx.
     */
    const sessionToken = requireSessionToken(session);
    return hire({ tokenId, category, sessionToken, priceModel, paymentJobId });
  };
}

/**
 * Ends a hire. The agent leaves My Agents and stops counting as active for
 * this wallet.
 *
 * It does NOT refund or alter an ERC-8183 escrow job: that money is on-chain,
 * it paid for work, and nothing in Dolphin has authority over it. A cancelled
 * paid hire keeps its paymentJobId, because it remains true that this wallet
 * paid this agent.
 */
export function useCancelHire() {
  const cancel = useMutation(api.agentHires.cancelHire);
  const session = useWalletSession();

  return async (tokenId: string) => {
    const sessionToken = requireSessionToken(session);
    return cancel({ tokenId, sessionToken });
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
