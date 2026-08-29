/**
 * STAGE 1 of the discovery pipeline: the cheap pre-filter.
 *
 * WHY IT EXISTS. 8004scan indexes 289,938 ERC-8004 identities on BSC mainnet
 * (measured live 2026-08-29, not carried from notes). Nothing expensive can run
 * over that set: at a measured 0.180 pages/s the registry takes ~4.5 hours just
 * to *read*, and a per-candidate detail fetch plus an endpoint probe on every
 * record would be several days of wall time. So the sweep hands every record it
 * sees to this function first, and only survivors reach the scorer
 * (convex/lib/agentScoring.ts) and the liveness probe.
 *
 * DESIGNED FROM THE SAMPLE, NOT FROM ASSUMPTIONS. Every rule below is traceable
 * to records actually read by hand during this session's Task 0 investigation -
 * a 2,000-record cluster sample spread across the whole registry, plus the
 * 1,446-agent topical union returned by a 50-term vocabulary search. See
 * SESSION-LOG-2026-08-29-discovery.md for the counts each rule was drawn from.
 * Do not add a rule here that cannot be pointed at a real observed registration.
 *
 * THE BIAS IS DELIBERATE: false negatives are worse than false positives.
 * Anything this stage drops is never seen again by any later stage, so a rule
 * that wrongly rejects a real agent silently costs Dolphin an entire listing.
 * A rule that wrongly *keeps* spam costs one detail fetch, and the scorer and
 * the liveness probe both still get their say. Every threshold below is
 * therefore set loose on purpose. `isOffTopic`'s vocabulary in particular is far
 * wider than the scoring vocabulary - it only has to answer "could this possibly
 * be about DeFi at all", not "which category is it".
 */

export type PrefilterRule =
  | "empty-description"
  | "numeric-noise"
  | "repeated-token"
  | "collectible-series"
  | "campaign-template"
  | "persona-agent"
  | "off-topic";

export interface PrefilterResult {
  /** "candidate" survives to the scorer; "reject" stops here. */
  verdict: "candidate" | "reject";
  /** Which rule rejected it, for reportable per-rule counts. Null when kept. */
  rule: PrefilterRule | null;
  /** Human-readable, stored on the candidate row so a rejection is auditable. */
  reason: string | null;
}

const CANDIDATE: PrefilterResult = { verdict: "candidate", rule: null, reason: null };

function reject(rule: PrefilterRule, reason: string): PrefilterResult {
  return { verdict: "reject", rule, reason };
}

/**
 * Mass-registration campaign signatures. Each of these was observed as an
 * EXACT, character-identical description repeated across hundreds of separate
 * token ids in the Task 0 sample - the top six templates alone accounted for
 * ~85% of the 2,000 records read. They are matched as substrings of the
 * lowercased description because the campaigns append per-agent suffixes.
 *
 * Counts in the 2,000-record registry sample are given so a future reader can
 * tell how load-bearing each entry is, and so a stale one is obvious.
 */
const CAMPAIGN_TEMPLATES: readonly { marker: string; note: string }[] = [
  { marker: "ai-driven multi-chain trading agent with on-chain reputation", note: "Ave.ai Trading Agent - 630/2000 identical registrations" },
  { marker: "trading agent from debot.ai", note: "Debot - 48/2000" },
  { marker: "purr-fect claw cloud instance agent", note: "Purr-Fect Claw - 42/2000" },
  { marker: "on termix platform", note: "Termix Platform - 3/100 in the hand-read sample" },
  { marker: "gasless stablecoin payment agent on bnb chain", note: "Quack AI Q402 - 28/2000; also not one of the four categories" },
  { marker: "autonomous trading agent (simple-mode)", note: "131/1446 in the topical union - DeFi-flavoured templating, the dominant spam shape INSIDE the topical slice" },
  { marker: "ai agent for liquid-staking", note: "44/1446 in the topical union" },
  { marker: "autonomous trading agent. trades aster dex perps", note: "BUILD# series - 38/1446 in the topical union" },
  { marker: "citizen of xtown", note: "XTown persona series - 9/2000" },
  { marker: "3d interactive agent", note: "carried over from the pre-existing filter" },
];

/**
 * Persona / "digital twin" products. These register in bulk with LLM-persona
 * flavour text and are not services at all. EvoEvo alone was ~867/2000 (43%) of
 * the registry sample, across a dozen different persona openings, which is why
 * the marker is the product name rather than any one opening line.
 */
const PERSONA_MARKERS: readonly string[] = [
  "an evoevo ai agent",
  "evoevo agent",
  "· ensoul",
  " ensoul",
  "yi he nexus",
];

/**
 * Collectible series naming. `BORT <two words> ##` recurred as ~15 registrations
 * per series name across at least ten series in the topical union - gamified NFT
 * collectibles that borrow DeFi jargon as flavour text ("BORT Yield Weaver #10922",
 * "BORT Liquidity Oracle #4471"), which is exactly why they reach the topical
 * union at all and must be cut here rather than left to the scorer.
 */
const COLLECTIBLE_SERIES = /\bbort\s+\w+\s+\w*\s*#\s*\d+/i;
const NFT_EDITION_MARKER = /\bedition\s+\d+\s*\/\s*\d+\b/i;

/** e.g. "ONEAIONEAIONEAI", "biuaibiuaibiuai" - carried over from the original filter. */
const REPEATED_TOKEN_SPAM = /(.{3,})\1{2,}/i;

/**
 * NOT A RULE HERE, ON PURPOSE. The pre-existing filter this module replaces
 * hard-rejected any name matching /\btest\b/. Running that rule against real
 * data this session showed it is a false negative on a genuine agent: token
 * 292939 is a working PancakeSwap grid-trading agent whose deployed 8004scan
 * name is "bnb-grid-trader-test.agent". It survives today only because it is
 * also hand-curated in the editorial catalog and so never reaches this filter -
 * an agent like it that nobody had curated would have been silently lost.
 *
 * A "test" marker is real signal, just not conclusive enough to be terminal at a
 * stage nothing can appeal. It now lives in convex/lib/agentScoring.ts as a
 * confidence penalty, where the rest of the evidence still gets a say.
 */

/** The bare mint-time default 8004scan shows when nothing was ever registered. */
const DEFAULT_NAME = /^agent\s*#?\s*\d+$/i;

/**
 * The topical gate. Deliberately far wider than the scoring vocabulary: this
 * asks only "could this text possibly be about on-chain finance", and every one
 * of Dolphin's four categories is unimaginable without at least one of these
 * appearing somewhere in the name or description.
 *
 * Substrings, not words, so "rebalanc" catches rebalance/rebalancer/rebalancing
 * and "liquidat" catches liquidation/liquidations/liquidated in one entry.
 */
const DEFI_VOCABULARY: readonly string[] = [
  // liquidity & AMM
  "liquidity", "liquidit", "lp ", " lp", "pool", "amm", "dex", "swap", "tick",
  "impermanent", "concentrated", "fee tier", "market mak",
  // rebalancing
  "rebalanc", "range", "reposition", "position manager",
  // grid
  "grid", "ladder", "price wall", "buy and sell",
  // lending / risk
  "lend", "borrow", "collateral", "liquidat", "health factor", "ltv",
  "loan-to-value", "loan to value", "debt", "leverage", "margin",
  // yield
  "yield", "apy", "apr", "farm", "vault", "compound", "stak", "reward",
  "earn", "interest rate",
  // protocols named in the four categories' data sources
  "venus", "pancakeswap", "pancake", "aave", "beefy", "alpaca", "radiant",
  "thena", "biswap", "uniswap", "morpho", "curve", "lista", "kinza", "wombat",
  // general on-chain finance
  "defi", "portfolio", "treasury", "trading strateg", "on-chain finance",
  "allocation", "risk manage", "drawdown", "slippage",
];

function normalize(text: string): string {
  return (text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Is the text overwhelmingly digits? e.g. description "70811513902261128802212069207154911872080276915736851192274192931669450883390". */
function isNumericNoise(name: string, description: string): boolean {
  const trimmedName = name.trim();
  if (/^\d+$/.test(trimmedName)) return true;
  const stripped = description.replace(/\s/g, "");
  if (stripped.length < 20) return false;
  const digits = (stripped.match(/\d/g) ?? []).length;
  return digits / stripped.length >= 0.9;
}

/**
 * The pre-filter itself. Cheap by construction: string work only, no network
 * call, no per-record I/O, so it can run over every record the sweep sees.
 *
 * Rules run structural-first (cheapest and most certain), then known campaign
 * signatures, then the topical gate last - so the reported per-rule counts read
 * as a funnel rather than as whichever rule happened to fire first.
 */
export function prefilterAgent(name: string, description: string): PrefilterResult {
  const rawName = (name ?? "").trim();
  const rawDescription = (description ?? "").trim();
  const combined = normalize(`${rawName} ${rawDescription}`);

  // 6.8% of the registry has no description at all, and another 3% have fewer
  // than 30 characters. An agent that says nothing about itself cannot be
  // placed in a category by any means available here, so dropping it loses
  // nothing that a later stage could have recovered.
  if (rawDescription.length < 20) {
    return reject(
      "empty-description",
      `Description is ${rawDescription.length} characters; too short to establish what the agent does.`,
    );
  }

  if (DEFAULT_NAME.test(rawName)) {
    return reject(
      "empty-description",
      `Name "${rawName}" is 8004scan's mint-time default, meaning no name was ever registered.`,
    );
  }

  if (isNumericNoise(rawName, rawDescription)) {
    return reject("numeric-noise", "Name or description is essentially a digit string, not prose.");
  }

  if (REPEATED_TOKEN_SPAM.test(rawName) || REPEATED_TOKEN_SPAM.test(rawDescription)) {
    return reject("repeated-token", "Name or description is a short token repeated three or more times.");
  }

  if (COLLECTIBLE_SERIES.test(rawName) || NFT_EDITION_MARKER.test(combined)) {
    return reject("collectible-series", "Numbered collectible-series naming, not a service registration.");
  }

  for (const { marker, note } of CAMPAIGN_TEMPLATES) {
    if (combined.includes(marker)) {
      return reject("campaign-template", `Matches a known mass-registration template (${note}).`);
    }
  }

  for (const marker of PERSONA_MARKERS) {
    if (combined.includes(marker)) {
      return reject("persona-agent", "Persona / digital-twin product registration, not a DeFi service.");
    }
  }

  if (!DEFI_VOCABULARY.some((term) => combined.includes(term))) {
    return reject(
      "off-topic",
      "Nothing in the name or description refers to on-chain finance, so it cannot belong to any of the four graded categories.",
    );
  }

  return CANDIDATE;
}

/** The rule ids, so a caller can report a complete funnel with explicit zeroes. */
export const PREFILTER_RULES: readonly PrefilterRule[] = [
  "empty-description",
  "numeric-noise",
  "repeated-token",
  "collectible-series",
  "campaign-template",
  "persona-agent",
  "off-topic",
];
