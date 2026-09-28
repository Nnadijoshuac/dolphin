import { create } from "zustand";

/**
 * Stars the person pressed that the backend has not confirmed yet. (2026-09-28)
 *
 * THE OWNER'S RULE: pressing the star five times must not be five writes and
 * five re-reads. So a press only flips local state, instantly. The write goes
 * out once the star has been left alone for SETTLE_MS, and only if the final
 * state differs from what the backend already holds - on, off, on, off sends
 * nothing at all.
 *
 * Reads were never per-press: `favorites.mine` is one Convex subscription per
 * page, shared by every star on it, and Convex only pushes when its result
 * changes. One write per burst therefore means one re-read per burst.
 *
 * A pending value lives until the backend's own list agrees with it (see
 * `reconcile`), so a star never flickers back while its write is in flight.
 */

/** Long enough to absorb a double-click or a change of mind, short enough to feel saved. */
export const SETTLE_MS = 700;

/** Sends one settled change. Registered by useFavorites, which owns the session and the mutation. */
export type FavoriteWriter = (agentKey: string, favorite: boolean) => Promise<void>;

type FavoritesState = {
  /** agentKey -> the state the person wants, not yet confirmed by the backend. */
  pending: Readonly<Record<string, boolean>>;
  setPending: (agentKey: string, favorite: boolean) => void;
  clearPending: (agentKey: string) => void;
};

export const useFavoritesStore = create<FavoritesState>((set) => ({
  pending: {},
  setPending: (agentKey, favorite) =>
    set((state) => ({ pending: { ...state.pending, [agentKey]: favorite } })),
  clearPending: (agentKey) =>
    set((state) => {
      if (!(agentKey in state.pending)) return state;
      const next = { ...state.pending };
      delete next[agentKey];
      return { pending: next };
    }),
}));

/* ── the write side: module scope, because timers are not React state ────── */

const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** Keys whose write is on the wire; a second write for one waits for it. */
const inFlight = new Set<string>();
let writer: FavoriteWriter | null = null;
/** What the backend last said is starred. Updated by useFavorites on every render. */
let confirmed: ReadonlySet<string> = new Set();

export function registerFavoriteWriter(next: FavoriteWriter | null, serverKeys: ReadonlySet<string>) {
  writer = next;
  confirmed = serverKeys;
}

/** A press: flip locally now, write later. */
export function pressFavorite(agentKey: string, favorite: boolean) {
  useFavoritesStore.getState().setPending(agentKey, favorite);
  const existing = timers.get(agentKey);
  if (existing) clearTimeout(existing);
  timers.set(
    agentKey,
    setTimeout(() => void settle(agentKey), SETTLE_MS),
  );
}

async function settle(agentKey: string) {
  timers.delete(agentKey);
  const store = useFavoritesStore.getState();
  const wanted = store.pending[agentKey];
  if (wanted === undefined) return;

  // Pressed back to where the backend already is: nothing to write.
  if (wanted === confirmed.has(agentKey)) {
    store.clearPending(agentKey);
    return;
  }
  if (!writer) return; // Signed out mid-burst; the pending value is dropped by reconcile.
  if (inFlight.has(agentKey)) {
    // One write per key at a time; look again once the current one lands.
    timers.set(agentKey, setTimeout(() => void settle(agentKey), SETTLE_MS));
    return;
  }

  inFlight.add(agentKey);
  try {
    await writer(agentKey, wanted);
  } catch {
    // The writer has already told the person; show the truth again.
    useFavoritesStore.getState().clearPending(agentKey);
  } finally {
    inFlight.delete(agentKey);
    // Convex can deliver the updated list before this promise settles, while
    // the key was still in flight and so skipped; look again after the render.
    setTimeout(() => reconcileFavorites(confirmed), 0);
  }
}

/** Sends every waiting change now. For a tab being hidden or closed. */
export function flushFavorites() {
  for (const [agentKey, timer] of timers) {
    clearTimeout(timer);
    void settle(agentKey);
  }
}

/**
 * Drops pending values the backend now agrees with - the moment a write has
 * round-tripped - so the backend's list is the source of truth again.
 */
export function reconcileFavorites(serverKeys: ReadonlySet<string>) {
  const { pending, clearPending } = useFavoritesStore.getState();
  for (const [agentKey, favorite] of Object.entries(pending)) {
    if (timers.has(agentKey) || inFlight.has(agentKey)) continue;
    if (serverKeys.has(agentKey) === favorite) clearPending(agentKey);
  }
}
