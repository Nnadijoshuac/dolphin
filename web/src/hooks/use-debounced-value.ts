"use client";

import { useEffect, useRef, useState } from "react";

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
  const previous = useRef(value);

  useEffect(() => {
    /*
     * Clearing is not debounced. Emptying the box should show the unfiltered
     * catalog at once - there is no expensive query to protect against, and a
     * quarter-second of stale results after an explicit "Clear" reads as a bug.
     */
    if (value === previous.current) return undefined;
    previous.current = value;

    if (typeof value === "string" && value.length === 0) {
      setDebounced(value);
      return undefined;
    }

    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
