import type { MetadataRoute } from "next";

import { SITE_URL } from "@/constants/site";
import { fetchAgentIdsForSitemap, fetchCategories } from "@/server/convex";

/**
 * The sitemap. There was none.
 *
 * ===========================================================================
 * WHY THIS IS THE HIGHEST-LEVERAGE FILE IN THE SEO WORK (2026-09-08)
 * ===========================================================================
 * Dolphin's entire proposition is DISCOVERY, and every route on this site was
 * a client component with no server-rendered content, no per-page title, no
 * sitemap and no robots.txt. A marketplace whose value is being findable had
 * made itself unfindable.
 *
 * `/agent/[id]` is the page that matters. There are hundreds of them, each
 * about a distinct named thing with distinct data, each independently linkable
 * and shareable. That is the only asset in this product that COMPOUNDS -
 * one page per agent, indexed once, earning traffic indefinitely. Listing them
 * here is what tells a crawler they exist at all, because nothing else on the
 * site links to more than the first paginated page of them.
 *
 * ===========================================================================
 * CHANGE FREQUENCY AND PRIORITY ARE HONEST OR ABSENT
 * ===========================================================================
 * `priority` is only meaningful RELATIVE to other URLs on the same site, and
 * `lastModified` is worse than useless if invented - a crawler that learns a
 * site lies about freshness stops trusting the signal. So `lastModified` on an
 * agent page is the timestamp of Dolphin's own last registry verification of
 * that record, and nothing carries a fabricated one.
 */

/*
 * Revalidated hourly rather than per-request. The catalog changes on the
 * discovery cron's cadence, not on a visitor's, and regenerating a
 * multi-thousand-URL sitemap on every crawler hit is a self-inflicted load
 * problem.
 */
export const revalidate = 3_600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: `${SITE_URL}/`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${SITE_URL}/search`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.8,
    },
  ];

  /*
   * Both reads degrade to empty rather than throwing - see server/convex.ts. A
   * sitemap containing only the two static routes is a smaller sitemap; a
   * sitemap route that throws is a 500 served to every crawler that asks.
   */
  const [categories, agents] = await Promise.all([
    fetchCategories(),
    fetchAgentIdsForSitemap(),
  ]);

  const categoryRoutes: MetadataRoute.Sitemap = categories
    // A category with no agents in it is a dead end, and submitting a dead end
    // is how a site teaches a crawler to discount its sitemap.
    .filter((category) => category.count > 0)
    .map((category) => ({
      url: `${SITE_URL}/search?category=${encodeURIComponent(category.slug)}`,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 0.7,
    }));

  const agentRoutes: MetadataRoute.Sitemap = agents.map((agent) => ({
    url: `${SITE_URL}/agent/${encodeURIComponent(agent.tokenId)}`,
    /*
     * When Dolphin last verified this record on-chain. Omitted rather than
     * defaulted to `now` when unknown: claiming every agent page changed at
     * sitemap-generation time is the exact lie that makes the field ignored.
     */
    lastModified: agent.updatedAt ? new Date(agent.updatedAt) : undefined,
    changeFrequency: "weekly" as const,
    priority: 0.6,
  }));

  return [...staticRoutes, ...categoryRoutes, ...agentRoutes];
}
