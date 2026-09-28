"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * A panel that slides in over the page from one edge. (owner, 2026-09-28)
 *
 * "The panel should scroll into the screen just like the right panel does -
 * no white overlay, the background should blur a little, and the shadow of the
 * panel." So the backdrop is a blur with no tint, and the panel slides in
 * AND out: it stays mounted through its exit animation, then unmounts.
 *
 * Motion is CSS (globals.css `.slide-over*`), so prefers-reduced-motion turns
 * it into a plain show/hide there.
 */
export function SlideOver({
  open,
  side,
  label,
  onClose,
  className = "",
  children,
}: {
  open: boolean;
  side: "left" | "right";
  label: string;
  onClose: () => void;
  /** Extra classes for the panel, e.g. `lg:hidden` or a width. */
  className?: string;
  children: ReactNode;
}) {
  // Kept mounted while closing so the exit can play. Updated during render -
  // React's documented way to adjust state to a prop, with no effect pass.
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  if (!mounted) return null;
  const state = open ? "open" : "closed";

  return (
    <div
      className={`slide-over fixed inset-0 z-30 flex ${side === "left" ? "justify-start" : "justify-end"} ${className}`}
      data-state={state}
    >
      <button aria-label={`Close ${label}`} className="slide-over__backdrop absolute inset-0" onClick={onClose} type="button" />
      <div
        aria-label={label}
        className={`slide-over__panel slide-over__panel--${side} relative h-full`}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget && !open) setMounted(false);
        }}
        role="dialog"
      >
        {children}
      </div>
    </div>
  );
}
