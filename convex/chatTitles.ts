/**
 * A CHAT'S TITLE IS A SUMMARY, NOT ITS FIRST LINE (owner, 2026-09-29: "try
 * and summarize... understand what the person is saying, and that becomes the
 * title of the chat").
 *
 * The first message stays as the title the instant the chat starts, so the
 * sidebar is never blank; this then asks Dolphin's own model for a short
 * title in the background and swaps it in. If the model is out, rate-limited
 * or says something unusable, the first-message title simply stays - which is
 * the owner's stated fallback.
 *
 * It replaces the title only while it is still the stand-in, so a title that
 * has changed in the meantime is never overwritten.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { chatCompletion } from "./lib/openrouter";

const PROMPT =
  "Write a short title for a chat that starts with the message below. " +
  "2 to 6 words, plain words, sentence case, no quotes, no emoji, no full stop. " +
  "Say what the person wants, not how they asked. Reply with the title only.";

/** Whatever the model said, made into a title - or null when it is not one. */
export function cleanTitle(raw: string): string | null {
  const text = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!text) return null;
  const title = text
    .replace(/^(title|chat title)\s*[:\-]\s*/i, "")
    .replace(/^[#*_`"'“”‘’\s]+|[#*_`"'“”‘’\s]+$/g, "")
    .replace(/[.!?;:,]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (title.length < 2 || title.length > 70) return null;
  return title.charAt(0).toUpperCase() + title.slice(1);
}

export const summarize = internalAction({
  args: { conversationId: v.id("dolphinConversations"), firstMessage: v.string(), standIn: v.string() },
  handler: async (ctx, { conversationId, firstMessage, standIn }) => {
    let title: string | null = null;
    try {
      const result = await chatCompletion({
        messages: [
          { role: "system", content: PROMPT },
          { role: "user", content: firstMessage.slice(0, 1_500) },
        ],
        temperature: 0.2,
        // Room for a reasoning model to think before it answers (see agentBuilder's note on budgets).
        maxTokens: 400,
      });
      title = cleanTitle(result.content);
    } catch {
      return; // The stand-in stays: the owner's fallback when the model is unavailable.
    }
    if (title) await ctx.runMutation(internal.chatTitles.apply, { conversationId, title, standIn });
  },
});

export const apply = internalMutation({
  args: { conversationId: v.id("dolphinConversations"), title: v.string(), standIn: v.string() },
  handler: async (ctx, { conversationId, title, standIn }) => {
    const conversation = await ctx.db.get(conversationId);
    if (conversation && conversation.title === standIn) await ctx.db.patch(conversationId, { title });
  },
});
