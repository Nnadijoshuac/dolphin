/**
 * KNOWLEDGE: A BUILDER'S DOCUMENTS, AS TEXT (owner, 2026-10-03).
 * Plan: Agent/PLAN-2026-10-03-knowledge-mcps.md.
 *
 * A builder drops Markdown, plain text or a PDF into the build chat. Dolphin
 * keeps only the TEXT, split into sections, and the original file is deleted:
 * nothing uploaded is ever stored or served as a file, so Dolphin cannot be
 * used to host malware, and a PDF's scripts and images never run or count.
 *
 * Pure string work here, so it is tested without Convex (tests/knowledge.test.ts).
 * PDF reading itself is in convex/knowledgeIngest.ts (unpdf needs the Node runtime).
 */

/** The owner's cap per upload. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_DOCUMENTS = 10;
/**
 * Text per agent, all documents together: ~150 pages. The cap is on TEXT,
 * not files - a 2 MB PDF is mostly images and layout (a printed 47 KB PDF
 * held 466 characters, measured 2026-10-03).
 */
export const MAX_AGENT_TEXT_CHARS = 300_000;
export const MAX_SECTIONS = 40;
/** A PDF longer than this is refused rather than read for minutes. */
export const MAX_PDF_PAGES = 400;
/** What one tool call returns at most (~15k tokens); a longer section is served in parts. */
export const MAX_RESULT_CHARS = 60_000;
/** A document with no headings is cut into parts of about this size. */
const UNTITLED_PART_CHARS = 8_000;

export type DocumentKind = "markdown" | "text" | "pdf";

export type Section = { title: string; slug: string; text: string };

/**
 * What the file really is, from its bytes - never its name alone. A renamed
 * script is just text and is accepted as text (we never run anything); a
 * binary that is not a PDF is refused.
 */
export function sniffKind(bytes: Uint8Array, fileName: string): DocumentKind | null {
  if (bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-") return "pdf";
  if (bytes.includes(0)) return null; // NUL bytes: a binary, not text
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  return /\.(md|markdown|mdx)$/i.test(fileName) ? "markdown" : "text";
}

/** Line endings unified, control characters (except tab and newline) gone, blank runs collapsed. */
export function normaliseText(text: string): string {
  return (
    text
      .replace(/\r\n?/g, "\n")
       
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .replace(/[^\S\n]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

export type PdfLine = { text: string; size: number };

/**
 * A PDF's lines back into Markdown. PDFs carry no headings, only font sizes:
 * the body size is the one most of the text is set in, and a line clearly
 * larger is a heading - the largest size "#", the next "##", then "###".
 */
export function pdfLinesToMarkdown(lines: readonly PdfLine[]): string {
  const weight = new Map<number, number>();
  for (const line of lines) {
    const size = Math.round(line.size);
    weight.set(size, (weight.get(size) ?? 0) + line.text.length);
  }
  const body = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 12;
  const headingSizes = [...weight.keys()].filter((size) => size >= body * 1.15).sort((a, b) => b - a).slice(0, 3);
  const out: string[] = [];
  for (const line of lines) {
    const text = line.text.trim();
    if (!text) continue;
    const level = headingSizes.indexOf(Math.round(line.size));
    // A heading is a short line; a whole paragraph in a big font is still a paragraph.
    if (level >= 0 && text.length <= 120) out.push(`\n${"#".repeat(level + 1)} ${text}\n`);
    else out.push(text);
  }
  return normaliseText(out.join("\n"));
}

/** A heading as a tool-name fragment: "Fast-cut Black & White" -> "fast_cut_black_white". */
export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/, "");
  return slug || "section";
}

/**
 * Sections, at the level the document is organised by: the shallowest heading
 * level that appears at least twice ("# Guide" over three "## Style"s splits
 * by the "##"s). Text before the first such heading becomes "Introduction"
 * when it says anything (20+ characters; a lone title line is not kept twice). No headings at all: parts of ~8,000 characters,
 * cut at paragraph breaks.
 */
export function splitSections(markdown: string, documentName: string): Section[] {
  const text = normaliseText(markdown);
  const headings = [...text.matchAll(/^(#{1,3})[^\S\n]+(.+)$/gm)].map((match) => ({
    level: match[1].length,
    title: match[2].replace(/[#*_`]+/g, "").trim(),
    at: match.index ?? 0,
  }));
  const level = [1, 2, 3].find((candidate) => headings.filter((heading) => heading.level === candidate).length >= 2);

  const sections: Section[] = [];
  if (level === undefined) {
    const paragraphs = text.split(/\n{2,}/);
    let part = "";
    const flush = () => {
      if (!part.trim()) return;
      const n = sections.length + 1;
      sections.push({ title: `${documentName} part ${n}`, slug: `part_${n}`, text: part.trim() });
      part = "";
    };
    for (const paragraph of paragraphs) {
      if (part.length + paragraph.length > UNTITLED_PART_CHARS) flush();
      part += `${paragraph}\n\n`;
    }
    flush();
    if (sections.length === 1) sections[0] = { ...sections[0], title: documentName, slug: slugify(documentName) };
  } else {
    const cuts = headings.filter((heading) => heading.level === level);
    const intro = text.slice(0, cuts[0].at).replace(/^#{1,3}[^\S\n]+.+$/gm, "").trim();
    // Any real words before the first section are kept: dropping a builder's text is losing it.
    if (intro.length >= 20) sections.push({ title: "Introduction", slug: "introduction", text: intro });
    cuts.forEach((cut, i) => {
      const body = text.slice(cut.at, cuts[i + 1]?.at ?? text.length).trim();
      sections.push({ title: cut.title || `Section ${i + 1}`, slug: slugify(cut.title), text: body });
    });
  }

  // Two sections must never share a tool name.
  const seen = new Map<string, number>();
  return sections.map((section) => {
    const count = (seen.get(section.slug) ?? 0) + 1;
    seen.set(section.slug, count);
    return count === 1 ? section : { ...section, slug: `${section.slug}_${count}`.slice(0, 44) };
  });
}

/**
 * Phrases that try to steer whoever reads the document - the buyer's AI, or
 * this agent's own model - shown to the builder before publishing. A flag,
 * not a refusal: "never share your seed phrase" in a security guide is
 * legitimate, and the builder knows their document.
 */
const INJECTION_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/ignore (all |any )?(the )?(previous|prior|above|earlier) (instructions|messages|prompts?)/i, "tells an AI to ignore its instructions"],
  [/disregard (your|the|all) (instructions|rules|system prompt)/i, "tells an AI to disregard its rules"],
  [/\b(you are now|act as|pretend to be) (an?|the) /i, "tries to change who the AI is"],
  [/\bsystem prompt\b/i, "mentions a system prompt"],
  [/\b(seed phrase|recovery phrase|mnemonic|private key)\b/i, "mentions a seed phrase or private key"],
  [/\b(send|transfer|approve)\b[^.\n]{0,60}\b0x[0-9a-f]{40}\b/i, "asks for funds to be sent to an address"],
];

export type Flag = { reason: string; excerpt: string };

export function injectionFlags(text: string): Flag[] {
  const flags: Flag[] = [];
  for (const [pattern, reason] of INJECTION_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const start = Math.max(0, (match.index ?? 0) - 40);
    flags.push({ reason, excerpt: text.slice(start, (match.index ?? 0) + match[0].length + 40).replace(/^#{1,6}\s+/gm, "").replace(/\s+/g, " ").trim() });
  }
  return flags;
}
