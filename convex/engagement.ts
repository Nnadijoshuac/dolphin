/**
 * ENGAGEMENT: the anonymous funnel, counted per agent per day.
 *
 * The web client batches the agent-keyed events it already emits (see
 * web/src/lib/engagement-sink.ts) and calls `record`. This file is deliberately
 * narrow about what it accepts and about what anything downstream may do with it.
 *
 *  - No identity is accepted or stored. The mutation takes agent keys and event
 *    kinds, nothing else.
 *  - It is public and unauthenticated, so it is capped per call, ignores keys
 *    that are not in the catalog, and - the property that matters - its output
 *    never raises an agent's rank. See the schema note on `agentEngagement`.
 *    Inflating an agent's opens buys that agent nothing.
 */

import { v } from "convex/values";

import { internalMutation, mutation, query } from "./_generated/server";
import { coerceAgentKey } from "./model/agent";

export const ENGAGEMENT_KINDS = [
  "impression",
  "open",
  "view",
  "toolPreview",
  "hireStart",
  "hireCompletion",
  "hireFailure",
] as const;
export type EngagementKind = (typeof ENGAGEMENT_KINDS)[number];

const kindValidator = v.union(...ENGAGEMENT_KINDS.map((kind) => v.literal(kind)));

const FIELD_BY_KIND = {
  impression: "impressions",
  open: "opens",
  view: "views",
  toolPreview: "toolPreviews",
  hireStart: "hireStarts",
  hireCompletion: "hireCompletions",
  hireFailure: "hireFailures",
} as const satisfies Record<EngagementKind, string>;

type CounterField = (typeof FIELD_BY_KIND)[EngagementKind];

/** One batch is one flush of one browser tab. Anything bigger is not a person. */
const MAX_EVENTS_PER_CALL = 60;
const MAX_AGENTS_PER_CALL = 30;
/** The most one call may add to one counter of one agent. */
const MAX_INCREMENT = 3;

/** Past this, rows are pruned. Enough for a 30-day window plus a month of history. */
export const ENGAGEMENT_RETENTION_DAYS = 60;

export function utcDay(at: number = Date.now()): string {
  return new Date(at).toISOString().slice(0, 10);
}

function emptyCounters(): Record<CounterField, number> {
  return {
    impressions: 0,
    opens: 0,
    views: 0,
    toolPreviews: 0,
    hireStarts: 0,
    hireCompletions: 0,
    hireFailures: 0,
  };
}

export const record = mutation({
  args: {
    events: v.array(v.object({ agentKey: v.string(), kind: kindValidator })),
  },
  handler: async (ctx, { events }): Promise<{ accepted: number }> => {
    const byAgent = new Map<string, Record<CounterField, number>>();
    for (const event of events.slice(0, MAX_EVENTS_PER_CALL)) {
      const agentKey = coerceAgentKey(event.agentKey);
      if (!agentKey) continue;
      if (!byAgent.has(agentKey)) {
        if (byAgent.size >= MAX_AGENTS_PER_CALL) continue;
        byAgent.set(agentKey, emptyCounters());
      }
      const counters = byAgent.get(agentKey)!;
      const field = FIELD_BY_KIND[event.kind];
      counters[field] = Math.min(MAX_INCREMENT, counters[field] + 1);
    }

    const day = utcDay();
    let accepted = 0;
    for (const [agentKey, delta] of byAgent) {
      // Only catalog agents are counted, so the table cannot be filled with
      // invented keys.
      const agent = await ctx.db
        .query("agents")
        .withIndex("by_key", (q) => q.eq("agentKey", agentKey))
        .unique();
      if (!agent) continue;

      const existing = await ctx.db
        .query("agentEngagement")
        .withIndex("by_agent_day", (q) => q.eq("agentKey", agentKey).eq("day", day))
        .unique();
      if (existing) {
        const next = { ...emptyCounters() };
        for (const field of Object.keys(next) as CounterField[]) {
          next[field] = existing[field] + delta[field];
        }
        await ctx.db.patch(existing._id, next);
      } else {
        await ctx.db.insert("agentEngagement", { agentKey, day, ...delta });
      }
      accepted++;
    }
    return { accepted };
  },
});

/**
 * The funnel per agent over the last `days` days, for understanding users -
 * the admin page, and the ranking job's DENOMINATORS. Aggregate counts about
 * public listings only; nothing here is about a person.
 */
export const summary = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, { days }) => {
    const span = Math.min(Math.max(Math.round(days ?? 7), 1), 30);
    const since = utcDay(Date.now() - (span - 1) * 24 * 60 * 60 * 1000);
    const rows = await ctx.db
      .query("agentEngagement")
      .withIndex("by_day", (q) => q.gte("day", since))
      .take(5000);

    const totals = new Map<string, Record<CounterField, number>>();
    for (const row of rows) {
      const counters = totals.get(row.agentKey) ?? emptyCounters();
      for (const field of Object.keys(counters) as CounterField[]) counters[field] += row[field];
      totals.set(row.agentKey, counters);
    }

    const agents = [...totals.entries()]
      .map(([agentKey, counters]) => ({ agentKey, ...counters }))
      .sort((a, b) => b.opens - a.opens || b.impressions - a.impressions);
    const overall = emptyCounters();
    for (const agent of agents) {
      for (const field of Object.keys(overall) as CounterField[]) overall[field] += agent[field];
    }
    return { days: span, since, overall, agents, truncated: rows.length === 5000 };
  },
});

/** Drops rows past the retention window. Called by the daily ranking cron. */
export const prune = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ deleted: number }> => {
    const cutoff = utcDay(Date.now() - ENGAGEMENT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const stale = await ctx.db
      .query("agentEngagement")
      .withIndex("by_day", (q) => q.lt("day", cutoff))
      .take(1000);
    for (const row of stale) await ctx.db.delete(row._id);
    return { deleted: stale.length };
  },
});
