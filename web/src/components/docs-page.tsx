import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { CopyButton, CopyPageMenu, DocsSideNav, Toc } from "@/components/docs-client";
import { DocsMobileBar, TableLabels } from "@/components/docs-mobile";
import { DocsSearch, SearchHighlighter } from "@/components/docs-search";

export type DocsSection = { id: string; title: string; body: ReactNode };

/**
 * THE DOCS (owner, 2026-10-03: "use nextra.site/docs as a reference"). Grouped sidebar, breadcrumbs, a Copy page menu, sections with ruled headings, an
 * "On this page" list that follows the reader, and previous / next links.
 *
 * Every number on these pages is a constant in the code or a published contract value - no TVL,
 * volume or user count (AGENTS.md §5). If the code changes, the page changes with it.
 */
type LibraryGroup = { group: string; items: { href: string; label: string }[] };

/*
 * The docs only. Legal pages are deliberately NOT here (owner, on counsel's advice, 2026-10-03):
 * they stay on the website in their own layout, with no Copy page and no "Open in ChatGPT /
 * Claude", and nothing legal reaches the MCP. Docs may link to them; they never include them.
 */
export const LIBRARY: LibraryGroup[] = [
  { group: "Get started", items: [{ href: "/docs", label: "How it works" }] },
  {
    group: "Use Dolphin",
    items: [
      { href: "/docs/use", label: "Using agents" },
      { href: "/docs/payments", label: "Payments" },
    ],
  },
  { group: "Build", items: [{ href: "/docs/build", label: "Building agents" }] },
  {
    group: "Developers",
    items: [
      { href: "/docs/mcp", label: "Dolphin for AI assistants" },
      { href: "/docs/api", label: "Public API" },
    ],
  },
  { group: "Paper", items: [{ href: "/whitepaper", label: "Whitepaper" }] },
];

/** Kept for older imports: the docs pages in reading order. */
export const DOCS_NAV = LIBRARY.flatMap((group) => group.items);

export function DocsPage({
  title,
  summary,
  sections,
  current,
  actions,
}: {
  title: string;
  summary: ReactNode;
  sections: DocsSection[];
  current: string;
  /** Extra buttons beside Copy page (the MCP page's one-click installs). */
  actions?: ReactNode;
}) {
  // Previous / next within the same part of the library.
  const siblings = LIBRARY.flatMap((group) => group.items);
  const index = siblings.findIndex((item) => item.href === current);
  const previous = index > 0 ? siblings[index - 1] : null;
  const next = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null;
  const group = LIBRARY.find((candidate) => candidate.items.some((item) => item.href === current));

  return (
    <div className="docs-shell">
      <aside className="docs-side">
        <DocsSearch pages={DOCS_NAV} />
        <DocsSideNav current={current} groups={LIBRARY} />
      </aside>

      {/* Phones: the library as one menu above the page. */}
      {/* Phones: one slim bar - search and the whole docs menu behind one button (after nextra.site). */}
      <DocsMobileBar current={current} groups={LIBRARY} pages={DOCS_NAV} />

      <main className="docs-main">
        <nav aria-label="Breadcrumb" className="docs-crumbs">
          <Link href="/docs">Docs</Link>
          {group && group.group !== "Get started" ? (
            <>
              <span aria-hidden>›</span>
              <span>{group.group}</span>
            </>
          ) : null}
          <span aria-hidden>›</span>
          <span aria-current="page">{title}</span>
        </nav>
        <div className="docs-head">
          <h1>{title}</h1>
          <div className="docs-head__actions">
            {actions}
            <CopyPageMenu path={current} title={title} />
          </div>
        </div>
        <div className="docs-lead">{summary}</div>

        <SearchHighlighter />
        <TableLabels />
        <article data-docs-article>
          {sections.map((section) => (
            <section className="docs-section" id={section.id} key={section.id}>
              <h2>
                {section.title}
                <a aria-label={`Link to ${section.title}`} className="docs-anchor" href={`#${section.id}`}>
                  #
                </a>
              </h2>
              <div className="docs-body">{section.body}</div>
            </section>
          ))}
        </article>

        {previous || next ? (
          <nav aria-label="More pages" className="docs-pager">
            {previous ? (
              <Link className="docs-pager__link" href={previous.href}>
                <span aria-hidden className="docs-pager__arrow">‹</span>
                <span>
                  <small>Previous</small>
                  {previous.label}
                </span>
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link className="docs-pager__link docs-pager__next" href={next.href}>
                <span>
                  <small>Next</small>
                  {next.label}
                </span>
                <span aria-hidden className="docs-pager__arrow">›</span>
              </Link>
            ) : null}
          </nav>
        ) : null}
      </main>

      <aside className="docs-right">
        <Toc items={sections.map((section) => ({ id: section.id, title: section.title }))} />
      </aside>
    </div>
  );
}

/** A block of code or configuration, with a one-tap copy. */
export function Code({ children, label }: { children: string; label?: string }) {
  return (
    <figure className="docs-code">
      <figcaption>
        <span>{label ?? "Code"}</span>
        <CopyButton text={children} />
      </figcaption>
      <pre>
        <code>{children}</code>
      </pre>
    </figure>
  );
}

/**
 * A screenshot of the real screen a passage explains (owner, 2026-10-03, after nextra.site).
 * Captured from Dolphin itself into /public/docs; `width` is the image's own pixel width, shown at
 * half size because it was captured at 2x.
 */
export function Figure({ src, alt, caption, width, height, narrow = false }: { src: string; alt: string; caption: string; width: number; height: number; narrow?: boolean }) {
  return (
    <figure className="docs-figure" data-narrow={narrow || undefined}>
      {/* Served as captured: these are already-compressed WebP, and re-encoding them blurs the text. */}
      <Image alt={alt} height={height} src={src} unoptimized width={width} />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
