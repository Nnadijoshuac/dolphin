import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Where a person was on /dolphin, so leaving the page and coming back - or
 * reloading - puts them back there. (owner, 2026-09-28: "when users switch
 * pages, let it remember where they were, especially in dolphin page")
 *
 * Browser-only, like the chat history beside it (use-app-store.ts). None of
 * this is a record of anything and none of it touches the database - the
 * owner is keeping database I/O to a minimum, and a scroll offset has no
 * business costing a write.
 *
 *  - conversationKey / newMode / composer: persisted to localStorage, so a
 *    reload or a new tab resumes too.
 *  - scroll: memory only. It only has to survive moving between pages in one
 *    tab, and a stale offset after a reload would land somewhere arbitrary.
 *
 * Read after mount only (dolphin-client restores in an effect), because
 * zustand/persist hydrates from localStorage on the client and the server
 * render must not depend on it (see onboarding-prompt.tsx on React #418).
 */

/** The composer key for "a new conversation that has not started yet". */
export const NEW_CONVERSATION = "new";
const MAX_COMPOSERS = 20;
const MAX_COMPOSER_CHARS = 4_000;

type DolphinPlaceState = {
  conversationKey: string | null;
  newMode: "chat" | "build";
  /** Unsent text per conversation key (or NEW_CONVERSATION). */
  composer: Record<string, string>;
  /** Scroll offset of the transcript per conversation key. Not persisted. */
  scroll: Record<string, number>;
  setConversationKey: (key: string | null) => void;
  setNewMode: (mode: "chat" | "build") => void;
  setComposer: (key: string, text: string) => void;
  setScroll: (key: string, top: number) => void;
};

export const useDolphinPlaceStore = create<DolphinPlaceState>()(
  persist(
    (set) => ({
      conversationKey: null,
      newMode: "chat",
      composer: {},
      scroll: {},
      setConversationKey: (conversationKey) => set({ conversationKey }),
      setNewMode: (newMode) => set({ newMode }),
      setComposer: (key, text) =>
        set((state) => {
          const next = { ...state.composer };
          delete next[key];
          const trimmed = text.slice(0, MAX_COMPOSER_CHARS);
          if (trimmed.trim().length === 0) return { composer: next };
          // Newest last, oldest dropped past the cap.
          const entries = [...Object.entries(next), [key, trimmed] as const].slice(-MAX_COMPOSERS);
          return { composer: Object.fromEntries(entries) };
        }),
      setScroll: (key, top) => set((state) => ({ scroll: { ...state.scroll, [key]: top } })),
    }),
    {
      name: "dolphin.place.v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        conversationKey: state.conversationKey,
        newMode: state.newMode,
        composer: state.composer,
      }),
    },
  ),
);
