/**
 * Heuristic spam-filtering and category classification for agents pulled
 * in bulk from 8004scan (discoveredAgents.ts). 8004scan has no field that
 * maps to this app's 4 categories (checked empirically - `tags`/`categories`
 * come back empty for the vast majority of real agents), and a manual
 * sample of its BSC-mainnet agents showed the registry is overwhelmingly
 * spam: templated bot registrations, test agents, and personas
 * impersonating real public figures/brands. This module is the repeatable
 * version of the filter applied by hand when vetting the first 4
 * discovered agents added to editorial-agents.ts - same bar, not a
 * separate, looser one.
 */

export type ClassificationCategory = "monitoring" | "grid-trading" | "health-factor" | "yield";

export interface ClassificationResult {
  category: ClassificationCategory;
  confidence: "confirmed" | "likely";
  matchedTerms: string[];
}

// Exact substrings observed in real spam sampled from 8004scan's BSC list
// (see the "287,502 agents" investigation) - not a general spam classifier,
// just the specific patterns actually seen.
const SPAM_MARKERS = [
  "an evoevo ai agent",
  "· ensoul", // third-party persona/"digital twin" products impersonating real public figures/brands
  " ensoul",
  "yi he nexus", // gamified NFT collectibles using real DeFi jargon as flavor text (e.g. "BORT Yield Weaver #10922")
  "3d interactive agent",
];

const REPEATED_TOKEN_SPAM = /(.{3,})\1{2,}/i; // e.g. "ONEAIONEAIONEAI", "biuaibiuaibiuai"
const TEST_MARKER = /\btest\b/i;
const NFT_EDITION_MARKER = /\bedition\s+\d+\s*\/\s*\d+\b/i; // "Edition 47/150" - collectible numbering, not a service

export function isLikelySpamOrUnsuitable(name: string, description: string): boolean {
  const nameText = (name ?? "").trim();
  const descriptionText = (description ?? "").trim();
  const combined = `${nameText} ${descriptionText}`.toLowerCase();

  if (descriptionText.length < 10) {
    return true;
  }
  if (SPAM_MARKERS.some((marker) => combined.includes(marker))) {
    return true;
  }
  if (REPEATED_TOKEN_SPAM.test(nameText) || REPEATED_TOKEN_SPAM.test(descriptionText)) {
    return true;
  }
  if (TEST_MARKER.test(nameText)) {
    return true;
  }
  if (NFT_EDITION_MARKER.test(combined)) {
    return true;
  }
  return false;
}

interface TermSet {
  strong: string[];
  weak: string[];
}

// Phrase lists reflect what real, on-topic agents actually said in the
// manual sample (e.g. "Aave powered by HeyAnon": "checks health factors",
// "Brain on BNB": "health factor"; "V3 Pools powered by HeyAnon":
// "concentrated liquidity"). Kept deliberately narrow - a term added here
// should be traceable to real observed agent copy, not a guess at what
// might exist.
const CATEGORY_TERMS: Record<ClassificationCategory, TermSet> = {
  monitoring: {
    strong: [
      "wallet monitor",
      "monitors wallet",
      "tracks wallet",
      "watches wallet",
      "position monitor",
      "monitoring agent",
    ],
    weak: ["surveillance", "notify", "watchlist"],
  },
  "grid-trading": {
    strong: [
      "grid trading",
      "grid strategy",
      "concentrated liquidity",
      "liquidity range",
      "market making",
      "tick range",
      "lp position",
    ],
    weak: ["liquidity pool", "v3 pool", "price range"],
  },
  "health-factor": {
    strong: [
      "health factor",
      "liquidation protection",
      "liquidation risk",
      "prevent liquidation",
      "collateral ratio",
    ],
    weak: ["liquidation", "collateral", "lending position"],
  },
  yield: {
    strong: [
      "yield farming",
      "yield optimizer",
      "yield maximizer",
      "auto-compound",
      "auto compound",
      "apy optimization",
    ],
    weak: ["yield", "vault", "staking rewards", "farming"],
  },
};

/**
 * Classifies by keyword match against name+description. Returns null when
 * zero categories match, or when more than one category matches - this
 * never guesses among competing categories, "looser" only means admitting
 * a single unambiguous weak match, not resolving genuine ambiguity.
 */
export function classifyAgent(name: string, description: string): ClassificationResult | null {
  const combined = `${name ?? ""} ${description ?? ""}`.toLowerCase();

  const matches = (Object.keys(CATEGORY_TERMS) as ClassificationCategory[])
    .map((category) => {
      const terms = CATEGORY_TERMS[category];
      const strongHits = terms.strong.filter((term) => combined.includes(term));
      const weakHits = terms.weak.filter((term) => combined.includes(term));
      return { category, strongHits, weakHits };
    })
    .filter((entry) => entry.strongHits.length > 0 || entry.weakHits.length > 0);

  if (matches.length !== 1) {
    return null;
  }

  const [match] = matches;
  if (match.strongHits.length > 0) {
    return { category: match.category, confidence: "confirmed", matchedTerms: match.strongHits };
  }
  return { category: match.category, confidence: "likely", matchedTerms: match.weakHits };
}
