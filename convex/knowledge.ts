import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { MAX_AGENT_TEXT_CHARS, MAX_DOCUMENTS, MAX_SECTIONS } from "./lib/knowledge";

/**
 * A draft's documents (Agent/PLAN-2026-10-03-knowledge-mcps.md, step 1).
 * Reading a file happens in knowledgeIngest.ts (Node: unpdf); this file holds
 * the rows. As everywhere in the builder, the conversation key is the
 * capability (agentBuilder.getDraft): whoever holds it is building the agent.
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

/** Where the browser uploads a file. Refused before the upload when the agent is already full. */
export const uploadUrl = mutation({
  args: { conversationKey: v.string() },
  handler: async (ctx, { conversationKey }) => {
    const conversation = await buildConversation(ctx, conversationKey);
    const draft = await draftOf(ctx, conversation._id);
    if (draft && (await documentsOf(ctx, draft._id)).length >= MAX_DOCUMENTS) {
      throw new ConvexError(`An agent can hold ${MAX_DOCUMENTS} documents. Remove one to add another.`);
    }
    return { uploadUrl: await ctx.storage.generateUploadUrl() };
  },
});

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
    for (const section of row.sections) await ctx.storage.delete(section.storageId);
    await ctx.db.delete(documentId);
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
    return ctx.db.insert("agentKnowledge", { draftId, ...document, createdAt: Date.now() });
  },
});
