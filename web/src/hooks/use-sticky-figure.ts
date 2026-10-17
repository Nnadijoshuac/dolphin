"use client";

export type Figure = { figure: string; unit: string | null };

/*
 * The last figure each balance showed, for the life of the tab (owner, 2026-10-17: the balance "goes
 * out, no figures appear at all, and then it brings out the figure... it looks like you lost internet").
 *
 * A re-read, a one-off failed token read, or a remount used to blank the number until the next answer.
 * The last real reading stays on screen until a new one replaces it. The key carries everything the
 * figure depends on (which wallet, which asset, BNB or USD, hidden or not), so a different question
 * never shows an old answer, and a balance never seen before still shows its loading state.
 */
const lastKnown = new Map<string, Figure>();

export function useStickyFigure(key: string, value: Figure | null): Figure | null {
  if (value) lastKnown.set(key, value);
  return value ?? lastKnown.get(key) ?? null;
}
