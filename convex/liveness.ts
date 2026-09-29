/**
 * LIVENESS HISTORY - the record of which agents actually answered, over time.
 * (Mentor review, 2026-09-29: the time series is the moat nobody can buy later.)
 *
 * Two writes, both cheap on purpose (the database I/O budget is shared):
 *   - an event when an agent GAINS or LOSES "live" (from verification.ts);
 *   - one snapshot a day of the live set, with a sha256 of the sorted list so a
 *     published number can be checked against what was recorded that day.
 * Reads are for the "State of Live Agents" report (convex/stateReport.ts).
 */

import { v } from "convex/values";

import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";

type Change = {
  agentKey: string;
  from: string;
  to: string;
  failureClass: string | null;
  detail: string;
  probedEndpoint: string | null;
  protocol: "a2a" | "mcp" | null;
  at: string;
};

/** Called in the same mutation as the probe result. Writes only when "live" is gained or lost. */
export async function recordLivenessChange(ctx: MutationCtx, change: Change): Promise<void> {
  if (change.from === change.to) return;
  if (change.from !== "live" && change.to !== "live") return;
  await ctx.db.insert("livenessEvents", { ...change, detail: change.detail.slice(0, 200) });
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The day's snapshot. Idempotent: a second run on the same day changes nothing. */
export const snapshotDay = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const existing = await ctx.db
      .query("livenessDaily")
      .withIndex("by_day", (q) => q.eq("day", day))
      .unique();
    if (existing) return { day, skipped: true };

    // Only the live rows are read (a few dozen), through the state index.
    const live = await ctx.db
      .query("agentVerification")
      .withIndex("by_state_next_probe", (q) => q.eq("state", "live"))
      .take(5_000);
    const liveKeys = live.map((row) => row.agentKey).sort();
    const since = new Date(now.getTime() - 86_400_000).toISOString();
    const events = await ctx.db
      .query("livenessEvents")
      .withIndex("by_time", (q) => q.gt("at", since))
      .take(5_000);
    await ctx.db.insert("livenessDaily", {
      day,
      live: liveKeys.length,
      liveKeys,
      liveKeysSha256: await sha256(liveKeys.join("\n")),
      gained: events.filter((event) => event.to === "live").length,
      lost: events.filter((event) => event.from === "live").length,
      takenAt: now.toISOString(),
    });
    return { day, skipped: false, live: liveKeys.length };
  },
});

/** The daily series, newest first. */
export const daily = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) =>
    (await ctx.db.query("livenessDaily").withIndex("by_day").order("desc").take(Math.min(limit ?? 90, 400))).map(
      ({ day, live, gained, lost, liveKeysSha256 }) => ({ day, live, gained, lost, liveKeysSha256 }),
    ),
});

/** One agent's history of gaining and losing "live". */
export const forAgent = internalQuery({
  args: { agentKey: v.string() },
  handler: async (ctx, { agentKey }) =>
    ctx.db
      .query("livenessEvents")
      .withIndex("by_agent", (q) => q.eq("agentKey", agentKey))
      .order("desc")
      .take(200),
});
