"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

/**
 * A dropdown that looks like Dolphin, not like Windows. (owner, 2026-09-28:
 * "the native Windows drop down is ugly".)
 *
 * A button that opens a floating list - searchable when the list is long,
 * keyboard-driven (arrows, Enter, Escape), closed by a click outside.
 * `allowCustom` turns the search box into a free-text entry, for a model id
 * the list does not know yet.
 */

export type Choice = { value: string; label: string; hint?: string };

export function ChoiceList({
  ariaLabel,
  choices,
  value,
  onChange,
  placeholder = "Choose…",
  searchable,
  allowCustom,
  mono,
  footer,
}: {
  ariaLabel: string;
  choices: Choice[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Defaults to on above 8 choices. */
  searchable?: boolean;
  allowCustom?: boolean;
  mono?: boolean;
  /** An extra row under the list, e.g. "Paste a new key". */
  footer?: { label: string; onSelect: () => void };
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const withSearch = searchable ?? (choices.length > 8 || Boolean(allowCustom));

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return choices;
    return choices.filter((choice) => `${choice.label} ${choice.value} ${choice.hint ?? ""}`.toLowerCase().includes(needle));
  }, [choices, query]);
  const custom = allowCustom && query.trim() && !choices.some((choice) => choice.value === query.trim()) ? query.trim() : null;
  const rows: Choice[] = custom ? [{ value: custom, label: custom, hint: "use this" }, ...filtered] : filtered;

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const openList = () => {
    setQuery("");
    setActive(Math.max(0, choices.findIndex((choice) => choice.value === value)));
    setOpen(true);
  };

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  const onKey = (event: React.KeyboardEvent) => {
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openList();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(rows.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = rows[active];
      if (row) pick(row.value);
    }
  };

  const selected = choices.find((choice) => choice.value === value);
  const shown = selected?.label ?? (value || null);

  return (
    <div className="choice-list relative" onKeyDown={onKey} ref={root}>
      <button
        aria-controls={listId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className="choice-list__trigger"
        data-open={open || undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        type="button"
      >
        <span className={`min-w-0 flex-1 truncate text-left ${mono ? "font-mono" : ""} ${shown ? "text-ink" : "text-muted"}`}>
          {shown ?? placeholder}
        </span>
        {selected?.hint ? <span className="shrink-0 text-[0.7rem] text-muted">{selected.hint}</span> : null}
        <svg aria-hidden className="choice-list__chevron" fill="none" height="14" viewBox="0 0 16 16" width="14">
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
        </svg>
      </button>

      {open ? (
        <div className="choice-list__pop" ref={(node) => node?.scrollIntoView({ block: "nearest", behavior: "smooth" })}>
          {withSearch ? (
            <input
              aria-label={`Search ${ariaLabel}`}
              autoComplete="off"
              autoFocus
              className={`choice-list__search ${mono ? "font-mono" : ""}`}
              data-1p-ignore
              data-lpignore="true"
              name="dolphin-choice-search"
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              placeholder={allowCustom ? "Search, or type your own…" : "Search…"}
              spellCheck={false}
              value={query}
            />
          ) : null}
          <ul className="choice-list__rows sleek-scroll" id={listId} role="listbox">
            {rows.length === 0 ? <li className="px-3 py-2 text-[0.75rem] text-muted">Nothing matches.</li> : null}
            {rows.map((row, index) => (
              <li
                aria-selected={row.value === value}
                className="choice-list__row"
                data-active={index === active || undefined}
                key={`${row.value}-${index}`}
                onClick={() => pick(row.value)}
                onPointerMove={() => setActive(index)}
                role="option"
              >
                <span className={`min-w-0 flex-1 truncate ${mono ? "font-mono" : ""}`}>{row.label}</span>
                {row.hint ? <span className="shrink-0 text-[0.68rem] text-muted">{row.hint}</span> : null}
                {row.value === value ? (
                  <svg aria-hidden className="shrink-0 text-accent-ink" fill="none" height="13" viewBox="0 0 16 16" width="13">
                    <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                  </svg>
                ) : null}
              </li>
            ))}
          </ul>
          {footer ? (
            <button
              className="choice-list__footer"
              onClick={() => {
                setOpen(false);
                footer.onSelect();
              }}
              type="button"
            >
              {footer.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
