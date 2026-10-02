"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * AN ⓘ THAT EXPLAINS (owner, 2026-10-02). Opens on hover, on keyboard focus
 * and on tap (phones have no hover); Escape or a tap elsewhere closes it.
 */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <span className="info-tip" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} ref={box}>
      <button
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        aria-label={label}
        className="info-tip__button"
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((value) => !value)}
        onFocus={() => setOpen(true)}
        type="button"
      >
        i
      </button>
      {open ? (
        <span className="info-tip__panel" id={id} role="tooltip">
          {children}
        </span>
      ) : null}
    </span>
  );
}
