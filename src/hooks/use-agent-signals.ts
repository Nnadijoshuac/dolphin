/**
 * Hire counts and review outcomes, and the one line a list row shows.
 *
 * ---------------------------------------------------------------------------
 * `useCatalogSignals` IS GONE, AND WHY
 * ---------------------------------------------------------------------------
 * It fetched signals for the WHOLE catalog in one query - correct while the
 * catalog was the whole of what a screen rendered, and wrong the moment the list
 * became paginated. The backend query behind it read every row of `agentHires`
 * and `agentReviews` and bucketed them in memory: a full scan of two growing
 * tables to answer a question about the 24 agents actually on screen.
 *
 * `useAgentSignals(agents)` in src/hooks/use-agents.ts replaces it and takes the
 * keys it needs. The summariser below is unchanged and still lives here, because
 * it is presentation logic that several components share.
 */

export type { AgentSignals } from "@/hooks/use-agents";
export { useAgentSignals } from "@/hooks/use-agents";

import type { AgentSignals } from "@/hooks/use-agents";

/**
 * The one-line summary a list row shows, or null when there is nothing honest
 * to say yet.
 *
 * Returns null rather than "0 hires" for an agent nobody has hired: a zero
 * reads as a judgement, and the true statement is that Dolphin has no record,
 * which the caller renders as its own quieter line.
 */
export function summariseSignals(signals: AgentSignals | undefined): string | null {
  if (!signals || signals.hires === 0) return null;

  const hires = `${signals.hires} ${signals.hires === 1 ? "hire" : "hires"}`;
  if (signals.reviews === 0) return hires;

  const reviews = `${signals.reviews} ${signals.reviews === 1 ? "review" : "reviews"}`;
  if (signals.wouldHireAgainRate === null) {
    // Too few to rate, so state the fraction rather than a percentage.
    return `${hires} · ${signals.wouldHireAgain}/${signals.reviews} would hire again`;
  }
  return `${hires} · ${reviews} · ${Math.round(signals.wouldHireAgainRate * 100)}% would hire again`;
}
