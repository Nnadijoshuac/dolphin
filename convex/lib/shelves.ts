/**
 * DISCOVER'S SHELVES: which agents a store front features, and in what order.
 *
 * Play Store is the model: a front page of short, themed rows, each ordered by
 * the same quality signal, rather than one long undifferentiated list. The
 * four quest categories come first because they are what a Set and Earn user
 * is on the page to do - hire one agent in each.
 *
 * FEATURING IS STRICTER THAN LISTING. Everything live stays in browse and
 * search; a shelf is an editorial surface and holds a higher bar:
 *
 *  - duplicates collapse to one tile, and only the highest-ranked registration
 *    is shown (the others stay listed). Two tests, each from the live catalog
 *    on 2026-09-25: the same NAME is one product whatever wallet registered it
 *    ("LP Agent 1 by 4LPHA" is live under two owners), and the same owner with
 *    the same DESCRIPTION is one product whatever it is named ("Lending Agent
 *    1".."4 by 4LPHA" are one sentence registered four times);
 *  - "test", "demo" and "sandbox" registrations are never featured (lib/rank.ts
 *    already ranks them down; here they are left off);
 *  - handle-style names ("bnb-recurring-monitor",
 *    "recurringmonitoringserviceagent") are not featured: all lowercase, no
 *    space, reads as an unfinished listing on a store front;
 *  - a shelf with fewer than MIN_SHELF agents is not shown at all. A thin row
 *    reads as an empty store, and inventing filler is not an option (§5).
 */

import { TEST_MARKER } from "./rank";

export const SHELF_SIZE = 12;
export const MIN_SHELF = 3;
const NEW_WINDOW_MS = 21 * 24 * 60 * 60 * 1000;

export interface ShelfCandidate {
  agentKey: string;
  name: string;
  description: string;
  ownerAddress: string;
  categorySlug: string;
  protocol: "a2a" | "mcp";
  rank: number;
  publishedAt: string;
  hasPrice: boolean;
  hirers: number;
  paidHirers: number;
}

export interface ShelfDefinition {
  id: string;
  title: string;
  subtitle: string;
  /** Where "See all" goes. */
  href: string;
  agentKeys: string[];
}

/** The quest's four categories, in the order the quest lists them. */
export const QUEST_SHELVES = [
  { slug: "yield", title: "Top yield agents", subtitle: "Put idle funds to work" },
  { slug: "grid-trading", title: "Top grid trading agents", subtitle: "Buy low and sell high inside a range" },
  { slug: "rebalancing", title: "Top rebalancing agents", subtitle: "Keep positions where they earn" },
  { slug: "health-factor", title: "Top health factor agents", subtitle: "Stay clear of liquidation" },
] as const;

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function byRank(a: ShelfCandidate, b: ShelfCandidate): number {
  return b.rank - a.rank || (a.agentKey < b.agentKey ? -1 : 1);
}

/** A registry handle rather than a product name: all lowercase, no space. */
export function isHandleName(name: string): boolean {
  const trimmed = name.trim();
  return !/\s/.test(trimmed) && trimmed === trimmed.toLowerCase() && trimmed.length > 10;
}

/** Featurable and de-duplicated, highest rank first. */
export function featurable(candidates: readonly ShelfCandidate[]): ShelfCandidate[] {
  const names = new Set<string>();
  const products = new Set<string>();
  const out: ShelfCandidate[] = [];
  for (const candidate of [...candidates].sort(byRank)) {
    if (TEST_MARKER.test(candidate.name) || TEST_MARKER.test(candidate.description)) continue;
    if (isHandleName(candidate.name)) continue;
    const name = normalizeName(candidate.name);
    const product = `${candidate.ownerAddress.toLowerCase()}|${normalizeName(candidate.description)}`;
    if (names.has(name) || products.has(product)) continue;
    names.add(name);
    products.add(product);
    out.push(candidate);
  }
  return out;
}

function shelf(
  id: string,
  title: string,
  subtitle: string,
  href: string,
  agents: readonly ShelfCandidate[],
): ShelfDefinition | null {
  const agentKeys = agents.slice(0, SHELF_SIZE).map((agent) => agent.agentKey);
  return agentKeys.length >= MIN_SHELF ? { id, title, subtitle, href, agentKeys } : null;
}

export function buildShelves(
  candidates: readonly ShelfCandidate[],
  now: number = Date.now(),
): ShelfDefinition[] {
  const pool = featurable(candidates);
  const shelves: (ShelfDefinition | null)[] = [];

  for (const quest of QUEST_SHELVES) {
    shelves.push(
      shelf(
        `top-${quest.slug}`,
        quest.title,
        quest.subtitle,
        `/?category=${quest.slug}#browse-by-role`,
        pool.filter((agent) => agent.categorySlug === quest.slug),
      ),
    );
  }

  shelves.push(
    shelf(
      "most-hired",
      "Most hired",
      "Chosen by the most paying users",
      "/search",
      pool
        .filter((agent) => agent.hirers > 0)
        .sort((a, b) => b.paidHirers - a.paidHirers || b.hirers - a.hirers || byRank(a, b)),
    ),
  );

  shelves.push(
    shelf(
      "ready-to-hire",
      "Ready to hire",
      "Priced up front and paid through escrow",
      "/search",
      pool.filter((agent) => agent.protocol === "a2a" && agent.hasPrice),
    ),
  );

  shelves.push(
    shelf(
      "new",
      "New on Dolphin",
      "Recently verified and listed",
      "/search",
      pool
        .filter((agent) => now - Date.parse(agent.publishedAt) <= NEW_WINDOW_MS)
        .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || byRank(a, b)),
    ),
  );

  return shelves.filter((s): s is ShelfDefinition => s !== null);
}
