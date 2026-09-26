/**
 * Collapses duplicate registrations to one listing. Rule: convex/lib/dedupe.ts.
 *
 * Runs hourly from ranking.recomputeUsage (the winner of a group is its
 * highest-ranked member, and rank moves with usage) and after a new agent is
 * listed. Considers `live` and `duplicate` rows together, so when a group's
 * winner stops answering and drops out, the next registration is promoted
 * back to `live` on the following run.
 */

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { findDuplicates } from "./lib/dedupe";

const MAX_ROWS = 1000;

export const dedupe = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ duplicates: number; changed: number }> => {
    const rows: Doc<"agents">[] = [];
    for (const status of ["live", "duplicate"] as const) {
      rows.push(
        ...(await ctx.db
          .query("agents")
          .withIndex("by_status_rank", (q) => q.eq("status", status))
          .take(MAX_ROWS)),
      );
    }

    const duplicates = findDuplicates(rows);
    let changed = 0;
    for (const row of rows) {
      const next = duplicates.has(row.agentKey) ? "duplicate" : "live";
      if (row.status !== next) {
        await ctx.db.patch(row._id, { status: next });
        changed++;
      }
    }

    if (changed > 0) {
      await ctx.scheduler.runAfter(0, internal.facets.recompute, {});
      await ctx.scheduler.runAfter(0, internal.shelves.rebuild, {});
    }
    return { duplicates: duplicates.size, changed };
  },
});
