import Link from "next/link";

import { BnbLogo, BrandMark } from "@/components/brand-mark";
import { AGENT_CATEGORIES } from "@/constants/agents";

function XLogo({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L2.25 2.25h6.18l4.254 5.622L18.245 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
    </svg>
  );
}

function InstagramLogo({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
    </svg>
  );
}

// Derived from AGENT_CATEGORIES, not hand-listed. This was four hardcoded
// entries and silently went stale the moment a category was added - the /search
// chips it links into were already showing one the footer didn't. Deriving it
// also settles the casing, which had drifted ("Grid trading" here vs the
// canonical "Grid Trading" everywhere the label comes from the constant).
const browseLinks = AGENT_CATEGORIES.map((category) => ({
  href: `/search?category=${category.slug}`,
  label: category.label,
}));

const accountLinks = [
  { href: "/my-agents", label: "My agents" },
  { href: "/wallet", label: "Wallet & permissions" },
  { href: "/search", label: "Search the catalog" },
] as const;

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line bg-paper">
      <div className="site-frame py-12 sm:py-16">
        <div className="grid gap-10 border-b border-line pb-12 lg:grid-cols-[minmax(0,2.5fr)_minmax(150px,0.6fr)_minmax(170px,0.7fr)]">
          <div className="max-w-lg">
            <Link
              aria-label="Dolphin home"
              className="inline-flex items-center gap-3 no-underline"
              href="/"
            >
              <BrandMark size={34} />
              <span className="text-lg font-semibold tracking-[-0.03em]">Dolphin</span>
            </Link>
            <p className="mt-4 max-w-[48ch] text-sm leading-6 text-muted">
              A clearer way to discover and control ERC-8004 agents on BNB Chain.
              Data sources, freshness, and permission boundaries stay visible where
              they matter.
            </p>
            <div className="mt-5 flex items-center gap-4 text-xs font-medium text-ink-soft">
              <BnbLogo size={16} />
              <span>Built on BNB Smart Chain</span>
              <span className="text-line">|</span>
              <a
                aria-label="Dolphin on X (Twitter)"
                className="interactive text-muted hover:text-ink"
                href="https://x.com/dolphin_Agents"
                rel="noreferrer"
                target="_blank"
              >
                <XLogo size={15} />
              </a>
              <a
                aria-label="Dolphin on Instagram"
                className="interactive text-muted hover:text-ink"
                href="https://www.instagram.com/dolphinamp/"
                rel="noreferrer"
                target="_blank"
              >
                <InstagramLogo size={15} />
              </a>
            </div>
          </div>

          <nav aria-label="Browse agents">
            <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-faint">
              Browse
            </h2>
            <ul className="mt-4 space-y-3 text-sm text-muted">
              {browseLinks.map((link) => (
                <li key={link.href}>
                  <Link className="interactive hover:text-ink" href={link.href}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Account controls">
            <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-faint">
              Control
            </h2>
            <ul className="mt-4 space-y-3 text-sm text-muted">
              {accountLinks.map((link) => (
                <li key={link.href}>
                  <Link className="interactive hover:text-ink" href={link.href}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="flex flex-col gap-4 pt-6 text-xs text-faint sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 Dolphin. Built for the BNB Chain Smart Money Era Hackathon.</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <a
              className="interactive hover:text-ink"
              href="https://8004scan.io"
              rel="noreferrer"
              target="_blank"
            >
              ERC-8004 registry
            </a>
            <a
              className="interactive hover:text-ink"
              href="https://bscscan.com"
              rel="noreferrer"
              target="_blank"
            >
              BscScan
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
