/**
 * WHICH POST BROUGHT THEM (owner, 2026-10-04: "we'll be able to track what post actually brought, how
 * many people"). A link we post carries `?ref=<tag>` (x-1004-thread, ig-bio...); the browser keeps that
 * tag for 30 days and reports four moments under it: the visit, a wallet sign-in, a build started and a
 * paid hire. Counted per tag per UTC day.
 *
 * Same rule as engagement.ts: the tag and the moment, nothing else. No wallet, no session, no person.
 * It is public and unauthenticated, so anyone can inflate a tag's count; these numbers steer what we
 * post, they never rank or pay anything.
 */

import { v } from "convex/values";

import { internalQuery, mutation } from "./_generated/server";
import { utcDay } from "./engagement";

export const REF_KINDS = ["visit", "signIn", "buildStart", "agentRegistered", "hire"] as const;
export type RefKind = (typeof REF_KINDS)[number];

const FIELD = {
  visit: "visits",
  signIn: "signIns",
  buildStart: "buildStarts",
  agentRegistered: "agentsRegistered",
  hire: "hires",
} as const satisfies Record<RefKind, string>;

/** Lowercase letters, digits and dashes, short - a tag we wrote, never free text. */
export function cleanRef(ref: string): string | null {
  const tag = ref.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,39}$/.test(tag) ? tag : null;
}

export const record = mutation({
  args: { ref: v.string(), kind: v.union(...REF_KINDS.map((kind) => v.literal(kind))) },
  handler: async (ctx, { ref, kind }): Promise<null> => {
    const tag = cleanRef(ref);
    if (!tag) return null;
    const day = utcDay();
    const field = FIELD[kind];
    const row = await ctx.db
      .query("campaignRefs")
      .withIndex("by_ref_day", (q) => q.eq("ref", tag).eq("day", day))
      .unique();
    if (row) await ctx.db.patch(row._id, { [field]: row[field] + 1 });
    else await ctx.db.insert("campaignRefs", { ref: tag, day, visits: 0, signIns: 0, buildStarts: 0, agentsRegistered: 0, hires: 0, [field]: 1 });
    return null;
  },
});

/**
 * Every tag over the last `days` days, best first. Internal until the admin page reads it:
 * `npx convex run campaignRefs:summary '{"days":7}' --prod`.
 */
export const summary = internalQuery({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, { days }) => {
    const span = Math.min(Math.max(Math.round(days ?? 7), 1), 60);
    const since = utcDay(Date.now() - (span - 1) * 24 * 60 * 60 * 1000);
    const rows = await ctx.db.query("campaignRefs").withIndex("by_day", (q) => q.gte("day", since)).take(5000);
    const byRef = new Map<string, { ref: string; visits: number; signIns: number; buildStarts: number; agentsRegistered: number; hires: number; days: string[] }>();
    for (const row of rows) {
      const total = byRef.get(row.ref) ?? { ref: row.ref, visits: 0, signIns: 0, buildStarts: 0, agentsRegistered: 0, hires: 0, days: [] };
      total.visits += row.visits;
      total.signIns += row.signIns;
      total.buildStarts += row.buildStarts;
      total.agentsRegistered += row.agentsRegistered;
      total.hires += row.hires;
      total.days.push(row.day);
      byRef.set(row.ref, total);
    }
    return { since, refs: [...byRef.values()].sort((a, b) => b.visits - a.visits) };
  },
});
