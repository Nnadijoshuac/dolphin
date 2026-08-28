import { getAddress, isAddress } from "viem";
import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { BSC_CHAIN_ID } from "./lib/bscClient";
import { agentCategoryValidator } from "./categoryStatsValidators";

// Mirrors AgentPriceModel in src/types/agent.ts field-for-field. Keep these
// two in sync by hand, same rule as the AGENT_QUERY_TIMINGS.* validators in
// categoryStatsValidators.ts.
const priceModelValidator = v.object({
  type: v.union(v.literal("flat"), v.literal("per-call"), v.literal("percentage-fee")),
  amount: v.string(),
  token: v.string(),
});

function isFreePriceModel(priceModel: { amount: string }): boolean {
  const amount = Number(priceModel.amount);
  return Number.isFinite(amount) && amount === 0;
}

/**
 * Generalized from what used to be monitoring-only hireMonitoringAgent -
 * the underlying logic was already category-agnostic (reject an unresolved
 * price, reject a non-zero price since no x402 seller-side integration is
 * wired up, upsert a hire record), it was just locked to one category's
 * name and table. Any category's free-tier agent can now be hired the same
 * way: no session, no spend cap, no call allowlist - just a wallet address.
 */
export const hireReadOnlyAgent = mutation({
  args: {
    tokenId: v.string(),
    category: agentCategoryValidator,
    walletAddress: v.string(),
    // The agent's resolved `priceModel.value` (from its LiveMetric<AgentPriceModel>
    // in src/types/agent.ts), or null if that LiveMetric hasn't resolved to
    // "live"/"stale" yet. Passed in by the caller rather than looked up here
    // because Convex doesn't persist full Agent records (only category live
    // stats) - the 8004scan/editorial Agent data this comes from only exists
    // client-side. Mirrors the agentWallet precondition on
    // categoryStats.refreshAgentCategoryStats: the caller is responsible for
    // handing over a value it actually trusts.
    priceModel: v.union(v.null(), priceModelValidator),
  },
  handler: async (ctx, { tokenId, category, walletAddress, priceModel }) => {
    if (!isAddress(walletAddress)) {
      throw new Error(`hireReadOnlyAgent: "${walletAddress}" is not a valid EVM address.`);
    }
    const normalizedWallet = getAddress(walletAddress);

    if (priceModel === null) {
      throw new Error(
        "Cannot hire yet: this agent's priceModel has not resolved to a live value. " +
          "Wait for priceModel.status to be \"live\" or \"stale\" before calling hireReadOnlyAgent - " +
          "per AGENT.md's data-integrity rule, an unresolved price is never treated as free.",
      );
    }

    if (!isFreePriceModel(priceModel)) {
      // project-scope.md SS3: seller-side x402 stays backend-only, but no
      // @x402/express dependency or facilitator is installed/configured
      // anywhere in this repo yet (checked package.json and convex/ - see
      // Task 2 report). Rather than fake a payment step, fail loudly so a
      // caller can't silently "hire" a paid agent for free.
      throw new Error(
        `hireReadOnlyAgent: agent ${tokenId}'s priceModel requires payment ` +
          `(${priceModel.amount} ${priceModel.token}, ${priceModel.type}), but no x402 seller-side ` +
          "integration is wired up in this backend yet. Not implemented - see project-scope.md SS3 and SS6.",
      );
    }

    const existing = await ctx.db
      .query("agentHires")
      .withIndex("by_agent_wallet", (q) =>
        q.eq("chainId", BSC_CHAIN_ID).eq("tokenId", tokenId).eq("walletAddress", normalizedWallet),
      )
      .unique();

    const hiredAt = new Date().toISOString();

    if (existing) {
      if (existing.status === "active") {
        return existing._id;
      }
      await ctx.db.patch(existing._id, { status: "active", hiredAt, cancelledAt: null });
      return existing._id;
    }

    return ctx.db.insert("agentHires", {
      chainId: BSC_CHAIN_ID,
      tokenId,
      category,
      walletAddress: normalizedWallet,
      status: "active",
      hiredAt,
      cancelledAt: null,
    });
  },
});

export const getHiredAgentsForWallet = query({
  args: {
    walletAddress: v.string(),
  },
  handler: async (ctx, { walletAddress }) => {
    if (!isAddress(walletAddress)) {
      return [];
    }
    const normalizedWallet = getAddress(walletAddress);

    return ctx.db
      .query("agentHires")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", normalizedWallet).eq("status", "active"))
      .collect();
  },
});
