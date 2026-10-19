import type { MetadataRoute } from "next";

import { SITE_URL } from "@/constants/site";
import { fetchAgentIdsForSitemap, fetchCategories, fetchLiveRuns, fetchSetups, fetchTraders } from "@/server/convex";

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

  /*
   * Every page a person could land on from a search (2026-10-19). This listed three; /live, /trade, /test,
   * /agents, the docs and the whitepaper were missing, and so was every trader, live run and setup page.
   * Priority is relative and honest: the pages that say what Dolphin is, then the hubs, then the reference.
   */
  // No lastModified on a static page: claiming each changed when the sitemap was built is the lie noted above.
  const page = (path: string, priority: number, changeFrequency: "daily" | "weekly" | "monthly" = "weekly") => ({
    url: `${SITE_URL}${path}`,
    changeFrequency,
    priority,
  });
  const staticRoutes: MetadataRoute.Sitemap = [
    page("/", 1, "daily"),
    page("/agents", 0.9, "daily"),
    page("/set-and-quest", 0.9, "daily"),
    page("/trade", 0.8, "daily"),
    page("/live", 0.8, "daily"),
    page("/test", 0.8),
    page("/search", 0.8, "daily"),
    page("/setups", 0.7, "daily"),
    page("/dolphin", 0.7),
    page("/docs", 0.7),
    page("/docs/use", 0.6),
    page("/docs/build", 0.6),
    page("/docs/traders", 0.6),
    page("/docs/mcp", 0.6),
    page("/docs/payments", 0.5),
    page("/docs/api", 0.5),
    page("/whitepaper", 0.6, "monthly"),
    ...["terms", "privacy", "risk", "disclaimer", "security", "conflicts"].map((name) => page(`/policies/${name}`, 0.2, "monthly")),
  ];

  /*
   * Both reads degrade to empty rather than throwing - see server/convex.ts. A
   * sitemap containing only the two static routes is a smaller sitemap; a
   * sitemap route that throws is a 500 served to every crawler that asks.
   */
  const [categories, agents, traders, runs, setups] = await Promise.all([
    fetchCategories(),
    fetchAgentIdsForSitemap(),
    fetchTraders(),
    fetchLiveRuns(),
    fetchSetups(),
  ]);

  const categoryRoutes: MetadataRoute.Sitemap = categories
    // A category with no agents in it is a dead end, and submitting a dead end
    // is how a site teaches a crawler to discount its sitemap.
    .filter((category) => category.count > 0)
    .map((category) => ({
      url: `${SITE_URL}/search?category=${encodeURIComponent(category.slug)}`,
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

  const traderRoutes: MetadataRoute.Sitemap = traders.map((trader) => ({
    url: `${SITE_URL}/trade/${encodeURIComponent(trader.id)}`,
    changeFrequency: "daily" as const,
    priority: 0.7,
  }));
  // A running run changes every few minutes; a finished one never again.
  const runRoutes: MetadataRoute.Sitemap = runs.map((run) => ({
    url: `${SITE_URL}/live/${encodeURIComponent(run.slug)}`,
    lastModified: new Date(run.endedAt ?? run.lastValuedAt),
    changeFrequency: run.status === "running" ? ("hourly" as const) : ("never" as const),
    priority: run.status === "running" ? 0.7 : 0.4,
  }));
  const setupRoutes: MetadataRoute.Sitemap = setups.map((setup) => ({
    url: `${SITE_URL}/setups/${encodeURIComponent(setup.id)}`,
    lastModified: new Date(setup.listedAt),
    changeFrequency: "weekly" as const,
    priority: 0.5,
  }));

  return [...staticRoutes, ...categoryRoutes, ...traderRoutes, ...runRoutes, ...setupRoutes, ...agentRoutes];
}
