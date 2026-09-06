import { useQuery } from "convex/react";
import { useMemo } from "react";

import { api } from "../../convex/_generated/api";
import { convexClient } from "@/providers/convex-provider";

/**
 * Hire counts and review outcomes for the whole catalog, in one read.
 *
 * One query for every row on a screen, not one per row. The per-row version
 * looks fine at thirty agents and is a thundering herd at three hundred - and
 * the catalog is drawn from a registry of nearly 300,000.
 *
 * See convex/agentSignals.ts for what each number means and why a rate is
 * withheld below five reviews.
 */
export type AgentSignals = {
  hires: number;
  activeHires: number;
  paidHires: number;
  reviews: number;
  wouldHireAgain: number;
  wouldHireAgainRate: number | null;
  deliveredCount: number;
};

export function useCatalogSignals(): Map<string, AgentSignals> {
  // Skipped rather than crashing when no backend is configured, matching every
  // other Convex-backed hook in the app.
  const rows = useQuery(
    api.agentSignals.getCatalogSignals,
    convexClient ? {} : "skip",
  );

  return useMemo(() => {
    const map = new Map<string, AgentSignals>();
    for (const row of rows ?? []) {
      const { tokenId, ...signals } = row;
      map.set(tokenId, signals);
    }
    return map;
  }, [rows]);
}

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
