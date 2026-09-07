/**
 * THE STABLE SORT KEY.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ONE PRECOMPUTED NUMBER
 * ---------------------------------------------------------------------------
 * Because cursor pagination requires it. A paginated query walks an index, and
 * a cursor is a position IN that index. If the ordering is computed at read
 * time - by collecting rows and sorting them, which is what `listAgents` and
 * `sortHireableFirst` did between them - then two rows can swap places between
 * page one and page two, and the reader sees one agent twice and never sees
 * another. An ordering that is a stored, indexed field cannot do that.
 *
 * It is also the only way to order without a scan. `by_status_rank` is
 * `[status, rank]`, so "the next 25 live agents" is an index range read, not a
 * sort over the catalog.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT IS NOT
 * ---------------------------------------------------------------------------
 * It is not a quality score and it must never be presented as one. Nothing here
 * measures whether an agent does its job well - that is what reviews are for,
 * and `convex/agentSignals.ts` reports those separately and honestly, with
 * rates suppressed below a minimum denominator.
 *
 * This is shelf position. Every input is a fact Dolphin verified itself or read
 * from a named source, and every weight is a Dolphin decision about ordering,
 * not a claim about the agent. Nothing derived from it is ever rendered as a
 * number to a user.
 */

export interface RankInput {
  /** Hand-vetted. A boost, never an exemption from verification. */
  curated: boolean;
  /** Returned a quote the hire path could actually honour. */
  hasPayableQuote: boolean;
  /** Skills from its own card, or tools from its MCP server. */
  skillCount: number;
  /** ERC-8004 feedbacks, from the indexer. */
  feedbackCount: number;
  /** 8004scan's own 0-100 composite. Used as a weak tiebreak, never as a gate. */
  sourceScore: number;
  /** 8004scan verified the endpoint's domain. Five agents chain-wide, so it is rare and meaningful. */
  endpointVerified: boolean;
  /** Published an icon of its own rather than falling back to a generated one. */
  hasPublisherIcon: boolean;
  name: string;
  description: string;
}

/**
 * A "test" marker is real signal, and it is a rank penalty rather than a
 * rejection.
 *
 * The filter this replaces hard-rejected any name matching /\btest\b/, and run
 * against real data that is a false negative on a genuine agent: token 292939
 * is a working PancakeSwap grid-trading agent deployed as
 * "bnb-grid-trader-test.agent". It survived only because a human had curated it
 * separately. Here the rest of the evidence still gets a say - the agent is
 * listed, just not near the top.
 */
const TEST_MARKER = /\btest(ing|net)?\b|\bdemo\b|\bsandbox\b|\bplaceholder\b/i;

/** Cheap saturating curve: rewards the first few of something, ignores the tail. */
function saturate(value: number, scale: number, cap: number): number {
  if (value <= 0) return 0;
  return Math.round(cap * (1 - Math.exp(-value / scale)));
}

/**
 * Higher is better. Queries read `by_status_rank` in descending order.
 *
 * Deliberately an integer: a float rank is a float index key, and two agents
 * whose scores differ in the fifteenth decimal place are a tie that should be
 * broken by the index's own deterministic ordering rather than by rounding.
 */
export function computeRank(input: RankInput): number {
  let rank = 0;

  // A human looked at it. The largest single term, and still not decisive on
  // its own against a well-evidenced discovered agent.
  if (input.curated) rank += 300;

  // It quoted a price the hire path validated against its registered wallet.
  // This is the strongest evidence in the system that a hire would complete,
  // because it is the same call and the same validator a hire runs.
  if (input.hasPayableQuote) rank += 200;

  // It told a client what it can do. Saturating, so an agent listing 40 skills
  // does not outrank one that lists four and actually sells.
  rank += saturate(input.skillCount, 3, 100);

  // Other people have used it. ERC-8004 feedback is on-chain and countable.
  rank += saturate(input.feedbackCount, 5, 150);

  // 8004scan verified the endpoint's DOMAIN. Only 5 agents chain-wide hold this
  // (measured 2026-09-07), which is exactly why it is worth points and could
  // never have been a gate.
  if (input.endpointVerified) rank += 100;

  // The indexer's own composite, scaled down hard. It is a weak, opaque signal
  // and it is here only to break ties between otherwise identical agents.
  rank += Math.round(Math.max(0, Math.min(100, input.sourceScore)) * 0.5);

  // It looks like a product. A publisher who supplied an icon has done more
  // than mint an identity.
  if (input.hasPublisherIcon) rank += 40;

  // See TEST_MARKER above. A penalty, not a rejection.
  if (TEST_MARKER.test(input.name) || TEST_MARKER.test(input.description)) {
    rank -= 120;
  }

  // A description that says almost nothing cannot be presented well, however
  // good the service behind it is.
  if (input.description.trim().length < 80) rank -= 40;

  return Math.max(0, rank);
}
