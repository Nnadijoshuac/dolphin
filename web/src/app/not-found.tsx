import Link from "next/link";
import type { Metadata } from "next";

import { CategoryGlyph } from "@/components/category-glyph";

export const metadata: Metadata = {
  title: "Page not found",
  /*
   * A 404 must never be indexed. Without this, a mistyped or expired agent URL
   * that someone linked to can be crawled and enter the index as a real page.
   */
  robots: { index: false, follow: true },
};

/**
 * The 404. There was no not-found.tsx, so an unknown URL fell through to Next's
 * unstyled default with no route back into the product.
 *
 * It offers search rather than only "go home", because on a catalog site the
 * overwhelmingly likely reason someone is here is that they were looking for a
 * specific agent - and search is the thing that can still find it.
 */
export default function NotFound() {
  return (
    <div className="site-frame page-shell">
      <div className="max-w-2xl">
        <div className="flex gap-4 border-y border-line py-8">
          <span aria-hidden="true" className="mt-0.5 shrink-0 text-muted">
            <CategoryGlyph color="currentColor" name="search" size={22} strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-muted">404</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-ink">
              There is nothing at this address
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted">
              The page may have moved, or the agent may no longer be listed in
              Dolphin&rsquo;s active catalog. Searching by name, protocol or
              ERC-8004 token id is the fastest way to find it if it is still
              there.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                className="interactive inline-flex min-h-11 items-center rounded-xl bg-accent px-5 text-sm font-semibold text-ink no-underline hover:bg-accent-hover"
                href="/search"
              >
                Search the catalog
              </Link>
              <Link
                className="interactive inline-flex min-h-11 items-center rounded-xl border border-line bg-paper px-5 text-sm font-semibold text-ink no-underline hover:bg-canvas"
                href="/"
              >
                Back to Discover
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
