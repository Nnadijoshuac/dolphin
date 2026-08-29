import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction, internalMutation, query } from "./_generated/server";
import { BSC_CHAIN_ID } from "./lib/bscClient";
import { classifyAgent, isLikelySpamOrUnsuitable } from "./lib/classification";
import { agentCategoryValidator } from "./categoryStatsValidators";

// 8004scan's public discovery API - see project-scope.md SS3, "8004scan
// Developer API as the primary discovery/listing source - do not build a
// registry event-scanning indexer from scratch." This calls its real,
// documented full-text search AND list endpoints (`/agents?search=...` and
// `/agents?sort_by=...`), never a from-scratch scan of the ~287k agents
// registered on BSC mainnet, most of which are spam (see
// convex/lib/classification.ts's header comment).
const AGENTS_URL = "https://api.8004scan.io/api/v1/agents";
const RESULTS_PER_QUERY = 30;

// One natural-language query per category, built from the same terms
// classifyAgent() looks for - mirrors what was verified by hand to return
// relevant results before 8004scan's API degraded mid-session.
//
// "grid-trading" and "rebalancing" queries were split (2026-08-28) to match
// classification.ts's split of what used to be one combined term list.
// "grid trader price ladder buy sell levels" was verified by hand against
// 8004scan's live search endpoint that day and surfaces real price-ladder
// agents (e.g. token 269224 "Grid Trader") that the old combined query,
// tuned only for LP-range language, never returned.
const CATEGORY_SEARCH_QUERIES: Record<string, string> = {
  monitoring: "monitor wallet alert track",
  rebalancing: "concentrated liquidity range rebalance lp position",
  "grid-trading": "grid trader price ladder buy sell levels",
  "health-factor": "health factor liquidation lending collateral",
  yield: "yield vault farm apy compound",
};

// 8004scan's own search relevance ranking doesn't reliably surface every
// on-topic agent - manual testing found real, clearly-classifiable agents
// (e.g. "Beefy powered by HeyAnon", description literally says "vault")
// that none of the search queries above returned. A bulk scan sorted by
// score, classified with OUR OWN substring matching rather than their
// search relevance, catches those. Bounded so a sync stays a handful of
// HTTP calls, not a scan of the full ~287k-agent registry.
//
// Deep pagination (high offset) has been observed to hang rather than
// error on 8004scan's end (a 524 Cloudflare timeout on one request during
// testing, and a full sync that never returned at BULK_SCAN_PAGES=15
// before this timeout was added). Bounded so one slow page can never hang
// the whole sync - it just counts as a failed page, same as any other
// fetch error.
// Agents that pass every automated filter (not spam, real, live, keyword-
// matched) but were manually reviewed and rejected as too broad a fit -
// the matched category is one incidental clause among many unrelated
// capabilities, not what the agent actually is. Keeping these terms in
// CATEGORY_TERMS is still correct (they're real signal for genuine
// category-focused agents), so the fix is a specific exclusion, not a
// weaker term list. Re-review by hand if 8004scan meaningfully updates an
// excluded agent's own description.
const MANUALLY_EXCLUDED_TOKEN_IDS = new Set([
  "113284", // Topaz Agent - broad ve(3,3) DEX agent (swaps, gauge votes, bribes,
  // veTOPAZ locks); "optimize LP positions" is one clause among many, not its
  // identity. Matches rebalancing's "lp position" term.
  "6428", // Tator Trader - 24+ chain "does everything" agent (trades, bridges,
  // perps, prediction markets, token launches, name registration); "manage
  // yield positions" is one clause among ten. Matches yield's weak "yield" term.
]);

const PER_REQUEST_TIMEOUT_MS = 15_000;
// Raised from 8 (2026-08-29) now that SCAN8004_API_KEY lifts the request
// budget to 600/min - each page is still independently timeout-boxed, so a
// slow/hung page beyond this count just fails soft, same as before.
const BULK_SCAN_PAGES = 20;
const BULK_SCAN_PAGE_SIZE = 100;

interface RawAgentListItem {
  token_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  owner_address: string;
  x402_supported: boolean;
  created_at: string | null;
}

// 8004scan's unauthenticated rate limit (30/min, 1000/day) is easy for one
// bulk sync (searches + up to BULK_SCAN_PAGES paginated pages) to trip,
// which is the most likely explanation for the intermittent 500/502/524s
// this module already tolerates (see the fail-soft handling below). An
// API key (set via `npx convex env set SCAN8004_API_KEY ...` - never
// committed, never bundled into the client) raises this to 600/min,
// 100000/day. Falls back to unauthenticated if the key isn't configured
// in a given deployment, rather than failing the whole sync.
function scan8004Headers(): HeadersInit {
  const apiKey = process.env.SCAN8004_API_KEY;
  return apiKey ? { Accept: "application/json", "X-API-Key": apiKey } : { Accept: "application/json" };
}

async function fetchAgentsList(params: string): Promise<RawAgentListItem[]> {
  const url = `${AGENTS_URL}?chain_id=${BSC_CHAIN_ID}&is_testnet=false&${params}`;
  const response = await fetch(url, {
    headers: scan8004Headers(),
    signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`8004scan request failed (${response.status}): ${params}`);
  }

  const payload = (await response.json()) as { items?: RawAgentListItem[] };
  return Array.isArray(payload.items) ? payload.items : [];
}

function searchAgents(query: string): Promise<RawAgentListItem[]> {
  return fetchAgentsList(`search=${encodeURIComponent(query)}&limit=${RESULTS_PER_QUERY}`);
}

function listByScore(offset: number): Promise<RawAgentListItem[]> {
  return fetchAgentsList(
    `sort_by=total_score&sort_order=desc&limit=${BULK_SCAN_PAGE_SIZE}&offset=${offset}`,
  );
}

/**
 * Real liveness gate, added 2026-08-29 after two already-added agents
 * ("V3 Pools powered by HeyAnon", "BNB LP Range Rebalancer") were flagged
 * as not live. Investigation found both were actually fine by every check
 * available (8004scan `is_active: true`, on-chain ownerOf/getAgentWallet
 * resolved, and their claimed MCP/A2A endpoints answered live) - so the
 * report likely traced to the dev client's stale TanStack Query cache
 * (see HANDOFF.md's "Fast Refresh doesn't invalidate the query cache"
 * gotcha) rather than a real data problem. Even so, this gate is worth
 * having: the list/search endpoints used above never return `is_active`
 * at all (checked - it's absent from the list item shape), so nothing in
 * this pipeline was ever actually checking it before upserting. This adds
 * one per-agent detail fetch, but only for candidates that already
 * survived the spam filter and classification - a handful per sync, not
 * hundreds - so it stays cheap even before the SCAN8004_API_KEY quota
 * bump made a wider check affordable.
 */
async function verifyAgentIsActive(tokenId: string): Promise<boolean> {
  const url = `${AGENTS_URL}/${BSC_CHAIN_ID}/${encodeURIComponent(tokenId)}`;
  try {
    const response = await fetch(url, {
      headers: scan8004Headers(),
      signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      return false;
    }
    const payload = (await response.json()) as { is_active?: unknown; data?: { is_active?: unknown } };
    const isActive = payload.data?.is_active ?? payload.is_active;
    return isActive === true;
  } catch {
    return false;
  }
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

    for (let page = 0; page < BULK_SCAN_PAGES; page++) {
      try {
        const results = await listByScore(page * BULK_SCAN_PAGE_SIZE);
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
    let rejectedNotActive = 0;
    let rejectedManually = 0;

    for (const item of seen.values()) {
      const name = item.name ?? "";
      const description = item.description ?? "";

      if (isLikelySpamOrUnsuitable(name, description)) {
        rejectedSpam++;
        continue;
      }

      if (MANUALLY_EXCLUDED_TOKEN_IDS.has(item.token_id)) {
        rejectedManually++;
        continue;
      }

      const classification = classifyAgent(name, description);
      if (!classification) {
        rejectedUnclassified++;
        continue;
      }

      const isActive = await verifyAgentIsActive(item.token_id);
      if (!isActive) {
        rejectedNotActive++;
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

    return {
      upserted,
      rejectedSpam,
      rejectedUnclassified,
      rejectedNotActive,
      rejectedManually,
      candidatesSeen: seen.size,
      errors,
    };
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

/**
 * Single-agent lookup for the agent detail route. Added 2026-08-29:
 * fetchAgentById (src/services/agents-api.ts) only ever checked
 * EDITORIAL_AGENTS, so opening any discovered (non-editorial) agent's
 * detail page threw "not in Dolphin's explicitly classified BSC discovery
 * set" and rendered "Agent Not Found" - confirmed by hand for "BNB LP
 * Range Rebalancer" (265375). useAgent() (src/hooks/use-agents.ts) now
 * falls back to this query when the editorial lookup fails.
 */
export const getDiscoveredAgentByTokenId = query({
  args: { tokenId: v.string() },
  handler: async (ctx, { tokenId }) => {
    return ctx.db
      .query("discoveredAgents")
      .withIndex("by_agent", (q) => q.eq("chainId", BSC_CHAIN_ID).eq("tokenId", tokenId))
      .unique();
  },
});
