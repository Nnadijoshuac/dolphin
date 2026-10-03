import Link from "next/link";
import type { ReactNode } from "react";

export type DocsSection = { id: string; title: string; body: ReactNode };

/** Every docs page, in reading order. The whitepaper sits last: it is the long form of all of them. */
export const DOCS_NAV = [
  { href: "/docs", label: "How it works" },
  { href: "/docs/use", label: "Using agents" },
  { href: "/docs/build", label: "Building agents" },
  { href: "/docs/payments", label: "Payments" },
  { href: "/docs/mcp", label: "Dolphin for AI assistants" },
  { href: "/docs/api", label: "Public API" },
  { href: "/whitepaper", label: "Whitepaper" },
] as const;

/**
 * THE DOCS (owner, 2026-10-02: "documentation, how it works, white paper - like crypto/Web3
 * products"). Same frame as the legal pages (`.legal*` in globals.css) so the two read as one
 * library: a sticky contents list, numbered sections, a plain summary up top.
 *
 * Every number on these pages is a constant in the code or a published contract value - no
 * TVL, volume or user count (AGENTS.md §5). If the code changes, the page changes with it.
 */
export function DocsPage({
  title,
  summary,
  sections,
  current,
}: {
  title: string;
  summary: ReactNode;
  sections: DocsSection[];
  current: string;
}) {
  return (
    <div className="site-frame page-shell">
      <div className="legal">
        <aside className="legal__aside">
          <nav aria-label="Docs" className="legal__docs">
            {DOCS_NAV.map((doc) => (
              <Link aria-current={doc.href === current ? "page" : undefined} href={doc.href} key={doc.href}>
                {doc.label}
              </Link>
            ))}
          </nav>
          <nav aria-label="On this page" className="legal__toc">
            <p className="legal__toc-title">On this page</p>
            <ol>
              {sections.map((section, index) => (
                <li key={section.id}>
                  <a href={`#${section.id}`}>
                    {index + 1}. {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>

        <article className="legal__body">
          <p className="legal__eyebrow">Docs</p>
          <h1 className="legal__title">{title}</h1>
          <div className="legal__summary">{summary}</div>
          {sections.map((section, index) => (
            <section className="legal__section" id={section.id} key={section.id}>
              <h2>
                <span className="legal__num">{index + 1}</span>
                {section.title}
              </h2>
              <div className="legal__text">{section.body}</div>
            </section>
          ))}
        </article>
      </div>
    </div>
  );
}

/** A block of code or configuration to copy. */
export function Code({ children, label }: { children: string; label?: string }) {
  return (
    <figure className="docs-code">
      {label ? <figcaption>{label}</figcaption> : null}
      <pre>
        <code>{children}</code>
      </pre>
    </figure>
  );
}
