"use client";

import { useSyncExternalStore } from "react";

/**
 * The current time, as an external store.
 *
 * Session expiry is the one number on the wallet screen that changes without
 * anyone touching the app, so it has to come from somewhere. Reading
 * `Date.now()` during render is impure - React may re-render at any moment and
 * would produce a different answer each time, which is why the React Compiler
 * lint rules reject it outright. A shared ticker is both correct and better
 * behaved: every countdown on the page updates from one timer.
 *
 * Snapshots are bucketed to the tick interval so getSnapshot returns a stable
 * value between ticks. Returning a raw Date.now() here would change on every
 * call and send React into an infinite re-render loop.
 */

const TICK_MS = 30_000;

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let bucket = bucketNow();

function bucketNow(): number {
  return Math.floor(Date.now() / TICK_MS) * TICK_MS;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  timer ??= setInterval(() => {
    const next = bucketNow();
    if (next === bucket) return;
    bucket = next;
    for (const l of listeners) l();
  }, TICK_MS);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot(): number {
  return bucket;
}

/**
 * Server render and first client render must agree, so the server snapshot is
 * 0 and every consumer treats 0 as "time not known yet" rather than 1970.
 */
function getServerSnapshot(): number {
  return 0;
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
