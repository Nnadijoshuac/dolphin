"use client";

import { useEffect, useRef, useState } from "react";

import { CategoryGlyph } from "@/components/category-glyph";
import { useToastStore, type Toast } from "@/store/use-toast-store";

/**
 * Where toasts appear. Mounted once, in the root layout. (2026-09-26)
 *
 * WHY A POPOVER. Modals here are native <dialog>s opened with showModal(),
 * which puts them in the browser's top layer, above every z-index. A toast
 * raised while one is open (a cancelled passkey inside Withdraw, say) would
 * sit BEHIND it. A `popover="manual"` element is in the top layer too, and
 * re-showing it moves it to the top of that stack, so each new toast is
 * raised above whatever dialog is open.
 */

const LIFETIME_MS: Record<Toast["tone"], number> = {
  error: 7000,
  notice: 4000,
  success: 5000,
};

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((state) => state.dismiss);
  const [paused, setPaused] = useState(false);
  /*
   * LEAVING (owner, 2026-09-29: "it should slide in from the side it comes
   * out of, and slide back out"). A toast plays its exit before it is removed;
   * the store only drops it once the animation has finished.
   */
  const [leaving, setLeaving] = useState(false);
  const leave = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) dismiss(toast.id);
    else setLeaving(true);
  };

  useEffect(() => {
    if (paused || leaving) return;
    const timer = window.setTimeout(() => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) dismiss(toast.id);
      else setLeaving(true);
    }, LIFETIME_MS[toast.tone]);
    return () => window.clearTimeout(timer);
  }, [dismiss, leaving, paused, toast.id, toast.tone]);

  return (
    <div
      className={`toast toast--${toast.tone}`}
      data-leaving={leaving || undefined}
      onAnimationEnd={(event) => {
        if (leaving && event.target === event.currentTarget) dismiss(toast.id);
      }}
      onBlur={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      role={toast.tone === "error" ? "alert" : "status"}
    >
      <span aria-hidden className="toast__dot" />
      <p className="toast__message">
        {toast.message}
        {toast.link ? (
          <>
            {" "}
            <a className="toast__link" href={toast.link.href} rel="noreferrer" target="_blank">
              {toast.link.label}
            </a>
          </>
        ) : null}
      </p>
      <button
        aria-label="Dismiss"
        className="toast__close"
        onClick={leave}
        type="button"
      >
        <CategoryGlyph color="currentColor" name="close" size={12} strokeWidth={2.2} />
      </button>
    </div>
  );
}

export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  const ref = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof element.showPopover !== "function") return;
    const grew = toasts.length > lastCount.current;
    lastCount.current = toasts.length;

    if (toasts.length === 0) {
      if (element.matches(":popover-open")) element.hidePopover();
      return;
    }
    // Re-show on every new toast so it rises above a dialog opened since.
    if (grew && element.matches(":popover-open")) element.hidePopover();
    if (!element.matches(":popover-open")) element.showPopover();
  }, [toasts]);

  return (
    <div aria-live="polite" className="toaster" popover="manual" ref={ref}>
      {toasts.map((item) => (
        <ToastItem key={item.id} toast={item} />
      ))}
    </div>
  );
}
