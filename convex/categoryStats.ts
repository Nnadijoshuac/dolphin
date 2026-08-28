import {
  actionGeneric,
  internalMutationGeneric,
  makeFunctionReference,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";

import { BSC_CHAIN_ID } from "./lib/bscClient";
import { agentCategoryValidator, agentLiveStatsValidator } from "./categoryStatsValidators";
import { readGridTradingStats } from "./protocols/pancakeswap";
import { readHealthFactorStats } from "./protocols/venus";
import { unavailableMonitoringStats, unavailableYieldStats } from "./protocols/unavailable";

/**
 * Written against the generic (un-codegenned) builders from convex/server
 * rather than the usual `./_generated/server` imports, because this project
 * has not yet run `npx convex dev` (it requires an interactive browser
 * login this environment cannot perform - see the project audit). Once that
 * one-time login has run, `_generated/server` and `_generated/api` will
 * exist; at that point these can be swapped to the idiomatic generated
 * imports, which is purely a local type-inference upgrade; the runtime
 * behavior is identical either way.
 */

const upsertRef = makeFunctionReference<"mutation">("categoryStats:upsertAgentCategoryStats");

export const getAgentCategoryStats = queryGeneric({
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

export const upsertAgentCategoryStats = internalMutationGeneric({
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
export const refreshAgentCategoryStats = actionGeneric({
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
        case "grid-trading":
          return readGridTradingStats(agentWallet, checkedAt);
        case "monitoring":
          return unavailableMonitoringStats(checkedAt);
        case "yield":
          return unavailableYieldStats(checkedAt);
      }
    })();

    await ctx.runMutation(upsertRef, {
      tokenId,
      category,
      agentWallet,
      stats,
      checkedAt,
    });

    return stats;
  },
});
