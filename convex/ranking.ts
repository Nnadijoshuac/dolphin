/**
 * RANKING: folds wallet-backed usage into `rank`, on a schedule.
 *
 * Runs from crons.ts, never at read time - `rank` is a stored sort key so that
 * paginated browsing cannot show one agent twice (see lib/rank.ts). What each
 * term means and why it is shaped the way it is lives in lib/usageRank.ts.
 *
 * Writes only when an agent's usage term actually changed, so an hour in which
 * nobody hired anything costs reads and zero writes - every write to `agents`
 * invalidates the list queries the whole site subscribes to.
 */

import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  computeUsageRank,
  excludedWallets,
  FREE_REVIEW_WEIGHT,
  parseTeamWallets,
} from "./lib/usageRank";

/** Bounds on one run. Far above today's catalog; past them, split the job. */
const MAX_AGENTS = 1000;
const MAX_ROWS_PER_AGENT = 1000;

/** The curation term, as setCurated and applyVerification apply it. */
const CURATED_BONUS = 300;

export const recomputeUsage = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ agents: number; changed: number }> => {
    const teamWallets = parseTeamWallets(process.env.DOLPHIN_TEAM_WALLETS);
    const now = new Date().toISOString();

    const agents: Doc<"agents">[] = [];
    for (const status of ["live", "degraded"] as const) {
      agents.push(
        ...(await ctx.db
          .query("agents")
          .withIndex("by_status_rank", (q) => q.eq("status", status))
          .take(MAX_AGENTS)),
      );
    }

    let changed = 0;
    for (const agent of agents) {
      const excluded = excludedWallets(agent, teamWallets);
      const counts = (address: string | null | undefined) =>
        !!address && !excluded.has(address.toLowerCase());

      const hires = await ctx.db
        .query("agentHires")
        .withIndex("by_agent", (q) => q.eq("agentKey", agent.agentKey))
        .take(MAX_ROWS_PER_AGENT);
      const hirers = new Set<string>();
      const paidHirers = new Set<string>();
      const retainedHirers = new Set<string>();
      for (const hire of hires) {
        if (!counts(hire.walletAddress)) continue;
        const wallet = hire.walletAddress.toLowerCase();
        hirers.add(wallet);
        if (hire.paymentJobId) {
          paidHirers.add(wallet);
          if (hire.status === "active") retainedHirers.add(wallet);
        }
      }

      const jobs = await ctx.db
        .query("agentJobs")
        .withIndex("by_agent_wallet", (q) => q.eq("agentKey", agent.agentKey))
        .take(MAX_ROWS_PER_AGENT);
      const completed = new Set<string>();
      for (const job of jobs) {
        if (job.jobStatus !== "COMPLETED") continue;
        // Either wallet of the pair being excluded excludes the job.
        if (!counts(job.altanaWalletAddress)) continue;
        if (job.hirerWalletAddress && !counts(job.hirerWalletAddress)) continue;
        completed.add((job.hirerWalletAddress ?? job.altanaWalletAddress).toLowerCase());
      }

      const reviews = await ctx.db
        .query("agentReviews")
        .withIndex("by_agent", (q) => q.eq("agentKey", agent.agentKey))
        .take(MAX_ROWS_PER_AGENT);
      let reviewWeight = 0;
      let wouldHireAgainWeight = 0;
      let deliveredWeight = 0;
      let reviewCount = 0;
      for (const review of reviews) {
        if (!counts(review.walletAddress)) continue;
        const weight = review.paidJobId ? 1 : FREE_REVIEW_WEIGHT;
        reviewCount++;
        reviewWeight += weight;
        if (review.wouldHireAgain) wouldHireAgainWeight += weight;
        deliveredWeight +=
          weight * (review.outcome === "yes" ? 1 : review.outcome === "partially" ? 0.5 : 0);
      }

      const usageRank = computeUsageRank({
        hirers: hirers.size,
        paidHirers: paidHirers.size,
        retainedPaidHirers: retainedHirers.size,
        completedJobs: completed.size,
        reviewWeight,
        wouldHireAgainWeight,
        deliveredWeight,
      });

      if (usageRank === (agent.usageRank ?? 0) && agent.usage) continue;

      // Rows written before baseRank existed: recover it from what rank holds.
      const curationTerm = agent.curated ? CURATED_BONUS : 0;
      const baseRank = agent.baseRank ?? agent.rank - curationTerm - (agent.usageRank ?? 0);
      await ctx.db.patch(agent._id, {
        baseRank,
        usageRank,
        rank: Math.max(0, baseRank + curationTerm + usageRank),
        usage: {
          hirers: hirers.size,
          paidHirers: paidHirers.size,
          retainedHirers: retainedHirers.size,
          completedJobs: completed.size,
          reviews: reviewCount,
          computedAt: now,
        },
      });
      changed++;
    }

    // Which registration of a duplicated product is listed follows rank, so the
    // dedupe pass runs after every ranking run. Shelves order by rank too. Both
    // compare before writing, so an unchanged hour writes nothing.
    await ctx.scheduler.runAfter(0, internal.catalogQuality.dedupe, {});
    await ctx.scheduler.runAfter(0, internal.shelves.rebuild, {});

    return { agents: agents.length, changed };
  },
});
