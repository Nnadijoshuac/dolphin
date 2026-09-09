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
import knowledge from "./knowledge.json";
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
 * Infused with a human-like DeFi specialist personality and backed by knowledge.json
 * so it speaks warmly, intelligently, and contextually rather than dumping raw JSON
 * or failing when no tools are called.
 */

/** Hard ceiling on tool calls in one turn. A free tier is a real budget. */
const MAX_TOOL_CALLS_PER_TURN = 6;

/**
 * How many times the model may go back for more evidence before it must write.
 */
const MAX_TOOL_ROUNDS = 2;

/** Stored tool output is truncated - a citation, not an archive. */
const MAX_STORED_RESULT_CHARS = 4_000;

/** What the model is allowed to see of a tool's answer. */
const MAX_MODEL_RESULT_CHARS = 6_000;

const KNOWLEDGE_SUMMARY = `
CORE KNOWLEDGE BASE:
- Name: ${knowledge.name} — ${knowledge.tagline}
- Identity: ${knowledge.persona.identity}
- Voice & Tone: ${knowledge.persona.voice} (${knowledge.persona.tone})
- Network & Purpose: ${knowledge.marketplace.description}
- Standards:
  * ERC-8004: ${knowledge.marketplace.standards.ERC8004}
  * MCP (Model Context Protocol): ${knowledge.marketplace.standards.MCP}
  * ERC-8183: ${knowledge.marketplace.standards.ERC8183}
- Agent Categories in Catalog:
${knowledge.marketplace.categories.map((c: { name: string; slug: string; description: string }) => `  * ${c.name} (${c.slug}): ${c.description}`).join("\n")}
- Key Protocols on BNB Chain:
  * Venus Protocol: ${knowledge.ecosystem.protocols.Venus.role}. Key concepts: vTokens (${knowledge.ecosystem.protocols.Venus.key_concepts.vTokens}), Health Factor (${knowledge.ecosystem.protocols.Venus.key_concepts.HealthFactor}).
  * PancakeSwap: ${knowledge.ecosystem.protocols.PancakeSwap.role}. Key concepts: Liquidity pools (${knowledge.ecosystem.protocols.PancakeSwap.key_concepts.LiquidityPools}), Slippage (${knowledge.ecosystem.protocols.PancakeSwap.key_concepts.Slippage}).
  * BNB Chain: ${knowledge.ecosystem.protocols.BNBChain.role}.
- How Hiring Works:
  * Users hire agents via ERC-8183 escrow agreements directly from the agent's marketplace profile.
  * Payment is locked safely in escrow until verified completion. Dolphin cannot sign or move funds for the user.
`;

const CONSULT_PROMPT = `You are Dolphin's evidence collector. You have access to tools from specialized on-chain agents.
If the user's message asks for specific live on-chain stats, current yields, prices, balances, or agent capabilities, call the appropriate tools to gather evidence.
If the message is a greeting, a general question about Dolphin or DeFi, or can be answered directly from core knowledge, do not call any tools.
Never write prose in this step. Only call tools if necessary.`;

const SYSTEM_PROMPT = `You are Dolphin, an intelligent, articulate, and friendly AI assistant and guide for the Dolphin Agent Marketplace on BNB Smart Chain.

${KNOWLEDGE_SUMMARY}

YOUR PERSONALITY & CONVERSATION RULES:

1. Speak like a sharp, friendly human crypto colleague. Be engaging, clear, and conversational—never robotic, terse, or childish.
2. When you receive data from tools, interpret and explain what the numbers mean in human terms. For example, explain whether a Venus health factor is safe (> 1.5 is safe, < 1.0 is liquidation risk) or how a yield compares. Do not just dump raw JSON or repeat data mechanically.
3. Naturally attribute claims to the agents they came from in your sentences (e.g. "According to Brain on BNB...", "The Venus monitoring agent reports...").
4. Absolute data integrity: Never fabricate live numbers, balances, prices, or APYs that were not provided by a tool or source. If you don't have a live number, explain what you know and how to get it.
5. If greeted or asked open-ended questions, greet warmly, introduce your role as Dolphin, and suggest 1-2 interesting things the user can explore (like checking yield agents, monitoring Venus health factors, or how ERC-8183 escrow hiring works).
6. Be concise and readable: clean paragraphs, no markdown tables, no code fences. Use simple dashes for short lists if needed.
7. Safety: You cannot sign transactions or move funds. Hiring an agent always requires the user's own wallet signature on an ERC-8183 escrow agreement.`;

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
        /*
         * What Dolphin ASKED, shown next to what came back. Worth surfacing:
         * "it consulted this agent" is a weaker claim than "it asked this
         * agent exactly this and got exactly that", and the second is the one
         * a person can check.
         */
        argumentsJson: call.argumentsJson,
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
      mentions: [],
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
      mentions: [],
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
       * RETRIEVE - catalog query to see if any live MCP agents match.
       * If agents match, build a tool menu so the model can consult them.
       */
      const candidates: CandidateAgent[] = await ctx.runQuery(internal.dolphin.candidatesFor, {
        text,
        limit: 6,
      });

      const menu =
        candidates.length > 0
          ? await buildToolMenu(candidates)
          : { tools: [], bindings: new Map(), unreachable: [] };

      // Starts with the consult prompt; swapped for the full rules before synthesis.
      const messages: ChatMessage[] = [
        { role: "system", content: CONSULT_PROMPT },
        { role: "user", content: text },
      ];

      let callsRemaining = MAX_TOOL_CALLS_PER_TURN;
      let callsMade = 0;

      // If matching agents advertise tools, allow the model to consult them as needed
      if (menu.tools.length > 0) {
        await ctx.runMutation(internal.dolphin.setMessageStatus, {
          messageId: assistantId,
          status: "consulting",
        });

        for (let round = 0; round < MAX_TOOL_ROUNDS && callsRemaining > 0; round++) {
          const turn = await chatCompletion({
            messages,
            tools: menu.tools,
            toolChoice: "auto",
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
      }

      /*
       * SYNTHESIZE.
       * The evidence (if any) is gathered. Now Dolphin synthesizes a human-like,
       * articulate answer guided by its personality and knowledge base.
       */
      await ctx.runMutation(internal.dolphin.setMessageStatus, {
        messageId: assistantId,
        status: "thinking",
      });

      messages[0] = { role: "system", content: SYSTEM_PROMPT };
      const final = await chatCompletion({ messages });

      await ctx.runMutation(internal.dolphin.setMessageStatus, {
        messageId: assistantId,
        status: "complete",
        content:
          final.content.trim().length > 0
            ? final.content
            : "I'm Dolphin, your marketplace guide on BNB Chain. How can I help you explore agents or DeFi strategies today?",
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
