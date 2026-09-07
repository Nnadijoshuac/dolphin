import { v } from "convex/values";

import { query } from "./_generated/server";
import { BSC_CHAIN_ID } from "./lib/bscClient";

/**
 * Retention: how many people who hired this agent were still using it a week
 * later, and a month later.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS THE FIRST REAL RANKING SIGNAL
 * ---------------------------------------------------------------------------
 * The catalog has nothing to compare agents on. reputationScore is unavailable
 * for a third of the catalog and exactly 0 for the rest, so ordering by it
 * orders by noise (the comment in src/app/(tabs)/search.tsx says as much).
 * feedbackCount is live but is a count of ERC-8004 feedback records, which is
 * a measure of activity rather than of quality. Every agent costs the same.
 * Two agents in the same category are, on the evidence the app can show,
 * indistinguishable.
 *
 * Retention is the one signal Dolphin can produce that nobody else has, it
 * needs no user input at all, and it is hard to fake now that a hire requires
 * a signature (convex/lib/walletAuth.ts). It is computed from agentHires
 * alone - no new table, no new source, no new column.
 *
 * ---------------------------------------------------------------------------
 * THE DEFINITION, AND WHY IT IS THE CAREFUL ONE
 * ---------------------------------------------------------------------------
 * "Still active after 7 days" only means something for a hire that has HAD
 * seven days. A hire made yesterday cannot have survived a week, and counting
 * it as a failure would punish an agent for being hired recently, while
 * counting it as a success would be a straightforward lie. So the denominator
 * is hires old enough to have been tested, and nothing else:
 *
 *   eligible  hires whose hiredAt is at least the window ago
 *   retained  of those, the ones that were still active AT the window mark -
 *             either never cancelled, or cancelled after surviving it
 *
 * A cancellation is dated (agentHires.cancelledAt), which is exactly why
 * cancelHire patches the row instead of deleting it: a deleted hire would
 * silently vanish from the denominator and flatter every agent it happened to.
 *
 * ---------------------------------------------------------------------------
 * SMALL NUMBERS ARE REPORTED AS NUMBERS, NOT AS PERCENTAGES
 * ---------------------------------------------------------------------------
 * "100% retention" over a single hire is true arithmetic and a false
 * impression, which is the failure mode this project keeps having to design
 * against. The counts are always returned; `sufficient` says whether there is
 * enough of a denominator for a rate to mean anything, and the UI shows a
 * percentage only when it is true. An agent with no hire old enough yet gets
 * an explicit "not measurable yet", never a zero.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The smallest denominator a percentage may be computed from.
 *
 * Five is a judgement call rather than a derived threshold, and is recorded as
 * one. It is set where a single outcome stops swinging the figure by more than
 * twenty points, which is the point at which a reader could be badly misled by
 * ordinary variation rather than by a real difference between agents.
 */
const MIN_DENOMINATOR = 5;

type HireRow = {
  hiredAt: string;
  cancelledAt: string | null;
  status: "active" | "cancelled";
};

/**
 * Was this hire still alive `windowMs` after it started?
 *
 * Returns null when the hire is not old enough to have been tested, which is
 * how it stays out of the denominator rather than being scored as either
 * outcome.
 */
function survivedWindow(
  hire: HireRow,
  windowMs: number,
  now: number,
): boolean | null {
  const hiredAt = Date.parse(hire.hiredAt);
  if (Number.isNaN(hiredAt)) return null;
  if (now - hiredAt < windowMs) return null;

  if (hire.status === "active" || hire.cancelledAt === null) return true;

  const cancelledAt = Date.parse(hire.cancelledAt);
  // An unparseable cancellation date is not evidence of survival. Excluded
  // rather than guessed either way.
  if (Number.isNaN(cancelledAt)) return null;

  return cancelledAt - hiredAt >= windowMs;
}

function summarise(hires: HireRow[], windowMs: number, now: number) {
  let eligible = 0;
  let retained = 0;

  for (const hire of hires) {
    const survived = survivedWindow(hire, windowMs, now);
    if (survived === null) continue;
    eligible += 1;
    if (survived) retained += 1;
  }

  return {
    eligible,
    retained,
    sufficient: eligible >= MIN_DENOMINATOR,
    /** Null below the threshold, so a caller cannot render a rate it should not. */
    rate: eligible >= MIN_DENOMINATOR ? retained / eligible : null,
  };
}

export const getAgentRetention = query({
  args: { agentKey: v.string() },
  returns: v.object({
    totalHires: v.number(),
    activeHires: v.number(),
    day7: v.object({
      eligible: v.number(),
      retained: v.number(),
      sufficient: v.boolean(),
      rate: v.union(v.number(), v.null()),
    }),
    day30: v.object({
      eligible: v.number(),
      retained: v.number(),
      sufficient: v.boolean(),
      rate: v.union(v.number(), v.null()),
    }),
  }),
  handler: async (ctx, { agentKey }) => {
    // Prefix query on by_agent_wallet [agentKey, walletAddress] - every
    // hire of this agent by anyone. No new index needed.
    const hires = await ctx.db
      .query("agentHires")
      .withIndex("by_agent_wallet", (q) =>
        q.eq("agentKey", agentKey),
      )
      .collect();

    const rows: HireRow[] = hires.map((hire) => ({
      hiredAt: hire.hiredAt,
      cancelledAt: hire.cancelledAt,
      status: hire.status,
    }));

    const now = Date.now();

    return {
      totalHires: rows.length,
      activeHires: rows.filter((hire) => hire.status === "active").length,
      day7: summarise(rows, 7 * DAY_MS, now),
      day30: summarise(rows, 30 * DAY_MS, now),
    };
  },
});
