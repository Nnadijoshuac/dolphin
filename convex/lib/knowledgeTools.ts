/**
 * THE TOOLS A KNOWLEDGE AGENT OFFERS (owner, 2026-10-03; Agent/PLAN-2026-10-03-knowledge-mcps.md, step 2).
 *
 * Level 3: Dolphin proposes every tool from the documents and the builder only
 * sets prices. Proposed by code, not a model: the same documents always give
 * the same tools, for free, and a builder's edits (price, on/off, wording)
 * survive every regeneration because tools are matched by name.
 *
 *   list_sections          what is in the documents            Free
 *   get_<section>          one section in full (one per section) 0.01 U suggested
 *   get_section(section)   ...or one tool for all, past 16 sections
 *   search_knowledge(q)    the best-matching passages           Free
 *   ask(question)          the agent answers from them           0.02 U suggested (needs the builder's brain)
 *
 * Prices are only SUGGESTED (owner: "so they know what a price looks like").
 */

export type KnowledgeToolKind = "list" | "get" | "get_any" | "search" | "ask";

export type KnowledgeTool = {
  name: string;
  kind: KnowledgeToolKind;
  description: string;
  /** For kind "get": the section it returns. */
  section: { documentId: string; slug: string } | null;
  /** Price per call in U as a decimal string ("0.01"); null is free. */
  priceU: string | null;
  enabled: boolean;
  /** True once the builder changed the description: regeneration keeps their words. */
  edited?: boolean;
};

export type KnowledgeDoc = { id: string; name: string; sections: { title: string; slug: string }[] };

export const MAX_KNOWLEDGE_TOOLS = 20;
/** Past this many sections, one get_section tool replaces a tool per section. */
export const PER_SECTION_TOOL_LIMIT = 16;
export const SUGGESTED_PRICE_GET = "0.01";
export const SUGGESTED_PRICE_ASK = "0.02";
/** The same bounds x402 enforces (lib/x402.ts priceInBounds). */
export const MIN_PRICE_U = 0.001;
export const MAX_PRICE_U = 1000;

/** A builder's price as entered: "0.05", ".5", "1" - or empty for free. Null when it is not a valid price. */
export function parsePriceU(input: string): { priceU: string | null } | null {
  const text = input.trim();
  if (text === "" || /^(free|0+(\.0+)?)$/i.test(text)) return { priceU: null };
  if (!/^\d*\.?\d{1,6}$/.test(text)) return null;
  const value = Number(text);
  if (!(value >= MIN_PRICE_U && value <= MAX_PRICE_U)) return null;
  return { priceU: String(value) };
}

function slugOf(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 20) || "doc"
  );
}

function getName(slug: string, taken: Set<string>): string {
  let name = `get_${slug}`.slice(0, 48);
  for (let n = 2; taken.has(name); n++) name = `get_${slug}`.slice(0, 44) + `_${n}`;
  taken.add(name);
  return name;
}

/**
 * The tools for these documents. `previous` is what the builder has now; a
 * tool that still exists keeps its price, its on/off and any wording the
 * builder wrote. `hasBrain` decides only whether "ask" starts switched on.
 */
export function proposeKnowledgeTools(docs: readonly KnowledgeDoc[], previous: readonly KnowledgeTool[], hasBrain: boolean): KnowledgeTool[] {
  const sections = docs.flatMap((doc) => doc.sections.map((section) => ({ doc, section })));
  if (sections.length === 0) return [];
  const many = sections.length > PER_SECTION_TOOL_LIMIT;
  const titles = (limit: number) => {
    const names = sections.slice(0, limit).map(({ section }) => section.title);
    return names.join(", ") + (sections.length > limit ? `, and ${sections.length - limit} more` : "");
  };
  const about = docs.map((doc) => doc.name).join(", ");

  const proposed: KnowledgeTool[] = [
    {
      name: "list_sections",
      kind: "list",
      description: `Lists what this agent knows: every section of ${about}, one line each. Call it first to see what to fetch.`,
      section: null,
      priceU: null,
      enabled: true,
    },
  ];
  if (many) {
    proposed.push({
      name: "get_section",
      kind: "get_any",
      description: `Returns one section in full. Pass its name from list_sections. Sections include ${titles(6)}.`,
      section: null,
      priceU: SUGGESTED_PRICE_GET,
      enabled: true,
    });
  } else {
    const taken = new Set<string>(["list_sections", "search_knowledge", "ask"]);
    // A heading two documents share ("Introduction") is named after its document,
    // so a buyer can tell get_introduction from get_steering_notes_introduction.
    const shared = new Set(sections.map(({ section }) => section.slug).filter((slug, i, all) => all.indexOf(slug) !== i));
    for (const { doc, section } of sections) {
      const first = sections.find((entry) => entry.section.slug === section.slug)?.doc === doc;
      const slug = shared.has(section.slug) && !first ? `${slugOf(doc.name)}_${section.slug}` : section.slug;
      proposed.push({
        name: getName(slug, taken),
        kind: "get",
        description: `Returns "${section.title}" from ${doc.name}, in full.`,
        section: { documentId: doc.id, slug: section.slug },
        priceU: SUGGESTED_PRICE_GET,
        enabled: true,
      });
    }
  }
  proposed.push(
    {
      name: "search_knowledge",
      kind: "search",
      description: `Finds the passages that best match a question across ${about}, and says which section each comes from.`,
      section: null,
      priceU: null,
      enabled: true,
    },
    {
      name: "ask",
      kind: "ask",
      description: `Ask a question in plain words; the agent answers from ${about}.`,
      section: null,
      priceU: SUGGESTED_PRICE_ASK,
      enabled: hasBrain,
    },
  );

  const before = new Map(previous.map((tool) => [tool.name, tool]));
  return proposed.slice(0, MAX_KNOWLEDGE_TOOLS).map((tool) => {
    const kept = before.get(tool.name);
    if (!kept) return tool;
    return {
      ...tool,
      priceU: kept.priceU,
      enabled: kept.enabled,
      ...(kept.edited ? { description: kept.description, edited: true } : {}),
    };
  });
}

/** Words of a query worth matching: lower-case, 3+ letters, minus filler. */
const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "what", "how", "are", "you", "your", "from", "into", "about", "does", "can", "use",
  "should", "would", "could", "when", "which", "there", "their", "have", "has", "was", "were", "will", "any", "all", "its", "our",
]);
function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? []).filter((word) => !STOP.has(word));
}

export type Passage = { section: string; text: string; score: number };

/**
 * Keyword search across sections: each paragraph scored by how many of the
 * query's words it holds (rarer words count more), its section's title adding
 * a little. Heading-only paragraphs are not passages, and a section gives at
 * most two, so one section cannot crowd out the rest. No embeddings - nothing
 * to store, nothing to pay, and good enough to point at the right section,
 * which get_* then returns in full.
 *
 * Measured 2026-10-03 on dev: "how fast should a montage cut?" returned the
 * bare heading "## Fast-cut Black and White" (title words counted double)
 * instead of the Showreel paragraph that answers it. Hence all of the above.
 */
export function searchSections(query: string, sections: readonly { title: string; text: string }[], limit = 4): Passage[] {
  const wanted = [...new Set(terms(query))];
  if (wanted.length === 0) return [];
  const paragraphs = sections.flatMap((section) =>
    section.text
      .split(/\n{2,}/)
      .map((text) => text.replace(/^#{1,6}[^\S\n]+.*$/gm, "").trim())
      .filter((text) => text.length > 0)
      .map((text) => ({ section: section.title, text })),
  );
  const documentFrequency = new Map(
    wanted.map((word) => [word, paragraphs.filter((p) => p.text.toLowerCase().includes(word)).length]),
  );
  const scored = paragraphs.map((paragraph) => {
    const body = paragraph.text.toLowerCase();
    const title = paragraph.section.toLowerCase();
    let score = 0;
    for (const word of wanted) {
      const weight = 1 / (1 + (documentFrequency.get(word) ?? 0));
      if (body.includes(word)) score += weight;
      if (title.includes(word)) score += 0.5 * weight;
    }
    return { ...paragraph, text: paragraph.text.slice(0, 1_200), score };
  });
  const perSection = new Map<string, number>();
  return scored
    .filter((passage) => passage.score > 0)
    .sort((a, b) => b.score - a.score)
    .filter((passage) => {
      const count = (perSection.get(passage.section) ?? 0) + 1;
      perSection.set(passage.section, count);
      return count <= 2;
    })
    .slice(0, limit);
}
