/**
 * THE BRIDGE between an open catalog category and a closed set of protocol
 * readers.
 *
 * `agents.categorySlug` is a free string so the marketplace can carry
 * categories nobody has thought of yet. `agentLiveStats.category` is a closed
 * union, and that is not an inconsistency - it answers a different question.
 *
 *   catalog category   "what drawer is this agent in"      must be open
 *   stats category     "which protocol reader do we run"   is closed by fact
 *
 * The second set is finite because each member is hand-written code against a
 * specific contract: Venus's comptroller, PancakeSwap V3's position manager,
 * Aave's pool. A category with no such reader has no live metric, and this
 * function returns null to say so - which convex/protocols/unavailable.ts then
 * renders as an explicit "not yet connected" rather than a plausible-looking
 * number (AGENTS.md §5).
 *
 * Adding a category needs no change here. Adding a protocol INTEGRATION does,
 * and that is the correct place for the friction to sit.
 */

export type StatsCategory =
  | "monitoring"
  | "rebalancing"
  | "grid-trading"
  | "health-factor"
  | "yield"
  | "trading";

const WIRED: ReadonlySet<string> = new Set<StatsCategory>([
  "monitoring",
  "rebalancing",
  "grid-trading",
  "health-factor",
  "yield",
  "trading",
]);

/**
 * The stats reader for a catalog category, or null when there is none.
 *
 * Null is the answer for every category added after this set was fixed -
 * `research`, `security`, `content`, `general` and anything the registry
 * invents. Their detail pages show no live-metric panel, which is honest: there
 * is no protocol holding a number about them to read.
 */
export function statsCategoryFor(categorySlug: string): StatsCategory | null {
  return WIRED.has(categorySlug) ? (categorySlug as StatsCategory) : null;
}

/** Whether a category has a live-metric panel at all. */
export function hasLiveStats(categorySlug: string): boolean {
  return statsCategoryFor(categorySlug) !== null;
}
