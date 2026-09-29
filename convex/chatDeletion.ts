/**
 * DELETING A CHAT, FOR REAL (owner, 2026-09-29).
 *
 * "There should be a way for people to delete their chats - and delete it
 * totally from our database." What goes: every message (what the person typed
 * and every reply) and every tool call (what was sent to agents and what came
 * back). What stays: one row in `chatSummaries` - the mode, message counts and
 * which agents' tools were used - with no text, no wallet and no key, so it
 * describes how Dolphin is used without describing who used it.
 *
 * ONE EXCEPTION, AND WHY. A conversation that an agent was built from (or
 * that an agent's autopilot runs in) is how that agent finds itself: practice
 * trades, the trade key and the run log are all looked up by its key. Deleting
 * the row would break a running agent. So for those, the messages and tool
 * calls go and the title - which is the person's first message - is wiped;
 * the empty shell the agent needs is kept. The page says so before deleting.
 *
 * Holding the conversation key is the capability, as it is for reading one.
 * Large chats are deleted in batches that reschedule themselves.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";

const BATCH = 250;
const MAX_KEYS = 24;
const MAX_SUMMARY_ROWS = 60;

type ToolTally = Doc<"chatSummaries">["toolCalls"][number];

/** Does an agent depend on this conversation? Then its shell must stay. */
async function agentDependsOn(ctx: MutationCtx, conversation: Doc<"dolphinConversations">): Promise<boolean> {
  if (conversation.draftId) return true;
  const draft = await ctx.db
    .query("agentDrafts")
    .withIndex("by_conversation", (q) => q.eq("conversationId", conversation._id))
    .first();
  return draft !== null;
}

export const deleteConversations = mutation({
  args: { conversationKeys: v.array(v.string()) },
  handler: async (ctx, { conversationKeys }) => {
    let started = 0;
    for (const conversationKey of conversationKeys.slice(0, MAX_KEYS)) {
      const conversation = await ctx.db
        .query("dolphinConversations")
        .withIndex("by_key", (q) => q.eq("conversationKey", conversationKey))
        .unique();
      if (!conversation) continue;
      const summaryId = await ctx.db.insert("chatSummaries", {
        mode: conversation.mode ?? "chat",
        userMessages: 0,
        assistantMessages: 0,
        toolCalls: [],
        startedAt: conversation.createdAt,
        lastActiveAt: conversation.updatedAt,
        deletedAt: Date.now(),
        complete: false,
      });
      // The title is the person's first message: gone at once, not at the end of the sweep.
      await ctx.db.patch(conversation._id, { title: "" });
      await ctx.scheduler.runAfter(0, internal.chatDeletion.sweep, { conversationId: conversation._id, summaryId });
      started++;
    }
    return { started };
  },
});

export const sweep = internalMutation({
  args: { conversationId: v.id("dolphinConversations"), summaryId: v.id("chatSummaries") },
  handler: async (ctx, { conversationId, summaryId }) => {
    const summary = await ctx.db.get(summaryId);
    const conversation = await ctx.db.get(conversationId);
    if (!summary) return;

    // 1. Tool calls: tally what was used, then delete.
    const calls = await ctx.db
      .query("dolphinToolCalls")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .take(BATCH);
    const tally = new Map<string, ToolTally>(summary.toolCalls.map((row) => [`${row.agentKey}|${row.toolName}`, { ...row }]));
    for (const call of calls) {
      const id = `${call.agentKey}|${call.toolName}`;
      const row = tally.get(id) ?? { agentKey: call.agentKey, agentName: call.agentName, toolName: call.toolName, calls: 0, errors: 0 };
      row.calls += 1;
      if (call.isError || call.transportError) row.errors += 1;
      tally.set(id, row);
      await ctx.db.delete(call._id);
    }

    // 2. Messages: count by role, then delete (only once the tool calls pointing at them are gone).
    let userMessages = summary.userMessages;
    let assistantMessages = summary.assistantMessages;
    const room = BATCH - calls.length;
    const messages =
      room > 0 && calls.length < BATCH
        ? await ctx.db
            .query("dolphinMessages")
            .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
            .take(room)
        : [];
    for (const message of messages) {
      if (message.role === "user") userMessages++;
      else assistantMessages++;
      await ctx.db.delete(message._id);
    }

    const toolCalls = [...tally.values()].sort((a, b) => b.calls - a.calls).slice(0, MAX_SUMMARY_ROWS);
    const more = calls.length === BATCH || messages.length === room;
    await ctx.db.patch(summaryId, { toolCalls, userMessages, assistantMessages, complete: !more });

    if (more) {
      await ctx.scheduler.runAfter(0, internal.chatDeletion.sweep, { conversationId, summaryId });
      return;
    }
    // 3. Done: the conversation row goes too, unless an agent needs it.
    if (conversation && !(await agentDependsOn(ctx, conversation))) {
      await ctx.db.delete(conversation._id as Id<"dolphinConversations">);
    }
  },
});
