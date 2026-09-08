"use client";

import { useEffect, useRef } from "react";
import { CategoryGlyph } from "@/components/category-glyph";
import type { AgentProtocol } from "@/hooks/use-agents";

interface FilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  protocol: AgentProtocol | "all";
  onSelectProtocol: (protocol: AgentProtocol | "all") => void;
}

/**
 * FilterModal
 *
 * A serene, floating dialog matching the mobile experience to choose agent kind:
 * All agents, Hire, or Tools.
 */
export function FilterModal({
  isOpen,
  onClose,
  protocol,
  onSelectProtocol,
}: FilterModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const options = [
    {
      value: "all" as const,
      title: "All agents",
      desc: "Everything verified across protocols",
      glyph: "agents" as const,
    },
    {
      value: "a2a" as const,
      title: "Hire",
      desc: "Paid tasks · ERC-8183 escrow",
      glyph: "dollar" as const,
    },
    {
      value: "mcp" as const,
      title: "Tools",
      desc: "Free tools · Call directly via MCP",
      glyph: "spanner" as const,
    },
  ];

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
    >
      {/* Backdrop */}
      <div
        aria-hidden="true"
        className="fixed inset-0 bg-ink/40 backdrop-blur-sm transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Modal Dialog */}
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-sm rounded-3xl border border-line bg-paper p-6 shadow-2xl animate-in zoom-in-95 fade-in duration-200"
      >
        <div className="flex items-center justify-between border-b border-line pb-4">
          <div>
            <h2 className="text-base font-bold text-ink">Filter by Kind</h2>
            <p className="mt-0.5 text-xs text-muted">Select what type of agent to show</p>
          </div>
          <button
            aria-label="Close filter modal"
            className="interactive flex h-8 w-8 items-center justify-center rounded-full border border-line bg-paper-muted text-muted hover:text-ink"
            onClick={onClose}
            type="button"
          >
            <CategoryGlyph color="currentColor" name="close" size={14} />
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-2.5">
          {options.map((opt) => {
            const isSelected = protocol === opt.value;
            return (
              <button
                className={`interactive group flex w-full items-center gap-3.5 rounded-2xl border p-3.5 text-left transition-all ${
                  isSelected
                    ? "border-accent bg-accent-soft shadow-sm"
                    : "border-line bg-paper hover:border-line-strong hover:bg-paper-muted"
                }`}
                key={opt.value}
                onClick={() => {
                  onSelectProtocol(opt.value);
                  onClose();
                }}
                type="button"
              >
                <div
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-colors ${
                    isSelected
                      ? "border-accent bg-accent text-ink"
                      : "border-line bg-paper-muted text-muted group-hover:text-ink"
                  }`}
                >
                  <CategoryGlyph color="currentColor" name={opt.glyph} size={20} />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-ink">{opt.title}</span>
                    {isSelected ? (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-ink">
                        <CategoryGlyph color="currentColor" name="check" size={12} strokeWidth={2.4} />
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-xs leading-4 text-muted">{opt.desc}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
