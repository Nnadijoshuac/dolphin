import { v } from "convex/values";

import { query } from "./_generated/server";
import { BSC_CHAIN_ID } from "./lib/bscClient";

/**
 * The numbers that say whether an agent is worth hiring: how many people hired
 * it, and what they said afterwards.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE, AND WHY TOGETHER
 * ---------------------------------------------------------------------------
 * Listing is gated on whether an agent CAN perform a task (convex/agents.ts's
 * sellability gate). Nothing about that gate says whether it performs the task
 * WELL, and it deliberately does not try: a bad agent that really does the work
 * belongs in the catalog with a bad review attached. That is the mechanism
 * working.
 *
 * So the catalog needs the other half - the evidence a person uses to choose
 * between two listed agents:
 *
 *   hires            how many wallets paid for this at all
 *   still active     how many kept it rather than stopping
 *   reviews          how many said whether it did what it said
 *   would hire again the single most predictive thing a reviewer tells you
 *
 * Together in one query because they are read together, by a list. The agent
 * detail page could afford four separate queries; a Discover screen rendering
 * thirty rows cannot, and the version of this that fired one query per row is
 * exactly the kind of thing that looks fine at 30 agents and falls over at 300.
 *
 * ---------------------------------------------------------------------------
 * SMALL NUMBERS STAY NUMBERS
 * ---------------------------------------------------------------------------
 * Same rule as convex/agentRetention.ts and convex/agentReviews.ts, applied
 * here for the same reason: a rate over one or two data points is arithmetic
 * that creates a false impression. Below MIN_DENOMINATOR the rate is null and
 * the caller must render the counts. There is no threshold on the counts
 * themselves - "3 hires" is honest at any size.
 */

const MIN_DENOMINATOR = 5;

const signalsValidator = v.object({
  tokenId: v.string(),
  /** Every wallet that has ever hired this agent, cancelled or not. */
  hires: v.number(),
  activeHires: v.number(),
  /** Hires that went through an ERC-8183 escrow rather than being free. */
  paidHires: v.number(),
  reviews: v.number(),
  wouldHireAgain: v.number(),
  /** Null below MIN_DENOMINATOR - the caller renders counts instead. */
  wouldHireAgainRate: v.union(v.number(), v.null()),
  /** Reviews saying it did what it said, of those left. */
  deliveredCount: v.number(),
});

/**
 * Signals for every agent that has any, in one read.
 *
 * Returns a sparse list rather than one entry per catalog agent: an agent
 * nobody has hired has nothing to report, and the caller renders that as "no
 * hires yet" rather than as a row of zeroes it has to special-case anyway.
 */
export const getCatalogSignals = query({
  args: {},
  returns: v.array(signalsValidator),
  handler: async (ctx) => {
    const hires = await ctx.db
      .query("agentHires")
      .withIndex("by_agent_wallet", (q) => q.eq("chainId", BSC_CHAIN_ID))
      .collect();

    const reviews = await ctx.db
      .query("agentReviews")
      .withIndex("by_agent", (q) => q.eq("chainId", BSC_CHAIN_ID))
      .collect();

    const byToken = new Map<
      string,
      {
        hires: number;
        activeHires: number;
        paidHires: number;
        reviews: number;
        wouldHireAgain: number;
        deliveredCount: number;
      }
    >();

    const bucket = (tokenId: string) => {
      const existing = byToken.get(tokenId);
      if (existing) return existing;
      const created = {
        hires: 0,
        activeHires: 0,
        paidHires: 0,
        reviews: 0,
        wouldHireAgain: 0,
        deliveredCount: 0,
      };
      byToken.set(tokenId, created);
      return created;
    };

    for (const hire of hires) {
      const entry = bucket(hire.tokenId);
      entry.hires += 1;
      if (hire.status === "active") entry.activeHires += 1;
      if (hire.paymentJobId) entry.paidHires += 1;
    }

    for (const review of reviews) {
      const entry = bucket(review.tokenId);
      entry.reviews += 1;
      if (review.wouldHireAgain) entry.wouldHireAgain += 1;
      if (review.outcome === "yes") entry.deliveredCount += 1;
    }

    return [...byToken.entries()].map(([tokenId, entry]) => ({
      tokenId,
      ...entry,
      wouldHireAgainRate:
        entry.reviews >= MIN_DENOMINATOR
          ? entry.wouldHireAgain / entry.reviews
          : null,
    }));
  },
});
