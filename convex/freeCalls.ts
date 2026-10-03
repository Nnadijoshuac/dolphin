import { v } from "convex/values";

import { internalMutation } from "./_generated/server";

/**
 * THE FREE-CALL CAP (owner, 2026-10-03). A free knowledge tool costs Dolphin
 * roughly three function calls and nobody pays for it, so free calls are
 * capped per agent AND across all of Dolphin, per UTC day: 200 x 1 agent,
 * 5,000 in all (~450k function calls a month, inside the free plan's 1M).
 * Paid calls are never capped. Raise these when the plan grows.
 */
export const FREE_CALLS_PER_AGENT_PER_DAY = 200;
export const FREE_CALLS_PER_DAY = 5_000;

export const spend = internalMutation({
  args: { hash: v.string() },
  handler: async (ctx, { hash }): Promise<{ ok: true } | { ok: false; reason: string }> => {
    const day = new Date().toISOString().slice(0, 10);
    const read = async (key: string) => ctx.db.query("freeCalls").withIndex("by_key", (q) => q.eq("key", key)).unique();
    const agent = await read(`${hash}:${day}`);
    const all = await read(`all:${day}`);
    if ((agent?.count ?? 0) >= FREE_CALLS_PER_AGENT_PER_DAY) {
      return { ok: false, reason: "This agent's free calls are used up for today. Its paid tools still work; free ones open again at midnight UTC." };
    }
    if ((all?.count ?? 0) >= FREE_CALLS_PER_DAY) {
      return { ok: false, reason: "Free calls are used up for today. Paid tools still work; free ones open again at midnight UTC." };
    }
    if (agent) await ctx.db.patch(agent._id, { count: agent.count + 1 });
    else await ctx.db.insert("freeCalls", { key: `${hash}:${day}`, count: 1 });
    if (all) await ctx.db.patch(all._id, { count: all.count + 1 });
    else await ctx.db.insert("freeCalls", { key: `all:${day}`, count: 1 });
    return { ok: true };
  },
});
