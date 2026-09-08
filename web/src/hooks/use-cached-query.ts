"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import { cacheKey, readCacheStable, writeCache } from "@/lib/local-cache";

/**
 * `useSyncExternalStore` needs a subscribe function, and this store genuinely
 * never changes underneath a mounted component: a snapshot is read once to seed
 * a first paint and is superseded by live data, not by another tab. So nothing
 * is subscribed to, and the unsubscribe is a no-op.
 *
 * Defined at module scope so its identity is stable - a new function per render
 * would make React tear down and re-subscribe on every single render.
 */
const NEVER_CHANGES = () => () => {};

/**
 * The server, and the first client render during hydration, both see nothing.
 *
 * This is what keeps the cache free of hydration mismatches: the HTML Next
 * rendered has no cached content in it, so the first client render must not
 * either. The snapshot appears on the render immediately after.
 */
const NO_SERVER_SNAPSHOT = () => undefined;

/**
 * Seeds a Convex subscription's first paint from the visitor's own browser.
 *
 * ---------------------------------------------------------------------------
 * THE PROBLEM THIS SOLVES
 * ---------------------------------------------------------------------------
 * `useQuery` from convex/react returns `undefined` until the websocket has
 * connected AND the query has run. On a fresh page load that is the whole
 * connection handshake before a single row exists, and every screen renders its
 * empty state for the duration. Returning to a page you visited a minute ago
 * costs exactly as much as seeing it for the first time, which is the thing
 * that makes an app feel slow even when the backend is fast.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES, AND WHAT IT REFUSES TO DO
 * ---------------------------------------------------------------------------
 * It does ONE thing: while live data is `undefined`, it hands back the last
 * value this browser saw for the same query and arguments. The instant Convex
 * answers, live data wins and the snapshot is never consulted again for that
 * mount.
 *
 * It is NOT a second source of truth. It never merges with live data, never
 * survives a schema bump (`SCHEMA` in local-cache.ts), and never outlives its
 * TTL. If Convex says a row is gone, the snapshot does not resurrect it - `null`
 * is a live answer and takes precedence over any cached value.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SNAPSHOT IS READ IN AN EFFECT AND NOT DURING RENDER
 * ---------------------------------------------------------------------------
 * Reading localStorage during render would make the first client render differ
 * from the server's HTML, which is a hydration mismatch - React would discard
 * the server tree and warn in the console. So the first client render matches
 * the server exactly, and the snapshot lands one frame later, from an effect.
 *
 * One frame is imperceptible; a websocket round trip is not. That trade is the
 * entire point.
 */
export interface CachedQueryResult<T> {
  /** Live data when it has arrived, otherwise the snapshot, otherwise undefined. */
  data: T | undefined;
  /** True only while nothing at all is available - neither live nor cached. */
  isLoading: boolean;
  /**
   * True while what is on screen came from this browser rather than from the
   * backend. Exposed so a caller can mark the view if it wants to; most do not
   * need to, because every metric already carries its own `asOf` and `source`.
   */
  isFromCache: boolean;
}

export function useCachedQuery<T>(
  /** The value `useQuery` returned: `undefined` while loading, else the result. */
  live: T | undefined,
  /** A stable name for the query, e.g. "agents.get". */
  name: string,
  /** The arguments it was called with, or "skip" when the query is disabled. */
  args: unknown,
  maxAgeMs: number,
): CachedQueryResult<T> {
  const skipped = args === "skip";
  const key = skipped ? null : cacheKey(name, args);

  /*
   * Read through useSyncExternalStore rather than into state from an effect.
   *
   * localStorage IS an external store, and this is the hook React provides for
   * reading one without tearing during concurrent rendering. Setting state from
   * an effect would also work, and would additionally paint one wasted frame
   * and trip react-hooks/set-state-in-effect.
   *
   * `readCacheStable` is required here, not `readCache`: the getter runs on
   * every render, and returning a freshly parsed object each time would look
   * like a store that changes constantly and loop forever.
   *
   * Keying the getter on `key` means a changed key (a different agent, a
   * different category) re-reads immediately, so one agent's snapshot can never
   * appear under another's heading.
   */
  const getSnapshot = useCallback(
    () => (key ? readCacheStable<T>(key, maxAgeMs) : undefined),
    [key, maxAgeMs],
  );

  const snapshot = useSyncExternalStore(NEVER_CHANGES, getSnapshot, NO_SERVER_SNAPSHOT);

  // Write whenever live data arrives. `undefined` means "still loading" and is
  // never written; `null` is a real answer (no such agent) and is.
  useEffect(() => {
    if (!key || live === undefined) return;
    writeCache(key, live);
  }, [key, live]);

  if (live !== undefined) {
    return { data: live, isLoading: false, isFromCache: false };
  }

  return {
    data: snapshot,
    isLoading: snapshot === undefined,
    isFromCache: snapshot !== undefined,
  };
}

/**
 * How long each kind of cached read may seed a first paint.
 *
 * These are ceilings on how stale a FIRST FRAME may be, not refresh intervals -
 * live data replaces the snapshot within the same second either way. They are
 * set by how badly a stale value would read if the socket were slow:
 *
 *   facets     the browse chips. A category appearing or emptying is not
 *              misleading for a moment, and this is the single cheapest win on
 *              the site: the chip row is above the fold on every page.
 *   catalog    the agent grid. Bounded tighter because a delisted agent should
 *              not linger on the shelf.
 *   agent      one agent's record. Tighter still - this is the page someone
 *              reads before spending money, and its pricing and status are the
 *              two fields that most deserve to be current.
 */
export const CACHE_TTL = {
  facets: 24 * 60 * 60 * 1000,
  catalog: 60 * 60 * 1000,
  agent: 15 * 60 * 1000,
} as const;
