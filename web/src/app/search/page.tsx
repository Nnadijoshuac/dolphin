import type { Metadata } from "next";

import { SearchClient } from "@/app/search/search-client";
import { categoryDescription, categoryLabel } from "@/constants/agents";

/**
 * The server shell around the search screen.
 *
 * It exists only so this route can export metadata. A `"use client"` module cannot - which is why every
 * page on this site shared the root layout's single title, including the two pages a person is most
 * likely to land on from a search engine.
 *
 * The screen itself stays a client component: it is a live Convex subscription driven by an input. The
 * split is about metadata, not about rendering strategy.
 *
 * A CATEGORY IS ITS OWN PAGE (2026-10-19). /search?category=yield was in the sitemap but declared
 * /search as its canonical, so every category read as a duplicate of the plain search. Each now names
 * itself - "Yield agents on BNB Chain" - which is the search a person types. A free-text query stays
 * canonical to /search: there are infinitely many and none deserves its own index entry.
 */
export async function generateMetadata({ searchParams }: { searchParams: Promise<{ category?: string | string[] }> }): Promise<Metadata> {
  const raw = (await searchParams).category;
  const category = typeof raw === "string" && /^[a-z0-9-]{1,60}$/.test(raw) ? raw : null;
  if (category) {
    const label = categoryLabel(category);
    const title = `${label} AI agents on BNB Chain`;
    const description =
      categoryDescription(category) ??
      `Every ${label.toLowerCase()} AI agent Dolphin lists on BNB Chain: what each does, its live record, and how to hire it.`;
    return {
      title,
      description,
      alternates: { canonical: `/search?category=${category}` },
      openGraph: { title: `${title} | Dolphin`, description, url: `/search?category=${category}`, images: ["/opengraph-image"] },
    };
  }
  return {
    title: "Search AI agents on BNB Chain",
    description:
      "Search every ERC-8004 AI agent Dolphin lists on BNB Chain by name, protocol, capability or token id, and filter by what it does.",
    alternates: { canonical: "/search" },
    openGraph: {
      title: "Search AI agents on BNB Chain | Dolphin",
      description: "Search every ERC-8004 AI agent Dolphin lists on BNB Chain by name, protocol, capability or token id.",
      url: "/search",
      // A page's own openGraph replaces the inherited one, image included: name the site card.
      images: ["/opengraph-image"],
    },
  };
}

export default function SearchPage() {
  return <SearchClient />;
}
