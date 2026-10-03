import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation, internalQuery, type ActionCtx } from "./_generated/server";
import { DOLPHIN_KEY_NAMES, type KeyLedger } from "./lib/openrouter";

/**
 * REQUESTS PER KEY, PER UTC DAY (owner, 2026-10-03: the console showed "2 / 50" under all
 * three keys - one Dolphin-wide count of ANSWERS repeated, while an answer costs 2-5 model
 * requests and only the first key was ever used).
 *
 * One row per key per day in `freeCalls` ("orkey:<NAME>:<YYYY-MM-DD>"), counted for every
 * request a key actually sent, refused or not - that is how OpenRouter counts its daily cap.
 */
const rowKey = (name: string, day: string) => `orkey:${name}:${day}`;
const today = () => new Date().toISOString().slice(0, 10);

export const count = internalMutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const key = rowKey(name, today());
    const row = await ctx.db.query("freeCalls").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (row) await ctx.db.patch(row._id, { count: row.count + 1 });
    else await ctx.db.insert("freeCalls", { key, count: 1 });
  },
});

/** Today's requests for each of Dolphin's key names (0 for a key that sent none). */
export const requestsToday = internalQuery({
  args: {},
  handler: async (ctx) => {
    const day = today();
    const out: Record<string, number> = {};
    for (const name of DOLPHIN_KEY_NAMES) {
      const row = await ctx.db.query("freeCalls").withIndex("by_key", (q) => q.eq("key", rowKey(name, day))).unique();
      out[name] = row?.count ?? 0;
    }
    return out;
  },
});

/** The ledger an action passes to chatCompletion, so each request counts against the key that sent it. */
export function keyLedger(ctx: Pick<ActionCtx, "runMutation">): KeyLedger {
  return async (name) => {
    await ctx.runMutation(internal.modelKeys.count, { name });
  };
}
