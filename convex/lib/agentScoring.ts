/**
 * STAGE 2 of the discovery pipeline: the classifier.
 *
 * Decides two things about a candidate that survived convex/lib/prefilter.ts:
 * is this a real, single-purpose service agent, and if so which ONE of the four
 * graded categories is it actually about. Returning `null` is a first-class
 * answer - an agent that does not clearly belong in one of the four is excluded,
 * never force-fitted, the same principle the Grid Trading taxonomy split already
 * established.
 *
 * ---------------------------------------------------------------------------
 * DECISION (2026-08-29): weighted multi-signal scoring, not an LLM step.
 * ---------------------------------------------------------------------------
 * Documented here the same way DEFAULT_READ_ONLY_PRICE_MODEL is documented in
 * convex/lib/agentCatalog.ts, because it is a judgment call and it should be
 * reversible by whoever disagrees.
 *
 * The brief asked for a real comparison rather than an assumption, so:
 *
 * WHAT AN LLM STEP WOULD COST HERE. It would run only on pre-filter survivors,
 * which this session measured at 490 out of a 1,446-agent topical union - a few
 * hundred short prompts per full cycle, which is genuinely affordable. Latency
 * is fine too, since the pipeline is already asynchronous and cron-driven. So
 * cost is NOT the reason this went the other way.
 *
 * THE REASON IS THAT IT CANNOT BE VERIFIED FROM HERE, AND THIS PROJECT DOES NOT
 * SHIP UNVERIFIED CODE. There is no LLM credential in this deployment and no LLM
 * SDK in either package.json - checked, not assumed (`npx convex env list`
 * returns only SCAN8004_API_KEY). Wiring an LLM call would mean committing a
 * code path that has never once executed, whose accuracy is asserted rather than
 * measured, in the exact place where a wrong answer produces a confident,
 * plausible-looking false claim about a real agent. That is precisely the
 * failure mode AGENTS.md §5 and §6 exist to prevent, and every prior session on
 * this project has held that line.
 *
 * A heuristic, by contrast, can be run against 1,446 real registry records right
 * now and its errors can be counted - which is what was done before committing
 * it (see SESSION-LOG-2026-08-29-discovery.md for the run).
 *
 * WHAT WOULD CHANGE THIS. An LLM step is the better classifier at this volume,
 * and this decision should be revisited the moment a credential exists. The
 * seam is deliberately ready: `scoreAgent` returns a full evidence trail
 * (`signals`, `penalties`, `runnerUp`), and the pipeline treats the classifier
 * as one input to `resolveStatus`. An LLM verdict would slot in as a second
 * opinion on the same candidate set, with disagreement between the two demoting
 * an agent to `pending` rather than either one silently winning. It must never
 * run over the full registry, only over pre-filter survivors.
 *
 * WHAT THIS IS NOT. It is not the old single-keyword match in
 * convex/lib/classification.ts, which assigned a category on one substring hit
 * and called a single weak term "likely". That classifier had no notion of a
 * competing category, no notion of an agent being too broad to belong to any
 * category, and no way to be wrong on purpose. This one scores every category,
 * requires a margin over the runner-up, and can reject an agent for being about
 * too many things at once - which is what the two entries in the manual
 * exclusion denylist were both actually about.
 */

import type { AgentCategory } from "./agentCatalog";

export interface CategorySignal {
  category: AgentCategory;
  /** Weight this signal contributed. */
  weight: number;
  /** What matched, and where, so a classification is auditable after the fact. */
  detail: string;
}

export interface ScorePenalty {
  /** Negative number, added to the winning category's score. */
  amount: number;
  detail: string;
}

export interface ClassificationResult {
  /** null = does not clearly belong to any category. An honest outcome, not a failure. */
  category: AgentCategory | null;
  /** null whenever `category` is null. */
  confidence: "confirmed" | "likely" | null;
  /** The winning category's score after penalties. */
  score: number;
  /** The next-best category, so ambiguity is visible rather than hidden. */
  runnerUp: { category: AgentCategory; score: number } | null;
  signals: CategorySignal[];
  penalties: ScorePenalty[];
  /** Set whenever `category` is null - says why, in a sentence a human can check. */
  rejectionReason: string | null;
}

/* ---------------------------------------------------------------------------
 * The vocabulary.
 *
 * Three tiers, by how much of an identity claim the phrase actually is:
 *
 *   defining   - naming this is naming what the agent IS. "health factor",
 *                "concentrated liquidity", "grid trading". A real agent in the
 *                category is close to unable to describe itself without one.
 *   supporting - strongly associated, but a neighbouring agent could say it too.
 *                "liquidation threshold" is said by lending agents generally.
 *   weak       - topical only. "vault", "yield", "collateral" on their own are
 *                said by half of DeFi.
 *
 * Every phrase is traceable to copy on a real agent read this session or in a
 * prior one. Do not add a phrase here because it sounds like it should exist.
 * ------------------------------------------------------------------------ */

interface TermTiers {
  defining: readonly string[];
  supporting: readonly string[];
  weak: readonly string[];
}

const CATEGORY_TERMS: Record<AgentCategory, TermTiers> = {
  monitoring: {
    // Kept classifiable on purpose even though it is not a graded category.
    // Recognising a wallet monitor AS a wallet monitor is what stops it being
    // force-fitted into health-factor, which is the nearest graded neighbour and
    // shares most of its vocabulary.
    defining: ["wallet monitor", "monitors wallet", "tracks wallet", "watches wallet", "position monitor", "monitoring agent"],
    supporting: ["on-chain alert", "activity alert", "notify you when", "watchlist"],
    weak: ["surveillance", "notify", "alert"],
  },
  rebalancing: {
    defining: [
      "concentrated liquidity", "liquidity range", "range rebalanc", "lp rebalanc",
      "rebalances when price", "tick range", "lp position", "range boundary",
      "portfolio rebalanc", "reposition liquidity",
    ],
    supporting: ["v3 pool", "position manager", "price range", "liquidity position", "fee tier", "tick spacing", "in range", "out of range", "range order"],
    weak: ["rebalanc", "liquidity pool", "impermanent loss", "drift"],
  },
  "grid-trading": {
    defining: ["grid trading", "grid trader", "grid strategy", "grid plan", "buy and sell ladder", "price ladder", "grid configuration", "grid level", "grid rung"],
    supporting: ["geometric grid", "symmetric buy", "price wall", "rungs", "ladder"],
    weak: ["grid"],
  },
  "health-factor": {
    defining: [
      "health factor", "liquidation protection", "liquidation risk", "prevent liquidation",
      "collateral ratio", "liquidation threshold", "collateral drawdown", "liquidation buffer",
      "loan-to-value", "loan to value",
    ],
    supporting: ["lending position", "borrow limit", "repayment requirement", "stress test", "getaccountliquidity", "safe position", "margin call"],
    weak: ["liquidation", "collateral", "borrow", "lending", "debt", "leverage"],
  },
  yield: {
    defining: [
      "yield farming", "yield optimi", "yield maximi", "yield aggregat", "auto-compound",
      "auto compound", "autocompound", "apy optimi", "highest net apy", "supply rate",
      "vault rotation", "earn most",
    ],
    supporting: ["farming strateg", "staking reward", "compounding reward", "deposit limit", "erc-4626", "erc4626", "vault compatib", "harvest"],
    weak: ["yield", "vault", "apy", "apr", "farming", "staking", "earn"],
  },
};

const WEIGHT = {
  definingInName: 12,
  definingInDescription: 8,
  supportingInName: 6,
  supportingInDescription: 3,
  weakInDescription: 1,
} as const;

/** A description that repeats "yield" nine times is not nine times more a yield agent. */
const MAX_WEAK_HITS_COUNTED = 3;

/* ---------------------------------------------------------------------------
 * Negative signals.
 * ------------------------------------------------------------------------ */

/**
 * Capabilities that belong to neither of the four categories. An agent naming
 * several of these is a general-purpose "does everything" agent that happens to
 * mention one category in passing - which is exactly what both entries in the
 * manual exclusion denylist turned out to be, and exactly the false positive
 * this classifier has to catch on its own rather than by being told the answer.
 */
const OFF_DOMAIN_CAPABILITIES: readonly string[] = [
  "bridge", "perp", "prediction market", "launch token", "token launch",
  "pump.fun", "clanker", "register blockchain name", "domain name", "nft mint",
  "airdrop", "gauge vote", "bribe", "governance vote", "dao voting", "escrow",
  "smart contract audit", "gas optimization", "vulnerability detection",
  "sentiment", "social", "narrative", "meme", "news", "price oracle",
  "token issuance", "arbitrage", "wrap/unwrap", "copy trading",
];

/**
 * How many distinct action verbs the description claims. A focused agent
 * describes a few ("reads a Venus lending position, derives a health factor,
 * and reports liquidation risk" = 3). A capability catalogue lists a dozen.
 * Measured against real registry copy before the threshold below was set.
 */
const ACTION_VERBS: readonly string[] = [
  "route", "swap", "trade", "bridge", "send", "wrap", "burn", "bet", "launch",
  "register", "mint", "vote", "claim", "deposit", "withdraw", "stake", "unstake",
  "borrow", "repay", "supply", "redeem", "lend", "rebalance", "compound",
  "monitor", "track", "analyz", "analys", "report", "recommend", "verif",
  "validat", "estimat", "comput", "read", "plan", "design", "optimi", "manage",
  "execut", "audit", "scan", "detect", "aggregat", "harvest", "collect",
];

const BREADTH_VERB_THRESHOLD = 8;

/** Not a hard reject (see the note in prefilter.ts) but real evidence. */
const TEST_MARKER = /\btest\b/i;

/* ---------------------------------------------------------------------------
 * CONFIDENCE THRESHOLDS - the numbers that decide what reaches the public
 * catalog. These are the load-bearing constants of this module; change them
 * knowingly.
 *
 * `confirmed` is the ONLY band the pipeline auto-publishes (see
 * convex/lib/pipelineStatus.ts). The bar is deliberately four conditions rather
 * than one score, because a wrongly-published spam agent damages trust in the
 * whole marketplace, whereas a real agent sitting one cycle longer in `pending`
 * costs a cycle:
 *
 *   1. at least one DEFINING phrase matched  - a pile of weak topical terms can
 *      never reach `confirmed` on its own, no matter how many there are
 *   2. score >= CONFIRMED_SCORE              - enough total evidence
 *   3. margin >= CONFIRMED_MARGIN over the runner-up - if two categories are
 *      close, that is genuine ambiguity and the honest answer is "not certain"
 *   4. no breadth penalty at all             - a general-purpose agent is never
 *      auto-published into a specific category
 *
 * `likely` lands in `pending`: plausible, visible to an operator, not public.
 * ------------------------------------------------------------------------ */
export const CONFIRMED_SCORE = 12;
export const CONFIRMED_MARGIN = 6;
export const LIKELY_SCORE = 4;

function normalize(text: string): string {
  return (text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function countDistinct(haystack: string, needles: readonly string[]): string[] {
  return needles.filter((n) => haystack.includes(n));
}

/**
 * Scores a candidate across every category and returns the winner with its
 * evidence, or null with a stated reason.
 *
 * `name` and `description` are 8004scan's indexed values; `crossCheck` is the
 * agent's own registration file where the pipeline managed to fetch it (see
 * convex/lib/registrationFile.ts). The agent's own current claim about itself is
 * appended to the text under consideration, so an agent that has since renamed
 * or re-scoped itself is judged on what it says now, not only on what the
 * indexer cached.
 */
export function scoreAgent(
  name: string,
  description: string,
  crossCheck?: { name?: string | null; description?: string | null; skills?: readonly string[] },
): ClassificationResult {
  const nameText = normalize(`${name ?? ""} ${crossCheck?.name ?? ""}`);
  const descriptionText = normalize(
    [description ?? "", crossCheck?.description ?? "", (crossCheck?.skills ?? []).join(" ")].join(" "),
  );
  const combined = `${nameText} ${descriptionText}`;

  const signals: CategorySignal[] = [];
  const scores = new Map<AgentCategory, number>();
  const definingHits = new Map<AgentCategory, number>();

  for (const category of Object.keys(CATEGORY_TERMS) as AgentCategory[]) {
    const tiers = CATEGORY_TERMS[category];
    let score = 0;

    for (const term of countDistinct(nameText, tiers.defining)) {
      score += WEIGHT.definingInName;
      definingHits.set(category, (definingHits.get(category) ?? 0) + 1);
      signals.push({ category, weight: WEIGHT.definingInName, detail: `defining phrase "${term}" in the name` });
    }
    for (const term of countDistinct(descriptionText, tiers.defining)) {
      if (nameText.includes(term)) continue; // already counted, at the higher weight
      score += WEIGHT.definingInDescription;
      definingHits.set(category, (definingHits.get(category) ?? 0) + 1);
      signals.push({ category, weight: WEIGHT.definingInDescription, detail: `defining phrase "${term}" in the description` });
    }
    for (const term of countDistinct(nameText, tiers.supporting)) {
      score += WEIGHT.supportingInName;
      signals.push({ category, weight: WEIGHT.supportingInName, detail: `supporting phrase "${term}" in the name` });
    }
    for (const term of countDistinct(descriptionText, tiers.supporting)) {
      if (nameText.includes(term)) continue;
      score += WEIGHT.supportingInDescription;
      signals.push({ category, weight: WEIGHT.supportingInDescription, detail: `supporting phrase "${term}" in the description` });
    }
    const weakHits = countDistinct(combined, tiers.weak).slice(0, MAX_WEAK_HITS_COUNTED);
    for (const term of weakHits) {
      score += WEIGHT.weakInDescription;
      signals.push({ category, weight: WEIGHT.weakInDescription, detail: `weak term "${term}"` });
    }

    if (score > 0) scores.set(category, score);
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);

  const penalties: ScorePenalty[] = [];

  const offDomain = countDistinct(combined, OFF_DOMAIN_CAPABILITIES);
  if (offDomain.length >= 2) {
    penalties.push({
      amount: -4 * offDomain.length,
      detail: `names ${offDomain.length} capabilities outside all four categories (${offDomain.slice(0, 6).join(", ")})`,
    });
  }

  const verbs = countDistinct(combined, ACTION_VERBS);
  if (verbs.length >= BREADTH_VERB_THRESHOLD) {
    penalties.push({
      amount: -3 * (verbs.length - BREADTH_VERB_THRESHOLD + 1),
      detail: `describes ${verbs.length} distinct actions, which reads as a general-purpose capability catalogue rather than one focused service`,
    });
  }

  if (TEST_MARKER.test(name ?? "")) {
    penalties.push({ amount: -6, detail: `name contains "test"` });
  }

  if (descriptionText.length < 60) {
    penalties.push({ amount: -3, detail: "description is under 60 characters, so there is thin evidence either way" });
  }

  const penaltyTotal = penalties.reduce((sum, p) => sum + p.amount, 0);

  if (ranked.length === 0) {
    return {
      category: null, confidence: null, score: 0, runnerUp: null, signals, penalties,
      rejectionReason: "No term from any of the four graded categories appeared in the name, description, or the agent's own registration file.",
    };
  }

  const [winner, runnerUp] = ranked;
  const adjusted = winner[1] + penaltyTotal;
  const margin = winner[1] - (runnerUp?.[1] ?? 0);
  const runnerUpResult = runnerUp ? { category: runnerUp[0], score: runnerUp[1] } : null;

  const base = { score: adjusted, runnerUp: runnerUpResult, signals, penalties };

  // Recognised, but not one of the four the marketplace grades. Excluding it is
  // the honest outcome and is exactly why `monitoring` stays classifiable.
  if (winner[0] === "monitoring") {
    return {
      ...base, category: null, confidence: null,
      rejectionReason: "Reads as a wallet/position monitoring agent, which is deliberately not one of the four graded categories.",
    };
  }

  if (adjusted < LIKELY_SCORE) {
    return {
      ...base, category: null, confidence: null,
      rejectionReason:
        penaltyTotal < 0
          ? `Best category was ${winner[0]} at ${winner[1]}, but penalties (${penalties.map((p) => p.detail).join("; ")}) reduced it to ${adjusted}, below the ${LIKELY_SCORE} floor.`
          : `Best category was ${winner[0]} at ${adjusted}, below the ${LIKELY_SCORE} floor for even a tentative classification.`,
    };
  }

  const hasDefining = (definingHits.get(winner[0]) ?? 0) > 0;
  const confirmed =
    hasDefining &&
    adjusted >= CONFIRMED_SCORE &&
    margin >= CONFIRMED_MARGIN &&
    penaltyTotal === 0;

  return {
    ...base,
    category: winner[0],
    confidence: confirmed ? "confirmed" : "likely",
    rejectionReason: null,
  };
}

/**
 * Why an agent that scored `likely` fell short of `confirmed`. Stored on the
 * candidate row so "why is this still pending" is answerable without re-running
 * the scorer, and so the confidence field carries real information rather than
 * being decoration - the exact gap flagged in a prior session.
 */
export function explainShortfall(result: ClassificationResult): string | null {
  if (result.confidence !== "likely" || result.category === null) return null;
  const reasons: string[] = [];
  if (result.penalties.length > 0) {
    reasons.push(`carries penalties (${result.penalties.map((p) => p.detail).join("; ")})`);
  }
  if (result.score < CONFIRMED_SCORE) {
    reasons.push(`scored ${result.score}, under the ${CONFIRMED_SCORE} needed to auto-publish`);
  }
  if (result.runnerUp && result.runnerUp.score > 0) {
    reasons.push(`${result.runnerUp.category} scored ${result.runnerUp.score}, too close to call outright`);
  }
  return reasons.length > 0
    ? `Held as pending because it ${reasons.join(", and ")}.`
    : "Held as pending because no defining phrase for the category was found - only weaker topical terms.";
}
