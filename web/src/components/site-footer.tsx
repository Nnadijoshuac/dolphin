import Link from "next/link";

import { BnbLogo, BrandMark } from "@/components/brand-mark";

const browseLinks = [
  { href: "/search?category=rebalancing", label: "Rebalancing" },
  { href: "/search?category=grid-trading", label: "Grid trading" },
  { href: "/search?category=health-factor", label: "Health factor" },
  { href: "/search?category=yield", label: "Yield" },
] as const;

const accountLinks = [
  { href: "/my-agents", label: "My agents" },
  { href: "/wallet", label: "Wallet & permissions" },
  { href: "/search", label: "Search the catalog" },
] as const;

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line bg-paper">
      <div className="site-frame py-12 sm:py-16">
        <div className="grid gap-10 border-b border-line pb-12 lg:grid-cols-[minmax(0,1.5fr)_minmax(150px,0.6fr)_minmax(170px,0.7fr)]">
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
            <div className="mt-5 flex items-center gap-2 text-xs font-medium text-ink-soft">
              <BnbLogo size={16} />
              <span>Built on BNB Smart Chain</span>
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
