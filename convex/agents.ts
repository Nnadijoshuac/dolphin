/**
 * THE READ PATH. Everything the marketplace frontends call.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS REPLACES, AND WHY IT HAD TO
 * ---------------------------------------------------------------------------
 * The previous `listAgents` took no arguments and returned THE ENTIRE CATALOG.
 * It collected `discoveredAgents`, rebuilt a full Agent object for every row,
 * merged nine hardcoded editorial agents, then performed one indexed lookup
 * plus one `await ctx.storage.getUrl()` per agent, serially. Both frontends
 * then filtered by category and searched in JavaScript over the whole result.
 *
 * That design had already taken the site down once: on 2026-09-02 an earlier
 * version collected the whole `agentDirectory` and crossed Convex's
 * read-per-execution limit, so `listAgents` threw for every caller and both
 * frontends rendered an empty catalog against a perfectly healthy deployment.
 *
 * There is no version of it that scales, because a Convex QUERY HAS A ONE
 * SECOND EXECUTION LIMIT and a serial `storage.getUrl` per agent crosses it
 * somewhere in the low hundreds. The brief targets thousands.
 *
 * So: everything here is indexed, paginated, and bounded by page size rather
 * than by catalog size.
 *
 *   list      by_status_category_rank / by_status_rank, cursor-paginated
 *   search    a Convex search index, cursor-paginated, relevance-ordered
 *   get       a point lookup on by_key
 *   signals   batched by key - never one query per rendered row
 *
 * ---------------------------------------------------------------------------
 * LiveMetric IS CONSTRUCTED HERE, NOT STORED
 * ---------------------------------------------------------------------------
 * The old schema stored every field as a `LiveMetric<T>` - a value plus a
 * status, a timestamp, a source label and a methodology sentence. The label and
 * the sentence are CONSTANT per field, so storing them multiplied every
 * document by their combined size for no gain. They are presentation, and they
 * are added on the way out.
 */

import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import { query } from "./_generated/server";
import { toPublicAgent } from "./lib/publicAgent";
import { coerceAgentKey } from "./model/agent";


/* ---------------------------------------------------------------------------
 * LIST
 * ------------------------------------------------------------------------ */

/**
 * The catalog, paginated.
 *
 * `category` narrows to one drawer via `by_status_category_rank`; without it,
 * `by_status_rank` walks everything. Both are index ranges, so cost is the page
 * size and nothing else.
 *
 * ORDERED BY `rank` DESCENDING, and `rank` is a STORED field for exactly this
 * reason. An ordering computed at read time can change between page one and
 * page two, which shows the reader one agent twice and hides another entirely.
 *
 * `status` is pinned to "live" and "degraded" is deliberately excluded from the
 * default browse - a degraded agent is one Dolphin currently cannot reach, and
 * the catalog is a shop. It remains reachable by direct link through `get`.
 */
export const list = query({
  args: {
    category: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { category, paginationOpts }) => {
    const page = category
      ? await ctx.db
          .query("agents")
          .withIndex("by_status_category_rank", (q) =>
            q.eq("status", "live").eq("categorySlug", category),
          )
          .order("desc")
          .paginate(paginationOpts)
      : await ctx.db
          .query("agents")
          .withIndex("by_status_rank", (q) => q.eq("status", "live"))
          .order("desc")
          .paginate(paginationOpts);

    return { ...page, page: page.page.map(toPublicAgent) };
  },
});

/**
 * Server-side search, paginated.
 *
 * Replaces `searchAgentsLocally`, which shipped the entire catalog to the
 * device and filtered it there - workable at 30 agents, impossible at 3,000,
 * and the reason the app had to load everything before it could show anything.
 *
 * Convex's search index tokenizes on whitespace and punctuation, lowercases,
 * and prefix-matches the final term, so "reba" finds "rebalancing". Relevance
 * ordering is the index's own and cannot be combined with `rank` - which is
 * correct for a search box, where what the user typed should outrank shelf
 * position.
 */
export const search = query({
  args: {
    text: v.string(),
    category: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { text, category, paginationOpts }) => {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      // An empty search is a browse, not a search over an empty string.
      const page = await ctx.db
        .query("agents")
        .withIndex("by_status_rank", (q) => q.eq("status", "live"))
        .order("desc")
        .paginate(paginationOpts);
      return { ...page, page: page.page.map(toPublicAgent) };
    }

    const page = await ctx.db
      .query("agents")
      .withSearchIndex("search_text", (q) => {
        const base = q.search("searchText", trimmed).eq("status", "live");
        return category ? base.eq("categorySlug", category) : base;
      })
      .paginate(paginationOpts);

    return { ...page, page: page.page.map(toPublicAgent) };
  },
});

/* ---------------------------------------------------------------------------
 * GET
 * ------------------------------------------------------------------------ */

/**
 * One agent, by key or by bare tokenId.
 *
 * DELIBERATELY NOT GATED ON STATUS. Someone holding a link, or a hire they
 * already paid for, must still be able to open the page - and the page itself
 * says whether the agent can be hired right now. Hiding the record would make
 * an existing hire unreadable, which is a worse failure than showing an agent
 * nobody can currently buy from.
 *
 * It also accepts a bare tokenId, because every deep link that exists today is
 * one. See `coerceAgentKey` for why that is a read-path convenience only.
 */
export const get = query({
  args: { reference: v.string() },
  handler: async (ctx, { reference }) => {
    const agentKey = coerceAgentKey(reference);
    if (!agentKey) return null;

    const row = await ctx.db
      .query("agents")
      .withIndex("by_key", (q) => q.eq("agentKey", agentKey))
      .unique();
    if (!row) return null;

    // The probe's own words about this agent, so a detail page can say WHY an
    // agent is degraded rather than just that it is.
    const verification = await ctx.db
      .query("agentVerification")
      .withIndex("by_key", (q) => q.eq("agentKey", agentKey))
      .unique();

    return {
      ...toPublicAgent(row),
      verification: verification
        ? {
            state: verification.state,
            detail: verification.detail,
            lastProbeAt: verification.lastProbeAt,
            lastOkAt: verification.lastOkAt,
            consecutiveFailures: verification.consecutiveFailures,
          }
        : null,
    };
  },
});

/* ---------------------------------------------------------------------------
 * SIGNALS
 * ------------------------------------------------------------------------ */

/**
 * A rate over one or two data points is arithmetic that creates a false
 * impression. Below this the rate is null and the caller renders the counts -
 * "3 hires" is honest at any size.
 */
const MIN_DENOMINATOR = 5;

/**
 * Hire and review counts for a SPECIFIC set of agents.
 *
 * TAKES THE KEYS IT NEEDS, rather than reading every hire and review in the
 * database and bucketing them, which is what `getCatalogSignals` did. That was
 * fine at four hires and is a full scan of two growing tables - a page of 25
 * agents should cost a bounded number of indexed reads, not a walk over every
 * hire Dolphin has ever recorded.
 *
 * Returns a sparse list: an agent nobody has hired has nothing to report, and
 * the caller renders that as "no hires yet" rather than a row of zeroes it has
 * to special-case anyway.
 */
export const signals = query({
  args: { agentKeys: v.array(v.string()) },
  handler: async (ctx, { agentKeys }) => {
    // Bounded so a caller cannot ask for the whole catalog in one query.
    const keys = [...new Set(agentKeys)].slice(0, 100);
    const results: {
      agentKey: string;
      hires: number;
      activeHires: number;
      paidHires: number;
      reviews: number;
      wouldHireAgain: number;
      wouldHireAgainRate: number | null;
      deliveredCount: number;
    }[] = [];

    for (const agentKey of keys) {
      const hires = await ctx.db
        .query("agentHires")
        .withIndex("by_agent", (q) => q.eq("agentKey", agentKey))
        .take(500);
      const reviews = await ctx.db
        .query("agentReviews")
        .withIndex("by_agent", (q) => q.eq("agentKey", agentKey))
        .take(500);

      if (hires.length === 0 && reviews.length === 0) continue;

      let activeHires = 0;
      let paidHires = 0;
      for (const hire of hires) {
        if (hire.status === "active") activeHires++;
        if (hire.paymentJobId) paidHires++;
      }

      let wouldHireAgain = 0;
      let deliveredCount = 0;
      for (const review of reviews) {
        if (review.wouldHireAgain) wouldHireAgain++;
        if (review.outcome === "yes") deliveredCount++;
      }

      results.push({
        agentKey,
        hires: hires.length,
        activeHires,
        paidHires,
        reviews: reviews.length,
        wouldHireAgain,
        wouldHireAgainRate:
          reviews.length >= MIN_DENOMINATOR ? wouldHireAgain / reviews.length : null,
        deliveredCount,
      });
    }

    return results;
  },
});
