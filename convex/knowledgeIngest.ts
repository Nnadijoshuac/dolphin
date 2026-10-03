"use node";

import { createHash } from "node:crypto";

import { ConvexError, v } from "convex/values";
import { gzipSync, strToU8 } from "fflate";
import { getDocumentProxy } from "unpdf";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action } from "./_generated/server";
import {
  injectionFlags,
  MAX_AGENT_TEXT_CHARS,
  MAX_PDF_PAGES,
  MAX_SECTIONS,
  MAX_UPLOAD_BYTES,
  normaliseText,
  pdfLinesToMarkdown,
  sniffKind,
  splitSections,
  type PdfLine,
} from "./lib/knowledge";

/**
 * READING A BUILDER'S DOCUMENT (Agent/PLAN-2026-10-03-knowledge-mcps.md, step 1).
 *
 * The Node runtime because unpdf only extracts there (probed on dev
 * 2026-10-03: the default runtime lacks structuredClone with transfer).
 * Text extraction never runs a PDF's scripts; images are skipped.
 *
 * The uploaded file is ALWAYS deleted, read or refused: only the text is
 * kept, gzipped one blob per section.
 */

type TextItem = { str?: string; transform?: number[]; hasEOL?: boolean };

/** A PDF's text, line by line with each line's font size, so headings can be found. */
async function pdfLines(bytes: Uint8Array): Promise<PdfLine[]> {
  const pdf = await getDocumentProxy(bytes);
  if (pdf.numPages > MAX_PDF_PAGES) {
    throw new ConvexError(`That PDF has ${pdf.numPages} pages. Dolphin reads up to ${MAX_PDF_PAGES}; split it, or keep the parts that matter.`);
  }
  const lines: PdfLine[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
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
  return lines;
}

/** "C:\fakepath\Style Guide (final).pdf" -> "Style Guide (final)". */
function documentName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "Document";
  return base.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/\s+/g, " ").trim().slice(0, 80) || "Document";
}

export type AddedDocument = {
  name: string;
  kind: "markdown" | "text" | "pdf";
  textChars: number;
  storedBytes: number;
  uploadBytes: number;
  sections: string[];
  flags: { reason: string; excerpt: string }[];
};

type Room = { documents: number; textChars: number; sections: number; names: string[] };

export const addDocument = action({
  args: { conversationKey: v.string(), storageId: v.id("_storage"), fileName: v.string() },
  handler: async (ctx, { conversationKey, storageId, fileName }): Promise<AddedDocument> => {
    const stored: Id<"_storage">[] = [];
    try {
      const room: Room = await ctx.runQuery(internal.knowledge.room, { conversationKey });
      const name = documentName(fileName);
      if (room.names.includes(name)) throw new ConvexError(`"${name}" is already in this agent. Remove it first to replace it.`);

      const blob = await ctx.storage.get(storageId);
      if (!blob) throw new ConvexError("The upload did not arrive. Try again.");
      if (blob.size > MAX_UPLOAD_BYTES) throw new ConvexError("That file is over 2 MB. Dolphin reads files up to 2 MB.");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const uploadBytes = bytes.length; // read now: pdf.js detaches the buffer it parses

      const kind = sniffKind(bytes, fileName);
      if (!kind) throw new ConvexError("Dolphin reads Markdown, plain text and PDF files. That file is none of them.");

      let text: string;
      if (kind === "pdf") {
        let lines: PdfLine[];
        try {
          lines = await pdfLines(bytes);
        } catch (cause) {
          if (cause instanceof ConvexError) throw cause;
          throw new ConvexError("That PDF could not be read. If it is password-protected or damaged, export it again.");
        }
        text = pdfLinesToMarkdown(lines);
      } else {
        text = normaliseText(new TextDecoder("utf-8").decode(bytes));
      }

      if (text.length < 20) {
        throw new ConvexError(
          kind === "pdf"
            ? "We couldn't find any text in this PDF. It may be scanned pages (pictures of text); export it with real text, or paste it as Markdown."
            : "That file is empty.",
        );
      }
      if (room.textChars + text.length > MAX_AGENT_TEXT_CHARS) {
        const left = Math.max(0, MAX_AGENT_TEXT_CHARS - room.textChars);
        throw new ConvexError(
          `That document has ${text.length.toLocaleString("en")} characters of text, and this agent has room for ${left.toLocaleString("en")} more (about 150 pages in all). Keep the parts that matter.`,
        );
      }
      const sections = splitSections(text, name);
      if (room.sections + sections.length > MAX_SECTIONS) {
        throw new ConvexError(`That document has ${sections.length} sections; an agent holds ${MAX_SECTIONS} in all. Merge some headings and try again.`);
      }

      let storedBytes = 0;
      const saved = [];
      for (const section of sections) {
        const gz = gzipSync(strToU8(section.text), { level: 9 });
        storedBytes += gz.byteLength;
        const id = await ctx.storage.store(new Blob([gz], { type: "application/gzip" }));
        stored.push(id);
        saved.push({ title: section.title, slug: section.slug, chars: section.text.length, storageId: id });
      }
      const flags = injectionFlags(text);
      const documentId: Id<"agentKnowledge"> | null = await ctx.runMutation(internal.knowledge.insertDocument, {
        conversationKey,
        name,
        kind,
        sha256: createHash("sha256").update(text, "utf8").digest("hex"),
        textChars: text.length,
        storedBytes,
        sections: saved,
        flags,
      });
      if (!documentId) throw new ConvexError("This agent filled up while that was being read. Remove a document and try again.");
      stored.length = 0; // kept: the row owns them now

      return {
        name,
        kind,
        textChars: text.length,
        storedBytes,
        uploadBytes,
        sections: saved.map((section) => section.title),
        flags,
      };
    } finally {
      // The original file never stays; nor do section blobs of a document that was refused.
      await ctx.storage.delete(storageId).catch(() => undefined);
      for (const id of stored) await ctx.storage.delete(id).catch(() => undefined);
    }
  },
});
