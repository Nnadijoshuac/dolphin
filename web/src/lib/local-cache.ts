"use client";

/**
 * A small, versioned, TTL'd cache in the visitor's own browser.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * The catalog is a Convex SUBSCRIPTION, and a subscription's cache is in
 * memory. That is exactly right while a tab is open and useless the moment it
 * is closed: every fresh load opened on an empty page, connected a websocket,
 * ran the query, and only then painted. The reader watched skeletons for the
 * round trip, every single time, including on the second visit to a page whose
 * contents had not changed.
 *
 * This does not replace the subscription and must never try to. It seeds the
 * FIRST PAINT with what was true on the last visit, and Convex overwrites it
 * with live data as soon as the socket answers - typically within the same
 * second. What the reader gets is a page that is already there.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS DOES NOT VIOLATE THE DATA-INTEGRITY RULE (AGENTS.md §5)
 * ---------------------------------------------------------------------------
 * Nothing here invents a value. A snapshot is a real backend response that was
 * true at `at`, and every metric inside it carries its own `asOf`, `source` and
 * `status` - so a snapshot renders with its own provenance and dates itself
 * honestly rather than posing as current. `MAX_AGE` is a backstop on top of
 * that: past it, the entry is dropped and the reader waits for live data rather
 * than being shown something stale enough to mislead.
 *
 * ---------------------------------------------------------------------------
 * EVERY ACCESS IS GUARDED, AND THAT IS NOT DEFENSIVE PADDING
 * ---------------------------------------------------------------------------
 * `localStorage` is not merely absent during SSR. It THROWS on property access
 * in a browser configured to block site data, and `setItem` throws
 * QuotaExceededError in Safari's private mode on the first write. An
 * unguarded read here would take down a server render and a whole category of
 * real browsers with it, to save a websocket round trip. Every path below
 * returns null or does nothing instead.
 */

/** Namespaced so this never collides with anything else on the origin. */
const PREFIX = "dolphin.cache.v1.";

/**
 * Bump to invalidate every entry at once.
 *
 * Required whenever the SHAPE of anything cached changes - a renamed field on
 * `MarketplaceAgent`, a new metric, a changed pricing object. An old snapshot
 * deserialised into new render code is the one way this cache can produce a
 * wrong screen rather than merely a stale one.
 */
const SCHEMA = 3;

/** Nothing is served from cache past this, whatever the caller asks for. */
const MAX_AGE_CEILING_MS = 24 * 60 * 60 * 1000;

interface Entry<T> {
  /** Schema version this was written under. */
  s: number;
  /** Epoch ms at write time. */
  at: number;
  d: T;
}

/**
 * Parsed entries, held so a repeated read returns the SAME reference.
 *
 * This exists for `useSyncExternalStore`, which calls its snapshot getter on
 * every render and treats a new object identity as a changed store. Re-parsing
 * JSON each time would hand back a fresh object every render and spin React
 * into an endless loop, so the parse happens once per key and the box is
 * reused. `writeCache` keeps it in step.
 */
const memo = new Map<string, { value: unknown }>();

/** Reads through the memo, so the result is referentially stable. */
export function readCacheStable<T>(key: string, maxAgeMs: number): T | undefined {
  const held = memo.get(key);
  if (held) return held.value as T | undefined;

  const value = readCache<T>(key, maxAgeMs) ?? undefined;
  memo.set(key, { value });
  return value;
}

function storage(): Storage | null {
  // `typeof window` first: during SSR there is no window at all, and touching
  // localStorage directly would throw rather than return undefined.
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // Browsers set to block site data throw on the property itself.
    return null;
  }
}

/**
 * Reads one entry, or null when it is missing, unparseable, from an older
 * schema, or older than `maxAgeMs`.
 *
 * A miss and a failure are deliberately the same answer. Every caller's
 * fallback is "wait for live data", which is correct for both.
 */
export function readCache<T>(key: string, maxAgeMs: number): T | null {
  const store = storage();
  if (!store) return null;

  try {
    const raw = store.getItem(PREFIX + key);
    if (!raw) return null;

    const entry = JSON.parse(raw) as Entry<T>;
    if (entry.s !== SCHEMA) {
      store.removeItem(PREFIX + key);
      return null;
    }

    const age = Date.now() - entry.at;
    // A negative age means the clock moved backwards since the write. Treat it
    // as unusable rather than as infinitely fresh.
    if (age < 0 || age > Math.min(maxAgeMs, MAX_AGE_CEILING_MS)) {
      store.removeItem(PREFIX + key);
      return null;
    }

    return entry.d;
  } catch {
    return null;
  }
}

/**
 * Writes one entry. Silent on failure, by design: a cache that cannot store is
 * a slower page, never a broken one.
 *
 * On a quota error it drops this cache's own entries and retries once. It
 * clears only the `dolphin.cache.` prefix - wiping the whole origin would take
 * the wallet's and onboarding's own persisted state with it, which is somebody
 * else's data.
 */
export function writeCache<T>(key: string, data: T): void {
  const store = storage();
  if (!store) return;

  // Keep the memo in step rather than clearing it: replacing the boxed value
  // means a later reader sees the new data, while the box identity stays stable
  // for anything currently subscribed.
  memo.set(key, { value: data });

  const entry: Entry<T> = { s: SCHEMA, at: Date.now(), d: data };

  let serialized: string;
  try {
    serialized = JSON.stringify(entry);
  } catch {
    // Non-serialisable payload (a cycle, a BigInt). Nothing to store.
    return;
  }

  try {
    store.setItem(PREFIX + key, serialized);
  } catch {
    try {
      clearCache();
      store.setItem(PREFIX + key, serialized);
    } catch {
      // Still no room, or writes are blocked outright. Give up quietly.
    }
  }
}

/** Drops every entry this module owns, and nothing else on the origin. */
export function clearCache(): void {
  memo.clear();
  const store = storage();
  if (!store) return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key?.startsWith(PREFIX)) doomed.push(key);
    }
    for (const key of doomed) store.removeItem(key);
  } catch {
    // Nothing to do; the next write will try again.
  }
}

/**
 * A stable cache key for a query and its arguments.
 *
 * Object keys are SORTED before serialising, because `{a,b}` and `{b,a}` are
 * the same query and must not be two cache entries - React gives no guarantee
 * about the key order of an object literal built across branches, and two keys
 * for one query means the second visit misses.
 */
export function cacheKey(name: string, args?: unknown): string {
  if (args === undefined || args === null) return name;
  return `${name}.${stableStringify(args)}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);

  return `{${entries.join(",")}}`;
}
