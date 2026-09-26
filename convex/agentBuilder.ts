import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { executeToolCalls, humanizeError } from "./dolphin";
import {
  BUILDER_REPLY_SCHEMA,
  EMPTY_DRAFT,
  applyBuilderReply,
  draftGaps,
  parseBuilderReply,
  resolveToolIdReferences,
  type BuilderReply,
  type DraftSpec,
  type OfferedTool,
} from "./lib/agentSpec";
import { stripRawPayloads } from "./lib/answerHygiene";
import { buildToolMenu, type CandidateAgent } from "./lib/decisionTools";
import { looksLikeLeakedReasoning } from "./lib/leakedReasoning";
import { chatCompletion, type ChatMessage } from "./lib/openrouter";
import { isMutating } from "./lib/toolCapability";
import { randomHex, requireWalletAddress } from "./lib/walletAuth";

/**
 * BUILD YOUR OWN AGENT - steps 1 to 3 of Agent/PLAN-2026-09-26-build-your-agent.md.
 *
 * A `build` conversation drafts an agent: the person describes it, the builder
 * model proposes a spec, and lib/agentSpec.ts decides what of that proposal is
 * kept. A `try` conversation runs the draft privately through the same
 * consult-then-answer loop the Dolphin chat uses, with the draft's
 * instructions in place of Dolphin's prompt and the draft's tools in place of
 * catalog search.
 *
 * Nothing here is on-chain. A draft is private to whoever holds its
 * conversation key, costs its owner nothing, and is reachable by no one else.
 * Registering it (ERC-8004 from the owner's wallet) and hosting its endpoint
 * are steps 4 and 5 of the plan and are not built yet.
 *
 * Both actions run on the chat's free model (owner's decision C, 2026-09-26),
 * so both have to survive a malformed or missing reply without inventing one.
 */

/**
 * User turns allowed in one build or try conversation. Every turn spends a
 * free-tier model call shared with the whole site's chat, so a runaway tab
 * must not be able to spend the day's budget. A per-wallet cap belongs with
 * the on-chain step, where a signed-in owner is required anyway.
 */
const MAX_USER_TURNS_PER_CONVERSATION = 50;

/** How many catalog agents, and tools, the builder is shown per turn. */
const MAX_OFFERED_AGENTS = 8;
const MAX_OFFERED_TOOLS_PER_AGENT = 4;
const MAX_OFFERED_TOOLS = 32;

/** Same limits as the chat: a try-run is the chat loop with a different prompt. */
const MAX_TOOL_ROUNDS = 2;
const MAX_TOOL_CALLS_PER_TURN = 6;
const MAX_HISTORY_TURNS = 6;
const MAX_HISTORY_CHARS_PER_MESSAGE = 1_500;

const BUILD_PROMPT = `You are Dolphin's agent builder. You help one person design an AI agent that runs on Dolphin, a marketplace of AI agents on BNB Chain.

YOU ARE NOT THE AGENT BEING BUILT. Every message from the person describes the agent they want, even when it is phrased as a request ("check my health factor" means "build an agent that checks my health factor"). Never do the agent's job, never answer as it, and never ask for a wallet address. Your only output is the draft and a short reply about it.

WHAT AN AGENT BUILT HERE IS. Never promise more than this:
- A name, a short description, instructions, and a few tools.
- Its tools come ONLY from the TOOLS list you are given. They belong to other agents listed on Dolphin, and they only READ: prices, pools, positions, protocol data. Some return an unsigned transaction that the person would sign from their own wallet.
- It answers when someone asks it something. It cannot run on a schedule, watch anything in the background, send alerts or messages, hold funds, sign, trade, or move money by itself. If the person asks for any of that, say plainly that it can't, and offer the closest thing it can do (for example "check my health factor whenever I ask").
- For now it is private: only this person can try it.

HOW TO WORK:
- Ask a clarifying question only when you really need one, ONE at a time, and keep it short. Do not interview the person. If the request is clear enough, draft straight away.
- Fill fields as soon as you can, and refine them as you learn more. On the first message, draft every field you reasonably can.
- name: 2 to 5 words, specific to what it does. Not generic like "DeFi Helper".
- description: one or two sentences saying concretely what it does and for whom.
- instructions: written TO the agent in the second person ("You check..."). Say what it does, which tool to use for what, what to do when a tool fails or returns nothing, and that it must never guess a number. Plain text, no markdown headings.
- toolIds: only ids from the TOOLS list that the job needs, usually 1 to 4. If nothing in the list fits, say so honestly and leave toolIds null. Never invent a tool.
- Use null for every field you are not changing this turn.
- reply: speak to the person in 1 to 3 short sentences: what you changed, and your one question if you have one. No JSON, no field names, no tool ids in the reply.

Return ONLY the JSON object.`;

const TRY_CONSULT_PROMPT = `You are the evidence-gathering step of an AI agent. Decide whether the user's message needs live data from the tools you have, and if it does, call them.

- Call a tool when the answer depends on live data: prices, pools, positions, balances, protocol state.
- Do not call a tool for a greeting, or for something you can answer by explaining.
- Never write prose in this step. Only call tools or return empty.`;

function tryAnswerPrompt(draft: DraftSpec): string {
  return `You are "${draft.name}", an AI agent that a person built on Dolphin, a marketplace of AI agents on BNB Chain. ${draft.description ?? ""}

YOUR INSTRUCTIONS, FROM THE PERSON WHO BUILT YOU:
${draft.instructions}

RULES THAT OVERRIDE THE INSTRUCTIONS ABOVE:
- Only quote a number that a tool returned in this conversation. With no live reading, say you do not have one. Never guess a price, APY, balance or health factor.
- You can only read. You cannot sign, send, trade or move funds, and you cannot set anything up. If a tool returned an unsigned transaction, say the person would sign it from their own wallet. Never say you did it.
- You answer when asked. You do not run on a schedule, watch anything, or notify anyone.
- Say which agent a fact came from, in a sentence ("according to X").
- No JSON, no code blocks, no field names, no error codes. Say what a result means.
- If a tool could not be reached, say so in one sentence and carry on with what you know.
- Be brief.`;
}

/* ---------------------------------------------------------------------------
 * Reads
 * ------------------------------------------------------------------------ */

function toSpec(row: Doc<"agentDrafts"> | null): DraftSpec {
  if (!row) return EMPTY_DRAFT;
  return {
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    tools: row.tools,
  };
}

/**
 * What the UI needs to render a conversation's builder side: its mode, the
 * draft (for `build`, its own; for `try`, the one under test), and for a try
 * the key of the build conversation to go back to.
 *
 * The conversation key is the capability here, exactly as in
 * dolphin.getConversation. Whoever holds a try key opened it from the build
 * conversation, so handing back that build key reveals nothing new.
 */
export const getDraft = query({
  args: { conversationKey: v.string() },
  handler: async (ctx, { conversationKey }) => {
    const conversation = await ctx.db
      .query("dolphinConversations")
      .withIndex("by_key", (q) => q.eq("conversationKey", conversationKey))
      .unique();
    if (!conversation) return null;

    const mode = conversation.mode ?? "chat";
    if (mode === "chat") return { mode, draft: null, buildConversationKey: null };

    let draft: Doc<"agentDrafts"> | null = null;
    let buildConversationKey: string | null = null;

    if (mode === "build") {
      draft = await ctx.db
        .query("agentDrafts")
        .withIndex("by_conversation", (q) => q.eq("conversationId", conversation._id))
        .unique();
      buildConversationKey = conversation.conversationKey;
    } else if (conversation.draftId) {
      draft = await ctx.db.get(conversation.draftId);
      const build = draft ? await ctx.db.get(draft.conversationId) : null;
      buildConversationKey = build?.conversationKey ?? null;
    }

    return {
      mode,
      draft: draft
        ? {
            name: draft.name,
            description: draft.description,
            instructions: draft.instructions,
            tools: draft.tools,
            updatedAt: draft.updatedAt,
          }
        : null,
      buildConversationKey,
    };
  },
});

export const userTurnCount = internalQuery({
  args: { conversationKey: v.string() },
  handler: async (ctx, { conversationKey }) => {
    const conversation = await ctx.db
      .query("dolphinConversations")
      .withIndex("by_key", (q) => q.eq("conversationKey", conversationKey))
      .unique();
    if (!conversation) return 0;
    const messages = await ctx.db
      .query("dolphinMessages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversation._id))
      .collect();
    return messages.filter((message) => message.role === "user").length;
  },
});

export const draftForConversation = internalQuery({
  args: { conversationId: v.id("dolphinConversations") },
  handler: async (ctx, { conversationId }): Promise<DraftSpec> =>
    toSpec(
      await ctx.db
        .query("agentDrafts")
        .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
        .unique(),
    ),
});

export const draftById = internalQuery({
  args: { draftId: v.id("agentDrafts") },
  handler: async (ctx, { draftId }): Promise<DraftSpec | null> => {
    const row = await ctx.db.get(draftId);
    return row ? toSpec(row) : null;
  },
});

/**
 * The tools the builder may choose from this turn, each under an id.
 *
 * Built from the catalog's stored `skills` (names and descriptions the probe
 * read from each server) rather than by opening MCP sessions: the builder only
 * needs to know what exists, and a draft turn should not dial eight strangers'
 * servers. The try-run asks the servers live, and reports any tool that is no
 * longer there.
 *
 * Order: the draft's own agents first, so the model can keep what it already
 * chose; then catalog search on what the person said; then the highest-ranked
 * live MCP agents. At most two agents per publisher from search and rank, the
 * same diversity rule as dolphin.candidatesFor, so one suite cannot fill the
 * list.
 */
export const toolCatalog = internalQuery({
  args: {
    text: v.string(),
    keep: v.array(v.object({ agentKey: v.string(), agentName: v.string(), toolName: v.string() })),
  },
  handler: async (ctx, { text, keep }): Promise<OfferedTool[]> => {
    const rows: Doc<"agents">[] = [];
    const seen = new Set<string>();
    const perPublisher = new Map<string, number>();

    const usable = (row: Doc<"agents">) =>
      row.status === "live" && row.protocol === "mcp" && !seen.has(row.agentKey);

    for (const agentKey of new Set(keep.map((tool) => tool.agentKey))) {
      const row = await ctx.db
        .query("agents")
        .withIndex("by_key", (q) => q.eq("agentKey", agentKey))
        .unique();
      if (row && usable(row)) {
        seen.add(row.agentKey);
        rows.push(row);
      }
    }

    const addDiverse = (row: Doc<"agents">) => {
      if (rows.length >= MAX_OFFERED_AGENTS || !usable(row)) return;
      const publisher = (row.ownerAddress || row.agentWallet || "unknown").toLowerCase();
      const count = perPublisher.get(publisher) ?? 0;
      if (count >= 2) return;
      perPublisher.set(publisher, count + 1);
      seen.add(row.agentKey);
      rows.push(row);
    };

    const searchText = text.trim().slice(0, 200);
    if (searchText.length >= 3) {
      const matches = await ctx.db
        .query("agents")
        .withSearchIndex("search_text", (q) =>
          q.search("searchText", searchText).eq("status", "live").eq("protocol", "mcp"),
        )
        .take(12);
      matches.forEach(addDiverse);
    }

    const topRanked = await ctx.db
      .query("agents")
      .withIndex("by_status_protocol_category_rank", (q) =>
        q.eq("status", "live").eq("protocol", "mcp"),
      )
      .order("desc")
      .take(16);
    topRanked.forEach(addDiverse);

    const keepSet = new Set(keep.map((tool) => `${tool.agentKey}\u0000${tool.toolName}`));
    const offered: OfferedTool[] = [];

    for (const row of rows) {
      const readable = row.skills.filter((skill) => !isMutating(skill.name));
      /* Tools already in the draft first, so a cap never drops a kept one. */
      readable.sort(
        (a, b) =>
          Number(keepSet.has(`${row.agentKey}\u0000${b.name}`)) -
          Number(keepSet.has(`${row.agentKey}\u0000${a.name}`)),
      );
      for (const skill of readable.slice(0, MAX_OFFERED_TOOLS_PER_AGENT)) {
        if (offered.length >= MAX_OFFERED_TOOLS) break;
        offered.push({
          id: `t${offered.length + 1}`,
          agentKey: row.agentKey,
          agentName: row.name,
          toolName: skill.name,
          description: skill.description ? skill.description.slice(0, 200) : null,
        });
      }
    }

    return offered;
  },
});

/** The catalog rows behind a draft's tools, for the try-run's menu. */
export const toolAgents = internalQuery({
  args: { agentKeys: v.array(v.string()) },
  handler: async (ctx, { agentKeys }) => {
    const found: Array<CandidateAgent & { status: Doc<"agents">["status"] }> = [];
    for (const agentKey of agentKeys) {
      const row = await ctx.db
        .query("agents")
        .withIndex("by_key", (q) => q.eq("agentKey", agentKey))
        .unique();
      if (row) {
        found.push({
          agentKey: row.agentKey,
          name: row.name,
          endpoint: row.endpoint,
          protocol: row.protocol,
          status: row.status,
        });
      }
    }
    return found;
  },
});

/* ---------------------------------------------------------------------------
 * Writes
 * ------------------------------------------------------------------------ */

export const saveDraft = internalMutation({
  args: {
    conversationId: v.id("dolphinConversations"),
    ownerAddress: v.union(v.string(), v.null()),
    name: v.union(v.string(), v.null()),
    description: v.union(v.string(), v.null()),
    instructions: v.union(v.string(), v.null()),
    tools: v.array(v.object({ agentKey: v.string(), agentName: v.string(), toolName: v.string() })),
  },
  handler: async (ctx, { conversationId, ownerAddress, ...spec }) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("agentDrafts")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { ...spec, updatedAt: now });
      return existing._id;
    }
    return ctx.db.insert("agentDrafts", {
      conversationId,
      ownerAddress,
      ...spec,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Opens a private try-run of a build conversation's draft.
 *
 * Refused until the draft has everything a run needs, so a try conversation
 * never starts on an agent with no instructions or no tools.
 */
export const startTry = mutation({
  args: {
    buildConversationKey: v.string(),
    sessionToken: v.optional(v.string()),
    userAddress: v.optional(v.string()),
  },
  handler: async (ctx, { buildConversationKey, sessionToken, userAddress }) => {
    const build = await ctx.db
      .query("dolphinConversations")
      .withIndex("by_key", (q) => q.eq("conversationKey", buildConversationKey))
      .unique();
    if (!build || (build.mode ?? "chat") !== "build") {
      throw new Error("That is not an agent draft, so there is nothing to try.");
    }

    const draft = await ctx.db
      .query("agentDrafts")
      .withIndex("by_conversation", (q) => q.eq("conversationId", build._id))
      .unique();
    const gaps = draftGaps(toSpec(draft));
    if (!draft || gaps.length > 0) {
      throw new Error(`The draft needs ${gaps.join(", ")} before it can be tried.`);
    }

    /* Same owner rule as dolphin.createConversation: a session binds, anonymous is allowed. */
    const verifiedOwner = sessionToken
      ? await requireWalletAddress(ctx, sessionToken, "Trying an agent draft").catch(() => null)
      : null;
    const ownerAddress =
      verifiedOwner ?? build.ownerAddress ?? (userAddress ? userAddress.toLowerCase() : null);

    const conversationKey = randomHex(32);
    const now = Date.now();
    await ctx.db.insert("dolphinConversations", {
      conversationKey,
      ownerAddress,
      title: `Trying ${draft.name}`,
      seedAgentKey: null,
      mode: "try",
      draftId: draft._id,
      createdAt: now,
      updatedAt: now,
    });

    return { conversationKey };
  },
});

/* ---------------------------------------------------------------------------
 * Actions
 * ------------------------------------------------------------------------ */

/**
 * The turn's promptHash, namespaced by mode.
 *
 * dolphin.reusableAnswer replays a stored answer to any earlier question with
 * the same hash, across every conversation. A builder's reply or a built
 * agent's answer is not an answer from Dolphin, so these turns must never
 * share a hash with a chat question of the same words.
 */
async function promptHashFor(mode: "build" | "try", input: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${mode}:${input.trim().toLowerCase()}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Prior turns without the one being answered (appendTurn has already stored it). */
function historyWithout(
  turns: { role: "user" | "assistant"; content: string }[],
  text: string,
): ChatMessage[] {
  const last = turns[turns.length - 1];
  const prior =
    last && last.role === "user" && last.content.trim() === text.trim() ? turns.slice(0, -1) : turns;
  return prior.slice(-MAX_HISTORY_TURNS * 2).map((turn) => ({
    role: turn.role,
    content: turn.content.slice(0, MAX_HISTORY_CHARS_PER_MESSAGE),
  }));
}

function describeDraft(draft: DraftSpec, offered: readonly OfferedTool[]): string {
  const idFor = (agentKey: string, toolName: string) =>
    offered.find((tool) => tool.agentKey === agentKey && tool.toolName === toolName)?.id;
  const tools =
    draft.tools.length === 0
      ? "none"
      : draft.tools
          .map((tool) => {
            const id = idFor(tool.agentKey, tool.toolName);
            return id
              ? `${id}`
              : `${tool.toolName} via ${tool.agentName} (no longer offered; choosing new toolIds drops it)`;
          })
          .join(", ");
  return [
    "CURRENT DRAFT:",
    `name: ${draft.name ?? "(not set)"}`,
    `description: ${draft.description ?? "(not set)"}`,
    `instructions: ${draft.instructions ?? "(not set)"}`,
    `toolIds: ${tools}`,
  ].join("\n");
}

function describeOffered(offered: readonly OfferedTool[]): string {
  if (offered.length === 0) {
    return "TOOLS: none are available right now. Say so, and do not set toolIds.";
  }
  return `TOOLS (choose by id):\n${offered
    .map(
      (tool) =>
        `${tool.id}: ${tool.toolName} (via ${tool.agentName})${tool.description ? ` - ${tool.description}` : ""}`,
    )
    .join("\n")}`;
}

/** What to say when the model changed the draft but wrote no usable reply. */
function summarizeChanges(changed: readonly string[]): string {
  const labels: Record<string, string> = {
    name: "the name",
    description: "the description",
    instructions: "the instructions",
    tools: "the tools",
  };
  const parts = changed.map((field) => labels[field] ?? field);
  const list =
    parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `I updated ${list}. The draft on the right shows them.`;
}

async function compileTurn(messages: ChatMessage[]): Promise<{ reply: BuilderReply; model: string } | null> {
  /*
   * Two attempts. Structured replies from the free model fail about one time
   * in three, and a second try is cheaper for the person than asking them to
   * resend. A second failure is reported, never papered over.
   */
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await chatCompletion({
      messages,
      responseSchema: BUILDER_REPLY_SCHEMA,
      temperature: 0.3,
      maxTokens: 2_500,
    });
    const reply = parseBuilderReply(result.content);
    if (reply) return { reply, model: result.model };
    console.warn(
      "[agentBuilder] builder reply was not a usable spec:",
      JSON.stringify({ model: result.model, finishReason: result.finishReason, content: result.content.slice(0, 300) }),
    );
  }
  return null;
}

/**
 * One turn of a build conversation: the person says something, the draft
 * moves, and the builder answers.
 */
export const ask = action({
  args: {
    conversationKey: v.string(),
    text: v.string(),
    userAddress: v.optional(v.string()),
  },
  handler: async (ctx, { conversationKey, text, userAddress }): Promise<{ messageId: Id<"dolphinMessages"> }> => {
    const turns = await ctx.runQuery(internal.agentBuilder.userTurnCount, { conversationKey });
    if (turns >= MAX_USER_TURNS_PER_CONVERSATION) {
      throw new Error(
        `This draft has reached its limit of ${MAX_USER_TURNS_PER_CONVERSATION} messages. Start a new build to keep going.`,
      );
    }

    const { conversationId, assistantId, ownerAddress } = await ctx.runMutation(
      internal.dolphin.appendTurn,
      {
        conversationKey,
        userText: text,
        promptHash: await promptHashFor("build", text),
        userAddress,
        mode: "build",
      },
    );

    try {
      const current = await ctx.runQuery(internal.agentBuilder.draftForConversation, {
        conversationId,
      });
      const priorTurns: { role: "user" | "assistant"; content: string }[] = await ctx.runQuery(
        internal.dolphin.recentHistory,
        { conversationKey, excludeMessageId: assistantId },
      );

      const offered = await ctx.runQuery(internal.agentBuilder.toolCatalog, {
        text: [text, current.description ?? ""].join(" "),
        keep: current.tools,
      });

      const messages: ChatMessage[] = [
        {
          role: "system",
          content: `${BUILD_PROMPT}\n\n${describeDraft(current, offered)}\n\n${describeOffered(offered)}`,
        },
        ...historyWithout(priorTurns, text),
        /*
         * Framed, not raw. Sent bare, "Check my Venus health factor when I
         * ask" was answered AS that agent - "I need your Venus wallet address"
         * - with the draft untouched (measured on dev, 2026-09-26).
         */
        { role: "user", content: `The person describes the agent they want:\n${text}` },
      ];

      const compiled = await compileTurn(messages);
      if (!compiled) {
        await ctx.runMutation(internal.dolphin.setMessageStatus, {
          messageId: assistantId,
          status: "error",
          errorReason:
            "The builder's model did not send back a usable draft, twice. Nothing in the draft changed. Try saying it again.",
          errorKind: "fault",
        });
        return { messageId: assistantId };
      }

      const applied = applyBuilderReply(current, compiled.reply, offered);
      if (applied.unknownToolIds.length > 0) {
        console.warn("[agentBuilder] model named tools that were not offered:", applied.unknownToolIds);
      }

      if (applied.changed.length > 0) {
        await ctx.runMutation(internal.agentBuilder.saveDraft, {
          conversationId,
          ownerAddress,
          ...applied.draft,
        });
      }

      let reply = resolveToolIdReferences(stripRawPayloads(compiled.reply.reply), offered).trim();
      if (looksLikeLeakedReasoning(reply)) reply = "";
      if (applied.overLimit.length > 0) {
        reply += `${reply ? "\n\n" : ""}I kept the tools to what one agent can run at once, so I left out ${applied.overLimit
          .map((tool) => tool.toolName)
          .join(", ")}.`;
      }
      if (reply.length === 0 && applied.changed.length > 0) reply = summarizeChanges(applied.changed);

      if (reply.length === 0) {
        await ctx.runMutation(internal.dolphin.setMessageStatus, {
          messageId: assistantId,
          status: "error",
          errorReason: "The builder's model sent back nothing to say and changed nothing. Try saying it again.",
          errorKind: "fault",
        });
        return { messageId: assistantId };
      }

      await ctx.runMutation(internal.dolphin.setMessageStatus, {
        messageId: assistantId,
        status: "complete",
        content: reply,
        model: compiled.model,
      });
    } catch (cause) {
      const reason = humanizeError(cause);
      await ctx.runMutation(internal.dolphin.setMessageStatus, {
        messageId: assistantId,
        status: "error",
        errorReason: reason.message,
        errorKind: reason.kind,
      });
    }

    return { messageId: assistantId };
  },
});

/**
 * One turn of a private try-run: the draft answers, consulting only its own
 * tools. The calls are recorded in dolphinToolCalls exactly as the chat's are,
 * so the transcript shows what ran.
 */
export const tryAsk = action({
  args: {
    conversationKey: v.string(),
    text: v.string(),
    userAddress: v.optional(v.string()),
  },
  handler: async (ctx, { conversationKey, text, userAddress }): Promise<{ messageId: Id<"dolphinMessages"> }> => {
    const turns = await ctx.runQuery(internal.agentBuilder.userTurnCount, { conversationKey });
    if (turns >= MAX_USER_TURNS_PER_CONVERSATION) {
      throw new Error(
        `This try-run has reached its limit of ${MAX_USER_TURNS_PER_CONVERSATION} messages. Start a new one from the draft.`,
      );
    }

    const { conversationId, assistantId, ownerAddress, draftId } = await ctx.runMutation(
      internal.dolphin.appendTurn,
      {
        conversationKey,
        userText: text,
        promptHash: await promptHashFor("try", text),
        userAddress,
        mode: "try",
      },
    );

    try {
      const draft = draftId ? await ctx.runQuery(internal.agentBuilder.draftById, { draftId }) : null;
      const gaps = draft ? draftGaps(draft) : ["a draft"];
      if (!draft || gaps.length > 0) {
        await ctx.runMutation(internal.dolphin.setMessageStatus, {
          messageId: assistantId,
          status: "error",
          errorReason: `This agent needs ${gaps.join(", ")} before it can run. Go back to the draft to add it.`,
          errorKind: "input",
        });
        return { messageId: assistantId };
      }

      /*
       * The menu is the draft's tools and nothing else. An agent that has left
       * the catalog, or a tool its server no longer lists, is named to the
       * model as unreachable rather than silently dropped.
       */
      const agentKeys = [...new Set(draft.tools.map((tool) => tool.agentKey))];
      const rows = await ctx.runQuery(internal.agentBuilder.toolAgents, { agentKeys });
      const candidates: CandidateAgent[] = rows
        .filter((row) => row.status === "live" && row.protocol === "mcp")
        .map(({ agentKey, name, endpoint, protocol }) => ({ agentKey, name, endpoint, protocol }));

      const allowed = new Set(draft.tools.map((tool) => `${tool.agentKey}\u0000${tool.toolName}`));
      const menu = await buildToolMenu(candidates, (agentKey, toolName) =>
        allowed.has(`${agentKey}\u0000${toolName}`),
      );

      const offeredNames = new Set([...menu.bindings.values()].map((b) => `${b.agentKey}\u0000${b.toolName}`));
      const unreachableKeys = new Set(menu.unreachable.map((u) => u.agentKey));
      const missing = draft.tools.filter(
        (tool) =>
          !offeredNames.has(`${tool.agentKey}\u0000${tool.toolName}`) && !unreachableKeys.has(tool.agentKey),
      );

      const priorTurns: { role: "user" | "assistant"; content: string }[] = await ctx.runQuery(
        internal.dolphin.recentHistory,
        { conversationKey, excludeMessageId: assistantId },
      );
      const history = historyWithout(priorTurns, text);

      const explicitAddress = text.match(/\b(0x[a-fA-F0-9]{40})\b/)?.[1]?.toLowerCase();
      const targetAddress =
        explicitAddress ?? (userAddress ? userAddress.toLowerCase() : null) ?? ownerAddress?.toLowerCase() ?? null;
      const addressNote = targetAddress
        ? `\n\nTHE USER'S WALLET ADDRESS: ${targetAddress}. When a tool asks for the user's address, pass this one. Never ask them to paste it.`
        : "\n\nNo wallet is connected. If a question needs the user's address, ask them to connect a wallet or paste an address.";

      const messages: ChatMessage[] = [
        { role: "system", content: `${TRY_CONSULT_PROMPT}${addressNote}` },
        ...history,
        { role: "user", content: text },
      ];

      let callsRemaining = MAX_TOOL_CALLS_PER_TURN;
      if (menu.tools.length > 0) {
        await ctx.runMutation(internal.dolphin.setMessageStatus, {
          messageId: assistantId,
          status: "consulting",
        });
        try {
          for (let round = 0; round < MAX_TOOL_ROUNDS && callsRemaining > 0; round++) {
            const turn = await chatCompletion({ messages, tools: menu.tools, toolChoice: "auto" });
            /* Consult prose is never carried forward. See the same note in dolphin.ask. */
            if (turn.toolCalls.length === 0) break;
            messages.push({ role: "assistant", content: null, tool_calls: turn.toolCalls });
            const batch = turn.toolCalls.slice(0, callsRemaining);
            callsRemaining -= batch.length;
            await executeToolCalls(ctx, {
              conversationId,
              messageId: assistantId,
              toolCalls: batch,
              menu,
              messages,
            });
          }
        } catch (consultError) {
          console.warn("[agentBuilder] try-run consult step failed; answering without it:", consultError);
          const last = messages[messages.length - 1];
          if (last && last.role === "assistant" && last.tool_calls && last.tool_calls.length > 0) {
            messages.pop();
          }
        }
      }

      await ctx.runMutation(internal.dolphin.setMessageStatus, {
        messageId: assistantId,
        status: "thinking",
      });

      let system = `${tryAnswerPrompt(draft)}${addressNote}`;
      const unreachable = [
        ...menu.unreachable.map((u) => `- ${u.agentName} did not answer: ${u.reason}`),
        ...rows
          .filter((row) => row.status !== "live" || row.protocol !== "mcp")
          .map((row) => `- ${row.name} is no longer listed on Dolphin, so its tools are unavailable.`),
        ...agentKeys
          .filter((key) => !rows.some((row) => row.agentKey === key))
          .map((key) => {
            const name = draft.tools.find((tool) => tool.agentKey === key)?.agentName ?? key;
            return `- ${name} is no longer listed on Dolphin, so its tools are unavailable.`;
          }),
        ...missing.map((tool) => `- ${tool.agentName} no longer offers the ${tool.toolName} tool.`),
      ];
      if (unreachable.length > 0) {
        system += `\n\nTOOLS YOU COULD NOT USE THIS TURN (say so honestly if it matters to the answer):\n${unreachable.join("\n")}`;
      }
      messages[0] = { role: "system", content: system };

      const final = await chatCompletion({ messages });
      const content = stripRawPayloads(final.content).trim();

      if (content.length === 0 || looksLikeLeakedReasoning(content)) {
        /*
         * No Dolphin catalog fallback here: that text speaks as Dolphin about
         * the marketplace, and this is someone else's agent answering its own
         * question. Saying it did not answer is the honest substitute.
         */
        await ctx.runMutation(internal.dolphin.setMessageStatus, {
          messageId: assistantId,
          status: "error",
          errorReason: "The model did not write an answer for your agent this time. Nothing was made up in its place. Try asking again.",
          errorKind: "fault",
        });
        return { messageId: assistantId };
      }

      await ctx.runMutation(internal.dolphin.setMessageStatus, {
        messageId: assistantId,
        status: "complete",
        content,
        model: final.model,
      });
    } catch (cause) {
      const reason = humanizeError(cause);
      await ctx.runMutation(internal.dolphin.setMessageStatus, {
        messageId: assistantId,
        status: "error",
        errorReason: reason.message,
        errorKind: reason.kind,
      });
    }

    return { messageId: assistantId };
  },
});
