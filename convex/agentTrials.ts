import { v } from "convex/values";

import { api, internal } from "./_generated/api";
import {
  action,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { callMcpTool, listMcpTools, openMcpSession } from "./lib/mcpClient";
import { readExecutionCapability } from "./lib/toolCapability";

/**
 * ===========================================================================
 * RUNNING AN AGENT BEFORE YOU COMMIT TO ANYTHING
 * ===========================================================================
 * The catalog could describe an agent and never show one working. To get
 * anything back a visitor had to connect a wallet, sign a message and record a
 * hire - and a hire writes a database row, so the honest answer to "what do I
 * get" was "nothing you can see". Every cost sat before the payoff and the
 * payoff was absent.
 *
 * This makes a listing demonstrate itself: one click, no wallet, no signature,
 * no payment, and the agent's own output on the page.
 *
 * ===========================================================================
 * THE SAFETY ARGUMENT, WHICH IS THE WHOLE DESIGN
 * ===========================================================================
 * This is an UNAUTHENTICATED endpoint that causes an outbound call to a third
 * party. That is the shape of an abuse primitive, so it is fenced four ways
 * and each fence is load-bearing:
 *
 * 1. ZERO ARGUMENTS. Only a tool whose input schema requires nothing may be
 *    run. The caller supplies a tool NAME and nothing else - there is no path
 *    by which a visitor's text reaches a stranger's server through Dolphin.
 *    This also removes the whole injection surface rather than filtering it.
 * 2. NO WRITE TOOLS. Checked with `readExecutionCapability` against the
 *    agent's OWN published tool list, not against the name the caller sent.
 *    Note this is stricter than `buildAgentTransaction`, which permits
 *    calldata builders: a transaction builder is safe when a human is about to
 *    inspect and sign the result, and is not something to fire anonymously
 *    from a browse page.
 * 3. CACHED. A trial inside the TTL is served from the table and never reaches
 *    the publisher. One tool can be invoked at most once per TTL however many
 *    people press the button - which bounds Dolphin's cost and is a courtesy
 *    to a seller who did not ask to be a demo.
 * 4. GLOBALLY CAPPED. Beyond the per-tool cache there is a ceiling on trials
 *    per minute across the entire deployment, so a script walking every
 *    listing hits a wall rather than a bill.
 *
 * The 2026-09-06 audit flagged `refreshAgentCategoryStats` as an open
 * amplification endpoint against the RPC quota. This is the same shape,
 * deliberately fenced, because a Run button is designed to be pressed.
 */

/**
 * How long a result stands in for a fresh call.
 *
 * Five minutes is chosen against what these tools return - pool state, rates,
 * rankings - which move on market time rather than block time. Long enough
 * that a page being shared does not become a load test, short enough that the
 * number on screen is still worth reading. The age is always shown, so a
 * cached answer is never passed off as a live one.
 */
const TRIAL_TTL_MS = 5 * 60 * 1000;

/** Global ceiling, across every agent and tool. */
const GLOBAL_TRIALS_PER_WINDOW = 30;
const GLOBAL_WINDOW_MS = 60 * 1000;

/** Stored output is a citation, not an archive. Matches dolphin.ts's ceiling. */
const MAX_RESULT_CHARS = 4_000;

export type TrialOutcome = {
  agentName: string;
  toolName: string;
  /** The agent's own words. ALWAYS render attributed - never as Dolphin's. */
  resultText: string;
  /** The agent answered and said the call failed. Still an answer. */
  isError: boolean;
  /** Set when the call could not be made at all, which is a different thing. */
  transportError: string | null;
  latencyMs: number;
  calledAt: number;
  /** True when served from the table. The UI says so rather than implying live. */
  cached: boolean;
};

/** Only what this module reads. Annotated to break the api-inference cycle (TS7022). */
type TrialAgent = {
  name: string;
  protocol: "a2a" | "mcp";
  skills: { name: string }[];
  /**
   * The MCP server, independent of `protocol` - an agent can run both
   * transports. See mcpEndpointFor in lib/publicAgent.ts.
   */
  mcpEndpoint: string | null;
  previewableTools: string[];
};

/* ---------------------------------------------------------------------------
 * Internals
 * ------------------------------------------------------------------------ */

export const cachedTrial = internalQuery({
  args: { agentKey: v.string(), toolName: v.string() },
  handler: async (ctx, { agentKey, toolName }) =>
    ctx.db
      .query("agentToolTrials")
      .withIndex("by_agent_tool", (q) =>
        q.eq("agentKey", agentKey).eq("toolName", toolName),
      )
      .unique(),
});

export const recentTrialCount = internalQuery({
  args: {},
  handler: async (ctx): Promise<number> => {
    const since = Date.now() - GLOBAL_WINDOW_MS;
    const rows = await ctx.db
      .query("agentToolTrials")
      .withIndex("by_called_at", (q) => q.gt("calledAt", since))
      .take(GLOBAL_TRIALS_PER_WINDOW + 1);
    return rows.length;
  },
});

export const writeTrial = internalMutation({
  args: {
    agentKey: v.string(),
    toolName: v.string(),
    resultText: v.string(),
    isError: v.boolean(),
    transportError: v.union(v.string(), v.null()),
    latencyMs: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agentToolTrials")
      .withIndex("by_agent_tool", (q) =>
        q.eq("agentKey", args.agentKey).eq("toolName", args.toolName),
      )
      .unique();

    const row = { ...args, calledAt: Date.now() };

    /*
     * One row per (agent, tool), replaced rather than appended. The history of
     * what a tool said an hour ago is not evidence of anything - it is a
     * stranger's prose about a moving number - and the 2026-09-06 storage
     * incident is the standing reminder that a row written per event is how
     * this deployment blew past its ceiling. Persist what costs a round trip;
     * re-derive what does not.
     */
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("agentToolTrials", row);
  },
});

/* ---------------------------------------------------------------------------
 * Public
 * ------------------------------------------------------------------------ */

/**
 * The last thing this tool said, if anything has run it recently.
 *
 * Lets a page render a previous result immediately instead of an empty frame,
 * with its age attached. Returns null rather than a placeholder: "nothing has
 * been run yet" is a real state and the UI says so.
 */
export const lastTrial = query({
  args: { agentKey: v.string(), toolName: v.string() },
  returns: v.union(
    v.object({
      resultText: v.string(),
      isError: v.boolean(),
      transportError: v.union(v.string(), v.null()),
      latencyMs: v.number(),
      calledAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, { agentKey, toolName }) => {
    const row = await ctx.db
      .query("agentToolTrials")
      .withIndex("by_agent_tool", (q) =>
        q.eq("agentKey", agentKey).eq("toolName", toolName),
      )
      .unique();

    if (!row) return null;
    return {
      resultText: row.resultText,
      isError: row.isError,
      transportError: row.transportError,
      latencyMs: row.latencyMs,
      calledAt: row.calledAt,
    };
  },
});

export const tryAgentTool = action({
  args: { agentKey: v.string(), toolName: v.string() },
  handler: async (ctx, { agentKey, toolName }): Promise<TrialOutcome> => {
    const agent = (await ctx.runQuery(api.agents.get, {
      reference: agentKey,
    })) as TrialAgent | null;

    if (!agent) {
      throw new Error("That agent is not in Dolphin's catalog.");
    }
    /*
     * Gated on the MCP SURFACE, not on the primary protocol. An agent whose
     * primary transport is A2A can still run an MCP server, and refusing it
     * here on `protocol !== "mcp"` was the same collapse the probe used to
     * make - see the dual-protocol note in lib/probe.ts.
     */
    if (!agent.mcpEndpoint) {
      throw new Error(
        `${agent.name} runs no MCP server that Dolphin has reached. A2A agents are commissioned ` +
          "over ERC-8183 escrow and deliver a result; they publish no tools to call directly.",
      );
    }

    /*
     * FENCE 2, before anything else and before any network call. Checked
     * against the agent's own published list, never against the caller's word.
     */
    const capability = readExecutionCapability(
      agent.skills.map((skill) => ({ name: skill.name })),
      "mcp",
    );
    if (capability.writeTools.includes(toolName)) {
      throw new Error(
        `${toolName} can change on-chain state, so Dolphin will not run it from a preview. ` +
          "Only read-only tools can be tried without a wallet.",
      );
    }
    if (!agent.skills.some((skill) => skill.name === toolName)) {
      throw new Error(`${agent.name} publishes no tool called ${toolName}.`);
    }

    /* FENCE 3. Served from the table; the publisher is never contacted. */
    const cached = await ctx.runQuery(internal.agentTrials.cachedTrial, {
      agentKey,
      toolName,
    });
    if (cached && Date.now() - cached.calledAt < TRIAL_TTL_MS) {
      return {
        agentName: agent.name,
        toolName,
        resultText: cached.resultText,
        isError: cached.isError,
        transportError: cached.transportError,
        latencyMs: cached.latencyMs,
        calledAt: cached.calledAt,
        cached: true,
      };
    }

    /* FENCE 4. A script walking the catalog meets a wall, not a bill. */
    const recent = await ctx.runQuery(internal.agentTrials.recentTrialCount, {});
    if (recent >= GLOBAL_TRIALS_PER_WINDOW) {
      throw new Error(
        "Dolphin is running a lot of previews right now. Try again in a minute — this limit " +
          "exists so a browse page cannot be turned into load on someone else's server.",
      );
    }

    const endpoint = agent.mcpEndpoint;

    const startedAt = Date.now();

    try {
      const session = await openMcpSession(endpoint);

      /*
       * FENCE 1. The schema is the only thing that says what is legal, and it
       * is read from the SERVER rather than from Dolphin's stored copy - the
       * catalog keeps names and descriptions, not schemas, and a tool's
       * signature can change between probes.
       *
       * A tool with any required input is refused rather than guessed at.
       * Filling in a plausible argument would mean Dolphin inventing a value
       * and presenting whatever came back as that agent's answer.
       */
      const tools = await listMcpTools(session);
      const tool = tools.find((candidate) => candidate.name === toolName);
      if (!tool) {
        throw new Error(
          `${agent.name}'s server no longer lists a tool called ${toolName}.`,
        );
      }

      const required = Array.isArray(
        (tool.inputSchema as { required?: unknown } | null)?.required,
      )
        ? ((tool.inputSchema as { required: string[] }).required)
        : [];

      if (required.length > 0) {
        throw new Error(
          `${toolName} needs ${required.join(", ")} to run. Dolphin only previews tools that take ` +
            "no input, so a preview cannot put words in your mouth or invent a value for you.",
        );
      }

      const result = await callMcpTool(session, toolName, {});
      const latencyMs = Date.now() - startedAt;
      const resultText = result.text.slice(0, MAX_RESULT_CHARS);

      await ctx.runMutation(internal.agentTrials.writeTrial, {
        agentKey,
        toolName,
        resultText,
        isError: result.isError,
        transportError: null,
        latencyMs,
      });

      return {
        agentName: agent.name,
        toolName,
        resultText,
        isError: result.isError,
        transportError: null,
        latencyMs,
        calledAt: Date.now(),
        cached: false,
      };
    } catch (cause) {
      const latencyMs = Date.now() - startedAt;
      const message = cause instanceof Error ? cause.message : String(cause);

      /*
       * A transport failure is RECORDED, not just thrown. "Dolphin called this
       * and could not reach it" is exactly the kind of fact this product
       * exists to publish, and it is also what stops a dead endpoint being
       * retried on every click - the row is written, so the cache absorbs the
       * next visitor.
       */
      await ctx.runMutation(internal.agentTrials.writeTrial, {
        agentKey,
        toolName,
        resultText: "",
        isError: true,
        transportError: message.slice(0, 500),
        latencyMs,
      });

      throw cause;
    }
  },
});
