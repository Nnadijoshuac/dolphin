import { ConvexError, v } from "convex/values";

import { gzipSync, strToU8 } from "fflate";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { injectionFlags, MAX_AGENT_TEXT_CHARS, MAX_DOCUMENTS, MAX_SECTIONS, normaliseText, splitSections } from "./lib/knowledge";
import { cleanDescribedTool, parsePriceU, proposeKnowledgeTools, type KnowledgeTool } from "./lib/knowledgeTools";

/**
 * A draft's documents (Agent/PLAN-2026-10-03-knowledge-mcps.md, steps 1-2).
 *
 * THE BROWSER READS THE FILE; THE SERVER ONLY EVER SEES TEXT (owner,
 * 2026-10-03: "do a lot of things client side"). A PDF is turned into
 * Markdown on the builder's own machine (web/src/lib/knowledge-extract.ts),
 * so no file is uploaded, stored, read back or deleted here, and no PDF parser
 * runs on Dolphin's servers for a stranger's file to attack. The server trusts
 * nothing the browser did: it re-checks the size, strips control characters,
 * splits, flags and compresses the text itself. Text is never executed.
 *
 * As everywhere in the builder, the conversation key is the capability
 * (agentBuilder.getDraft): whoever holds it is building the agent.
 */

async function buildConversation(ctx: QueryCtx, conversationKey: string): Promise<Doc<"dolphinConversations">> {
  const conversation = await ctx.db
    .query("dolphinConversations")
    .withIndex("by_key", (q) => q.eq("conversationKey", conversationKey))
    .unique();
  if (!conversation || (conversation.mode ?? "chat") !== "build") throw new ConvexError("That is not an agent draft.");
  return conversation;
}

async function draftOf(ctx: QueryCtx, conversationId: Id<"dolphinConversations">): Promise<Doc<"agentDrafts"> | null> {
  return ctx.db
    .query("agentDrafts")
    .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
    .unique();
}

async function documentsOf(ctx: QueryCtx, draftId: Id<"agentDrafts">): Promise<Doc<"agentKnowledge">[]> {
  return ctx.db
    .query("agentKnowledge")
    .withIndex("by_draft", (q) => q.eq("draftId", draftId))
    .collect();
}

/**
 * The draft's knowledge tools, proposed again from its documents (step 2).
 * Called after every add and remove; the builder's edits survive by name.
 */
async function regenerateTools(ctx: MutationCtx, draftId: Id<"agentDrafts">) {
  const draft = await ctx.db.get(draftId);
  if (!draft) return;
  const rows = await documentsOf(ctx, draftId);
  const tools = proposeKnowledgeTools(
    rows.sort((a, b) => a.createdAt - b.createdAt).map((row) => ({ id: row._id, name: row.name, sections: row.sections })),
    (draft.knowledgeTools ?? []) as KnowledgeTool[],
    Boolean(draft.brain),
  );
  await ctx.db.patch(draftId, { knowledgeTools: tools, updatedAt: Date.now() });
}

/** The draft's documents, for the build chat and the canvas. */
export const documents = query({
  args: { conversationKey: v.string() },
  handler: async (ctx, { conversationKey }) => {
    const conversation = await ctx.db
      .query("dolphinConversations")
      .withIndex("by_key", (q) => q.eq("conversationKey", conversationKey))
      .unique();
    if (!conversation) return [];
    const draft = await draftOf(ctx, conversation._id);
    if (!draft) return [];
    const rows = await documentsOf(ctx, draft._id);
    return rows
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((row) => ({
        id: row._id,
        name: row.name,
        kind: row.kind,
        textChars: row.textChars,
        storedBytes: row.storedBytes,
        sections: row.sections.map((section) => ({ title: section.title, slug: section.slug, chars: section.chars })),
        flags: row.flags,
      }));
  },
});

export const removeDocument = mutation({
  args: { conversationKey: v.string(), documentId: v.id("agentKnowledge") },
  handler: async (ctx, { conversationKey, documentId }) => {
    const conversation = await buildConversation(ctx, conversationKey);
    const draft = await draftOf(ctx, conversation._id);
    const row = await ctx.db.get(documentId);
    if (!draft || !row || row.draftId !== draft._id) throw new ConvexError("That document is not in this agent.");
    // A published agent still serves the sections it froze (step 3): those blobs stay.
    const listings = await ctx.db
      .query("builtAgents")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
      .collect();
    const published = new Set(listings.flatMap((listing) => (listing.knowledge?.documents ?? []).flatMap((doc) => doc.sections.map((section) => section.storageId))));
    for (const section of row.sections) {
      if (published.has(section.storageId)) continue;
      // A blob already gone must never leave a document stuck (found on dev 2026-10-03: "storage id ... not found").
      if (await ctx.db.system.get(section.storageId)) await ctx.storage.delete(section.storageId);
    }
    await ctx.db.delete(documentId);
    await regenerateTools(ctx, draft._id);
  },
});

/** The tools buyers will be able to call, for the draft panel. */
export const tools = query({
  args: { conversationKey: v.string() },
  handler: async (ctx, { conversationKey }) => {
    const conversation = await ctx.db
      .query("dolphinConversations")
      .withIndex("by_key", (q) => q.eq("conversationKey", conversationKey))
      .unique();
    if (!conversation) return { tools: [], hasBrain: false };
    const draft = await draftOf(ctx, conversation._id);
    return { tools: ((draft?.knowledgeTools ?? []) as KnowledgeTool[]), hasBrain: Boolean(draft?.brain) };
  },
});

/** The builder sets a tool's price, switches it on or off, or rewrites what it says. */
export const setTool = mutation({
  args: {
    conversationKey: v.string(),
    name: v.string(),
    price: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, { conversationKey, name, price, enabled, description }) => {
    const conversation = await buildConversation(ctx, conversationKey);
    const draft = await draftOf(ctx, conversation._id);
    const current = (draft?.knowledgeTools ?? []) as KnowledgeTool[];
    const tool = current.find((candidate) => candidate.name === name);
    if (!draft || !tool) throw new ConvexError("That tool is not in this agent.");
    const next: KnowledgeTool = { ...tool };
    if (price !== undefined) {
      const parsed = parsePriceU(price);
      if (!parsed) throw new ConvexError("A price is between 0.001 and 1,000 U, or empty for free.");
      next.priceU = parsed.priceU;
    }
    if (enabled !== undefined) next.enabled = enabled;
    if (description !== undefined) {
      const words = description.replace(/\s+/g, " ").trim().slice(0, 300);
      if (words.length < 10) throw new ConvexError("Say in a sentence what the tool returns.");
      next.description = words;
      next.edited = true;
    }
    await ctx.db.patch(draft._id, {
      knowledgeTools: current.map((candidate) => (candidate.name === name ? next : candidate)),
      updatedAt: Date.now(),
    });
  },
});

/**
 * Tools the builder described in the build chat (step 5, level 2), added or
 * updated by name. What cannot be made safe is skipped and named, for the reply.
 */
export const addDescribedTools = internalMutation({
  args: {
    conversationId: v.id("dolphinConversations"),
    tools: v.array(
      v.object({
        name: v.string(),
        description: v.string(),
        inputs: v.array(v.object({ name: v.string(), description: v.string() })),
        instructions: v.string(),
      }),
    ),
  },
  handler: async (ctx, { conversationId, tools }): Promise<{ added: string[]; skipped: string[] }> => {
    const conversation = await ctx.db.get(conversationId);
    if (!conversation) return { added: [], skipped: [] };
    const draftId = await ensureDraft(ctx, conversation);
    const draft = await ctx.db.get(draftId);
    let current = ((draft?.knowledgeTools ?? []) as KnowledgeTool[]).slice();
    const added: string[] = [];
    const skipped: string[] = [];
    for (const raw of tools.slice(0, 5)) {
      const made = cleanDescribedTool(raw, current, Boolean(draft?.brain));
      if ("problem" in made) {
        skipped.push(made.problem);
        continue;
      }
      const at = current.findIndex((tool) => tool.name === made.tool.name);
      current = at >= 0 ? current.map((tool, i) => (i === at ? made.tool : tool)) : [...current, made.tool];
      added.push(made.tool.name);
    }
    if (added.length > 0) await ctx.db.patch(draftId, { knowledgeTools: current, updatedAt: Date.now() });
    return { added, skipped };
  },
});

/** The builder removes a tool they described. Document tools are switched off instead, never removed. */
export const removeTool = mutation({
  args: { conversationKey: v.string(), name: v.string() },
  handler: async (ctx, { conversationKey, name }) => {
    const conversation = await buildConversation(ctx, conversationKey);
    const draft = await draftOf(ctx, conversation._id);
    const current = (draft?.knowledgeTools ?? []) as KnowledgeTool[];
    const tool = current.find((candidate) => candidate.name === name);
    if (!draft || !tool || tool.kind !== "described") throw new ConvexError("Only a tool you described can be removed; switch the others off.");
    await ctx.db.patch(draft._id, { knowledgeTools: current.filter((candidate) => candidate.name !== name), updatedAt: Date.now() });
  },
});

/** Everything a run needs to serve the tools: which are on, and where each section's text is. */
export const forDraft = internalQuery({
  args: { draftId: v.id("agentDrafts") },
  handler: async (ctx, { draftId }) => {
    const draft = await ctx.db.get(draftId);
    const rows = await documentsOf(ctx, draftId);
    return {
      tools: ((draft?.knowledgeTools ?? []) as KnowledgeTool[]).filter((tool) => tool.enabled),
      documents: rows.map((row) => row.name),
      sections: rows
        .sort((a, b) => a.createdAt - b.createdAt)
        .flatMap((row) =>
          row.sections.map((section) => ({ documentId: row._id as string, documentName: row.name, title: section.title, slug: section.slug, storageId: section.storageId })),
        ),
    };
  },
});

export type AddedDocument = {
  name: string;
  textChars: number;
  storedBytes: number;
  sections: string[];
  flags: { reason: string; excerpt: string }[];
};

/** "Style Guide (final).pdf" -> "Style Guide (final)". */
function documentName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "Document";
  return base.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/\s+/g, " ").trim().slice(0, 80) || "Document";
}

/**
 * One document's text, added to the draft: checked, split into sections,
 * each gzipped (fflate - this runtime has no CompressionStream) into its own
 * blob, so a tool call later reads one section, not the document.
 */
export const addDocument = action({
  args: {
    conversationKey: v.string(),
    fileName: v.string(),
    kind: v.union(v.literal("markdown"), v.literal("text"), v.literal("pdf")),
    text: v.string(),
  },
  handler: async (ctx, { conversationKey, fileName, kind, text: raw }): Promise<AddedDocument> => {
    // Refuse the oversized before doing any work on it.
    if (raw.length > MAX_AGENT_TEXT_CHARS * 2) {
      throw new ConvexError(`That document is too long. An agent holds about ${MAX_AGENT_TEXT_CHARS.toLocaleString("en")} characters of text (150 pages) in all.`);
    }
    const room: { documents: number; textChars: number; sections: number; names: string[] } = await ctx.runQuery(internal.knowledge.room, { conversationKey });
    if (room.documents >= MAX_DOCUMENTS) throw new ConvexError(`An agent can hold ${MAX_DOCUMENTS} documents. Remove one to add another.`);
    const name = documentName(fileName);
    if (room.names.includes(name)) throw new ConvexError(`"${name}" is already in this agent. Remove it first to replace it.`);

    const text = normaliseText(raw);
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

    const stored: Id<"_storage">[] = [];
    try {
      let storedBytes = 0;
      const saved = [];
      for (const section of sections) {
        const gz = gzipSync(strToU8(section.text), { level: 9 });
        storedBytes += gz.byteLength;
        const id = await ctx.storage.store(new Blob([gz], { type: "application/gzip" }));
        stored.push(id);
        saved.push({ title: section.title, slug: section.slug, chars: section.text.length, storageId: id });
      }
      const digest = await crypto.subtle.digest("SHA-256", strToU8(text));
      const flags = injectionFlags(text);
      const documentId: Id<"agentKnowledge"> | null = await ctx.runMutation(internal.knowledge.insertDocument, {
        conversationKey,
        name,
        kind,
        sha256: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
        textChars: text.length,
        storedBytes,
        sections: saved,
        flags,
      });
      if (!documentId) throw new ConvexError("This agent filled up while that was being read. Remove a document and try again.");
      stored.length = 0; // kept: the row owns them now
      return { name, textChars: text.length, storedBytes, sections: saved.map((section) => section.title), flags };
    } finally {
      // A refused document leaves nothing behind.
      for (const id of stored) await ctx.storage.delete(id).catch(() => undefined);
    }
  },
});

/** What the reader needs to decide whether one more document fits. */
export const room = internalQuery({
  args: { conversationKey: v.string() },
  handler: async (ctx, { conversationKey }) => {
    const conversation = await buildConversation(ctx, conversationKey);
    const draft = await draftOf(ctx, conversation._id);
    const rows = draft ? await documentsOf(ctx, draft._id) : [];
    return {
      documents: rows.length,
      textChars: rows.reduce((sum, row) => sum + row.textChars, 0),
      sections: rows.reduce((sum, row) => sum + row.sections.length, 0),
      names: rows.map((row) => row.name),
    };
  },
});

/** A brand-new build chat may have no draft row yet; a document creates it, as updateDraft does. */
async function ensureDraft(ctx: MutationCtx, conversation: Doc<"dolphinConversations">): Promise<Id<"agentDrafts">> {
  const existing = await draftOf(ctx, conversation._id);
  if (existing) return existing._id;
  const now = Date.now();
  return ctx.db.insert("agentDrafts", {
    conversationId: conversation._id,
    ownerAddress: conversation.ownerAddress ?? null,
    name: null,
    description: null,
    instructions: null,
    tools: [],
    createdAt: now,
    updatedAt: now,
  });
}

export const insertDocument = internalMutation({
  args: {
    conversationKey: v.string(),
    name: v.string(),
    kind: v.union(v.literal("markdown"), v.literal("text"), v.literal("pdf")),
    sha256: v.string(),
    textChars: v.number(),
    storedBytes: v.number(),
    sections: v.array(v.object({ title: v.string(), slug: v.string(), chars: v.number(), storageId: v.id("_storage") })),
    flags: v.array(v.object({ reason: v.string(), excerpt: v.string() })),
  },
  handler: async (ctx, { conversationKey, ...document }) => {
    const conversation = await buildConversation(ctx, conversationKey);
    const draftId = await ensureDraft(ctx, conversation);
    // Checked again here, inside the transaction: two uploads at once must not both squeeze in.
    const rows = await documentsOf(ctx, draftId);
    const textChars = rows.reduce((sum, row) => sum + row.textChars, 0) + document.textChars;
    const sections = rows.reduce((sum, row) => sum + row.sections.length, 0) + document.sections.length;
    if (rows.length >= MAX_DOCUMENTS || textChars > MAX_AGENT_TEXT_CHARS || sections > MAX_SECTIONS) {
      return null;
    }
    const id = await ctx.db.insert("agentKnowledge", { draftId, ...document, createdAt: Date.now() });
    await regenerateTools(ctx, draftId);
    return id;
  },
});
