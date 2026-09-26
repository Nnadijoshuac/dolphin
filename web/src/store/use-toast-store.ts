import { create } from "zustand";

import { isCancellationMessage } from "@/wallet/wallet-errors";

/**
 * Toasts: short notices that arrive, stay a few seconds, and leave. (2026-09-26)
 *
 * They replace errors printed inline in red wherever an action failed. The
 * owner cancelled a passkey on purpose and got "Failed to request credential."
 * wedged into the card; a notice at the edge of the screen says the same thing
 * without taking the page over.
 *
 * Tones:
 *   - error   something went wrong and the person may want to act
 *   - notice  nothing went wrong (a cancelled prompt); neutral, no alarm colour
 *   - success it worked
 */
export type ToastTone = "error" | "notice" | "success";

export type Toast = Readonly<{
  id: number;
  tone: ToastTone;
  message: string;
  /** Optional link, e.g. a transaction on BscScan. */
  link?: Readonly<{ label: string; href: string }>;
}>;

type ToastState = {
  toasts: readonly Toast[];
  push: (toast: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
};

/** At most this many at once; the oldest leaves when a new one arrives. */
const MAX_VISIBLE = 3;

let nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) =>
    set((state) => {
      // The same message twice in a row is one toast, not a stack of copies.
      const latest = state.toasts[state.toasts.length - 1];
      if (latest && latest.message === toast.message && latest.tone === toast.tone) return state;
      return { toasts: [...state.toasts, { ...toast, id: nextId++ }].slice(-MAX_VISIBLE) };
    }),
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

/** Callable from anywhere, including outside React. */
export const toast = {
  error: (message: string, link?: Toast["link"]) =>
    useToastStore.getState().push({
      // A cancellation is not an error, whatever path reported it.
      tone: isCancellationMessage(message) ? "notice" : "error",
      message,
      link,
    }),
  notice: (message: string) => useToastStore.getState().push({ tone: "notice", message }),
  success: (message: string, link?: Toast["link"]) =>
    useToastStore.getState().push({ tone: "success", message, link }),
};
