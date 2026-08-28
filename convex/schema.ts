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

  monitoringHires: defineTable({
    chainId: v.number(),
    tokenId: v.string(),
    walletAddress: v.string(),
    status: v.union(v.literal("active"), v.literal("cancelled")),
    hiredAt: v.string(),
    cancelledAt: v.union(v.string(), v.null()),
  })
    .index("by_agent_wallet", ["chainId", "tokenId", "walletAddress"])
    .index("by_wallet", ["walletAddress", "status"]),

  discoveredAgents: defineTable({
    chainId: v.number(),
    tokenId: v.string(),
    name: v.string(),
    description: v.string(),
    iconUrl: v.union(v.string(), v.null()),
    ownerAddress: v.string(),
    category: agentCategoryValidator,
    confidence: v.union(v.literal("confirmed"), v.literal("likely")),
    matchedTerms: v.array(v.string()),
    x402Supported: v.boolean(),
    registeredAt: v.union(v.string(), v.null()),
    syncedAt: v.string(),
  })
    .index("by_agent", ["chainId", "tokenId"])
    .index("by_category", ["chainId", "category"]),
});
