/**
 * WHICH DRAWER AN AGENT GOES IN.
 *
 * ---------------------------------------------------------------------------
 * THIS IS METADATA NOW, NOT A GATE
 * ---------------------------------------------------------------------------
 * The previous pipeline treated classification as a publish gate: an agent the
 * scorer would not place into one of six hardcoded slugs was written to the
 * ledger as `rejected-classifier` and never probed. 5,921 agents were discarded
 * that way - discarded for not being describable by a vocabulary list, not for
 * failing to work.
 *
 * Nothing here can reject an agent. `categorize` always returns a slug, and the
 * worst case is `general`. What decides whether an agent is listed is whether it
 * answers and sells (convex/lib/probe.ts). A miscategorised working agent is in
 * the wrong drawer, which a user can recover from; an unlisted working agent is
 * invisible, which they cannot.
 *
 * ---------------------------------------------------------------------------
 * FOUR SOURCES, BEST FIRST, AND THE FIRST TWO ARE THE AGENT'S OWN WORDS
 * ---------------------------------------------------------------------------
 *   1. The registry's own `categories` - the publisher said so explicitly.
 *   2. The A2A card's `skills` - what the agent tells a client it can do. This
 *      is the highest-quality capability data in the system and the old
 *      pipeline never used it for classification at all, because it classified
 *      from 8004scan's indexed text BEFORE it ever fetched a card.
 *   3. Keyword match over name + description + tags.
 *   4. `general`.
 *
 * Measured 2026-09-07: token 302257 - a working, quoting agent - publishes an
 * EMPTY `categories` and an EMPTY `tags` at 8004scan while serving a real card.
 * So source 1 is frequently absent and sources 2-4 carry the load, which is
 * exactly why source 2 had to be added.
 *
 * ---------------------------------------------------------------------------
 * THE KEYWORD TABLE IS DATA, NOT STRUCTURE
 * ---------------------------------------------------------------------------
 * Adding a category means adding an entry below. It does NOT mean a schema
 * migration, a validator union edit in six modules, a scoring-ruleset version
 * bump, or a re-judge of the whole ledger - which is what adding `trading` cost
 * on 2026-09-03, and it still sat empty for two days because a SEPARATE
 * hardcoded list decided what the API was asked for.
 *
 * The catalog's browse chips are read from `catalogFacets`, which is computed
 * from the slugs actually present. A category with no agents in it does not
 * appear, and one that appears was not hardcoded anywhere.
 */

export interface CategoryDefinition {
  slug: string;
  label: string;
  /**
   * Phrases that identify this category. Longer and more specific first: the
   * matcher scores by specificity, so "concentrated liquidity" outranks "yield"
   * when both appear.
   */
  terms: readonly string[];
}

/**
 * The categories Dolphin knows how to name.
 *
 * The first five carry the hackathon's graded taxonomy and Dolphin's own
 * `trading` addition, so existing screens keep working unchanged. The rest
 * exist because the registry has real populations of them and the old topical
 * gate was throwing every one of them away before anything asked whether they
 * worked.
 */
export const CATEGORY_DEFINITIONS: readonly CategoryDefinition[] = [
  {
    slug: "rebalancing",
    label: "Rebalancing",
    terms: [
      "concentrated liquidity", "liquidity range", "lp position", "tick range",
      "position manager", "impermanent loss", "reposition", "fee tier",
      "rebalance", "rebalancing", "v3 pool", "liquidity provider",
    ],
  },
  {
    slug: "grid-trading",
    label: "Grid Trading",
    terms: [
      "grid trading", "grid trader", "grid strategy", "price ladder", "grid bot",
      "grid level", "buy and sell ladder", "geometric grid",
    ],
  },
  {
    slug: "health-factor",
    label: "Health Factor",
    terms: [
      "health factor", "liquidation risk", "liquidation protection",
      "collateral ratio", "loan to value", "borrow limit", "lending position",
      "liquidation", "collateral",
    ],
  },
  {
    slug: "yield",
    label: "Yield",
    terms: [
      "yield optimizer", "yield aggregator", "yield farming", "auto compound",
      "autocompound", "staking rewards", "vault", "apy", "apr", "yield", "farming",
    ],
  },
  {
    slug: "trading",
    label: "Trading",
    terms: [
      "trading strategy", "algorithmic trading", "systematic trading",
      "trade execution", "momentum trading", "trend following", "position sizing",
      "trading signal", "entry and exit", "stop loss", "take profit",
      "limit order", "backtest", "dollar-cost",
    ],
  },
  {
    slug: "monitoring",
    label: "Monitoring",
    terms: [
      "wallet monitoring", "on-chain alert", "activity alert", "watch wallet",
      "portfolio tracking", "monitor", "alerting", "notification",
    ],
  },
  {
    slug: "research",
    label: "Research",
    terms: [
      "market research", "protocol research", "due diligence", "data analysis",
      "analytics", "research", "insight", "report generation",
    ],
  },
  {
    slug: "development",
    label: "Development",
    terms: [
      "smart contract", "code review", "solidity", "audit", "unit test",
      "code generation", "debugging", "developer tool",
    ],
  },
  {
    slug: "security",
    label: "Security",
    terms: [
      "rug pull", "honeypot", "threat detection", "vulnerability", "exploit",
      "phishing", "risk assessment", "security scan",
    ],
  },
  {
    slug: "payments",
    label: "Payments",
    terms: [
      "stablecoin payment", "invoice", "settlement", "payment rail", "payout",
      "escrow", "remittance", "x402",
    ],
  },
  {
    slug: "content",
    label: "Content",
    terms: [
      "content generation", "copywriting", "translation", "summarisation",
      "summarization", "writing", "social media", "image generation",
    ],
  },
  {
    slug: "automation",
    label: "Automation",
    terms: [
      "workflow automation", "task automation", "scheduling", "orchestration",
      "integration", "webhook", "operations",
    ],
  },
];

/** The catch-all. An agent that works belongs in the catalog even unlabelled. */
export const DEFAULT_CATEGORY = { slug: "general", label: "General" } as const;

const LABEL_BY_SLUG = new Map<string, string>([
  ...CATEGORY_DEFINITIONS.map((d) => [d.slug, d.label] as [string, string]),
  [DEFAULT_CATEGORY.slug, DEFAULT_CATEGORY.label],
]);

/** A human label for a slug, including one the registry invented. */
export function categoryLabel(slug: string): string {
  const known = LABEL_BY_SLUG.get(slug);
  if (known) return known;
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Turns a registry-supplied category string into a stable slug. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export interface CategorizeInput {
  name: string;
  description: string;
  /** 8004scan's `categories` - publisher-declared, frequently empty. */
  registryCategories: readonly string[];
  /** 8004scan's `tags`. */
  tags: readonly string[];
  /** Names and descriptions from the agent's own A2A card. */
  skills: readonly { name: string; description: string | null }[];
}

export interface CategoryAssignment {
  slug: string;
  label: string;
  /** Which of the four sources decided it. Stored nowhere; used for reporting. */
  source: "registry" | "skills" | "keyword" | "default";
}

/**
 * Scores the known definitions against a blob of text.
 *
 * Specificity-weighted: a term's score is its word count, so "concentrated
 * liquidity" (2) beats a bare "yield" (1) when a description mentions both.
 * That is the whole tie-break, and it is deliberately simple - the old scorer
 * had confirmed/likely thresholds, runner-up margins, penalty lists and a
 * ruleset version, all in service of a decision that was being used to REJECT
 * agents. Used only to pick a drawer, it does not need to be that machine.
 */
function bestKeywordMatch(text: string): { slug: string; score: number } | null {
  let best: { slug: string; score: number } | null = null;
  for (const definition of CATEGORY_DEFINITIONS) {
    let score = 0;
    for (const term of definition.terms) {
      if (text.includes(term)) score += term.split(/\s+/).length;
    }
    if (score > 0 && (best === null || score > best.score)) {
      best = { slug: definition.slug, score };
    }
  }
  return best;
}

export function categorize(input: CategorizeInput): CategoryAssignment {
  // 1. The publisher said so explicitly.
  for (const raw of input.registryCategories) {
    const slug = slugify(raw);
    if (slug.length > 0) return { slug, label: categoryLabel(slug), source: "registry" };
  }

  // 2. The agent's own card. Weighted above the indexed description because a
  // skill is what the agent tells a CLIENT it will do, whereas a description is
  // marketing - and because the card is fetched by the probe anyway.
  const skillText = input.skills
    .map((skill) => `${skill.name} ${skill.description ?? ""}`)
    .join(" ")
    .toLowerCase();
  if (skillText.trim().length > 0) {
    const match = bestKeywordMatch(skillText);
    if (match) return { slug: match.slug, label: categoryLabel(match.slug), source: "skills" };
  }

  // 3. Everything else the record says about itself.
  const text = `${input.name} ${input.description} ${input.tags.join(" ")}`.toLowerCase();
  const match = bestKeywordMatch(text);
  if (match) return { slug: match.slug, label: categoryLabel(match.slug), source: "keyword" };

  // 4. Unlabelled, and listed anyway.
  return { slug: DEFAULT_CATEGORY.slug, label: DEFAULT_CATEGORY.label, source: "default" };
}

/**
 * Tags for the catalog row: the registry's, plus every card skill name.
 *
 * Deduplicated case-insensitively and capped, because this feeds `searchText`
 * and an agent that lists 200 skills should not be able to dominate the search
 * index.
 */
export function buildTags(
  registryTags: readonly string[],
  skills: readonly { name: string }[],
): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of [...registryTags, ...skills.map((s) => s.name)]) {
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.length > 40) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(trimmed);
    if (tags.length >= 12) break;
  }
  return tags;
}
