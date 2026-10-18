import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * A public run ends the moment its agent stops trading (owner, 2026-10-18: "I stopped it, but it's still
 * showing that I'm live"). Called wherever Autopilot is switched off; liveRuns.tick catches any other path.
 */
export async function endLiveRunsForDraft(ctx: MutationCtx, draftId: Id<"agentDrafts">): Promise<void> {
  const runs = await ctx.db.query("liveRuns").withIndex("by_draft", (q) => q.eq("draftId", draftId)).take(20);
  const now = Date.now();
  for (const run of runs) {
    if (run.status === "running") await ctx.db.patch(run._id, { status: "ended", endedAt: now });
  }
}
