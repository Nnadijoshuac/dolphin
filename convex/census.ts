import { v } from "convex/values";

import { query } from "./_generated/server";

/**
 * THE CENSUS — the one number nobody else on BNB Chain has.
 *
 * ===========================================================================
 * WHY THIS QUERY EXISTS
 * ===========================================================================
 * Dolphin has been presenting its catalog as "43 agents", which reads as an
 * EMPTY STORE. A marketplace with 43 items is a negative signal and no amount
 * of design fixes that.
 *
 * The same data said the other way round is a finding: Dolphin has walked the
 * whole ERC-8004 registry, called every identity that published an endpoint,
 * and recorded which ones answer. 43 is not the size of a shop — it is *the
 * number of live agents that exist*, which is a claim only the thing that did
 * the counting can make.
 *
 * Same rows, inverted valence, no new backend work. This query exists to make
 * that framing available to the public site.
 *
 * ===========================================================================
 * WHY NOT REUSE admin.getOverview
 * ===========================================================================
 * Two reasons, and the second is the important one.
 *
 * It returns up to 100 agent records, 20 degraded records, 20 sessions, 20
 * conversations and the full verification matrix — hundreds of documents to
 * render three numbers on a landing page.
 *
 * And it is an ungated `query`, so every one of those documents is already
 * readable by anyone who knows the function name. Pointing the public site at
 * it would make that dependency deliberate rather than accidental, and it
 * should stay accidental until somebody decides what belongs behind auth. This
 * query returns four integers and a timestamp and nothing else, so there is
 * nothing here that is not already on the marketing page.
 * ===========================================================================
 */

/*
 * "bsc", matching convex/discovery.ts and convex/admin.ts.
 *
 * Worth stating rather than inlining: I first wrote "singleton" here, which is
 * a perfectly reasonable guess for a one-row table and is WRONG. The query
 * returned assessed: 0 — a silent zero, not an error, because `.unique()` on a
 * key nobody uses legitimately finds nothing. The marquee then correctly
 * refused to render, so the failure looked exactly like "discovery has never
 * run" rather than like a typo.
 *
 * Both facets and the cursor key off the same constant in their own modules.
 * If a second chain is ever indexed this becomes a parameter, and this comment
 * is the reminder that three files would need to agree.
 */
const CURSOR_KEY = "bsc";

export const funnel = query({
  args: {},
  returns: v.object({
    /**
     * Registry identities Dolphin has looked at.
     *
     * `seenTotal` — the count actually walked — rather than `registryTotal`,
     * which is 8004scan's own report of how large the registry is. The claim
     * on the site has to be "we assessed this many", and only one of those two
     * numbers supports it.
     */
    assessed: v.number(),
    /** Those that published an endpoint worth calling. */
    candidates: v.number(),
    /** Those that answered a probe and are in the catalog now. */
    live: v.number(),
    /**
     * Distinct publishers behind the live agents.
     *
     * Included because the headline count does NOT imply supplier diversity
     * and has been read as though it does: the live catalog is concentrated in
     * a handful of publisher suites. Stating both numbers together is the
     * honest version of the claim, and it costs one line.
     */
    publishers: v.number(),
    /** When discovery last ran, so a stale census can say so. */
    lastRunAt: v.union(v.string(), v.null()),
  }),
  handler: async (ctx) => {
    const cursor = await ctx.db
      .query("discoveryCursor")
      .withIndex("by_key", (q) => q.eq("key", CURSOR_KEY))
      .unique();

    const facets = await ctx.db
      .query("catalogFacets")
      .withIndex("by_key", (q) => q.eq("key", CURSOR_KEY))
      .unique();

    /*
     * Publishers are counted from the live agents themselves rather than
     * stored, because there is no facet for it and one pass over ~43 indexed
     * rows is cheaper than a new denormalised counter that can drift.
     *
     * `.take(500)` rather than `.collect()`: the catalog is 43 today and this
     * is a public endpoint. A bound that is an order of magnitude above the
     * real figure keeps a future catalog growth from turning a landing-page
     * query into a full table scan.
     */
    const live = await ctx.db
      .query("agents")
      .withIndex("by_status_rank", (q) => q.eq("status", "live"))
      .take(500);

    /*
     * Keyed on `ownerAddress`, not on the `publisher` NAME.
     *
     * `publisher` is "a human-readable publisher name when the indexer has
     * one" — nullable, and null for part of this catalog. Counting distinct
     * names would silently drop every agent whose publisher the indexer could
     * not name, which under-reports concentration in exactly the direction
     * that flatters us. `ownerAddress` is required on the table and is the
     * registering identity, so it is present for every row.
     */
    const publishers = new Set<string>();
    for (const agent of live) {
      const owner = agent.ownerAddress.trim().toLowerCase();
      if (owner) publishers.add(owner);
    }

    return {
      assessed: cursor?.seenTotal ?? 0,
      candidates: cursor?.candidatesFound ?? 0,
      live: facets?.totalLive ?? live.length,
      publishers: publishers.size,
      lastRunAt: cursor?.lastRunAt ?? null,
    };
  },
});
