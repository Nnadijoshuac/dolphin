import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { apiBase, registrationUrl, siteBase } from "./builtAgents";
import { agentJson, readme, repoName, type RepoListing } from "./lib/agentRepo";
import type { Rule } from "./lib/strategy";

/**
 * A PUBLIC GITHUB REPOSITORY FOR EVERY REGISTERED AGENT (owner, 2026-10-04). Created when the
 * registration confirms, and refreshed whenever `publish` runs again (same name, files updated).
 *
 * Needs two deployment variables, set by the owner - never pasted anywhere else:
 *   GITHUB_AGENTS_TOKEN  a fine-grained token allowed to create and write repositories for the owner below
 *   GITHUB_AGENTS_OWNER  the GitHub organisation or user the repositories are created under
 * Without them nothing is sent, and the listing records why (repoError).
 */

const GITHUB = "https://api.github.com";

type Ghr = { status: number; body: unknown };

async function gh(token: string, method: string, path: string, body?: unknown): Promise<Ghr> {
  const response = await fetch(`${GITHUB}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "dolphin-agent-repos",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text.slice(0, 300);
  }
  return { status: response.status, body: parsed };
}

function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export const listingForRepo = internalQuery({
  args: { hash: v.string() },
  handler: async (ctx, { hash }) => {
    const listing = await ctx.db
      .query("builtAgents")
      .withIndex("by_hash", (q) => q.eq("hash", hash))
      .unique();
    if (!listing) return null;
    const draft = await ctx.db.get(listing.draftId);
    return { listing, rules: ((draft?.rules ?? []) as Rule[]).filter((rule) => rule && typeof rule.id === "string") };
  },
});

export const recordRepo = internalMutation({
  args: { hash: v.string(), repoUrl: v.union(v.string(), v.null()), repoError: v.union(v.string(), v.null()) },
  handler: async (ctx, { hash, repoUrl, repoError }) => {
    const row = await ctx.db
      .query("builtAgents")
      .withIndex("by_hash", (q) => q.eq("hash", hash))
      .unique();
    if (!row) return;
    await ctx.db.patch(row._id, { ...(repoUrl ? { repoUrl } : {}), repoError: repoError ?? undefined, repoSyncedAt: Date.now() });
  },
});

export const registeredHashes = internalQuery({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("builtAgents").collect()).filter((row) => row.status === "registered" && row.tokenId).map((row) => row.hash),
});

/** Creates the agent's public repository if it is not there yet, then writes README.md and agent.json. */
export const publish = internalAction({
  args: { hash: v.string() },
  handler: async (ctx, { hash }): Promise<{ repoUrl: string | null; error: string | null }> => {
    const found: { listing: Doc<"builtAgents">; rules: Rule[] } | null = await ctx.runQuery(internal.agentRepos.listingForRepo, { hash });
    if (!found || found.listing.status !== "registered" || !found.listing.tokenId || !found.listing.agentKey) {
      return { repoUrl: null, error: "not registered yet" };
    }
    const token = process.env.GITHUB_AGENTS_TOKEN;
    const owner = process.env.GITHUB_AGENTS_OWNER;
    const fail = async (error: string) => {
      await ctx.runMutation(internal.agentRepos.recordRepo, { hash, repoUrl: null, repoError: error });
      return { repoUrl: null, error };
    };
    if (!token || !owner) return fail("GitHub is not connected yet (GITHUB_AGENTS_TOKEN / GITHUB_AGENTS_OWNER).");

    const l = found.listing;
    const listing: RepoListing = {
      hash: l.hash,
      name: l.name,
      description: l.description,
      instructions: l.instructions,
      category: l.category,
      protocol: l.protocol ?? "mcp",
      priceRaw: l.priceRaw ?? null,
      chainId: l.chainId,
      registry: l.registry,
      tokenId: l.tokenId!,
      agentKey: l.agentKey!,
      ownerAddress: l.ownerAddress,
      registerTxHash: l.registerTxHash,
      registeredAt: l.registeredAt,
      blocks: (l.blocks ?? []).map(({ type, config }) => ({ type, config })),
      tools: l.tools.map(({ agentName, toolName }) => ({ agentName, toolName })),
    };
    const context = {
      registrationUrl: registrationUrl(l.hash),
      agentPageUrl: `${siteBase()}/agent/${l.tokenId}`,
      // Where a caller connects, as builtAgents.ts publishes it: the A2A agent card, or the MCP server.
      mcpUrl: listing.protocol === "a2a" ? `${apiBase()}/api/v1/built/${l.hash}/agent-card.json` : `${apiBase()}/api/v1/built/${l.hash}/mcp`,
    };
    const name = repoName(listing);

    let repo = await gh(token, "GET", `/repos/${owner}/${name}`);
    if (repo.status === 404) {
      const isOrg = (await gh(token, "GET", `/orgs/${owner}`)).status === 200;
      repo = await gh(token, "POST", isOrg ? `/orgs/${owner}/repos` : "/user/repos", {
        name,
        description: `${l.name} - ERC-8004 agent #${l.tokenId} on BNB Smart Chain (${l.chainId}). Built on Dolphin.`.slice(0, 350),
        homepage: context.agentPageUrl,
        private: false,
        has_issues: false,
        has_wiki: false,
        auto_init: false,
      });
      if (repo.status !== 201) return fail(`GitHub refused to create the repository (${repo.status}).`);
      await gh(token, "PUT", `/repos/${owner}/${name}/topics`, { names: ["erc-8004", "bnb-chain", "ai-agent", "dolphin-agent", l.category.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 35)] });
    } else if (repo.status !== 200) {
      return fail(`GitHub did not answer as expected (${repo.status}).`);
    }

    const files: [string, string][] = [
      ["README.md", readme(listing, found.rules, context)],
      ["agent.json", agentJson(listing, found.rules, context)],
    ];
    for (const [path, content] of files) {
      const existing = await gh(token, "GET", `/repos/${owner}/${name}/contents/${path}`);
      const sha = existing.status === 200 ? (existing.body as { sha?: string }).sha : undefined;
      const encoded = base64(content);
      if (sha && (existing.body as { content?: string }).content?.replace(/\n/g, "") === encoded) continue;
      const put = await gh(token, "PUT", `/repos/${owner}/${name}/contents/${path}`, {
        message: sha ? `Update ${path}` : `Add ${path}`,
        content: encoded,
        ...(sha ? { sha } : {}),
      });
      if (put.status !== 200 && put.status !== 201) return fail(`GitHub refused ${path} (${put.status}).`);
    }
    const repoUrl = `https://github.com/${owner}/${name}`;
    await ctx.runMutation(internal.agentRepos.recordRepo, { hash, repoUrl, repoError: null });
    return { repoUrl, error: null };
  },
});

/** Every registered agent, one after another - for agents registered before this existed, and after a token is first set. */
export const publishAll = internalAction({
  args: {},
  handler: async (ctx): Promise<{ done: number; failed: string[] }> => {
    const hashes: string[] = await ctx.runQuery(internal.agentRepos.registeredHashes, {});
    const failed: string[] = [];
    let done = 0;
    for (const hash of hashes) {
      const result: { repoUrl: string | null; error: string | null } = await ctx.runAction(internal.agentRepos.publish, { hash });
      if (result.repoUrl) done++;
      else failed.push(`${hash.slice(0, 8)}: ${result.error}`);
    }
    return { done, failed };
  },
});
