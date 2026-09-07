import AsyncStorage from "@react-native-async-storage/async-storage";
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
  /**
   * Whether the "tap Use to copy the link" hint has been dismissed for good.
   *
   * It explains a control that is one tap away and self-evident once used, so
   * it is worth showing once and never being a toll on every subsequent visit.
   * "Okay" closes this time; this flag is what "Don't show again" writes.
   */
  hasDismissedUseHint: boolean;
  previewHires: PreviewHire[];
  recentSearches: string[];
  setHasCompletedOnboarding: (isComplete: boolean) => void;
  dismissUseHint: () => void;
  addRecentSearch: (query: string) => void;
  removeRecentSearch: (query: string) => void;
  clearRecentSearches: () => void;
  savePreviewHire: (agentId: string) => void;
  removePreviewHire: (agentId: string) => void;
  clearPreviewHires: () => void;
}

type LegacyPersistedState = {
  hasCompletedOnboarding?: unknown;
  hasDismissedUseHint?: unknown;
  previewHires?: unknown;
  hiredAgents?: unknown;
  recentSearches?: unknown;
};

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
  const legacy = (persistedState ?? {}) as LegacyPersistedState;
  const previews = Array.isArray(legacy.previewHires)
    ? legacy.previewHires.filter(isPreviewHire)
    : [];
  const formerLocalHires = Array.isArray(legacy.hiredAgents)
    ? legacy.hiredAgents.flatMap((value): PreviewHire[] => {
        if (!value || typeof value !== "object") return [];
        const agentId = (value as { agentId?: unknown }).agentId;
        if (typeof agentId !== "string" || !agentId.trim()) return [];
        return [
          {
            agentId: agentId.trim(),
            savedAt: new Date().toISOString(),
            source: "local_preview",
            isOnChain: false,
          },
        ];
      })
    : [];
  const previewHires = [...previews, ...formerLocalHires].filter(
    (preview, index, collection) =>
      collection.findIndex((item) => item.agentId === preview.agentId) === index,
  );
  const recentSearches = Array.isArray(legacy.recentSearches)
    ? legacy.recentSearches.filter(
        (value): value is string =>
          typeof value === "string" && Boolean(value.trim()),
      )
    : [];

  return {
    hasCompletedOnboarding: legacy.hasCompletedOnboarding === true,
    // Absent on every store written before this existed, which reads as "not
    // dismissed" - the correct answer for someone who has never seen it.
    hasDismissedUseHint: legacy.hasDismissedUseHint === true,
    previewHires,
    recentSearches,
  };
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      hasCompletedOnboarding: false,
      hasDismissedUseHint: false,
      previewHires: [],
      recentSearches: [],
      setHasCompletedOnboarding: (isComplete) =>
        set({ hasCompletedOnboarding: isComplete }),
      dismissUseHint: () => set({ hasDismissedUseHint: true }),
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
      name: "dolphin-app-state-v2",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        hasCompletedOnboarding: state.hasCompletedOnboarding,
        hasDismissedUseHint: state.hasDismissedUseHint,
        previewHires: state.previewHires,
        recentSearches: state.recentSearches,
      }),
      version: 3,
      migrate: migratePersistedState,
    },
  ),
);
