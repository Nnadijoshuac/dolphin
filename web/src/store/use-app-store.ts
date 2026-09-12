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
/**
 * Which denomination the wallet screen shows. Persisted because it is a
 * preference, not a session detail — someone who thinks in dollars thinks in
 * dollars tomorrow too, and asking again every visit is the kind of small
 * forgetting that makes software feel rented.
 *
 * BNB is the default: it is the only figure Dolphin can always show. USD needs
 * a live Chainlink round (see wallet/bnb-price.ts) and is refused when that
 * round cannot be read — the preference is remembered, but it never forces a
 * dollar figure into existence.
 */
export type DisplayCurrency = "BNB" | "USD";

interface AppState {
  hasCompletedOnboarding: boolean;
  chatHistory: ChatHistoryEntry[];
  recentSearches: string[];
  displayCurrency: DisplayCurrency;
  /** Shoulder-surfing cover for balances. Per device, deliberately. */
  hideBalances: boolean;
  setDisplayCurrency: (currency: DisplayCurrency) => void;
  toggleHideBalances: () => void;
  setHasCompletedOnboarding: (isComplete: boolean) => void;
  addRecentSearch: (query: string) => void;
  removeRecentSearch: (query: string) => void;
  clearRecentSearches: () => void;
  upsertChatHistory: (entry: ChatHistoryEntry) => void;
  removeChatHistory: (conversationKey: string) => void;
  clearChatHistory: () => void;
}

export type ChatHistoryEntry = Readonly<{
  conversationKey: string;
  title: string;
  updatedAt: number;
}>;

function isChatHistoryEntry(value: unknown): value is ChatHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ChatHistoryEntry>;
  return (
    typeof candidate.conversationKey === "string" &&
    Boolean(candidate.conversationKey.trim()) &&
    typeof candidate.title === "string" &&
    Number.isFinite(candidate.updatedAt)
  );
}

function migratePersistedState(persistedState: unknown): Partial<AppState> {
  const legacy = (persistedState ?? {}) as Record<string, unknown>;
  const recentSearches = Array.isArray(legacy.recentSearches)
    ? legacy.recentSearches.filter(
        (value): value is string =>
          typeof value === "string" && Boolean(value.trim()),
      )
    : [];
  const chatHistory = Array.isArray(legacy.chatHistory)
    ? legacy.chatHistory.filter(isChatHistoryEntry).slice(0, 24)
    : [];

  return {
    hasCompletedOnboarding: legacy.hasCompletedOnboarding === true,
    chatHistory,
    recentSearches,
    // Anything that is not the literal "USD" falls back to BNB — the figure
    // Dolphin can always show without a price feed.
    displayCurrency: legacy.displayCurrency === "USD" ? "USD" : "BNB",
    hideBalances: legacy.hideBalances === true,
  };
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      hasCompletedOnboarding: false,
      chatHistory: [],
      recentSearches: [],
      displayCurrency: "BNB",
      hideBalances: false,
      setDisplayCurrency: (displayCurrency) => set({ displayCurrency }),
      toggleHideBalances: () =>
        set((state) => ({ hideBalances: !state.hideBalances })),
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
      upsertChatHistory: (entry) => {
        const conversationKey = entry.conversationKey.trim();
        if (!conversationKey) return;
        const title = entry.title.trim() || "New conversation";
        set((state) => ({
          chatHistory: [
            { conversationKey, title, updatedAt: entry.updatedAt },
            ...state.chatHistory.filter((item) => item.conversationKey !== conversationKey),
          ]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, 24),
        }));
      },
      removeChatHistory: (conversationKey) =>
        set((state) => ({
          chatHistory: state.chatHistory.filter(
            (item) => item.conversationKey !== conversationKey,
          ),
        })),
      clearChatHistory: () => set({ chatHistory: [] }),
    }),
    {
      name: "dolphin-web-app-state-v2",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        hasCompletedOnboarding: state.hasCompletedOnboarding,
        chatHistory: state.chatHistory,
        recentSearches: state.recentSearches,
        displayCurrency: state.displayCurrency,
        hideBalances: state.hideBalances,
      }),
      // 4: added displayCurrency + hideBalances. migratePersistedState defaults
      // both, so an older persisted blob upgrades rather than being discarded.
      version: 4,
      migrate: migratePersistedState,
    },
  ),
);
