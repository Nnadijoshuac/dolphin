"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Entry = { href: string; page: string; section: string; text: string };

/**
 * SEARCH THE DOCS (owner, 2026-10-03, after nextra.site: "somebody looking for a keyword can search
 * the documents"). Ctrl/⌘ K anywhere in the docs. The index is built in the browser on first open
 * from the docs pages themselves - each section's heading and words - so it can never drift from
 * what the pages say, and costs the database nothing.
 */
let indexPromise: Promise<Entry[]> | null = null;

export const HIT_KEY = "dolphin.docs-hit";
export const HIT_EVENT = "dolphin:docs-hit";

/**
 * WHERE THE SEARCH POINTED (owner, 2026-10-03: "let the paragraph glow twice, then out, so the
 * person knows why they are here"). After a search jump, the first paragraph or list item in the
 * section that contains every searched word glows twice and fades. Reduced motion: a still tint.
 */
export function SearchHighlighter() {
  useEffect(() => {
    let timers: number[] = [];
    const run = () => {
      let hit: { href: string; words: string[]; at: number } | null = null;
      try {
        hit = JSON.parse(sessionStorage.getItem(HIT_KEY) ?? "null");
      } catch {
        hit = null;
      }
      if (!hit || Date.now() - hit.at > 10_000) return;
      const [path, id] = hit.href.split("#");
      const words = hit.words;
      let tries = 0;
      // Navigation and scrolling land a moment after the click; look until the section is there.
      const attempt = () => {
        tries++;
        const section = window.location.pathname === path && id ? document.getElementById(id) : null;
        if (!section) {
          if (tries < 20) timers.push(window.setTimeout(attempt, 150));
          return;
        }
        sessionStorage.removeItem(HIT_KEY);
        const blocks = [...section.querySelectorAll<HTMLElement>(".docs-body p, .docs-body li, .docs-body td, .docs-code")];
        const target = blocks.find((block) => words.every((word) => (block.textContent ?? "").toLowerCase().includes(word))) ?? blocks.find((block) => words.some((word) => (block.textContent ?? "").toLowerCase().includes(word))) ?? section.querySelector("h2");
        if (!target) return;
        target.scrollIntoView({ block: "center", behavior: "smooth" });
        target.classList.remove("docs-hit");
        void target.offsetWidth; // restart the animation on a repeat search
        target.classList.add("docs-hit");
        // Cleared by the element itself, not a timer this page might cancel while navigating away.
        const clear = () => target.classList.remove("docs-hit");
        target.addEventListener("animationend", clear, { once: true });
        window.setTimeout(clear, 2600);
      };
      attempt();
    };
    run();
    window.addEventListener(HIT_EVENT, run);
    return () => {
      window.removeEventListener(HIT_EVENT, run);
      timers.forEach((timer) => window.clearTimeout(timer));
      timers = [];
    };
  }, []);
  return null;
}

async function buildIndex(pages: { href: string; label: string }[]): Promise<Entry[]> {
  const entries: Entry[] = [];
  await Promise.all(
    pages.map(async ({ href, label }) => {
      try {
        const html = await (await fetch(href)).text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        doc.querySelectorAll<HTMLElement>("[data-docs-article] section[id]").forEach((section) => {
          section.querySelectorAll(".docs-anchor, .docs-copy").forEach((element) => element.remove());
          const heading = section.querySelector("h2")?.textContent?.trim() ?? label;
          // Block by block, with a space between, so words from two paragraphs never run together.
          const text = [...section.querySelectorAll("p, li, td, th, h3, figcaption, pre")]
            .map((block) => block.textContent ?? "")
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
          entries.push({ href: `${href}#${section.id}`, page: label, section: heading, text });
        });
      } catch {
        /* A page that did not load is simply not searchable this time. */
      }
    }),
  );
  return entries;
}

function snippet(text: string, words: string[]): string {
  const lower = text.toLowerCase();
  const at = Math.max(0, Math.min(...words.map((word) => lower.indexOf(word)).filter((index) => index >= 0)));
  const start = Math.max(0, at - 50);
  return `${start > 0 ? "…" : ""}${text.slice(start, start + 150)}${start + 150 < text.length ? "…" : ""}`;
}

export function DocsSearch({ pages, hotkey = true, variant = "box" }: { pages: { href: string; label: string }[]; hotkey?: boolean; variant?: "box" | "icon" }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<Entry[] | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // One Ctrl K listener per page: the phone search box opens only by tap.
    if (!hotkey) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      } else if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkey]);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    indexPromise ??= buildIndex(pages);
    let live = true;
    void indexPromise.then((entries) => live && setIndex(entries));
    return () => {
      live = false;
    };
  }, [open, pages]);

  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter((word) => word.length > 1);
    if (!index || words.length === 0) return [];
    return index
      .map((entry) => {
        const hay = `${entry.section} ${entry.text}`.toLowerCase();
        if (!words.every((word) => hay.includes(word))) return null;
        const score = words.reduce((sum, word) => sum + (entry.section.toLowerCase().includes(word) ? 5 : 0) + (hay.split(word).length - 1), 0);
        return { entry, score, words };
      })
      .filter((hit): hit is { entry: Entry; score: number; words: string[] } => hit !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
  }, [index, query]);

  return (
    <>
      {variant === "icon" ? (
        <button aria-label="Search the docs" className="docs-mbar__button" onClick={() => setOpen(true)} type="button">
          <svg aria-hidden fill="none" height={19} viewBox="0 0 24 24" width={19}>
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          </svg>
        </button>
      ) : (
      <button className="docs-searchbox" onClick={() => setOpen(true)} type="button">
        <svg aria-hidden fill="none" height={14} viewBox="0 0 24 24" width={14}>
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <path d="m20 20-3.5-3.5" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
        </svg>
        <span>Search docs…</span>
        <kbd>Ctrl K</kbd>
      </button>
      )}
      {/* On document.body: inside the sticky sidebar the dialog sat under the page's own headings. */}
      {open && typeof document !== "undefined" ? createPortal(
        <div aria-label="Search the docs" aria-modal className="docs-search" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)} role="dialog">
          <div className="docs-search__panel">
            <input
              aria-label="Search the docs"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search the docs - e.g. escrow, leverage, MCP, testnet"
              ref={input}
              value={query}
            />
            <div className="docs-search__results">
              {index === null ? (
                <p className="docs-search__empty">Loading the docs…</p>
              ) : query.trim().length < 2 ? (
                <p className="docs-search__empty">Type a word to search every docs page.</p>
              ) : results.length === 0 ? (
                <p className="docs-search__empty">Nothing matches &ldquo;{query}&rdquo;.</p>
              ) : (
                results.map(({ entry, words }) => (
                  <Link
                    href={entry.href}
                    key={entry.href}
                    onClick={() => {
                      // Tell the page which words brought the reader, so it can point at the paragraph.
                      try {
                        sessionStorage.setItem(HIT_KEY, JSON.stringify({ href: entry.href, words, at: Date.now() }));
                      } catch {
                        /* Blocked storage: the reader still lands on the section. */
                      }
                      window.dispatchEvent(new Event(HIT_EVENT));
                      setOpen(false);
                    }}
                  >
                    <small>{entry.page}</small>
                    <strong>{entry.section}</strong>
                    <span>{snippet(entry.text, words)}</span>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
