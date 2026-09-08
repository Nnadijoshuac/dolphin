"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Per-device UI state. Nothing here is a record of anything.
 *
 * ===========================================================================
 * `previewHires` WAS REMOVED (2026-09-08)
 * ===========================================================================
 * The store carried a `PreviewHire` type, three actions to manage them
 * (`savePreviewHire`, `removePreviewHire`, `clearPreviewHires`), a type guard,
 * and migration logic - and NOTHING IN THIS PROJECT EVER CALLED
 * `savePreviewHire`. The array could only ever be empty, which meant the
 * "Device previews" section on /my-agents that rendered from it - heading,
 * count, explanatory copy and all - was unreachable UI for a feature that was
 * never built.
 *
 * `hasCompletedOnboarding` is KEPT and is now genuinely used: it was in the
 * same state (persisted, read by nothing) because the website had no onboarding
 * at all, which app/onboarding now provides.
 *
 * The persisted key is bumped to v2 so a browser holding the old shape drops
 * the dead array rather than carrying it forever.
 */
interface AppState {
  hasCompletedOnboarding: boolean;
  recentSearches: string[];
  setHasCompletedOnboarding: (isComplete: boolean) => void;
  addRecentSearch: (query: string) => void;
  removeRecentSearch: (query: string) => void;
  clearRecentSearches: () => void;
}

function migratePersistedState(persistedState: unknown): Partial<AppState> {
  const legacy = (persistedState ?? {}) as Record<string, unknown>;
  const recentSearches = Array.isArray(legacy.recentSearches)
    ? legacy.recentSearches.filter(
        (value): value is string =>
          typeof value === "string" && Boolean(value.trim()),
      )
    : [];

  return {
    hasCompletedOnboarding: legacy.hasCompletedOnboarding === true,
    recentSearches,
  };
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      hasCompletedOnboarding: false,
      recentSearches: [],
      setHasCompletedOnboarding: (isComplete) =>
        set({ hasCompletedOnboarding: isComplete }),
      addRecentSearch: (query) => {
        const trimmed = query.trim();
        if (!trimmed) return;
        set((state) => ({
          recentSearches: [
            trimmed,
            ...state.recentSearches.filter((item) => item.toLowerCase() !== trimmed.toLowerCase()),
          ].slice(0, 8),
        }));
      },
      removeRecentSearch: (query) => {
        set((state) => ({
          recentSearches: state.recentSearches.filter((item) => item !== query),
        }));
      },
      clearRecentSearches: () => set({ recentSearches: [] }),
    }),
    {
      name: "dolphin-web-app-state-v2",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        hasCompletedOnboarding: state.hasCompletedOnboarding,
        recentSearches: state.recentSearches,
      }),
      version: 2,
      migrate: migratePersistedState,
    },
  ),
);
