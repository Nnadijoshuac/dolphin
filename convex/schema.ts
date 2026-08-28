import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import { agentCategoryValidator, agentLiveStatsValidator } from "./categoryStatsValidators";

export default defineSchema({
  agentLiveStats: defineTable({
    chainId: v.number(),
    tokenId: v.string(),
    category: agentCategoryValidator,
    agentWallet: v.union(v.string(), v.null()),
    stats: agentLiveStatsValidator,
    checkedAt: v.string(),
  }).index("by_agent_category", ["chainId", "tokenId", "category"]),
});
