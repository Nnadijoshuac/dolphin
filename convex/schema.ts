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

  agentHires: defineTable({
    chainId: v.number(),
    tokenId: v.string(),
    category: agentCategoryValidator,
    walletAddress: v.string(),
    status: v.union(v.literal("active"), v.literal("cancelled")),
    hiredAt: v.string(),
    cancelledAt: v.union(v.string(), v.null()),
  })
    .index("by_agent_wallet", ["chainId", "tokenId", "walletAddress"])
    .index("by_wallet", ["walletAddress", "status"]),

  // 8004scan's indexed view of one agent, refreshed server-side by
  // agents.refreshAgentDirectory. Before this table the mobile app fetched
  // 8004scan per agent from the client on every list render, and the website
  // would have had to do the same - two surfaces hitting the same API and
  // applying the same decode rules independently. agents.listAgents overlays
  // these rows onto the curated catalog so both frontends read one answer.
  //
  // Every field is nullable on purpose: a missing value means 8004scan did not
  // publish it, and listAgents turns that into an explicit "unavailable"
  // metric rather than a plausible-looking default (AGENTS.md SS5).
  agentDirectory: defineTable({
    chainId: v.number(),
    tokenId: v.string(),
    name: v.union(v.string(), v.null()),
    description: v.union(v.string(), v.null()),
    iconUrl: v.union(v.string(), v.null()),
    publisher: v.union(v.string(), v.null()),
    ownerAddress: v.union(v.string(), v.null()),
    agentWallet: v.union(v.string(), v.null()),
    registeredAt: v.union(v.string(), v.null()),
    tags: v.array(v.string()),
    services: v.array(
      v.object({
        name: v.string(),
        endpoint: v.string(),
        version: v.union(v.string(), v.null()),
      }),
    ),
    x402Supported: v.union(v.boolean(), v.null()),
    isActive: v.union(v.boolean(), v.null()),
    reputationScore: v.union(v.number(), v.null()),
    feedbackCount: v.union(v.number(), v.null()),
    endpointStatus: v.union(v.string(), v.null()),
    endpointCheckedAt: v.union(v.string(), v.null()),
    indexedAt: v.string(),
    refreshedAt: v.string(),
  }).index("by_agent", ["chainId", "tokenId"]),

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
