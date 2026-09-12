"use client";

import Link from "next/link";
import { MobileMenuButton } from "@/components/mobile-nav";
import type { Agent } from "@/types/agent";

/**
 * The editorial rail. Artwork matches src/components/advert-carousel.tsx.
 *
 * ===========================================================================
 * THESE CARDS USED TO BE THE ONE PLACE THE HONESTY RULE WAS SUSPENDED
 * ===========================================================================
 * Previous copy, and why each line went (2026-09-12):
 *
 *   "Never Get Liquidated"  - a guarantee. Nothing in this product can make
 *      it, and with no notification channel anywhere in the codebase, Dolphin
 *      cannot even tell you that you are ABOUT to be. The most prominent
 *      promise on the site was the one it was least able to keep.
 *   "Maximize Staking Yields" / "the most profitable vault strategies"
 *      - superlatives over a set nothing has ranked for profitability.
 *   "24/7 liquidation protection" and "reset your liquidity range 24/7"
 *      - both describe continuous ACTION. Session execution is gated off
 *      (FEATURE_SESSION_EXECUTION = false), so what these agents actually do
 *      for a user today is read and report.
 *
 * Every other surface in this product refuses to print a number it did not
 * read. The hero rail was asserting outcomes, in larger type, above the fold.
 *
 * The replacements still sell - they name a job worth wanting - but each one
 * describes a capability that exists: a read that is wired, a protocol an
 * agent is built around, or the probe result that got it listed. If a future
 * card needs a verb like "protects" or "prevents", the feature has to ship
 * first.
 */
const promos = [
  { image: "health", title: "Brain on BNB", subtitle: "Reads your Venus health factor live from the Comptroller.", label: "Featured agent", category: "health-factor", tokenId: "302257" },
  { image: "rebalancing", title: "Keep an LP range in range", subtitle: "Agents built around PancakeSwap v3 position management.", label: "Rebalancing", category: "rebalancing" },
  { image: "yield", title: "Put idle stablecoins to work", subtitle: "Yield agents that compare lending and LP routes on BSC.", label: "Yield", category: "yield" },
  { image: "security", title: "See your liquidation buffer", subtitle: "Health-factor monitors that answered when Dolphin called them.", label: "Health factor", category: "health-factor" },
] as const;

export function MobileDiscoverHero({ agents }: { agents: Agent[] }) {
  return (
    <div className="mobile-discover-hero">
      <div className="mobile-discover-heading">
        <h1>Discover</h1>
        {/*
          * This was a "layers" glyph linking to /search. It is the MENU now.
          *
          * Discover's title row is the header this screen already has, and the
          * bottom tab bar that used to carry navigation is gone — so the one
          * control in this row has to be the one that reaches everywhere.
          * Search did not disappear: it is one of the five destinations inside
          * the drawer, with a label, which is more than a "layers" icon ever
          * told anyone about where it went.
          */}
        <MobileMenuButton />
      </div>
      <div aria-label="Featured agents and collections" className="mobile-promo-rail">
        {promos.map((promo) => {
          const tokenId = "tokenId" in promo ? promo.tokenId : null;
          const target = agents.find((agent) => tokenId ? agent.tokenId === tokenId : agent.category === promo.category);
          const href = target ? `/agent/${encodeURIComponent(target.tokenId)}` : tokenId ? `/agent/${tokenId}` : `/search?category=${promo.category}`;
          return (
            <Link className="mobile-promo-card" href={href} key={promo.image} style={{ backgroundImage: `linear-gradient(#0006, #0006), url(/promos/${promo.image}.jpg)` }}>
              <div>
                <p className="mobile-promo-label">{promo.label}</p>
                <h2>{promo.title}</h2>
                <p className="mobile-promo-subtitle">{promo.subtitle}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
