"use client";

import { useQuery } from "convex/react";

import { censusApi } from "@/convex/api";
import { convexClient } from "@/providers/convex-provider";

/**
 * THE CENSUS TICKER — Dolphin's one unique claim, running under the navbar.
 *
 * ===========================================================================
 * WHAT IT IS FOR
 * ===========================================================================
 * The catalog was presented as "43 agents", which reads as an EMPTY STORE. No
 * amount of design repairs that, because the reader's instinct is correct: 43
 * is a small shop.
 *
 * But 43 is not the size of a shop. It is the number of ERC-8004 agents on BNB
 * Chain that ANSWER, out of a registry Dolphin walked end to end. Said as a
 * funnel it stops being an inventory and becomes a finding — and a finding
 * belongs in the chrome of every page, not in a card on one of them.
 *
 * ===========================================================================
 * A TICKER, AND THE THREE THINGS THAT MAKES MANDATORY
 * ===========================================================================
 * 1. SEAMLESS LOOP. The track holds the sequence TWICE and translates by
 *    exactly -50%, so the second copy is under the cursor at the instant the
 *    animation restarts. Any other number leaves a visible jump. The duplicate
 *    is `aria-hidden` — a screen reader must hear the census once.
 *
 * 2. REDUCED MOTION IS NOT OPTIONAL. Perpetual horizontal movement in fixed
 *    page chrome is one of the clearest vestibular triggers there is, and this
 *    thing is on every route. Under `prefers-reduced-motion` the animation is
 *    removed entirely and the strip becomes a normal, quietly scrollable row.
 *    See globals.css — the rule is local, not left to the global blanket
 *    override, because that one only shortens durations.
 *
 * 3. IT MUST NOT SHIFT LAYOUT. The strip keeps a fixed height whether or not
 *    the numbers have loaded, so a late Convex response does not push the page
 *    down under the reader.
 *
 * ===========================================================================
 * NOTHING HERE IS A FALLBACK NUMBER (AGENTS.md §5)
 * ===========================================================================
 * If Convex is unconfigured, the query has not resolved, or discovery has
 * never run, this renders NOTHING. A census is the one component where an
 * invented figure would not be a small lie — it would be the whole lie.
 * ===========================================================================
 */

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function CensusMarquee() {
  /*
   * `convexClient` is null when NEXT_PUBLIC_CONVEX_URL is unset. useQuery still
   * has to be called unconditionally (rules of hooks), so the gate is the
   * "skip" argument and the render below.
   */
  const census = useQuery(censusApi.census.funnel, convexClient ? {} : "skip");

  if (!census || census.assessed <= 0) return null;

  /*
   * One pass of the ticker. Built as data rather than markup so the duplicate
   * copy is guaranteed identical — a hand-copied second <span> list is how a
   * loop develops a seam nobody can find later.
   */
  const segments = [
    { value: formatCount(census.assessed), label: "registry identities assessed" },
    { value: formatCount(census.candidates), label: "published an endpoint" },
    { value: formatCount(census.live), label: "answered", terminal: true },
    {
      value: formatCount(census.publishers),
      label: `publishers behind those ${formatCount(census.live)}`,
    },
  ];

  const pass = (hidden: boolean) => (
    <div aria-hidden={hidden || undefined} className="ticker__pass">
      <span className="ticker__tag">The liveness census</span>
      {segments.map((segment, index) => (
        <span className="ticker__item" key={`${segment.label}-${index}`}>
          <span
            className={`ticker__value${segment.terminal ? " ticker__value--terminal" : ""}`}
          >
            {segment.value}
          </span>
          <span className="ticker__label">{segment.label}</span>
        </span>
      ))}
      <span className="ticker__note">
        Dolphin called every ERC-8004 agent on BNB Chain. Most do not answer.
      </span>
    </div>
  );

  return (
    <aside aria-label="Registry liveness census" className="ticker">
      <div className="ticker__track">
        {pass(false)}
        {/* The seam-free duplicate. Hidden from assistive tech: the census is
            one statement, not two. */}
        {pass(true)}
      </div>
    </aside>
  );
}
