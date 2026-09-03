/**
 * THE MANUAL SAFETY VALVE - compile-time half.
 *
 * Agents that pass every automated filter but were reviewed by a human and
 * rejected as too broad a fit: the matched category is one incidental clause
 * among many unrelated capabilities, not what the agent actually is.
 *
 * MOVED HERE (2026-08-30) from convex/discoveredAgents.ts, unchanged, so both
 * the old keyword sync and the new automated pipeline
 * (convex/discoveryPipeline.ts) enforce the same list rather than each keeping
 * its own. discoveredAgents.ts still re-exports it, so nothing that referenced
 * it there breaks.
 *
 * WHY THIS SURVIVES THE AUTOMATED CLASSIFIER. The new scorer is specifically
 * designed to catch this failure mode on its own - it penalises agents that
 * name capabilities outside every category and agents that read as a
 * general-purpose capability catalogue - and it does catch both entries below
 * unaided (verified this session, without being told the answer). The list is
 * kept anyway because no classifier is right every time, and a marketplace that
 * publishes automatically needs a way for a human to be final about one
 * specific case without waiting on a redeploy or a threshold change that would
 * move every other agent too.
 *
 * There is also a runtime half: `discoveryPipeline.setManualOverride` records
 * the same decision in the database, for a case found after a deploy. Both are
 * checked, and either one is sufficient to keep an agent out.
 *
 * Re-review by hand if 8004scan meaningfully updates an excluded agent's own
 * description.
 */
export const MANUALLY_EXCLUDED_TOKEN_IDS: ReadonlySet<string> = new Set([
  "113284", // Topaz Agent - broad ve(3,3) DEX agent (swaps, gauge votes, bribes,
  // veTOPAZ locks); "optimize LP positions" is one clause among many, not its
  // identity. Matches rebalancing's "lp position" term.
  "6428", // Tator Trader - 24+ chain "does everything" agent (trades, bridges,
  // perps, prediction markets, token launches, name registration); "manage
  // yield positions" is one clause among ten. Matches yield's weak "yield" term.
]);
