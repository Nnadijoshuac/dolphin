/**
 * READING A BUILDER'S DOCUMENT, IN THEIR OWN BROWSER (owner, 2026-10-03:
 * "do a lot of things client side"). Agent/PLAN-2026-10-03-knowledge-mcps.md.
 *
 * The file never leaves the builder's machine: only its text is sent
 * (convex/knowledge.ts addDocument), so no upload is stored, read back or
 * deleted on Dolphin's servers, and no PDF parser runs there for a hostile
 * file to attack. The server re-checks everything this sends - it trusts no
 * browser - so this file is about speed and a good message, not security.
 *
 * pdf.js (unpdf) is loaded only when a PDF is picked: no weight on any other page.
 */

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_PDF_PAGES = 400;

export type DocumentKind = "markdown" | "text" | "pdf";

/**
 * What the file really is, from its bytes - never its name alone. A renamed
 * script is just text (nothing ever runs it); a binary that is not a PDF is refused.
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

export type PdfLine = { text: string; size: number };

/**
 * A PDF's lines back into Markdown. PDFs carry no headings, only font sizes:
 * the body size is the one most of the text is set in, and a short line
 * clearly larger is a heading - the largest size "#", the next "##", then "###".
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
    if (!text) {
      out.push("");
      continue;
    }
    const level = headingSizes.indexOf(Math.round(line.size));
    if (level >= 0 && text.length <= 120) out.push(`\n${"#".repeat(level + 1)} ${text}\n`);
    else out.push(text);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

type TextItem = { str?: string; transform?: number[]; hasEOL?: boolean };

async function pdfText(bytes: Uint8Array): Promise<string> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  if (pdf.numPages > MAX_PDF_PAGES) {
    throw new Error(`That PDF has ${pdf.numPages} pages. Dolphin reads up to ${MAX_PDF_PAGES}; split it, or keep the parts that matter.`);
  }
  const lines: PdfLine[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    let text = "";
    let size = 0;
    for (const item of content.items as TextItem[]) {
      if (typeof item.str !== "string") continue;
      text += item.str;
      // The font size is the text matrix's scale.
      if (item.str.trim() && item.transform) size = Math.max(size, Math.hypot(item.transform[0], item.transform[1]));
      if (item.hasEOL) {
        lines.push({ text, size: size || 12 });
        text = "";
        size = 0;
      }
    }
    if (text) lines.push({ text, size: size || 12 });
    lines.push({ text: "", size: 12 }); // a page break is a paragraph break
  }
  return pdfLinesToMarkdown(lines);
}

/** The document's kind and text, read here. Throws an Error whose message is for the builder. */
export async function extractDocument(file: File): Promise<{ kind: DocumentKind; text: string }> {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error(`${file.name} is over 2 MB. Dolphin reads files up to 2 MB.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffKind(bytes, file.name);
  if (!kind) throw new Error(`${file.name}: Dolphin reads Markdown, plain text and PDF files. That file is none of them.`);
  if (kind !== "pdf") return { kind, text: new TextDecoder("utf-8").decode(bytes) };
  try {
    return { kind, text: await pdfText(bytes) };
  } catch (cause) {
    if (cause instanceof Error && /pages\. Dolphin reads/.test(cause.message)) throw cause;
    throw new Error(`${file.name} could not be read. If it is password-protected or damaged, export it again.`);
  }
}
