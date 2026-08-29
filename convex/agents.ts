/**
 * The single authoritative agent listing that both frontends read.
 *
 * `listAgents` and `getAgent` are the only place the curated catalog, the
 * category taxonomy, the hire-price policy, the discovered->Agent mapping and
 * the editorial/discovered merge rule are applied. The mobile app
 * (src/hooks/use-agents.ts) and the website (web/src/hooks/use-agents.ts) both
 * call these and shape nothing themselves, so the two surfaces cannot show
 * different agents, categories or prices for the same registry.
 *
 * The decisions live in convex/lib/agentCatalog.ts. This file is the fetch and
 * assembly mechanics around them:
 *
 *   editorial catalog  (hand-vetted, convex/lib/agentCatalog.ts)
 *     + discoveredAgents  (cron keyword discovery, convex/discoveredAgents.ts)
 *     + agentDirectory    (8004scan indexed overlay, refreshed below)
 *     = listAgents
 *
 * Live category stats (Venus/Aave/PancakeSwap reads) are deliberately NOT here
 * - they stay in convex/categoryStats.ts, refreshed per agent on view, because
 * they need the on-chain agent wallet and are far more expensive than a
 * listing.
 */

import { v } from "convex/values";

import { internal } from "./_generated/api";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { BSC_CHAIN_ID } from "./lib/bscClient";
import {
  AGENT_DATA_SOURCES,
  EDITORIAL_AGENT_INPUTS,
  EDITORIAL_TOKEN_IDS,
  buildDiscoveredAgent,
  buildEditorialAgent,
  liveMetric,
  mergeCatalog,
  unavailableMetric,
  type CatalogAgent,
} from "./lib/agentCatalog";

type DirectoryRow = {
  tokenId: string;
  name: string | null;
  description: string | null;
  iconUrl: string | null;
  publisher: string | null;
  ownerAddress: string | null;
  agentWallet: string | null;
  registeredAt: string | null;
  tags: string[];
  services: { name: string; endpoint: string; version: string | null }[];
  x402Supported: boolean | null;
  isActive: boolean | null;
  reputationScore: number | null;
  feedbackCount: number | null;
  endpointStatus: string | null;
  endpointCheckedAt: string | null;
  indexedAt: string;
  refreshedAt: string;
};

/**
 * Lays 8004scan's indexed values over a catalog entry. A null field means
 * 8004scan published nothing for it, so the catalog's own value (or an explicit
 * "unavailable" metric) stands - never a filled-in guess.
 *
 * priceModel is deliberately untouched: 8004scan's agent payload carries no
 * price field of any kind (verified against a full raw response), so there is
 * nothing here to overlay. Leaving it alone is what stops a refresh from
 * regressing an agent to an unresolved price and re-breaking the hire button.
 */
function applyDirectory(agent: CatalogAgent, row: DirectoryRow): CatalogAgent {
  const asOf = row.indexedAt;

  const skillNames = new Set(agent.skills.map((s) => s.name.toLowerCase()));
  const skills = [...agent.skills];
  for (const tag of row.tags) {
    if (!skillNames.has(tag.toLowerCase())) {
      skillNames.add(tag.toLowerCase());
      skills.push({ name: tag, evidence: "registry-metadata" as never });
    }
  }

  return {
    ...agent,
    name: row.name ?? agent.name,
    description: row.description ?? agent.description,
    iconUrl: row.iconUrl ?? agent.iconUrl,
    publisher: row.publisher ?? agent.publisher,
    publisherAddress: row.ownerAddress ?? agent.publisherAddress,
    agentWallet: row.agentWallet ?? agent.agentWallet,
    registeredAt: row.registeredAt ?? agent.registeredAt,
    skills,
    services: row.services,
    x402Supported:
      row.x402Supported === null
        ? unavailableMetric(
            "8004scan did not return x402 support metadata.",
            AGENT_DATA_SOURCES.scan,
          )
        : (liveMetric(row.x402Supported, asOf, AGENT_DATA_SOURCES.scan) as never),
    isActive:
      row.isActive === null
        ? unavailableMetric(
            "8004scan did not return an active-state value.",
            AGENT_DATA_SOURCES.scan,
          )
        : (liveMetric(row.isActive, asOf, AGENT_DATA_SOURCES.scan) as never),
    // A score is only meaningful with at least one review behind it; an
    // average over zero feedbacks is not a rating, it is an artefact.
    reputationScore:
      row.reputationScore === null ||
      row.feedbackCount === null ||
      row.feedbackCount <= 0
        ? unavailableMetric(
            "No indexed ERC-8004 feedback is available for a reputation score.",
            AGENT_DATA_SOURCES.scan,
          )
        : (liveMetric(
            row.reputationScore,
            asOf,
            AGENT_DATA_SOURCES.scan,
            "Unfiltered 8004scan feedback aggregate. Review count and reviewer trust must be considered separately.",
          ) as never),
    feedbackCount:
      row.feedbackCount === null
        ? unavailableMetric(
            "8004scan did not return a feedback count.",
            AGENT_DATA_SOURCES.scan,
          )
        : (liveMetric(row.feedbackCount, asOf, AGENT_DATA_SOURCES.scan) as never),
    endpointStatus:
      row.endpointStatus === null
        ? unavailableMetric(
            "8004scan has not published a recent endpoint health check.",
            AGENT_DATA_SOURCES.scan,
          )
        : (liveMetric(
            row.endpointStatus,
            row.endpointCheckedAt ?? asOf,
            AGENT_DATA_SOURCES.scan,
            "Endpoint status checked by 8004scan; it is not an ERC-8004 capability guarantee.",
          ) as never),
    recordStatus: "indexed" as const,
  };
}

async function buildCatalog(ctx: {
  db: {
    query: (table: string) => {
      withIndex: (
        name: string,
        fn: (q: { eq: (k: string, val: unknown) => unknown }) => unknown,
      ) => { collect: () => Promise<unknown[]> };
    };
  };
}): Promise<CatalogAgent[]> {
  const asOf = new Date().toISOString();

  const discoveredRows = (await ctx.db
    .query("discoveredAgents")
    .withIndex("by_agent", (q) => q.eq("chainId", BSC_CHAIN_ID))
    .collect()) as Parameters<typeof buildDiscoveredAgent>[0][];

  const directoryRows = (await ctx.db
    .query("agentDirectory")
    .withIndex("by_agent", (q) => q.eq("chainId", BSC_CHAIN_ID))
    .collect()) as DirectoryRow[];

  const directory = new Map(directoryRows.map((row) => [row.tokenId, row]));

  const merged = mergeCatalog(
    EDITORIAL_AGENT_INPUTS.map((input) => buildEditorialAgent(input, asOf)),
    discoveredRows.map((row) => buildDiscoveredAgent(row, asOf)),
  );

  return merged.map((agent) => {
    const row = directory.get(agent.tokenId);
    return row ? applyDirectory(agent, row) : agent;
  });
}

/**
 * Every agent Dolphin lists, already curated, categorised, priced, deduped and
 * overlaid with 8004scan's indexed data. Both frontends render this as-is.
 */
export const listAgents = query({
  args: {},
  handler: async (ctx) => buildCatalog(ctx as never),
});

/**
 * One agent by tokenId, from exactly the same pipeline as listAgents, so a
 * detail page can never disagree with the card that linked to it. Accepts
 * either a bare tokenId or a full "56:<registry>:<tokenId>" agent id.
 */
export const getAgent = query({
  args: { reference: v.string() },
  handler: async (ctx, { reference }) => {
    const parts = reference.split(":");
    const tokenId = parts[parts.length - 1];
    const catalog = await buildCatalog(ctx as never);
    return catalog.find((agent) => agent.tokenId === tokenId) ?? null;
  },
});

/* ---------------------------------------------------------------------------
 * 8004scan refresh
 * ------------------------------------------------------------------------ */

const AGENT_DETAIL_URL = "https://api.8004scan.io/api/v1/agents";
const PER_REQUEST_TIMEOUT_MS = 15_000;

// Same key and same fallback as convex/discoveredAgents.ts - authenticated
// raises 8004scan's limit from 30/min to 600/min. Never EXPO_PUBLIC_/
// NEXT_PUBLIC_ prefixed: that would ship it in the client bundle.
function scan8004Headers(): HeadersInit {
  const apiKey = process.env.SCAN8004_API_KEY;
  return apiKey
    ? { Accept: "application/json", "X-API-Key": apiKey }
    : { Accept: "application/json" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function readBoolean(
  record: Record<string, unknown>,
  key: string,
): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readDate(record: Record<string, unknown>, key: string): string | null {
  const value = readString(record, key);
  return value !== null && Number.isFinite(Date.parse(value)) ? value : null;
}

function readHttpUrl(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = readString(record, key);
  if (value === null) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? value
      : null;
  } catch {
    return null;
  }
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const candidate = value.trim();
  if (candidate.length === 0) return value;
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return value;
  }
}

function readStringArray(
  record: Record<string, unknown>,
  key: string,
): string[] {
  const value = parseJsonValue(record[key]);
  if (typeof value === "string" && value.trim().length > 0) {
    return [value.trim()];
  }
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
}

function decodeServices(
  value: unknown,
): { name: string; endpoint: string; version: string | null }[] {
  const services: { name: string; endpoint: string; version: string | null }[] =
    [];
  const decoded = parseJsonValue(value);

  const append = (name: string, candidate: unknown) => {
    if (!isRecord(candidate)) return;
    const endpoint = readHttpUrl(candidate, "endpoint");
    if (endpoint === null) return;
    services.push({ name, endpoint, version: readString(candidate, "version") });
  };

  if (Array.isArray(decoded)) {
    for (const candidate of decoded) {
      if (!isRecord(candidate)) continue;
      append(readString(candidate, "name") ?? "Agent service", candidate);
    }
  } else if (isRecord(decoded)) {
    for (const [name, candidate] of Object.entries(decoded)) {
      append(name, candidate);
    }
  }

  return services;
}

/**
 * Refreshes 8004scan's indexed view of every agent Dolphin lists - the eight
 * curated token IDs plus whatever the discovery cron has found. One agent
 * failing (8004scan intermittently returns 500/502/524) just leaves that
 * agent's previous row in place; it never empties the table.
 */
export const refreshAgentDirectory = internalAction({
  args: {},
  handler: async (ctx): Promise<{
    refreshed: number;
    failed: number;
    tokenIds: number;
    errors: string[];
  }> => {
    const discovered: { tokenId: string }[] = await ctx.runQuery(
      internal.agents.listDiscoveredTokenIds,
      {},
    );
    const tokenIds = [
      ...new Set([
        ...EDITORIAL_TOKEN_IDS,
        ...discovered.map(({ tokenId }) => tokenId),
      ]),
    ];

    let refreshed = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const tokenId of tokenIds) {
      try {
        const response = await fetch(
          `${AGENT_DETAIL_URL}/${BSC_CHAIN_ID}/${encodeURIComponent(tokenId)}`,
          {
            headers: scan8004Headers(),
            signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS),
          },
        );

        if (!response.ok) {
          throw new Error(`8004scan returned ${response.status}`);
        }

        const payload = (await response.json()) as unknown;
        const data =
          isRecord(payload) && isRecord(payload.data) ? payload.data : payload;

        if (!isRecord(data)) {
          throw new Error("8004scan returned a non-object agent record");
        }

        const indexedAt = readDate(data, "updated_at") ?? new Date().toISOString();
        const health = isRecord(data.health_status) ? data.health_status : null;
        const overall = health ? readString(health, "overall_status") : null;
        const endpointStatus =
          overall === "healthy" ||
          overall === "degraded" ||
          overall === "unhealthy" ||
          overall === "unknown"
            ? overall
            : null;

        await ctx.runMutation(internal.agents.upsertAgentDirectory, {
          tokenId,
          name: readString(data, "name"),
          description: readString(data, "description"),
          iconUrl: readHttpUrl(data, "image_url"),
          publisher:
            readString(data, "owner_certified_name") ??
            readString(data, "owner_username") ??
            readString(data, "owner_ens"),
          ownerAddress: readString(data, "owner_address"),
          agentWallet: readString(data, "agent_wallet"),
          registeredAt: readDate(data, "created_at"),
          tags: [
            ...readStringArray(data, "supported_protocols"),
            ...readStringArray(data, "tags"),
          ],
          services: decodeServices(data.services),
          x402Supported: readBoolean(data, "x402_supported"),
          isActive: readBoolean(data, "is_active"),
          reputationScore: readNumber(data, "average_score"),
          feedbackCount: readNumber(data, "total_feedbacks"),
          endpointStatus,
          endpointCheckedAt: health ? readDate(health, "checked_at") : null,
          indexedAt,
          refreshedAt: new Date().toISOString(),
        });
        refreshed++;
      } catch (error) {
        failed++;
        errors.push(
          `${tokenId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return { refreshed, failed, tokenIds: tokenIds.length, errors };
  },
});

/** Public trigger for the same refresh, so it can be run by hand while testing. */
export const refreshAgentDirectoryNow = action({
  args: {},
  handler: async (ctx): Promise<{
    refreshed: number;
    failed: number;
    tokenIds: number;
    errors: string[];
  }> => ctx.runAction(internal.agents.refreshAgentDirectory, {}),
});

/** Internal: just the token IDs refreshAgentDirectory needs to iterate. */
export const listDiscoveredTokenIds = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("discoveredAgents")
      .withIndex("by_agent", (q) => q.eq("chainId", BSC_CHAIN_ID))
      .collect();
    return rows.map(({ tokenId }) => ({ tokenId }));
  },
});

export const upsertAgentDirectory = internalMutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agentDirectory")
      .withIndex("by_agent", (q) =>
        q.eq("chainId", BSC_CHAIN_ID).eq("tokenId", args.tokenId),
      )
      .unique();

    const document = { chainId: BSC_CHAIN_ID, ...args };

    if (existing) {
      await ctx.db.patch(existing._id, document);
    } else {
      await ctx.db.insert("agentDirectory", document);
    }
  },
});
