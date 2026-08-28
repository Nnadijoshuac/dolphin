import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction, internalMutation, query } from "./_generated/server";
import { BSC_CHAIN_ID } from "./lib/bscClient";
import { classifyAgent, isLikelySpamOrUnsuitable } from "./lib/classification";
import { agentCategoryValidator } from "./categoryStatsValidators";

// 8004scan's public discovery API - see project-scope.md SS3, "8004scan
// Developer API as the primary discovery/listing source - do not build a
// registry event-scanning indexer from scratch." This calls its real,
// documented full-text search (`/agents?search=...`), not a from-scratch
// scan of the ~287k agents registered on BSC mainnet, most of which are
// spam (see convex/lib/classification.ts's header comment).
const SEARCH_BASE_URL = "https://api.8004scan.io/api/v1/agents";
const RESULTS_PER_QUERY = 30;

// One natural-language query per category, built from the same terms
// classifyAgent() looks for - mirrors what was verified by hand to return
// relevant results before 8004scan's API degraded mid-session.
const CATEGORY_SEARCH_QUERIES: Record<string, string> = {
  monitoring: "monitor wallet alert track",
  "grid-trading": "grid trading liquidity concentrated range",
  "health-factor": "health factor liquidation lending collateral",
  yield: "yield vault farm apy compound",
};

interface RawAgentListItem {
  token_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  owner_address: string;
  x402_supported: boolean;
  created_at: string | null;
}

async function searchAgents(query: string): Promise<RawAgentListItem[]> {
  const url = `${SEARCH_BASE_URL}?chain_id=${BSC_CHAIN_ID}&is_testnet=false&search=${encodeURIComponent(query)}&limit=${RESULTS_PER_QUERY}`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });

  if (!response.ok) {
    throw new Error(`8004scan search failed (${response.status}) for query "${query}"`);
  }

  const payload = (await response.json()) as { items?: RawAgentListItem[] };
  return Array.isArray(payload.items) ? payload.items : [];
}

/**
 * Pulls candidate agents from 8004scan (one search per category), filters
 * spam/unsuitable entries, classifies survivors by keyword match, and
 * upserts them. A failed search for one category just skips that
 * category's candidates this round - it never deletes previously cached
 * agents, so a bad 8004scan moment degrades to "serving the last good
 * sync," not an empty or broken list. Intended to run on a schedule
 * (convex/crons.ts), not to be triggered by the client.
 */
export const syncDiscoveredAgents = internalAction({
  args: {},
  handler: async (ctx) => {
    const syncedAt = new Date().toISOString();
    const seen = new Map<string, RawAgentListItem>();
    const errors: string[] = [];

    for (const query of Object.values(CATEGORY_SEARCH_QUERIES)) {
      try {
        const results = await searchAgents(query);
        for (const item of results) {
          if (!seen.has(item.token_id)) {
            seen.set(item.token_id, item);
          }
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    let upserted = 0;
    let rejectedSpam = 0;
    let rejectedUnclassified = 0;

    for (const item of seen.values()) {
      const name = item.name ?? "";
      const description = item.description ?? "";

      if (isLikelySpamOrUnsuitable(name, description)) {
        rejectedSpam++;
        continue;
      }

      const classification = classifyAgent(name, description);
      if (!classification) {
        rejectedUnclassified++;
        continue;
      }

      await ctx.runMutation(internal.discoveredAgents.upsertDiscoveredAgent, {
        tokenId: item.token_id,
        name,
        description,
        iconUrl: item.image_url ?? null,
        ownerAddress: item.owner_address,
        category: classification.category,
        confidence: classification.confidence,
        matchedTerms: classification.matchedTerms,
        x402Supported: item.x402_supported ?? false,
        registeredAt: item.created_at ?? null,
        syncedAt,
      });
      upserted++;
    }

    return { upserted, rejectedSpam, rejectedUnclassified, candidatesSeen: seen.size, errors };
  },
});

export const upsertDiscoveredAgent = internalMutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("discoveredAgents")
      .withIndex("by_agent", (q) => q.eq("chainId", BSC_CHAIN_ID).eq("tokenId", args.tokenId))
      .unique();

    const document = { chainId: BSC_CHAIN_ID, ...args };

    if (existing) {
      await ctx.db.patch(existing._id, document);
    } else {
      await ctx.db.insert("discoveredAgents", document);
    }
  },
});

export const listDiscoveredAgents = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db
      .query("discoveredAgents")
      .withIndex("by_agent", (q) => q.eq("chainId", BSC_CHAIN_ID))
      .collect();
  },
});
