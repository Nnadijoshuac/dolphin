import Link from "next/link";
import type { ReactNode } from "react";

import { LEGAL } from "@/constants/legal";

export type LegalSection = { id: string; title: string; body: ReactNode };

const DOCS = [
  { href: "/policies/terms", label: "Terms of Use" },
  { href: "/policies/privacy", label: "Privacy Policy" },
  { href: "/policies/risk", label: "Risk Disclosure" },
  { href: "/policies/security", label: "Security Policy" },
  { href: "/policies/conflicts", label: "Conflicts of interest" },
] as const;

/**
 * One layout for every legal page: title, date, a short plain summary, a
 * contents list that stays in view on desktop, and numbered sections.
 */
export function LegalDoc({
  title,
  summary,
  sections,
  current,
}: {
  title: string;
  summary: ReactNode;
  sections: LegalSection[];
  current: string;
}) {
  return (
    <div className="site-frame page-shell">
      <div className="legal">
        <aside className="legal__aside">
          <nav aria-label="Policies" className="legal__docs">
            {DOCS.map((doc) => (
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
          <p className="legal__eyebrow">Policy</p>
          <h1 className="legal__title">{title}</h1>
          <p className="legal__updated">Last updated {LEGAL.updated}</p>
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
