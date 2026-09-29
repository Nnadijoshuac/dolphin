import { ConvexError, v } from "convex/values";
import { formatUnits } from "viem";

import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
} from "./_generated/server";
import { executeToolCalls, humanizeError } from "./dolphin";
import {
  BUILDER_REPLY_SCHEMA,
  DESCRIPTION_MAX_CHARS,
  EMPTY_DRAFT,
  INSTRUCTIONS_MAX_CHARS,
  MAX_DRAFT_AGENTS,
  MAX_DRAFT_TOOLS,
  MAX_DRAFT_TOOLS_PER_AGENT,
  NAME_MAX_CHARS,
  applyBuilderReply,
  cleanBlock,
  cleanLine,
  draftGaps,
  parseBuilderReply,
  resolveToolIdReferences,
  type BuilderReply,
  type DraftSpec,
  type OfferedTool,
} from "./lib/agentSpec";
import {
  activeBlocks,
  blockToolDefinitions,
  MAX_DETACHED,
  runBlockTool,
  type BlockToolResult,
  toolMemberId,
  validateBlocks,
  type AgentBlock,
} from "./lib/agentBlocks";
import { stripRawPayloads } from "./lib/answerHygiene";
import { syncTriggers } from "./lib/triggerSync";
import { buildToolMenu, type CandidateAgent } from "./lib/decisionTools";
import { looksLikeLeakedReasoning } from "./lib/leakedReasoning";
import { memoryBrief, recall, remember, type MemoryTarget } from "./lib/agentMemory";
import { chatCompletion, customChatUrl, isBrainProvider, type ChatMessage } from "./lib/openrouter";
import { assertSafeUrl } from "./lib/safeFetch";
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
- A name, a short description, instructions (its strategy, called the Melon), and a few tools.
- Its tools come ONLY from the TOOLS list you are given. They belong to other agents listed on Dolphin, and they only READ: prices, pools, positions, protocol data. Some return an unsigned transaction that the person would sign from their own wallet.
- Its brain runs on the person's OWN model key (OpenAI or OpenRouter), which they add in the Keys tab and choose on the Brain block. Dolphin does not supply one.
- The person can add more from the canvas TOOLBOX - you cannot add these yourself, so tell them which to add when the job needs them:
  - Market (the token it trades: live price, candles and a chart), Safety (token security checks).
  - Triggers: Schedule (every 15 minutes to daily), Price (when the token crosses a level), Wallet watch (when a wallet they follow - a KOL, a whale - transacts). With Autopilot switched on, the agent runs on these by itself, up to 48 times a day.
  - Risk limits (dollars per trade, trades per day) and Swap: the agent may then PROPOSE PancakeSwap trades within those limits. By default the person approves and signs every trade. They can opt in to "Trade without asking" (Draft tab) so it trades by itself for 1-30 days within limits the wallet enforces, and stop it any time. Nothing guarantees a profit - never promise one.
  - Wallet: the agent's OWN wallet, which the person funds. With it plugged in, trades within the Risk limits execute from that wallet at once, with no tap, and what they buy lands back in it; the person withdraws to their own wallet any time. Dolphin holds that wallet's key, so it should hold only what they would let the agent trade.
  - Memory: the person's OWN memory server (any https address that speaks Dolphin's two-call memory interface; a one-file server is offered to download). The agent reads its recent memories before every run, a record of each run is saved after it, and it can remember and recall notes. Dolphin keeps none of it. Suggest it for scheduled agents that must know what they did before.
  - Hire an agent: one paid A2A agent from Dolphin's catalog. The agent can ask it to do a task and gets its price; the person confirms each payment from their Dolphin Wallet with their passkey. The result is delivered later, on-chain - not into the conversation.
- Write the instructions so they use what is there: e.g. "When your price trigger fires, read the market snapshot, check safety, and propose a trade only if...". Rules with exact numbers beat vague judgement.
- It cannot send emails or messages, and cannot trade without the person signing. If asked, say so plainly and offer the closest thing it can do.
- It is private until the person puts it on-chain.

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

export const TRY_CONSULT_PROMPT = `You are the evidence-gathering step of an AI agent. Decide whether the user's message needs live data from the tools you have, and if it does, call them.

- Call a tool when the answer depends on live data: prices, pools, positions, balances, protocol state.
- Do not call a tool for a greeting, or for something you can answer by explaining.
- Never write prose in this step. Only call tools or return empty.`;

export function tryAnswerPrompt(
  draft: DraftSpec,
  abilities: { canPropose?: boolean; canTrade?: boolean; triggered?: boolean } = {},
): string {
  return `You are "${draft.name}", an AI agent that a person built on Dolphin, a marketplace of AI agents on BNB Chain. ${draft.description ?? ""}

YOUR INSTRUCTIONS, FROM THE PERSON WHO BUILT YOU:
${draft.instructions}

RULES THAT OVERRIDE THE INSTRUCTIONS ABOVE:
- Only quote a number that a tool returned in this conversation. With no live reading, say you do not have one. Never guess a price, APY, balance or health factor.
${
    abilities.canTrade
      ? "- You may TRADE with block_propose_swap: a swap within your Risk limits executes at once - from your own agent wallet if you have one, otherwise from the owner's Dolphin Wallet with the trade key they granted. Trade only when your instructions and the data call for it. Say exactly what the tool reports - traded, or not traded and why. Never claim a trade the tool did not report."
      : abilities.canPropose
      ? "- You cannot sign, send or move funds. You MAY propose a trade with block_propose_swap; the owner reviews it and signs it from their Dolphin Wallet. Say you proposed it - never that you traded. Propose only when your instructions and the data call for it."
      : "- You can only read. You cannot sign, send, trade or move funds, and you cannot set anything up. If a tool returned an unsigned transaction, say the person would sign it from their own wallet. Never say you did it."
  }
${
    abilities.triggered
      ? "- This run was started by one of your triggers, and the message says what happened. Check the data, decide whether it calls for action under your instructions, and report what you found and did in two or three sentences."
      : "- You answer when asked. You do not run on a schedule, watch anything, or notify anyone."
  }
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
            // Which model and which of the builder's keys - never the key.
            brain: draft.brain
              ? {
                  provider: draft.brain.provider,
                  model: draft.brain.model,
                  keyName: draft.brain.keyName,
                  baseUrl: draft.brain.baseUrl ?? null,
                }
              : null,
            blocks: (draft.blocks ?? []) as AgentBlock[],
            detached: draft.detached ?? [],
            autopilot: draft.autopilot
              ? { on: draft.autopilot.on, conversationKey: draft.autopilot.conversationKey }
              : null,
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

/** What a run needs beyond the spec: its brain (with the key's wallet), blocks and today's proposals. Internal. */
export const runtimeForDraft = internalQuery({
  args: { draftId: v.id("agentDrafts") },
  handler: async (ctx, { draftId }) => {
    const draft = await ctx.db.get(draftId);
    const today = new Date().toISOString().slice(0, 10);
    const tradeKeys = await ctx.db
      .query("agentTradeKeys")
      .withIndex("by_draft", (q) => q.eq("draftId", draftId))
      .order("desc")
      .take(3);
    const autotradeActive = tradeKeys.some((key) => key.status === "active" && key.ciphertext && key.expiry > Date.now() / 1000);
    const blocks = activeBlocks((draft?.blocks ?? []) as AgentBlock[], draft?.detached);
    // The agent's own wallet trades only while its Wallet block is plugged in.
    const ownWallet = blocks.some((block) => block.type === "wallet")
      ? await ctx.db
          .query("agentWallets")
          .withIndex("by_draft", (q) => q.eq("draftId", draftId))
          .first()
      : null;
    return {
      autotradeActive,
      agentWallet: ownWallet?.address ?? null,
      brain: draft?.brain ?? null,
      // Only what is still plugged in on the canvas.
      blocks,
      detached: draft?.detached ?? [],
      proposalsToday: draft?.proposals?.day === today ? draft.proposals.count : 0,
    };
  },
});

/** Counts one proposed swap against today's Risk limit. */
export const recordProposal = internalMutation({
  args: { draftId: v.id("agentDrafts") },
  handler: async (ctx, { draftId }) => {
    const draft = await ctx.db.get(draftId);
    if (!draft) return;
    const today = new Date().toISOString().slice(0, 10);
    const count = draft.proposals?.day === today ? draft.proposals.count + 1 : 1;
    await ctx.db.patch(draftId, { proposals: { day: today, count } });
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

/* ---------------------------------------------------------------------------
 * Editing on the canvas (2026-09-28)
 * ------------------------------------------------------------------------ */

/** Agents the tool picker shows at once. */
const PALETTE_AGENTS = 12;

/**
 * The tools a person can add to a draft by hand: read-only tools of live MCP
 * agents in the catalog, grouped by the agent that publishes them.
 *
 * The same pool the builder model is offered (toolCatalog), minus its
 * per-turn cap of four tools per agent. The web client subscribes to this only
 * while the picker is open: it reads agent rows, and a probe patching one
 * re-runs it for everyone subscribed.
 */
export const toolPalette = query({
  args: { search: v.optional(v.string()) },
  handler: async (ctx, { search }) => {
    const text = (search ?? "").trim().slice(0, 200);
    const rows =
      text.length >= 2
        ? await ctx.db
            .query("agents")
            .withSearchIndex("search_text", (q) =>
              q.search("searchText", text).eq("status", "live").eq("protocol", "mcp"),
            )
            .take(PALETTE_AGENTS)
        : await ctx.db
            .query("agents")
            .withIndex("by_status_protocol_category_rank", (q) =>
              q.eq("status", "live").eq("protocol", "mcp"),
            )
            .order("desc")
            .take(PALETTE_AGENTS);

    return rows
      .map((row) => ({
        agentKey: row.agentKey,
        agentName: row.name,
        tools: row.skills
          .filter((skill) => !isMutating(skill.name))
          .map((skill) => ({
            name: skill.name,
            description: skill.description ? skill.description.slice(0, 200) : null,
          })),
      }))
      .filter((agent) => agent.tools.length > 0);
  },
});

/**
 * A person's own edit to their draft, from the canvas.
 *
 * THE SAME RULES AS A MODEL'S EDIT, ENFORCED HERE: text is cleaned and capped
 * by agentSpec's own helpers, and every tool must be a read-only tool of a
 * live MCP agent in the catalog, within the per-draft caps. Nothing the client
 * sends is taken as a value - the tool's publisher name comes from the catalog
 * row, not the request.
 *
 * Unlike a model's edit, an empty tool list IS applied: a person removing
 * their last tool meant it. The draft then simply cannot be tried until one is
 * added back, which draftGaps already says.
 *
 * The conversation key is the capability, as for `ask`. A published agent is
 * a snapshot (builtAgents.ts), so editing here never changes a live listing.
 */
export const updateDraft = mutation({
  args: {
    conversationKey: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    instructions: v.optional(v.string()),
    tools: v.optional(v.array(v.object({ agentKey: v.string(), toolName: v.string() }))),
    /**
     * The model and key the agent thinks with. Setting one needs a signed-in
     * wallet that holds a variable of that name: a draft can only ever run on
     * its builder's own key. null clears it.
     */
    brain: v.optional(
      v.union(
        v.null(),
        v.object({
          provider: v.string(),
          model: v.string(),
          keyName: v.string(),
          baseUrl: v.optional(v.union(v.string(), v.null())),
        }),
      ),
    ),
    sessionToken: v.optional(v.string()),
    /** The whole toolbox block list; validated by lib/agentBlocks.ts. */
    blocks: v.optional(v.any()),
    /** Canvas connections cut by the builder (see `detached` in schema.ts). */
    detached: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db
      .query("dolphinConversations")
      .withIndex("by_key", (q) => q.eq("conversationKey", args.conversationKey))
      .unique();
    if (!conversation || (conversation.mode ?? "chat") !== "build") {
      throw new ConvexError("That is not an agent draft.");
    }
    const existing = await ctx.db
      .query("agentDrafts")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversation._id))
      .unique();
    const current = toSpec(existing);
    const next: DraftSpec = { ...current };

    if (args.name !== undefined) next.name = cleanLine(args.name, NAME_MAX_CHARS);
    if (args.description !== undefined) next.description = cleanLine(args.description, DESCRIPTION_MAX_CHARS);
    if (args.instructions !== undefined) next.instructions = cleanBlock(args.instructions, INSTRUCTIONS_MAX_CHARS);

    if (args.tools !== undefined) {
      if (args.tools.length > MAX_DRAFT_TOOLS) {
        throw new ConvexError(`An agent can have at most ${MAX_DRAFT_TOOLS} tools.`);
      }
      const picked: DraftSpec["tools"] = [];
      const perAgent = new Map<string, number>();
      const seen = new Set<string>();
      for (const requested of args.tools) {
        const identity = `${requested.agentKey}\u0000${requested.toolName}`;
        if (seen.has(identity)) continue;
        seen.add(identity);

        // A tool already in the draft stays even if its agent has since gone
        // quiet: the try-run reports a missing tool, and removing it is the
        // person's call. A NEW tool must come from a live catalog agent.
        const kept = current.tools.find(
          (tool) => tool.agentKey === requested.agentKey && tool.toolName === requested.toolName,
        );
        let agentName: string;
        if (kept) {
          agentName = kept.agentName;
        } else {
          const row = await ctx.db
            .query("agents")
            .withIndex("by_key", (q) => q.eq("agentKey", requested.agentKey))
            .unique();
          const skill = row?.skills.find((candidate) => candidate.name === requested.toolName);
          if (!row || row.status !== "live" || row.protocol !== "mcp" || !skill) {
            throw new ConvexError(`${requested.toolName} is not a tool of a live agent on Dolphin.`);
          }
          if (isMutating(skill.name)) {
            throw new ConvexError(`${requested.toolName} changes things on-chain, and agents built here can only read.`);
          }
          agentName = row.name;
        }

        const count = perAgent.get(requested.agentKey) ?? 0;
        if (count >= MAX_DRAFT_TOOLS_PER_AGENT) {
          throw new ConvexError(`At most ${MAX_DRAFT_TOOLS_PER_AGENT} tools can come from one agent.`);
        }
        if (count === 0 && perAgent.size >= MAX_DRAFT_AGENTS) {
          throw new ConvexError(`Tools can come from at most ${MAX_DRAFT_AGENTS} different agents.`);
        }
        perAgent.set(requested.agentKey, count + 1);
        picked.push({ agentKey: requested.agentKey, agentName, toolName: requested.toolName });
      }
      next.tools = picked;
    }

    let brain = existing?.brain;
    if (args.brain === null) brain = undefined;
    if (args.brain) {
      if (!args.sessionToken) throw new ConvexError("Sign in with your wallet to choose a key for the brain.");
      const walletAddress = await requireWalletAddress(ctx, args.sessionToken, "Choosing the brain's key");
      const model = args.brain.model.trim();
      if (!/^[A-Za-z0-9._:/-]{2,100}$/.test(model)) {
        throw new ConvexError("That model name does not look right. Use the provider's id, like gpt-4o-mini or openai/gpt-4o-mini.");
      }
      const key = await ctx.db
        .query("userEnvVars")
        .withIndex("by_wallet_name", (q) => q.eq("walletAddress", walletAddress).eq("name", args.brain!.keyName))
        .unique();
      if (!key) throw new ConvexError(`You have no key called ${args.brain.keyName}. Add it in the Keys tab first.`);
      if (!isBrainProvider(args.brain.provider)) throw new ConvexError("Choose a provider from the list.");
      let baseUrl: string | null = null;
      if (args.brain.provider === "custom") {
        try {
          const url = assertSafeUrl(customChatUrl(args.brain.baseUrl ?? ""));
          if (url.protocol !== "https:") throw new Error("https only");
          baseUrl = (args.brain.baseUrl ?? "").trim();
        } catch {
          throw new ConvexError("The custom endpoint must be a public https:// URL, e.g. https://api.example.com/v1.");
        }
      }
      brain = { provider: args.brain.provider, model, keyName: args.brain.keyName, walletAddress, baseUrl };
    }

    const blocks = args.blocks !== undefined ? validateBlocks(args.blocks) : ((existing?.blocks ?? []) as AgentBlock[]);
    let detached = existing?.detached ?? [];
    if (args.detached !== undefined) {
      if (args.detached.length > MAX_DETACHED) throw new ConvexError("Too many cut connections.");
      detached = [...new Set(args.detached.filter((id) => typeof id === "string" && id.length <= 200))];
    }

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { ...next, brain, blocks, detached, updatedAt: now });
      // An armed agent's triggers follow its blocks - and its connections - at once.
      if ((args.blocks !== undefined || args.detached !== undefined) && existing.autopilot?.on) {
        await syncTriggers(ctx, existing._id, activeBlocks(blocks, detached), true);
      }
    } else {
      await ctx.db.insert("agentDrafts", {
        conversationId: conversation._id,
        ownerAddress: conversation.ownerAddress ?? null,
        ...next,
        // The first save of a new draft must keep its brain too (it was dropped, found by test 2026-09-28).
        brain,
        blocks,
        detached,
        createdAt: now,
        updatedAt: now,
      });
    }
    return { gaps: draftGaps(next) };
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
export async function runTryTurn(
  ctx: ActionCtx,
  {
    conversationKey,
    text,
    userAddress,
    triggered = false,
  }: { conversationKey: string; text: string; userAddress?: string; triggered?: boolean },
): Promise<{ messageId: Id<"dolphinMessages"> }> {
    // Autopilot runs have their own daily cap (convex/autopilot.ts).
    const turns = triggered ? 0 : await ctx.runQuery(internal.agentBuilder.userTurnCount, { conversationKey });
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
       * THE BRAIN IS THE BUILDER'S OWN (owner, 2026-09-28: "we are not giving
       * anybody free agents"). No brain, no run - never a silent fallback to
       * Dolphin's model. The key is decrypted here, used for this turn's calls,
       * and never written anywhere or returned.
       */
      const runtime = draftId ? await ctx.runQuery(internal.agentBuilder.runtimeForDraft, { draftId }) : null;
      const brain = runtime?.brain ?? null;
      const blocks = runtime?.blocks ?? [];
      let proposalsToday = runtime?.proposalsToday ?? 0;
      const canExecute = Boolean(runtime?.agentWallet) || Boolean(runtime?.autotradeActive);
      const blockTools = blockToolDefinitions(blocks, canExecute ? "execute" : "propose");
      let ticket: unknown = undefined;
      // What the run did with money, for the record written to memory afterwards.
      const tradeLines: string[] = [];
      const apiKey = brain
        ? await ctx.runAction(internal.envVars.reveal, { walletAddress: brain.walletAddress, name: brain.keyName })
        : null;
      if (!brain || !apiKey) {
        await ctx.runMutation(internal.dolphin.setMessageStatus, {
          messageId: assistantId,
          status: "error",
          errorReason: !brain
            ? "This agent has no brain yet. Add your model's API key in the Keys tab, then choose it on the Brain block."
            : `The key ${brain.keyName} is gone from your Keys. Add it again, or choose another on the Brain block.`,
          errorKind: "input",
        });
        return { messageId: assistantId };
      }
      if (!isBrainProvider(brain.provider)) {
        await ctx.runMutation(internal.dolphin.setMessageStatus, {
          messageId: assistantId,
          status: "error",
          errorReason: "This agent's brain names a provider Dolphin does not know. Choose one on the Brain block.",
          errorKind: "input",
        });
        return { messageId: assistantId };
      }
      const endpoint = { provider: brain.provider, apiKey, model: brain.model, baseUrl: brain.baseUrl ?? null };

      /*
       * MEMORY, from the builder's own server (lib/agentMemory.ts). Read before
       * the run so a scheduled agent knows what it did last time. Down or
       * refusing: the run goes on and the agent is told so.
       */
      const memoryBlock = blocks.find((block) => block.type === "memory");
      let memoryTarget: MemoryTarget | null = null;
      let memoryNote = "";
      if (memoryBlock && memoryBlock.type === "memory" && draftId) {
        const memoryKey: string | null = memoryBlock.config.keyName
          ? await ctx.runAction(internal.envVars.reveal, { walletAddress: brain.walletAddress, name: memoryBlock.config.keyName })
          : null;
        memoryTarget = { url: memoryBlock.config.url, key: memoryKey, agent: draftId };
        try {
          memoryNote = `\n\n${memoryBrief(await recall(memoryTarget))}`;
        } catch (cause) {
          memoryNote = `\n\nYOUR MEMORY could not be reached this run (${cause instanceof Error ? cause.message : "no answer"}). Say so if it matters, and do not assume what you did before.`;
        }
      }

      /*
       * The menu is the draft's tools and nothing else. An agent that has left
       * the catalog, or a tool its server no longer lists, is named to the
       * model as unreachable rather than silently dropped.
       */
      // Tools cut on the canvas are not offered.
      const cutTools = new Set(runtime?.detached ?? []);
      draft.tools = draft.tools.filter((tool) => !cutTools.has(toolMemberId(tool)));
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
        { role: "system", content: `${TRY_CONSULT_PROMPT}${addressNote}${memoryNote}` },
        ...history,
        { role: "user", content: text },
      ];

      const allTools = [...menu.tools, ...blockTools];
      let callsRemaining = MAX_TOOL_CALLS_PER_TURN;
      if (allTools.length > 0) {
        await ctx.runMutation(internal.dolphin.setMessageStatus, {
          messageId: assistantId,
          status: "consulting",
        });
        try {
          for (let round = 0; round < MAX_TOOL_ROUNDS && callsRemaining > 0; round++) {
            const turn = await chatCompletion({ messages, tools: allTools, toolChoice: "auto", endpoint });
            /* Consult prose is never carried forward. See the same note in dolphin.ask. */
            if (turn.toolCalls.length === 0) break;
            const batch = turn.toolCalls.slice(0, callsRemaining);
            callsRemaining -= batch.length;
            // The provider's own blocks ride along (Anthropic thinking between tool calls).
            messages.push({ role: "assistant", content: null, tool_calls: batch, providerContent: turn.providerContent });

            /*
             * Built-in block tools run here, recorded exactly like an MCP call
             * (before, then completed) so the transcript and the live canvas
             * show them. The block's id is the "agent", so the canvas can light
             * its block.
             */
            for (const call of batch.filter((c) => c.function.name.startsWith("block_"))) {
              const block = blocks.find(
                (candidate) =>
                  call.function.name === blockToolNameFor(candidate.type) ||
                  (candidate.type === "memory" && (call.function.name === "block_remember" || call.function.name === "block_recall")),
              );
              const started = Date.now();
              const toolCallId = await ctx.runMutation(internal.dolphin.recordToolCall, {
                conversationId,
                messageId: assistantId,
                agentKey: `block:${block?.id ?? "unknown"}`,
                agentName: block ? BLOCK_LABELS[block.type] : "Dolphin",
                toolName: call.function.name,
                argumentsJson: call.function.arguments || "{}",
              });
              const result =
                call.function.name === "block_hire_agent"
                  ? await askToHire(ctx, blocks, call.function.arguments)
                  : call.function.name === "block_remember" || call.function.name === "block_recall"
                    ? await useMemory(memoryTarget, call.function.name, call.function.arguments)
                    : await runBlockTool(blocks, call.function.name, call.function.arguments, proposalsToday);
              if (!result.isError && /^(Traded|Proposed|Not traded)/.test(result.text)) tradeLines.push(result.text.slice(0, 240));
              if (result.ticket && (result.ticket as { kind?: string }).kind === "hire") {
                // A paid hire always waits for the owner's passkey.
                ticket = result.ticket;
              } else if (result.ticket && draftId) {
                proposalsToday += 1;
                await ctx.runMutation(internal.agentBuilder.recordProposal, { draftId });
                /*
                 * NO-TAP TRADING. With the agent's own Wallet block plugged in, the
                 * swap executes from that wallet (convex/agentWallet.ts). Otherwise,
                 * with a live trade key, from the owner's Dolphin Wallet inside the
                 * limits its contract enforces (convex/autotrade.ts). Anything that
                 * stops it leaves the ticket for the owner to sign.
                 */
                const swapTicket = result.ticket as {
                  kind: "swap";
                  amountIn: string;
                  tokenIn: { address: string | null; symbol: string; decimals: number; verified: boolean };
                  tokenOut: { address: string | null; symbol: string; decimals: number; verified: boolean };
                  safety: null;
                };
                const auto: { attempted: boolean; executed: boolean; text: string } = runtime?.agentWallet
                  ? await ctx.runAction(internal.agentWallet.executeTrade, { draftId, agentName: draft.name ?? "Agent", ticket: swapTicket })
                  : await ctx.runAction(internal.autotrade.executeTrade, { draftId, agentName: draft.name ?? "Agent", ticket: swapTicket });
                if (auto.executed) {
                  result.text = auto.text;
                } else {
                  ticket = result.ticket;
                  if (auto.attempted) result.text = `${auto.text} It is waiting as a ticket for the owner to sign instead.`;
                }
              }
              await ctx.runMutation(internal.dolphin.completeToolCall, {
                toolCallId,
                resultText: result.text,
                isError: result.isError,
                transportError: null,
                latencyMs: Date.now() - started,
              });
              messages.push({ role: "tool", tool_call_id: call.id, content: result.text });
            }
            const mcpCalls = batch.filter((c) => !c.function.name.startsWith("block_"));
            if (mcpCalls.length > 0) {
              await executeToolCalls(ctx, {
                conversationId,
                messageId: assistantId,
                toolCalls: mcpCalls,
                menu,
                messages,
              });
            }
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

      let system = `${tryAnswerPrompt(draft, {
        canPropose: blocks.some((block) => block.type === "swap"),
        canTrade: canExecute,
        triggered,
      })}${addressNote}${memoryNote}`;
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

      // Tools stay declared (but unusable) so a history of tool calls stays valid for every provider.
      const final = await chatCompletion({
        messages,
        endpoint,
        ...(allTools.length > 0 ? { tools: allTools, toolChoice: "none" as const } : {}),
      });
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
        // A proposed swap rides on the answer as a ticket the owner signs.
        ...(ticket ? { ticket } : {}),
      });
      if (memoryTarget) {
        const record =
          `${triggered ? "Triggered run" : "Asked"}: ${text.replace(/\s+/g, " ").slice(0, 200)} | ` +
          (tradeLines.length ? `${tradeLines.join(" ")} | ` : "") +
          `Answered: ${content.replace(/\s+/g, " ").slice(0, 400)}`;
        await remember(memoryTarget, record, "run").catch((cause) => console.warn("[agentBuilder] memory record not written:", cause));
      }
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
}

const BLOCK_LABELS: Record<AgentBlock["type"], string> = {
  market: "Market",
  safety: "Safety check",
  swap: "Swap",
  risk: "Risk",
  schedule: "Schedule",
  price: "Price trigger",
  walletWatch: "Wallet watch",
  wallet: "Wallet",
  hire: "Hired agent",
  memory: "Memory",
};

function blockToolNameFor(type: AgentBlock["type"]): string | null {
  return type === "market"
    ? "block_market_snapshot"
    : type === "safety"
      ? "block_token_safety"
      : type === "swap"
        ? "block_propose_swap"
        : type === "hire"
          ? "block_hire_agent"
          : null;
}

/** block_remember / block_recall against the builder's own memory server. */
async function useMemory(target: MemoryTarget | null, name: string, rawArgs: string): Promise<BlockToolResult> {
  if (!target) return { text: "This agent has no Memory block.", isError: true };
  let args: { text?: unknown; query?: unknown } = {};
  try {
    args = JSON.parse(rawArgs || "{}");
  } catch {
    return { text: "The arguments were not valid JSON.", isError: true };
  }
  try {
    if (name === "block_remember") {
      const note = typeof args.text === "string" ? args.text : "";
      if (note.trim().length < 3) return { text: "Say what to remember.", isError: true };
      await remember(target, note, "note");
      return { text: "Saved to memory.", isError: false };
    }
    const found = await recall(target, { query: typeof args.query === "string" ? args.query : undefined });
    return { text: found.length ? memoryBrief(found) : "Nothing in memory matches that.", isError: false };
  } catch (cause) {
    return { text: `Memory could not be reached: ${cause instanceof Error ? cause.message : String(cause)}.`, isError: true };
  }
}

/**
 * block_hire_agent: asks the Hire block's agent for a price for the task, over
 * the same negotiation a hire from its page uses (agentPayments.requestQuote,
 * so the flow knocks on the same door). Nothing is paid here: the answer
 * carries a hire ticket, and the owner confirms paying it with their passkey.
 */
async function askToHire(ctx: ActionCtx, blocks: readonly AgentBlock[], rawArgs: string): Promise<BlockToolResult> {
  const hire = blocks.find((block) => block.type === "hire");
  if (!hire || hire.type !== "hire") return { text: "This agent has no Hire block.", isError: true };
  let task = "";
  try {
    task = String((JSON.parse(rawArgs || "{}") as { task?: unknown }).task ?? "").trim().slice(0, 600);
  } catch {
    return { text: "The arguments were not valid JSON.", isError: true };
  }
  if (task.length < 4) return { text: "Say what the agent should do.", isError: true };
  try {
    const quote: { priceRaw: string; paymentTokenSymbol: string; paymentTokenDecimals: number } = await ctx.runAction(
      api.agentPayments.requestQuote,
      { agentKey: hire.config.agentKey, taskDescription: task },
    );
    const priceText = `${formatUnits(BigInt(quote.priceRaw), quote.paymentTokenDecimals)} ${quote.paymentTokenSymbol}`;
    return {
      text: `${hire.config.agentName} quoted ${priceText} for this task. The owner decides whether to pay it from their Dolphin Wallet; the agent delivers after that, on-chain - not in this conversation.`,
      isError: false,
      ticket: { kind: "hire", agentKey: hire.config.agentKey, agentName: hire.config.agentName, task, priceText },
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message.replace(/^[\s\S]*?Uncaught Error:\s*/, "").split("\n")[0] : String(cause);
    return { text: `${hire.config.agentName} did not quote: ${message.slice(0, 300)}`, isError: true };
  }
}

export const tryAsk = action({
  args: {
    conversationKey: v.string(),
    text: v.string(),
    userAddress: v.optional(v.string()),
  },
  handler: (ctx, args): Promise<{ messageId: Id<"dolphinMessages"> }> => runTryTurn(ctx, args),
});

/** A run started by an armed trigger (convex/autopilot.ts). Internal: no client can start one. */
export const runTriggeredTurn = internalAction({
  args: { conversationKey: v.string(), text: v.string() },
  handler: (ctx, args): Promise<{ messageId: Id<"dolphinMessages"> }> => runTryTurn(ctx, { ...args, triggered: true }),
});
