import { v } from "convex/values";

import { internal } from "./_generated/api";
import { action, internalMutation, query } from "./_generated/server";
import { BSC_CHAIN_ID } from "./lib/bscClient";
import { agentCategoryValidator, agentLiveStatsValidator } from "./categoryStatsValidators";
import { readYieldStats } from "./protocols/aave";
import { readRebalancingStats } from "./protocols/pancakeswap";
import { unavailableGridTradingStats, unavailableMonitoringStats } from "./protocols/unavailable";
import { readHealthFactorStats } from "./protocols/venus";

export const getAgentCategoryStats = query({
  args: {
    tokenId: v.string(),
    category: agentCategoryValidator,
  },
  handler: async (ctx, { tokenId, category }) => {
    const row = await ctx.db
      .query("agentLiveStats")
      .withIndex("by_agent_category", (q) =>
        q.eq("chainId", BSC_CHAIN_ID).eq("tokenId", tokenId).eq("category", category),
      )
      .unique();

    return row ?? null;
  },
});

export const upsertAgentCategoryStats = internalMutation({
  args: {
    tokenId: v.string(),
    category: agentCategoryValidator,
    agentWallet: v.union(v.string(), v.null()),
    stats: agentLiveStatsValidator,
    checkedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agentLiveStats")
      .withIndex("by_agent_category", (q) =>
        q.eq("chainId", BSC_CHAIN_ID).eq("tokenId", args.tokenId).eq("category", args.category),
      )
      .unique();

    const document = { chainId: BSC_CHAIN_ID, ...args };

    if (existing) {
      await ctx.db.patch(existing._id, document);
    } else {
      await ctx.db.insert("agentLiveStats", document);
    }
  },
});

/**
 * Reads real on-chain state for one agent's category and caches the result.
 * agentWallet must come from a live ERC-8004 registry read (chain.ts on the
 * client, or an equivalent server-side verification) - never trust an
 * unverified publisher-reported address for a financial read.
 */
export const refreshAgentCategoryStats = action({
  args: {
    tokenId: v.string(),
    category: agentCategoryValidator,
    agentWallet: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { tokenId, category, agentWallet }) => {
    const checkedAt = new Date().toISOString();

    const stats = await (async () => {
      switch (category) {
        case "health-factor":
          return readHealthFactorStats(agentWallet, checkedAt);
        case "rebalancing":
          return readRebalancingStats(agentWallet, checkedAt);
        case "grid-trading":
          return unavailableGridTradingStats(checkedAt);
        case "monitoring":
          return unavailableMonitoringStats(checkedAt);
        case "yield":
          return readYieldStats(agentWallet, checkedAt);
      }
    })();

    await ctx.runMutation(internal.categoryStats.upsertAgentCategoryStats, {
      tokenId,
      category,
      agentWallet,
      stats,
      checkedAt,
    });

    return stats;
  },
});
