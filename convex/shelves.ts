/**
 * Discover's shelves: rebuilt on a schedule, read in one document.
 * What goes on a shelf and why lives in convex/lib/shelves.ts.
 */

import { internalMutation, query } from "./_generated/server";
import { buildShelves, MIN_SHELF } from "./lib/shelves";
import { toPublicAgent } from "./lib/publicAgent";

const SHELVES_KEY = "discover";
const MAX_CANDIDATES = 1000;

export const rebuild = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ shelves: number }> => {
    const live = await ctx.db
      .query("agents")
      .withIndex("by_status_rank", (q) => q.eq("status", "live"))
      .order("desc")
      .take(MAX_CANDIDATES);

    const shelves = buildShelves(
      live.map((row) => ({
        agentKey: row.agentKey,
        name: row.name,
        description: row.description,
        ownerAddress: row.ownerAddress,
        categorySlug: row.categorySlug,
        protocol: row.protocol,
        rank: row.rank,
        publishedAt: row.publishedAt,
        hasPrice: row.pricing !== null,
        hirers: row.usage?.hirers ?? 0,
        paidHirers: row.usage?.paidHirers ?? 0,
      })),
    );

    const existing = await ctx.db
      .query("catalogShelves")
      .withIndex("by_key", (q) => q.eq("key", SHELVES_KEY))
      .unique();
    // Compare before writing: Discover subscribes to this row.
    if (existing && JSON.stringify(existing.shelves) === JSON.stringify(shelves)) {
      return { shelves: shelves.length };
    }
    const row = { key: SHELVES_KEY, shelves, updatedAt: new Date().toISOString() };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("catalogShelves", row);
    return { shelves: shelves.length };
  },
});

/**
 * The shelves with their agents resolved. An agent delisted since the last
 * rebuild is dropped here, and a shelf left thinner than MIN_SHELF by that is
 * dropped with it - the same bar the rebuild applies.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const doc = await ctx.db
      .query("catalogShelves")
      .withIndex("by_key", (q) => q.eq("key", SHELVES_KEY))
      .unique();
    if (!doc) return { shelves: [], updatedAt: null };

    const shelves = [];
    for (const shelf of doc.shelves) {
      const agents = [];
      for (const agentKey of shelf.agentKeys) {
        const row = await ctx.db
          .query("agents")
          .withIndex("by_key", (q) => q.eq("agentKey", agentKey))
          .unique();
        if (row && row.status === "live") agents.push(toPublicAgent(row));
      }
      if (agents.length >= MIN_SHELF) {
        shelves.push({
          id: shelf.id,
          title: shelf.title,
          subtitle: shelf.subtitle,
          href: shelf.href,
          agents,
        });
      }
    }
    return { shelves, updatedAt: doc.updatedAt };
  },
});
