"use client";

import Link from "next/link";
import { useState } from "react";

import { BnbLogo, BrandMark } from "@/components/brand-mark";
import { CategoryGlyph } from "@/components/category-glyph";
import { DOLPHIN_CONTRACTS, NETWORK_LABEL } from "@/constants/agents";
import { useCategoryFacets } from "@/hooks/use-agents";

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

/*
 * FROM THE CATALOG. The same convex/facets.ts row the landing tiles and the
 * search pills read, so all three agree by construction. Capped: a footer
 * column is the top of a category index, not the index.
 */
const FOOTER_CATEGORY_LIMIT = 6;

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/", label: "Discover" },
      { href: "/search", label: "Search agents" },
      { href: "/dolphin", label: "Build an agent" },
    ],
  },
  {
    title: "Account",
    links: [
      { href: "/my-agents", label: "My agents" },
      { href: "/wallet", label: "Wallet" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/policies/terms", label: "Terms of Use" },
      { href: "/policies/privacy", label: "Privacy Policy" },
      { href: "/policies/risk", label: "Risk Disclosure" },
      { href: "/policies/disclaimer", label: "Disclaimer" },
      { href: "/policies/security", label: "Security" },
      { href: "/policies/conflicts", label: "Conflicts of interest" },
    ],
  },
] as const;

/**
 * THE FOOTER (reorganised 2026-09-29 - owner: "why are we having Dolphin up
 * and contracts down... a lot of things are wrong"). Brand and four columns
 * on one row; the contract addresses - kept, because every one is checkable -
 * fold behind a toggle in the bottom bar instead of taking a full band.
 */
export function SiteFooter() {
  const facets = useCategoryFacets();
  const [contractsOpen, setContractsOpen] = useState(false);
  const categories = facets.categories.slice(0, FOOTER_CATEGORY_LIMIT);

  return (
    <footer className="site-footer">
      <div className="site-frame">
        <div className="site-footer__top">
          <div className="site-footer__brand">
            <Link aria-label="Dolphin home" className="inline-flex items-center gap-3 no-underline" href="/">
              <BrandMark size={34} />
              <span className="text-lg font-semibold tracking-[-0.03em]">Dolphin</span>
            </Link>
            <p className="site-footer__tagline">Hire AI agents on BNB Chain, or build your own.</p>
            <div className="site-footer__social">
              <a aria-label="Dolphin on X" href="https://x.com/dolphin_Agents" rel="noreferrer" target="_blank">
                <XLogo size={15} />
              </a>
              <a aria-label="Dolphin on Instagram" href="https://www.instagram.com/dolphinamp/" rel="noreferrer" target="_blank">
                <InstagramLogo size={15} />
              </a>
            </div>
          </div>

          <nav aria-label="Footer" className="site-footer__cols">
            <div>
              <h2 className="site-footer__heading">{COLUMNS[0].title}</h2>
              <ul>
                {COLUMNS[0].links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href}>{link.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="site-footer__heading">Categories</h2>
              <ul>
                {categories.map((category) => (
                  <li key={category.slug}>
                    <Link href={`/search?category=${category.slug}`}>{category.label}</Link>
                  </li>
                ))}
                {/* Always present, so the column is never a heading over nothing. */}
                <li>
                  <Link href="/search">{categories.length > 0 ? "All categories" : "Browse the catalog"}</Link>
                </li>
              </ul>
            </div>
            {COLUMNS.slice(1).map((column) => (
              <div key={column.title}>
                <h2 className="site-footer__heading">{column.title}</h2>
                <ul>
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href}>{link.label}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="site-footer__bottom">
          <p>
            © 2026 Dolphin · Built for the BNB Chain Smart Money Era Hackathon
            {/* The one-line disclaimer (owner, 2026-10-03), quiet, on every page with a footer. */}
            <span className="site-footer__disclaimer">
              Not financial, legal or tax advice. Every trade is your own decision and responsibility.{" "}
              <Link href="/policies/disclaimer">Disclaimer</Link>
            </span>
          </p>
          <div className="site-footer__bottom-links">
            <span className="inline-flex items-center gap-2">
              <BnbLogo size={14} />
              {NETWORK_LABEL}
            </span>
            <button aria-expanded={contractsOpen} className="site-footer__toggle" onClick={() => setContractsOpen((open) => !open)} type="button">
              Contracts
              <span className={`flex transition-transform duration-200 ${contractsOpen ? "rotate-90" : ""}`}>
                <CategoryGlyph color="currentColor" name="chevron-right" size={12} />
              </span>
            </button>
            <a href="https://8004scan.io" rel="noreferrer" target="_blank">
              ERC-8004 registry
            </a>
            <a href="https://bscscan.com" rel="noreferrer" target="_blank">
              BscScan
            </a>
          </div>
        </div>

        {/* Every contract the catalog reads and every hire pays through, each one checkable. */}
        <div className="reveal" data-open={contractsOpen || undefined} inert={!contractsOpen}>
          <div className="reveal__inner">
            <ul className="site-footer__contracts">
              {DOLPHIN_CONTRACTS.map((contract) => (
                <li key={contract.address}>
                  <span>{contract.label}</span>
                  <a href={`https://bscscan.com/address/${contract.address}`} rel="noreferrer" target="_blank" title={contract.address}>
                    {contract.address}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}
