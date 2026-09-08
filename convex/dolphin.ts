import { v } from "convex/values";

import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
} from "./_generated/server";
import { buildToolMenu, type CandidateAgent } from "./lib/decisionTools";
import { McpError, callMcpTool } from "./lib/mcpClient";
import {
  OpenRouterError,
  chatCompletion,
  type ChatMessage,
  type ToolCall,
} from "./lib/openrouter";
import { randomHex, requireWalletAddress } from "./lib/walletAuth";

/**
 * DOLPHIN - the in-app agent that consults marketplace agents to answer.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS FOR
 * ---------------------------------------------------------------------------
 * 26 of the 28 live agents in this catalog speak MCP, and MCP has no ERC-8183
 * quote path - so the entire hire/review/retention apparatus reaches 2 of 28
 * and never can reach the rest (SESSION-LOG-2026-09-07-backend-rebuild.md §12,
 * SESSION-LOG-2026-09-07-agent-page-and-mcp.md §6, which names it as an
 * undecided product tension). Those 26 publish 226 working tools that a phone
 * user has no way to consume.
 *
 * This is the way to consume them. It converts a directory listing into
 * something a person can ask a question of.
 *
 * ---------------------------------------------------------------------------
 * THE CITATIONS ARE RECORDED BY THE EXECUTOR, NOT ASSERTED BY THE MODEL
 * ---------------------------------------------------------------------------
 * Every call written to `dolphinToolCalls` is written by the code that made
 * the call, before and after it happened, with the latency it actually took.
 * The model does not get to say which agents it consulted - it is told, by the
 * record of what ran.
 *
 * This matters because the model is small, free, and will happily claim to
 * have consulted an agent it never called. A UI that rendered the model's own
 * account of its sources would be exactly the fabricated-provenance failure
 * AGENTS.md §5 forbids, one level up from a fabricated number. So the sources
 * shown are the sources that ran, and if the prose disagrees with them, the
 * prose is the thing that is wrong.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS AGENT CANNOT DO, ON PURPOSE
 * ---------------------------------------------------------------------------
 * It cannot spend. It reads MCP tools and composes an answer; a paid hire
 * remains the existing quote -> escrow -> user signature path, and the user
 * signs. project-scope.md §6 is the reason it could not be otherwise even if
 * that were wanted: @altananetwork/sdk 0.8.0 ships no injected-wallet signer,
 * so a Reown-connected wallet cannot drive a session grant at all.
 */

/** Hard ceiling on tool calls in one turn. A free tier is a real budget. */
const MAX_TOOL_CALLS_PER_TURN = 6;

/**
 * How many times the model may go back for more evidence before it must write.
 *
 * Two, because one is measurably too few: the first live run reached an agent
 * whose tool is a directory of other agents, so round one produced a candidate
 * list and no answer. Two is enough to follow a pointer once. It is not a
 * budget for open-ended exploration, which a free tier cannot fund.
 */
const MAX_TOOL_ROUNDS = 2;

/** Stored tool output is truncated - a citation, not an archive. */
const MAX_STORED_RESULT_CHARS = 4_000;

/** What the model is allowed to see of a tool's answer. */
const MAX_MODEL_RESULT_CHARS = 6_000;

/**
 * The prompt for the TOOL ROUNDS. Deliberately almost empty.
 *
 * MEASURED 2026-09-08. With the full rule list below in front of it,
 * `nemotron-3-super` stopped emitting structured tool calls and wrote them as
 * JSON into the message body instead - at 28 tools and still at 10, so it was
 * never only a menu-size problem. It is a reasoning model, and a long
 * rule-heavy prompt makes it deliberate in prose, which is exactly the mode in
 * which a tool call becomes text.
 *
 * The honesty rules are not needed here anyway: nothing this turn produces is
 * shown to anyone. The only job is to gather evidence. The rules apply where
 * they matter, at synthesis, when there is prose to govern.
 */
const CONSULT_PROMPT = `You gather evidence by calling tools. Call the tools that will answer the user's question. Do not write prose. Do not explain your plan. Only call tools.`;

const SYSTEM_PROMPT = `You are Dolphin, an assistant inside a marketplace of on-chain AI agents on BNB Smart Chain.

You answer by CONSULTING the agents available to you as tools. Those tools are real agents published by third parties, and calling one is how you learn anything specific.

Rules you must follow:

1. Never state a number, price, balance, rate or status that did not come back from a tool call in this conversation. If you do not have it, say you do not have it and say what you would need to get it.
2. Attribute every specific claim to the agent it came from, by name, in your prose. Write "Brain on BNB reports a health factor of 1.84" - never "your health factor is 1.84".
3. A tool's output is that agent's CLAIM, not an established outcome. If an agent says it did something, report that it said so. Agents in this catalog have been observed reporting success for actions that did not occur.
4. If the tools you called do not answer the question, say so plainly. An honest "the agents I can reach do not cover this" is correct and useful. Inventing a plausible answer is not.
5. Be brief and concrete. You are rendered as plain text on a phone screen: no markdown tables, no headings, no code fences. Short paragraphs, and a dash for a list item if you need one. A table will render as unreadable pipe characters.

You cannot spend money, sign transactions, or take on-chain actions. If the user needs paid work, explain which agent could do it and that hiring it requires their own signature.`;

/* ---------------------------------------------------------------------------
 * Reads
 * ------------------------------------------------------------------------ */

export const getConversation = query({
  args: { conversationKey: v.string() },
  handler: async (ctx, { conversationKey }) => {
    const conversation = await ctx.db
      .query("dolphinConversations")
      .withIndex("by_key", (q) => q.eq("conversationKey", conversationKey))
      .unique();
    if (!conversation) return null;

    const messages = await ctx.db
      .query("dolphinMessages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversation._id))
      .order("asc")
      .collect();

    const toolCalls = await ctx.db
      .query("dolphinToolCalls")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversation._id))
      .order("asc")
      .collect();

    return {
      conversation: {
        conversationKey: conversation.conversationKey,
        title: conversation.title,
        seedAgentKey: conversation.seedAgentKey,
        createdAt: conversation.createdAt,
      },
      messages: messages.map((message) => ({
        id: message._id,
        role: message.role,
        content: message.content,
        status: message.status,
        errorReason: message.errorReason,
        model: message.model,
        createdAt: message.createdAt,
        completedAt: message.completedAt,
      })),
      /*
       * Grouped by message so the UI can render each turn's citations under it.
       * These are the calls that RAN - see this file's header on why they are
       * not taken from the model's own account of its sources.
       */
      toolCalls: toolCalls.map((call) => ({
        id: call._id,
        messageId: call.messageId,
        agentKey: call.agentKey,
        agentName: call.agentName,
        toolName: call.toolName,
        resultText: call.resultText,
        isError: call.isError,
        transportError: call.transportError,
        latencyMs: call.latencyMs,
        calledAt: call.calledAt,
      })),
    };
  },
});

/* ---------------------------------------------------------------------------
 * Writes - internal, called by the action as it works
 * ------------------------------------------------------------------------ */

export const createConversation = mutation({
  args: {
    seedAgentKey: v.optional(v.string()),
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, { seedAgentKey, sessionToken }) => {
    /*
     * 32 bytes. This key is a capability - holding it is what grants read
     * access to an anonymous conversation - so it is generated server-side
     * with the same helper the SIWE session tokens use, never client-side.
     */
    const conversationKey = randomHex(32);

    /*
     * Binds an owner when a session is present; anonymous is permitted. See
     * the access-model note on the table in schema.ts.
     *
     * The catch is deliberate and narrow: an EXPIRED or unknown token means
     * "not signed in", which downgrades this to an anonymous conversation
     * rather than refusing to open one. This is the only place in convex/ that
     * softens requireWalletAddress, and it is safe here because the address is
     * used solely to list a user's own history - no write is authorised by it.
     */
    const ownerAddress = sessionToken
      ? await requireWalletAddress(ctx, sessionToken, "Opening a Dolphin conversation").catch(
          () => null,
        )
      : null;

    const now = Date.now();
    await ctx.db.insert("dolphinConversations", {
      conversationKey,
      ownerAddress,
      title: "New conversation",
      seedAgentKey: seedAgentKey ?? null,
      createdAt: now,
      updatedAt: now,
    });

    return { conversationKey };
  },
});

export const appendTurn = internalMutation({
  args: {
    conversationKey: v.string(),
    userText: v.string(),
    promptHash: v.string(),
  },
  handler: async (ctx, { conversationKey, userText, promptHash }) => {
    const conversation = await ctx.db
      .query("dolphinConversations")
      .withIndex("by_key", (q) => q.eq("conversationKey", conversationKey))
      .unique();
    if (!conversation) throw new Error("That conversation no longer exists.");

    const now = Date.now();

    await ctx.db.insert("dolphinMessages", {
      conversationId: conversation._id,
      role: "user",
      content: userText,
      status: "complete",
      errorReason: null,
      promptHash,
      model: null,
      createdAt: now,
      completedAt: now,
    });

    const assistantId = await ctx.db.insert("dolphinMessages", {
      conversationId: conversation._id,
      role: "assistant",
      content: "",
      status: "thinking",
      errorReason: null,
      promptHash: null,
      model: null,
      createdAt: now + 1,
      completedAt: null,
    });

    // The first thing asked becomes the conversation's name in the history list.
    const title =
      conversation.title === "New conversation"
        ? userText.trim().slice(0, 80)
        : conversation.title;
    await ctx.db.patch(conversation._id, { title, updatedAt: now });

    return { conversationId: conversation._id, assistantId };
  },
});

export const setMessageStatus = internalMutation({
  args: {
    messageId: v.id("dolphinMessages"),
    status: v.union(
      v.literal("thinking"),
      v.literal("consulting"),
      v.literal("complete"),
      v.literal("error"),
    ),
    content: v.optional(v.string()),
    errorReason: v.optional(v.union(v.string(), v.null())),
    model: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { messageId, status, content, errorReason, model }) => {
    const patch: Partial<Doc<"dolphinMessages">> = { status };
    if (content !== undefined) patch.content = content;
    if (errorReason !== undefined) patch.errorReason = errorReason;
    if (model !== undefined) patch.model = model;
    if (status === "complete" || status === "error") patch.completedAt = Date.now();
    await ctx.db.patch(messageId, patch);
  },
});

export const recordToolCall = internalMutation({
  args: {
    conversationId: v.id("dolphinConversations"),
    messageId: v.id("dolphinMessages"),
    agentKey: v.string(),
    agentName: v.string(),
    toolName: v.string(),
    argumentsJson: v.string(),
  },
  handler: async (ctx, args) =>
    // Inserted BEFORE the call is made, so a call that hangs or crashes still
    // leaves a record that it was attempted. A citation list assembled only
    // from successes would quietly hide the agents that did not answer.
    ctx.db.insert("dolphinToolCalls", {
      ...args,
      resultText: null,
      isError: false,
      transportError: null,
      latencyMs: null,
      calledAt: Date.now(),
    }),
});

export const completeToolCall = internalMutation({
  args: {
    toolCallId: v.id("dolphinToolCalls"),
    resultText: v.union(v.string(), v.null()),
    isError: v.boolean(),
    transportError: v.union(v.string(), v.null()),
    latencyMs: v.number(),
  },
  handler: async (ctx, { toolCallId, ...patch }) => {
    await ctx.db.patch(toolCallId, patch);
  },
});

/**
 * Candidate agents for a question.
 *
 * Deterministic: the catalog's own search index and ranking decide who is
 * offered, before the model sees anything. Restricted to MCP because that is
 * the protocol with tools to call - an A2A agent is commissioned and paid, not
 * queried, and putting one in a tool menu would imply this agent can spend.
 */
export const candidatesFor = internalQuery({
  args: { text: v.string(), limit: v.number() },
  handler: async (ctx, { text, limit }) => {
    const trimmed = text.trim();

    const rows = trimmed.length > 0
      ? await ctx.db
          .query("agents")
          .withSearchIndex("search_text", (q) =>
            q.search("searchText", trimmed).eq("status", "live").eq("protocol", "mcp"),
          )
          .take(limit)
      : await ctx.db
          .query("agents")
          .withIndex("by_status_protocol_category_rank", (q) =>
            q.eq("status", "live").eq("protocol", "mcp"),
          )
          .order("desc")
          .take(limit);

    return rows.map((row) => ({
      agentKey: row.agentKey,
      name: row.name,
      endpoint: row.endpoint,
      protocol: row.protocol,
    }));
  },
});

/**
 * What the model budget actually looks like right now, and whether the model
 * this agent depends on will answer a tool call.
 *
 * Exists because the free tier fails in ways that look like application bugs.
 * A model that is out of budget, and a model that is present but declines to
 * emit a structured tool call, produce the same visible symptom - an answer
 * with no citations - and they need completely different responses. Guessing
 * between them wasted a cycle on 2026-09-08.
 *
 * Returns no secret: `/api/v1/key` reports usage and limits, never the key.
 *
 * Run it with:
 *   npx convex run dolphin:checkModelBudget '{}'
 */
export const checkModelBudget = action({
  args: { text: v.optional(v.string()) },
  handler: async (
    ctx,
    { text },
  ): Promise<{
    budget: unknown;
    toolCallProbe: { model: string; toolCalls: number; finishReason: string | null } | string;
    realMenu?: unknown;
  }> => {
    let budget: unknown;
    try {
      const response = await fetch("https://openrouter.ai/api/v1/key", {
        headers: { authorization: `Bearer ${process.env.OPENROUTER_API_KEY ?? ""}` },
      });
      budget = JSON.parse(await response.text());
    } catch (cause) {
      budget = `could not read: ${cause instanceof Error ? cause.message : String(cause)}`;
    }

    // The smallest possible question that REQUIRES a tool call to answer.
    let toolCallProbe: { model: string; toolCalls: number; finishReason: string | null } | string;
    try {
      const result = await chatCompletion({
        messages: [{ role: "user", content: "What is the weather in Lagos? Use the tool." }],
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              description: "Returns the current weather for a city.",
              parameters: {
                type: "object",
                properties: { city: { type: "string" } },
                required: ["city"],
              },
            },
          },
        ],
        toolChoice: "required",
      });
      toolCallProbe = {
        model: result.model,
        toolCalls: result.toolCalls.length,
        finishReason: result.finishReason,
      };
    } catch (cause) {
      toolCallProbe = cause instanceof Error ? cause.message : String(cause);
    }

    if (text === undefined) return { budget, toolCallProbe };

    /*
     * The same menu a real question would build, then the same forced call.
     * This is the half that matters: the model demonstrably emits tool calls
     * against a hand-written one-tool menu, so a failure here is the CATALOG's
     * schemas, not the model - and the two need opposite fixes.
     */
    const candidates: CandidateAgent[] = await ctx.runQuery(internal.dolphin.candidatesFor, {
      text,
      limit: 6,
    });
    const menu = await buildToolMenu(candidates);

    let menuProbe: unknown;
    try {
      const result = await chatCompletion({
        messages: [
          { role: "system", content: CONSULT_PROMPT },
          { role: "user", content: text },
        ],
        tools: menu.tools,
        toolChoice: "required",
      });
      menuProbe = {
        model: result.model,
        toolCalls: result.toolCalls.length,
        finishReason: result.finishReason,
        content: result.content.slice(0, 300),
      };
    } catch (cause) {
      menuProbe = cause instanceof Error ? cause.message : String(cause);
    }

    return {
      budget,
      toolCallProbe,
      realMenu: {
        candidates: candidates.map((candidate) => candidate.name),
        unreachable: menu.unreachable,
        toolCount: menu.tools.length,
        tools: menu.tools.map((tool) => ({
          name: tool.function.name,
          schemaBytes: JSON.stringify(tool.function.parameters).length,
          schema: tool.function.parameters,
        })),
        menuProbe,
      },
    };
  },
});

/* ---------------------------------------------------------------------------
 * The loop
 * ------------------------------------------------------------------------ */

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export const ask = action({
  args: {
    conversationKey: v.string(),
    text: v.string(),
  },
  handler: async (ctx, { conversationKey, text }): Promise<{ messageId: Id<"dolphinMessages"> }> => {
    const promptHash = await sha256Hex(text);

    const { conversationId, assistantId } = await ctx.runMutation(internal.dolphin.appendTurn, {
      conversationKey,
      userText: text,
      promptHash,
    });

    try {
      /*
       * RETRIEVE - ordinary catalog code, no model involved. See
       * decisionTools.ts on why the menu the model sees is small.
       */
      const candidates: CandidateAgent[] = await ctx.runQuery(internal.dolphin.candidatesFor, {
        text,
        limit: 6,
      });

      if (candidates.length === 0) {
        await ctx.runMutation(internal.dolphin.setMessageStatus, {
          messageId: assistantId,
          status: "error",
          errorReason:
            "No live MCP agents in the catalog matched that question, so there was nothing for Dolphin to consult.",
        });
        return { messageId: assistantId };
      }

      await ctx.runMutation(internal.dolphin.setMessageStatus, {
        messageId: assistantId,
        status: "consulting",
      });

      const menu = await buildToolMenu(candidates);

      if (menu.tools.length === 0) {
        await ctx.runMutation(internal.dolphin.setMessageStatus, {
          messageId: assistantId,
          status: "error",
          errorReason:
            menu.unreachable.length > 0
              ? `The agents that matched could not be reached right now: ${menu.unreachable
                  .map((entry) => entry.agentName)
                  .join(", ")}.`
              : "The agents that matched publish no tools Dolphin can call.",
        });
        return { messageId: assistantId };
      }

      // Starts with the terse consult prompt; swapped for the full rules before
      // synthesis. See CONSULT_PROMPT for the measurement behind the split.
      const messages: ChatMessage[] = [
        { role: "system", content: CONSULT_PROMPT },
        { role: "user", content: text },
      ];

      /*
       * CONSULT, up to MAX_TOOL_ROUNDS times.
       *
       * One round is not enough, and this is measured rather than assumed. The
       * first end-to-end run (2026-09-08) reached a BROKER - an agent whose
       * tool is itself a directory of other agents - so the single round
       * returned a list of candidates and no yield figure, and the model
       * correctly stopped and asked the user which agent to query next. That is
       * the right instinct and the wrong experience.
       *
       * The budget is bounded on both axes because a free tier is a real one:
       * at most MAX_TOOL_ROUNDS model calls with tools attached, and at most
       * MAX_TOOL_CALLS_PER_TURN agent calls across all of them combined.
       *
       * `required` on the FIRST round only. A small model left to its own
       * judgement answers from its own weights, which is how an unsourced
       * number reaches a user - the one outcome this product must never
       * produce. After evidence is in, `auto` is right: forcing a second call
       * would make it invent a reason to make one.
       */
      let callsRemaining = MAX_TOOL_CALLS_PER_TURN;
      let callsMade = 0;

      for (let round = 0; round < MAX_TOOL_ROUNDS && callsRemaining > 0; round++) {
        const turn = await chatCompletion({
          messages,
          tools: menu.tools,
          toolChoice: round === 0 ? "required" : "auto",
        });

        messages.push({
          role: "assistant",
          content: turn.content || null,
          tool_calls: turn.toolCalls,
        });

        if (turn.toolCalls.length === 0) break;

        const batch = turn.toolCalls.slice(0, callsRemaining);
        callsRemaining -= batch.length;
        callsMade += batch.length;

        await executeToolCalls(ctx, {
          conversationId,
          messageId: assistantId,
          toolCalls: batch,
          menu,
          messages,
        });
      }

      /*
       * NO CITATIONS, NO ANSWER.
       *
       * If nothing was consulted there is nothing to synthesise from, and
       * anything the model writes here is its own weights talking - an
       * unsourced answer wearing the costume of a researched one. That is the
       * single outcome this product exists to not produce, and it is worse than
       * a stated failure because only one of the two tells the user something
       * true.
       *
       * Reached for real on 2026-09-08: `tool_choice: "required"` was set and
       * the served model returned no tool calls anyway, the loop fell through,
       * and synthesis produced prose from an empty evidence set. Providers on
       * this tier do not all honour forced tool use, so it is enforced here
       * rather than assumed of them.
       */
      if (callsMade === 0) {
        await ctx.runMutation(internal.dolphin.setMessageStatus, {
          messageId: assistantId,
          status: "error",
          errorReason:
            "Dolphin could not get any of the matching agents to answer, so it has nothing " +
            "to base a reply on. It will not guess. Try asking again, or rephrase the question " +
            "toward what a specific agent does.",
        });
        return { messageId: assistantId };
      }

      /*
       * SYNTHESIZE. No tools: the evidence is in, and the model must now write
       * an answer rather than reach for one more call it cannot afford.
       *
       * The system turn is swapped here, from the terse consult prompt to the
       * full rules. This is the point where prose starts existing, so it is the
       * point where rules about prose start applying.
       */
      messages[0] = { role: "system", content: SYSTEM_PROMPT };
      const final = await chatCompletion({ messages });

      await ctx.runMutation(internal.dolphin.setMessageStatus, {
        messageId: assistantId,
        status: "complete",
        content:
          final.content.trim().length > 0
            ? final.content
            : "Dolphin consulted the agents below but could not form an answer from what they returned.",
        model: final.model,
      });
    } catch (cause) {
      // A reason a person can read. `isRateLimit` matters: "we are out of free
      // calls today" and "the agent is broken" are different facts.
      const reason =
        cause instanceof OpenRouterError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : String(cause);

      await ctx.runMutation(internal.dolphin.setMessageStatus, {
        messageId: assistantId,
        status: "error",
        errorReason: reason,
      });
    }

    return { messageId: assistantId };
  },
});

/**
 * Runs the calls the model asked for, recording each one as it goes.
 *
 * Every result is appended to `messages` as a `tool` turn, including failures -
 * a model told nothing about a failed call will assume it succeeded and invent
 * what it returned.
 */
async function executeToolCalls(
  ctx: ActionCtx,
  input: {
    conversationId: Id<"dolphinConversations">;
    messageId: Id<"dolphinMessages">;
    toolCalls: ToolCall[];
    menu: Awaited<ReturnType<typeof buildToolMenu>>;
    messages: ChatMessage[];
  },
): Promise<void> {
  for (const call of input.toolCalls) {
    const binding = input.menu.bindings.get(call.function.name);

    if (!binding) {
      // The model named a tool that was never offered. Not fatal, and worth
      // telling it plainly rather than silently dropping - a dropped call is
      // one the model will assume succeeded.
      input.messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: `No such tool: ${call.function.name}. It was not in the menu you were given.`,
      });
      continue;
    }

    let args: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(call.function.arguments || "{}") as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>;
      }
    } catch {
      // A malformed argument string is the model's error, not the agent's.
      // Recorded as an attempt so the citation list stays honest.
      args = {};
    }

    const toolCallId = await ctx.runMutation(internal.dolphin.recordToolCall, {
      conversationId: input.conversationId,
      messageId: input.messageId,
      agentKey: binding.agentKey,
      agentName: binding.agentName,
      toolName: binding.toolName,
      argumentsJson: JSON.stringify(args).slice(0, 2_000),
    });

    const startedAt = Date.now();
    try {
      const result = await callMcpTool(binding.session, binding.toolName, args);
      const latencyMs = Date.now() - startedAt;

      await ctx.runMutation(internal.dolphin.completeToolCall, {
        toolCallId,
        resultText: result.text.slice(0, MAX_STORED_RESULT_CHARS),
        isError: result.isError,
        transportError: null,
        latencyMs,
      });

      input.messages.push({
        role: "tool",
        tool_call_id: call.id,
        // Prefixed with the source so the model has what it needs to attribute
        // the claim, and so a tool that tries to impersonate another agent in
        // its own output is contradicted by the framing around it.
        content:
          `[${binding.agentName} -> ${binding.toolName}${result.isError ? " (reported an error)" : ""}]\n` +
          result.text.slice(0, MAX_MODEL_RESULT_CHARS),
      });
    } catch (cause) {
      const latencyMs = Date.now() - startedAt;
      const detail = cause instanceof McpError ? cause.message : String(cause);

      await ctx.runMutation(internal.dolphin.completeToolCall, {
        toolCallId,
        resultText: null,
        isError: true,
        transportError: detail.slice(0, 500),
        latencyMs,
      });

      input.messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: `[${binding.agentName} could not be reached] ${detail}`,
      });
    }
  }
}
