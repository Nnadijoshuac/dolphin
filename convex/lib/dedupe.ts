/**
 * ONE PRODUCT, ONE LISTING.
 *
 * Publishers register the same agent more than once. On 2026-09-25 the live
 * catalog listed "Grid Agent 1 by 4LPHA" four times, and "Grid Agent 1..3"
 * were one sentence under one owner. A browse list that shows the same product
 * four times reads as padding, and Set and Earn grades agent diversity.
 *
 * TWO OF THREE. Registrations are the same product when at least two of name,
 * owner and description match (normalised). One alone is not enough: two
 * publishers can both call something "Grid Trader", and one publisher can run
 * several different agents. Two together is a re-registration.
 *
 * The highest-ranked registration of each group stays `live`; the rest become
 * `duplicate`, which every browse, search, facet and shelf query leaves out
 * because they all read `status == "live"`. Nothing is deleted, and a duplicate's
 * page still resolves by link.
 */

export interface DedupeCandidate {
  agentKey: string;
  name: string;
  description: string;
  ownerAddress: string;
  rank: number;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function sameProduct(a: DedupeCandidate, b: DedupeCandidate): boolean {
  const name = normalize(a.name) === normalize(b.name);
  const owner = a.ownerAddress.toLowerCase() === b.ownerAddress.toLowerCase();
  const description =
    normalize(a.description).length > 0 && normalize(a.description) === normalize(b.description);
  return Number(name) + Number(owner) + Number(description) >= 2;
}

/**
 * The keys that should be `duplicate`: every candidate but the best of its group.
 *
 * Grouping is TRANSITIVE: a candidate joins a group when it matches ANY member,
 * not only the winner. Comparing against winners alone left two 4LPHA grid
 * listings on dev - "Grid Agent 2" (346171) shared only a description with the
 * winning "Grid Agent 1", while matching name and owner with members already
 * collapsed into that group.
 */
export function findDuplicates(candidates: readonly DedupeCandidate[]): Set<string> {
  const ordered = [...candidates].sort(
    (a, b) => b.rank - a.rank || (a.agentKey < b.agentKey ? -1 : 1),
  );
  const groups: DedupeCandidate[][] = [];
  for (const candidate of ordered) {
    const matching = groups.filter((group) => group.some((member) => sameProduct(member, candidate)));
    if (matching.length === 0) {
      groups.push([candidate]);
      continue;
    }
    // A candidate can bridge two groups; merge them, keeping rank order.
    const [first, ...rest] = matching;
    first.push(candidate);
    for (const other of rest) {
      first.push(...other);
      groups.splice(groups.indexOf(other), 1);
    }
  }
  const duplicates = new Set<string>();
  for (const group of groups) {
    // Everyone but the highest-ranked member.
    const others = [...group]
      .sort((a, b) => b.rank - a.rank || (a.agentKey < b.agentKey ? -1 : 1))
      .slice(1);
    for (const other of others) duplicates.add(other.agentKey);
  }
  return duplicates;
}
