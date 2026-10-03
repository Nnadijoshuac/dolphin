"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { BrandMark } from "@/components/brand-mark";
import { DocsSearch } from "@/components/docs-search";

type Group = { group: string; items: { href: string; label: string }[] };

/**
 * THE DOCS ON A PHONE (owner, 2026-10-03: "look at how Nextra did their mobile"). One slim sticky
 * bar - the mark and "Docs", search, menu - and the whole docs menu behind one button as a
 * full-screen sheet, with search at its top and the current page highlighted. The site's own
 * menu stays one tap away from the sheet.
 */
export function DocsMobileBar({ groups, current, pages }: { groups: Group[]; current: string; pages: { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // A page change closes the sheet, the way a tap on a link should.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", escape);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div className="docs-mbar">
      <div className="docs-mbar__row">
        <Link className="docs-mbar__brand" href="/docs">
          <BrandMark size={24} />
          <span>Dolphin</span>
          <em>Docs</em>
        </Link>
        <div className="docs-mbar__actions">
          <DocsSearch hotkey={false} pages={pages} variant="icon" />
          <button aria-expanded={open} aria-label={open ? "Close the docs menu" : "Open the docs menu"} className="docs-mbar__button" onClick={() => setOpen((value) => !value)} type="button">
            <svg aria-hidden fill="none" height={20} viewBox="0 0 24 24" width={20}>
              {open ? (
                <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
              ) : (
                <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
              )}
            </svg>
          </button>
        </div>
      </div>
      {/* On document.body: inside the blurred bar a fixed sheet is trapped in the bar's own box. */}
      {open && typeof document !== "undefined" ? createPortal(
        <div className="docs-msheet">
          <DocsSearch hotkey={false} pages={pages} />
          <nav aria-label="Docs">
            {groups.map((section) => (
              <div className="docs-msheet__group" key={section.group}>
                <p>{section.group}</p>
                {section.items.map((item) => (
                  <Link aria-current={item.href === current ? "page" : undefined} href={item.href} key={item.href} onClick={() => setOpen(false)}>
                    {item.label}
                  </Link>
                ))}
              </div>
            ))}
          </nav>
          <div className="docs-msheet__site">
            <Link href="/">Back to Dolphin</Link>
            <button
              onClick={() => {
                setOpen(false);
                window.dispatchEvent(new CustomEvent("dolphin:mobile-menu-open"));
              }}
              type="button"
            >
              Site menu
            </button>
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

/**
 * Tables become labelled cards on a phone: each cell is given its column's heading as
 * `data-label`, which the phone CSS prints above the value. Read from the table itself, so a new
 * table needs nothing extra.
 */
export function TableLabels() {
  useEffect(() => {
    document.querySelectorAll<HTMLTableElement>("[data-docs-article] table").forEach((table) => {
      const heads = [...table.querySelectorAll("thead th")].map((th) => th.textContent?.trim() ?? "");
      table.querySelectorAll("tbody tr").forEach((row) => {
        [...row.children].forEach((cell, index) => cell.setAttribute("data-label", heads[index] ?? ""));
      });
    });
  }, []);
  return null;
}
