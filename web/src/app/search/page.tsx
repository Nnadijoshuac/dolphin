import type { Metadata } from "next";

import { SearchClient } from "@/app/search/search-client";

/**
 * The server shell around the search screen.
 *
 * It exists only so this route can export `metadata`. A `"use client"` module
 * cannot - which is why every page on this site shared the root layout's single
 * title, including the two pages a person is most likely to land on from a
 * search engine.
 *
 * The screen itself stays a client component and always will: it is a live
 * Convex subscription driven by an input, and there is nothing here worth
 * server-rendering. The split is about metadata, not about rendering strategy.
 */
export const metadata: Metadata = {
  title: "Search agents",
  description:
    "Search every ERC-8004 agent Dolphin lists on BNB Smart Chain by name, protocol, capability or token id, and filter by the role it is classified under.",
  alternates: { canonical: "/search" },
  openGraph: {
    title: "Search agents | Dolphin",
    description:
      "Search every ERC-8004 agent Dolphin lists on BNB Smart Chain by name, protocol, capability or token id.",
    url: "/search",
  },
};

export default function SearchPage() {
  return <SearchClient />;
}
