"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { CategoryGlyph } from "@/components/category-glyph";
import type { AgentProtocol } from "@/hooks/use-agents";

interface FilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  protocol: AgentProtocol | "all";
  onSelectProtocol: (protocol: AgentProtocol | "all") => void;
  /**
   * The button that opened it. On desktop the menu opens right under it,
   * right-aligned, instead of in the middle of the page (owner, 2026-09-29:
   * nobody should travel across the screen to reach what they just clicked).
   * Phones keep the centred dialog.
   */
  anchor?: DOMRect | null;
}

const OPTIONS = [
  { value: "all" as const, title: "All agents", desc: "Every agent in the catalog", glyph: "agents" as const },
  { value: "a2a" as const, title: "Hire", desc: "Paid jobs, held in escrow until delivered", glyph: "dollar" as const },
  { value: "mcp" as const, title: "Tools", desc: "Free tools you call directly over MCP", glyph: "spanner" as const },
];

/**
 * Choose the agent type: All, Hire or Tools.
 *
 * Owner, 2026-09-29: a standard dialog - the page behind is blurred with NO
 * tint (the tint read as a white wash in dark mode), plain rows, one check on
 * the selected row. It fades and scales in, and back out on close.
 */
export function FilterModal({ isOpen, onClose, protocol, onSelectProtocol, anchor }: FilterModalProps) {
  const [leaving, setLeaving] = useState(false);

  const close = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) onClose();
    else setLeaving(true);
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) onClose();
        else setLeaving(true);
      }
    };
    // The anchor is a snapshot; if the layout moves, close rather than float loose.
    const handleResize = () => onClose();
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleResize);
    if (anchor) window.addEventListener("scroll", handleResize, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleResize);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResize);
    };
  }, [isOpen, onClose, anchor]);

  if (!isOpen) return null;

  return (
    <div
      aria-labelledby="filter-modal-title"
      aria-modal="true"
      className="filter-modal"
      data-anchored={anchor ? true : undefined}
      data-leaving={leaving || undefined}
      onAnimationEnd={(event) => {
        // The panel's exit is the last to finish; its end closes the dialog.
        if (leaving && (event.target as Element).classList.contains("filter-modal__panel")) {
          setLeaving(false);
          onClose();
        }
      }}
      role="dialog"
    >
      <div aria-hidden="true" className="filter-modal__backdrop" onClick={close} />

      <div
        className="filter-modal__panel"
        style={
          anchor
            ? ({ "--anchor-top": `${anchor.bottom + 8}px`, "--anchor-right": `${window.innerWidth - anchor.right}px` } as CSSProperties)
            : undefined
        }
      >
        {/* A quiet label, not a title: the list is the point (owner, 2026-09-29). Outside click and Escape close it. */}
        <p className="px-3.5 pb-1 pt-2.5 text-[0.66rem] font-semibold uppercase tracking-[0.1em] text-faint" id="filter-modal-title">
          Agent type
        </p>

        <div className="p-1.5 pt-0.5" role="radiogroup" aria-label="Agent type">
          {OPTIONS.map((option) => {
            const isSelected = protocol === option.value;
            return (
              <button
                aria-checked={isSelected}
                className={`flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-left transition-colors ${
                  isSelected ? "bg-paper-muted" : "hover:bg-paper-muted/70"
                }`}
                key={option.value}
                onClick={() => {
                  onSelectProtocol(option.value);
                  close();
                }}
                role="radio"
                type="button"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line/80 text-muted">
                  <CategoryGlyph color="currentColor" name={option.glyph} size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.84rem] font-semibold text-ink">{option.title}</span>
                  <span className="block text-[0.74rem] text-muted">{option.desc}</span>
                </span>
                {isSelected ? (
                  <CategoryGlyph color="var(--ink)" name="check" size={15} strokeWidth={2.2} />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
