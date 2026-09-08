"use client";

import { useEffect, useState } from "react";

/**
 * A value that lags behind its input until the input stops changing.
 *
 * ===========================================================================
 * WHY THE SEARCH BOX NEEDED THIS (2026-09-08)
 * ===========================================================================
 * app/search/page.tsx fed its raw input state straight into `useAgentList`,
 * which feeds `usePaginatedQuery`. Convex paginated queries are SUBSCRIPTIONS,
 * so every keystroke tore down one subscription and opened another: typing
 * "pancakeswap" opened eleven, each of which ran a full search-index query
 * server-side, and ten of whose results were discarded before they painted.
 *
 * The comment above that call celebrated moving search off the client -
 * "which is what makes a catalog of thousands searchable rather than merely
 * downloadable". That was true and it moved the cost rather than removing it:
 * from the user's CPU to the Convex bill, at one query per character.
 *
 * ===========================================================================
 * WHY 250ms
 * ===========================================================================
 * Below ~150ms a fast typist still fires per-character. Above ~350ms the box
 * feels like it has stopped responding. 250ms is inside the window where a
 * result arriving still reads as a response to the last keystroke rather than
 * as a separate event. Recorded as a judgement call, not a measured optimum.
 *
 * The INPUT itself is never debounced - it renders from its own state, so
 * typing stays immediate. Only the query does.
 */
export const SEARCH_DEBOUNCE_MS = 250;

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  /*
   * CLEARING IS NOT DEBOUNCED, and it is adjusted DURING RENDER rather than in
   * an effect. Emptying the box should show the unfiltered catalog at once -
   * there is no expensive query to protect against, and a quarter-second of
   * stale results after an explicit "Clear" reads as a bug.
   *
   * React's documented "adjusting state when a prop changes" pattern, the same
   * one app/search/search-client.tsx uses for its URL sync. React restarts the
   * render before committing, so there is no cascade and no extra paint - and
   * unlike a synchronous setState inside an effect it does not trip
   * react-hooks/set-state-in-effect, which flags that shape precisely because
   * the effect version DOES cause a second render pass.
   *
   * Termination is guaranteed: the condition tests the value it then sets.
   */
  if (typeof value === "string" && value.length === 0 && debounced !== value) {
    setDebounced(value);
  }

  useEffect(() => {
    if (value === debounced) return undefined;

    // Inside a timeout, so this is not a synchronous setState in an effect.
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, debounced, delayMs]);

  return debounced;
}
