/**
 * Keeps a draft's armed triggers (agentTriggers) in step with its blocks.
 * Called when autopilot is switched on or off, and when the blocks of an
 * armed draft change. Plain function, not a Convex function, so the builder
 * and the autopilot share it without importing each other.
 */

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { TRIGGER_TYPES, type AgentBlock } from "./agentBlocks";

/** First check a minute after arming, so turning autopilot on never fires instantly. */
const FIRST_CHECK_DELAY_MS = 60_000;

export async function syncTriggers(
  ctx: MutationCtx,
  draftId: Id<"agentDrafts">,
  blocks: readonly AgentBlock[],
  armed: boolean,
): Promise<number> {
  const existing = await ctx.db
    .query("agentTriggers")
    .withIndex("by_draft", (q) => q.eq("draftId", draftId))
    .collect();
  const wanted = armed ? blocks.filter((block) => TRIGGER_TYPES.includes(block.type)) : [];

  for (const row of existing) {
    const block = wanted.find((candidate) => candidate.id === row.blockId && candidate.type === row.type);
    if (!block) {
      await ctx.db.delete(row._id);
    } else if (JSON.stringify(block.config) !== JSON.stringify(row.config)) {
      // Settings changed: start its memory afresh, so a new price level is not
      // judged against the side of the old one.
      await ctx.db.patch(row._id, { config: block.config, state: null, nextRunAt: Date.now() + FIRST_CHECK_DELAY_MS });
    }
  }
  for (const block of wanted) {
    if (existing.some((row) => row.blockId === block.id && row.type === block.type)) continue;
    await ctx.db.insert("agentTriggers", {
      draftId,
      blockId: block.id,
      type: block.type as "schedule" | "price" | "walletWatch",
      config: block.config,
      nextRunAt: Date.now() + FIRST_CHECK_DELAY_MS,
      state: null,
    });
  }
  return wanted.length;
}
