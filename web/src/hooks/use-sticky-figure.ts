"use client";

export type Figure = { figure: string; unit: string | null };

/*
 * The last figure each balance showed (owner, 2026-10-17: the balance "goes out, no figures appear at
 * all, and then it brings out the figure... it looks like you lost internet"; then: "it takes way too
 * long for the total balance to show").
 *
 * A re-read, a one-off failed token read, or a remount used to blank the number until the next answer,
 * and a fresh page load waited several seconds of public-RPC reads before showing anything. The last
 * real reading now stays on screen until a new one replaces it, and is remembered on this device, so
 * the page opens on it and rolls to the fresh value. The key carries everything the figure depends on
 * (which wallets, which asset, BNB or USD, hidden or not), so a different question never shows an old
 * answer, and a balance never read on this device still shows its loading state.
 *
 * Browser storage only - it never leaves the device - and every access is guarded, because storage
 * can be blocked or full.
 */
const STORAGE_KEY = "dolphin.balances.v1";
const lastKnown = new Map<string, Figure>();
let loaded = false;

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    for (const [key, value] of Object.entries(JSON.parse(raw) as Record<string, Figure>)) {
      if (value && typeof value.figure === "string") lastKnown.set(key, value);
    }
  } catch {
    // Unreadable storage means no head start, not a broken page.
  }
}

function save() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(lastKnown)));
  } catch {
    // Same: the in-memory copy still works for this tab.
  }
}

export function useStickyFigure(key: string, value: Figure | null): Figure | null {
  load();
  if (value) {
    const before = lastKnown.get(key);
    if (!before || before.figure !== value.figure || before.unit !== value.unit) {
      lastKnown.set(key, value);
      if (typeof window !== "undefined") save();
    }
  }
  return value ?? lastKnown.get(key) ?? null;
}
