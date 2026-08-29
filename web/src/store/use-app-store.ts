"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/** A setup saved only on this device; it is never an onchain hire record. */
export type PreviewHire = Readonly<{
  agentId: string;
  savedAt: string;
  source: "local_preview";
  isOnChain: false;
}>;

interface AppState {
  hasCompletedOnboarding: boolean;
  previewHires: PreviewHire[];
  recentSearches: string[];
  setHasCompletedOnboarding: (isComplete: boolean) => void;
  addRecentSearch: (query: string) => void;
  removeRecentSearch: (query: string) => void;
  clearRecentSearches: () => void;
  savePreviewHire: (agentId: string) => void;
  removePreviewHire: (agentId: string) => void;
  clearPreviewHires: () => void;
}

function isPreviewHire(value: unknown): value is PreviewHire {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PreviewHire>;
  return (
    typeof candidate.agentId === "string" &&
    typeof candidate.savedAt === "string" &&
    candidate.source === "local_preview" &&
    candidate.isOnChain === false
  );
}

function migratePersistedState(persistedState: unknown): Partial<AppState> {
  const legacy = (persistedState ?? {}) as Record<string, unknown>;
  const previews = Array.isArray(legacy.previewHires)
    ? legacy.previewHires.filter(isPreviewHire)
    : [];
  const recentSearches = Array.isArray(legacy.recentSearches)
    ? legacy.recentSearches.filter(
        (value): value is string =>
          typeof value === "string" && Boolean(value.trim()),
      )
    : [];

  return {
    hasCompletedOnboarding: legacy.hasCompletedOnboarding === true,
    previewHires: previews,
    recentSearches,
  };
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      hasCompletedOnboarding: false,
      previewHires: [],
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
      savePreviewHire: (agentId) => {
        const normalizedAgentId = agentId.trim();
        if (!normalizedAgentId) return;

        set((state) => {
          if (state.previewHires.some((h) => h.agentId === normalizedAgentId)) {
            return {};
          }
          const previewHire: PreviewHire = {
            agentId: normalizedAgentId,
            savedAt: new Date().toISOString(),
            source: "local_preview",
            isOnChain: false,
          };
          return { previewHires: [...state.previewHires, previewHire] };
        });
      },
      removePreviewHire: (agentId) =>
        set((state) => ({
          previewHires: state.previewHires.filter((h) => h.agentId !== agentId),
        })),
      clearPreviewHires: () => set({ previewHires: [] }),
    }),
    {
      name: "dolphin-web-app-state-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        hasCompletedOnboarding: state.hasCompletedOnboarding,
        previewHires: state.previewHires,
        recentSearches: state.recentSearches,
      }),
      version: 1,
      migrate: migratePersistedState,
    },
  ),
);
