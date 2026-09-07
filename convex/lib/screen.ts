/**
 * THE CHEAP SCREEN. Pure string work, no network call, AND NO WRITES.
 *
 * ---------------------------------------------------------------------------
 * THE ONE CHANGE THAT MATTERS: THIS FUNCTION NO LONGER PRODUCES ROWS
 * ---------------------------------------------------------------------------
 * Its predecessor, convex/lib/prefilter.ts, wrote a database row for every
 * record it rejected. Those rows became 251,922 of the 257,991 in the ledger -
 * 97.6% of a table that existed to describe 26 published agents - and took the
 * deployment over its storage ceiling, which switched discovery off entirely on
 * 2026-09-02.
 *
 * Nothing is stored here now. A screened-out record is COUNTED into
 * `discoveryCursor`, and the incremental `created_after` cursor guarantees it is
 * never fetched a second time. Re-deriving a string verdict costs microseconds;
 * the only decision worth persisting is one that cost a network round trip.
 *
 * ---------------------------------------------------------------------------
 * THE TOPICAL GATE IS DELETED, DELIBERATELY
 * ---------------------------------------------------------------------------
 * prefilter.ts's largest rule was `off-topic`: a 90-term DeFi vocabulary, and a
 * record mentioning none of it was rejected outright and never seen again.
 *
 * That was a CATEGORY FILTER wearing a spam filter's clothes. It encoded the
 * assumption that a marketplace agent must be about on-chain finance, which was
 * true of the four graded hackathon categories and is not true of the product:
 * an agent that writes code, researches a market, or moves data is a perfectly
 * good thing to hire, and every one of them was being discarded before anything
 * could ask whether it worked. It is the single biggest reason the catalog
 * could never grow past a handful of DeFi tools.
 *
 * What survives are rules about FORM, not TOPIC - "this registration is not a
 * service at all". Each is traceable to records read by hand during the
 * 2026-08-29 registry sample and re-confirmed against a live page today, where
 * the newest 100 A2A registrations were dominated by "<name>.agent" identities
 * carrying an identical "Autonomous <noun> agent registered through …" template.
 *
 * ---------------------------------------------------------------------------
 * THE BIAS IS STILL THAT FALSE NEGATIVES COST MORE
 * ---------------------------------------------------------------------------
 * Anything dropped here is never probed, so a wrong rejection silently costs a
 * listing. Anything wrongly KEPT costs one detail fetch and one probe, and the
 * probe is the real gate. Every threshold below is set loose on purpose.
 */

export type ScreenRule =
  | "empty-description"
  | "numeric-noise"
  | "repeated-token"
  | "collectible-series"
  | "campaign-template"
  | "persona-agent";

export interface ScreenResult {
  /** "candidate" is probed; "reject" stops here and is only counted. */
  verdict: "candidate" | "reject";
  rule: ScreenRule | null;
}

const CANDIDATE: ScreenResult = { verdict: "candidate", rule: null };

/**
 * Mass-registration campaign signatures. Each was observed as an EXACT,
 * character-identical description repeated across hundreds of token ids; the
 * top six accounted for ~85% of a 2,000-record registry sample. Matched as
 * substrings of the lowercased text because campaigns append per-agent
 * suffixes.
 *
 * The counts say how load-bearing each entry is, so a stale one is obvious.
 */
const CAMPAIGN_TEMPLATES: readonly { marker: string; note: string }[] = [
  { marker: "ai-driven multi-chain trading agent with on-chain reputation", note: "Ave.ai - 630/2000" },
  { marker: "trading agent from debot.ai", note: "Debot - 48/2000" },
  { marker: "purr-fect claw cloud instance agent", note: "Purr-Fect Claw - 42/2000" },
  { marker: "on termix platform", note: "Termix - templated {agentId} endpoints, uncallable" },
  { marker: "gasless stablecoin payment agent on bnb chain", note: "Quack AI Q402 - 28/2000" },
  { marker: "autonomous trading agent (simple-mode)", note: "131/1446 of the topical union" },
  { marker: "ai agent for liquid-staking", note: "44/1446" },
  { marker: "autonomous trading agent. trades aster dex perps", note: "BUILD# series - 38/1446" },
  { marker: "citizen of xtown", note: "XTown persona series - 9/2000" },
  { marker: "3d interactive agent", note: "carried over from the original filter" },
  /*
   * ADDED 2026-09-07, and it is the dominant shape in the A2A slice
   * specifically - which is the slice that now matters, because it is the only
   * one Dolphin looks at.
   *
   * MEASURED, and the exact string matters. A page of the 100 newest has_a2a
   * registrations held only 41 distinct descriptions, and 57 of the 100 were
   * one of seven "Autonomous <noun> & <noun> agent registered through TermiX."
   * strings against "<handle>.agent" identities.
   *
   * The marker is the verbatim platform phrase rather than the looser "agent
   * registered through", which would also catch a real agent describing its own
   * provenance. This rule can never be appealed, so it is worth the extra three
   * words.
   *
   * NOTE this does not subsume "on termix platform" above: that is the older
   * variant of the same platform's boilerplate, and both are live in the
   * registry today.
   */
  { marker: "registered through termix", note: "TermiX bulk registrations - 57/100 of the newest A2A page, 2026-09-07" },
];

/**
 * Persona / "digital twin" products. These register in bulk with LLM-persona
 * flavour text and are not services. EvoEvo alone was ~867/2000 (43%) of the
 * registry sample across a dozen different opening lines, which is why the
 * marker is the product name rather than any one opening.
 */
const PERSONA_MARKERS: readonly string[] = [
  "an evoevo ai agent",
  "evoevo agent",
  "· ensoul",
  " ensoul",
  "yi he nexus",
];

/** `BORT <two words> #<n>` recurred ~15 times per series across ten+ series. */
const COLLECTIBLE_SERIES = /\bbort\s+\w+\s+\w*\s*#\s*\d+/i;
const NFT_EDITION_MARKER = /\bedition\s+\d+\s*\/\s*\d+\b/i;

/** e.g. "ONEAIONEAIONEAI", "biuaibiuaibiuai". */
const REPEATED_TOKEN_SPAM = /(.{3,})\1{2,}/i;

/** 8004scan's mint-time default, meaning no name was ever registered. */
const DEFAULT_NAME = /^agent\s*#?\s*\d+$/i;

/*
 * NOT A RULE, ON PURPOSE. The original filter hard-rejected any name matching
 * /\btest\b/. Run against real data that is a false negative on a genuine
 * agent: token 292939 is a working PancakeSwap grid-trading agent whose
 * deployed name is "bnb-grid-trader-test.agent". It survived only because it
 * was also hand-curated, so an uncurated agent like it was silently lost.
 *
 * A "test" marker is real signal but not conclusive enough to be terminal at a
 * stage nothing can appeal. It is a rank penalty instead - see lib/rank.ts.
 */

function normalize(text: string): string {
  return (text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Is the text overwhelmingly digits? Some descriptions are a bare 78-digit number. */
function isNumericNoise(name: string, description: string): boolean {
  if (/^\d+$/.test(name.trim())) return true;
  const stripped = description.replace(/\s/g, "");
  if (stripped.length < 20) return false;
  const digits = (stripped.match(/\d/g) ?? []).length;
  return digits / stripped.length >= 0.9;
}

/**
 * Runs structural-first (cheapest and most certain), then known campaign
 * signatures, so the reported per-rule counts read as a funnel rather than as
 * whichever rule happened to fire first.
 */
export function screenAgent(name: string, description: string): ScreenResult {
  const rawName = (name ?? "").trim();
  const rawDescription = (description ?? "").trim();
  const combined = normalize(`${rawName} ${rawDescription}`);

  // ~7% of the registry has no description and another 3% have under 30
  // characters. An agent that says nothing about itself cannot be presented to
  // a browsing user even if its endpoint answers.
  if (rawDescription.length < 20) {
    return { verdict: "reject", rule: "empty-description" };
  }
  if (DEFAULT_NAME.test(rawName)) {
    return { verdict: "reject", rule: "empty-description" };
  }
  if (isNumericNoise(rawName, rawDescription)) {
    return { verdict: "reject", rule: "numeric-noise" };
  }
  if (REPEATED_TOKEN_SPAM.test(rawName) || REPEATED_TOKEN_SPAM.test(rawDescription)) {
    return { verdict: "reject", rule: "repeated-token" };
  }
  if (COLLECTIBLE_SERIES.test(rawName) || NFT_EDITION_MARKER.test(combined)) {
    return { verdict: "reject", rule: "collectible-series" };
  }
  for (const { marker } of CAMPAIGN_TEMPLATES) {
    if (combined.includes(marker)) return { verdict: "reject", rule: "campaign-template" };
  }
  for (const marker of PERSONA_MARKERS) {
    if (combined.includes(marker)) return { verdict: "reject", rule: "persona-agent" };
  }

  return CANDIDATE;
}

export const SCREEN_RULES: readonly ScreenRule[] = [
  "empty-description",
  "numeric-noise",
  "repeated-token",
  "collectible-series",
  "campaign-template",
  "persona-agent",
];
