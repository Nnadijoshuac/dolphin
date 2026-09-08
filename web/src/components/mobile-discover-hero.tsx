"use client";

import Link from "next/link";
import { CategoryGlyph } from "@/components/category-glyph";
import type { Agent } from "@/types/agent";

// Same editorial cards and artwork as src/components/advert-carousel.tsx.
const promos = [
  { image: "health", title: "Brain on BNB", subtitle: "Venus Health Factor Monitor: 24/7 liquidation protection.", label: "Featured Agent", category: "health-factor", tokenId: "302257" },
  { image: "rebalancing", title: "Automate LP Management", subtitle: "Agents that reset your liquidity range 24/7.", label: "Featured Collection", category: "rebalancing" },
  { image: "yield", title: "Maximize Staking Yields", subtitle: "Discover the most profitable vault strategies.", label: "Top Yield Agents", category: "yield" },
  { image: "security", title: "Never Get Liquidated", subtitle: "Health factor monitors that act before it's too late.", label: "Essential Security", category: "health-factor" },
] as const;

export function MobileDiscoverHero({ agents }: { agents: Agent[] }) {
  return (
    <div className="mobile-discover-hero">
      <div className="mobile-discover-heading">
        <h1>Discover</h1>
        <Link aria-label="Search agents" className="mobile-circle" href="/search">
          <CategoryGlyph name="layers" color="var(--accent-ink)" size={18} />
        </Link>
      </div>
      <div aria-label="Featured agents and collections" className="mobile-promo-rail">
        {promos.map((promo) => {
          const tokenId = "tokenId" in promo ? promo.tokenId : null;
          const target = agents.find((agent) => tokenId ? agent.tokenId === tokenId : agent.category === promo.category);
          const href = target ? `/agent/${encodeURIComponent(target.agentKey)}` : tokenId ? `/agent/${tokenId}` : `/search?category=${promo.category}`;
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
