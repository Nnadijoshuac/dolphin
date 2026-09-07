/**
 * THE BROWSE CHIPS, computed from the catalog rather than hardcoded.
 *
 * `agents.categorySlug` is an open string, so the set of categories that exist
 * is a property of the data. This recomputes it into one document that the
 * frontend reads with a single query.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS AN ACTION THAT PAGES, NOT A QUERY THAT COUNTS
 * ---------------------------------------------------------------------------
 * Counting per category means visiting every live row. A query that
 * `.collect()`s the catalog works at 30 agents and fails at a few thousand:
 * Convex caps one function execution at 16 MiB of reads and 32,000 scanned
 * documents, and a catalog row is on the order of a kilobyte. That is exactly
 * the failure that took the site down on 2026-09-02, when `listAgents`
 * collected a 5,400-row table and blew the read limit for every caller.
 *
 * So the walk is an action over paginated internal queries, each of which
 * touches a bounded page. It runs on a schedule and after a membership change,
 * never on a read - the frontend reads the stored answer.
 */

import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { categoryLabel } from "./lib/categorize";

const FACETS_KEY = "bsc";
const PAGE_SIZE = 500;

export const countPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("agents")
      .withIndex("by_status_rank", (q) => q.eq("status", "live"))
      .paginate({ cursor, numItems: PAGE_SIZE });

    const counts: Record<string, number> = {};
    for (const row of page.page) {
      counts[row.categorySlug] = (counts[row.categorySlug] ?? 0) + 1;
    }

    return {
      counts,
      total: page.page.length,
      cursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

export const recompute = internalAction({
  args: {},
  handler: async (ctx): Promise<{ totalLive: number; categories: number }> => {
    const totals: Record<string, number> = {};
    let totalLive = 0;
    let cursor: string | null = null;

    for (;;) {
      const page: {
        counts: Record<string, number>;
        total: number;
        cursor: string;
        isDone: boolean;
      } = await ctx.runQuery(internal.facets.countPage, { cursor });

      for (const [slug, count] of Object.entries(page.counts)) {
        totals[slug] = (totals[slug] ?? 0) + count;
      }
      totalLive += page.total;

      if (page.isDone) break;
      cursor = page.cursor;
    }

    const categories = Object.entries(totals)
      .map(([slug, count]) => ({ slug, label: categoryLabel(slug), count }))
      // Biggest first: the chip row should lead with where the agents actually
      // are, not with an alphabetical accident.
      .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug));

    await ctx.runMutation(internal.facets.write, { categories, totalLive });
    return { totalLive, categories: categories.length };
  },
});

export const write = internalMutation({
  args: {
    categories: v.array(
      v.object({ slug: v.string(), label: v.string(), count: v.number() }),
    ),
    totalLive: v.number(),
  },
  handler: async (ctx, { categories, totalLive }) => {
    const existing = await ctx.db
      .query("catalogFacets")
      .withIndex("by_key", (q) => q.eq("key", FACETS_KEY))
      .unique();
    const document = { categories, totalLive, updatedAt: new Date().toISOString() };

    if (existing) {
      // Same guard as the catalog upsert: this document is subscribed to by
      // every screen that renders a chip row, so an unchanged recompute must
      // not invalidate it.
      const unchanged =
        existing.totalLive === totalLive &&
        JSON.stringify(existing.categories) === JSON.stringify(categories);
      if (unchanged) return;
      await ctx.db.patch(existing._id, document);
      return;
    }
    await ctx.db.insert("catalogFacets", { key: FACETS_KEY, ...document });
  },
});

/**
 * The chip row, as data. One document read.
 *
 * Returns an empty list rather than a default set when nothing has been
 * computed yet: a category chip that leads to zero agents is a dead end, and
 * inventing one before the catalog has any agents in it would be exactly that.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("catalogFacets")
      .withIndex("by_key", (q) => q.eq("key", FACETS_KEY))
      .unique();
    return {
      categories: row?.categories ?? [],
      totalLive: row?.totalLive ?? 0,
      updatedAt: row?.updatedAt ?? null,
    };
  },
});
