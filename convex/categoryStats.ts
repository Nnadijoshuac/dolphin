import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import { action, internalMutation, query } from "./_generated/server";
import { BSC_CHAIN_ID } from "./lib/bscClient";
import { agentCategoryValidator, agentLiveStatsValidator } from "./categoryStatsValidators";
import { readYieldStats } from "./protocols/aave";
import { readGridTradingStats } from "./protocols/pancakeswap";
import { unavailableMonitoringStats } from "./protocols/unavailable";
import { readHealthFactorStats } from "./protocols/venus";

/**
 * `./_generated/server` and the `internal.*`/`api.*` reference objects are
 * normally produced by `npx convex dev`, which needs an interactive browser
 * login this environment cannot perform (see the project audit). server.ts
 * and dataModel.ts here are hand-written to match what codegen produces, so
 * this typechecks now; running `npx convex dev` once will safely regenerate
 * them. `internal.categoryStats.*` isn't available without generated
 * `api.ts`, so the one cross-function call below uses an explicit
 * makeFunctionReference instead - swap it for `internal.categoryStats.
 * upsertAgentCategoryStats` once codegen has run, purely for readability.
 */
const upsertRef = makeFunctionReference<"mutation">("categoryStats:upsertAgentCategoryStats");

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
        case "grid-trading":
          return readGridTradingStats(agentWallet, checkedAt);
        case "monitoring":
          return unavailableMonitoringStats(checkedAt);
        case "yield":
          return readYieldStats(agentWallet, checkedAt);
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
