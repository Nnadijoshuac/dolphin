/**
 * SEARCH ORDERING: what you typed, then how good the agent is.
 *
 * ---------------------------------------------------------------------------
 * WHY SEARCH NO LONGER RETURNS THE INDEX'S ORDER UNTOUCHED (2026-09-25)
 * ---------------------------------------------------------------------------
 * `agents.search` used to hand back Convex's relevance order as-is, on the
 * reasoning that what a user typed should outrank shelf position. Half right.
 * Relevance is a text score: it prefers the agent whose description repeats
 * "yield" five times over the one that quotes a price and actually sells. A
 * store search - Play Store is the model - uses the query to decide WHAT
 * matches and quality to decide the ORDER among things that match about
 * equally well.
 *
 * So the order is a blend of three terms, and none of them wins alone:
 *
 *   relevance  the index's own position. Convex exposes order, not scores, so
 *              position is turned into a decaying weight: the top hit counts
 *              fully, the fifth about half.
 *   quality    the stored `rank` (lib/rank.ts): payable quote, skills,
 *              on-chain feedback, verified domain, curation. Saturating, so a
 *              very high rank cannot drag an irrelevant agent to the top.
 *   intent     the query names the agent. Someone who types "Venus
 *              Liquidation Guard" wants that agent first, whatever its rank.
 *
 * `rank` still is NOT a quality score shown to anyone - see lib/rank.ts. It is
 * used here exactly as the browse shelf uses it: as ordering.
 *
 * ---------------------------------------------------------------------------
 * PAGINATION
 * ---------------------------------------------------------------------------
 * A blended order cannot come straight off an index, so search reads a bounded
 * window of matches (SEARCH_WINDOW), orders it, and pages through that list
 * with an offset cursor. The blend is deterministic for the same rows, so page
 * two continues page one. A window of 100 is far above what any query matches
 * in a catalog of this size; past it, results beyond the window are simply not
 * offered, and that bound is the cost of never scanning the catalog.
 */

/** Matches read from the search index before ordering. */
export const SEARCH_WINDOW = 100;

const WEIGHTS = {
  relevance: 0.55,
  quality: 0.45,
  /** Additive on purpose: naming the agent should be close to decisive. */
  intent: 0.6,
} as const;

/** Rank at which the quality term reaches half its weight. See lib/rank.ts for the scale. */
const QUALITY_HALF_POINT = 350;

/** Index position at which the relevance term reaches half its weight. */
const RELEVANCE_HALF_POSITION = 4;

export interface SearchCandidate {
  agentKey: string;
  name: string;
  rank: number;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function relevanceWeight(position: number): number {
  return 1 / (1 + position / RELEVANCE_HALF_POSITION);
}

function qualityWeight(rank: number): number {
  const safe = Math.max(0, rank);
  return safe / (safe + QUALITY_HALF_POINT);
}

/** How directly the query names this agent. 0 when it does not. */
export function intentWeight(name: string, query: string): number {
  const n = normalize(name);
  const q = normalize(query);
  if (q.length === 0 || n.length === 0) return 0;
  if (n === q) return 1;
  if (n.startsWith(q)) return 0.6;
  const terms = q.split(" ");
  if (terms.length > 1 && terms.every((term) => n.split(" ").some((word) => word.startsWith(term)))) {
    return 0.35;
  }
  return 0;
}

/**
 * Orders search matches. `matches` must be in the index's relevance order;
 * that order is the relevance signal.
 */
export function orderSearchResults<T extends SearchCandidate>(matches: readonly T[], query: string): T[] {
  return matches
    .map((row, position) => ({
      row,
      score:
        WEIGHTS.relevance * relevanceWeight(position) +
        WEIGHTS.quality * qualityWeight(row.rank) +
        WEIGHTS.intent * intentWeight(row.name, query),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.row.rank - a.row.rank ||
        (a.row.agentKey < b.row.agentKey ? -1 : a.row.agentKey > b.row.agentKey ? 1 : 0),
    )
    .map(({ row }) => row);
}

/** `"blend:<offset>"`. Anything else, including a cursor from the old index-order search, restarts at 0. */
export function parseSearchCursor(cursor: string | null): number {
  if (!cursor) return 0;
  const match = /^blend:(\d+)$/.exec(cursor);
  return match ? Number(match[1]) : 0;
}

export function searchCursor(offset: number): string {
  return `blend:${offset}`;
}
