import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { TRY_CONSULT_PROMPT, tryAnswerPrompt } from "./agentBuilder";
import { apiBase, NETWORKS, siteBase } from "./builtAgents";
import { digestToolResult, stripRawPayloads } from "./lib/answerHygiene";
import { buildToolMenu, type CandidateAgent } from "./lib/decisionTools";
import { looksLikeLeakedReasoning } from "./lib/leakedReasoning";
import { McpError, callMcpTool, listMcpTools, openMcpSession, MCP_PROTOCOL_VERSION } from "./lib/mcpClient";
import { OpenRouterError, chatCompletion, isBrainProvider, type BrainEndpoint, type ChatMessage } from "./lib/openrouter";
import { isMutating } from "./lib/toolCapability";
import { U_TOKEN, X402_NETWORK, formatU } from "./lib/x402";

/**
 * WHAT A BUILT AGENT SERVES TO THE WORLD. (2026-09-26, owner's choice "C")
 *
 * Under https://<api base>/api/v1/built/<hash>/ (convex/http.ts):
 *
 *   registration.json  the ERC-8004 registration file its token points at
 *   icon               its icon, as redrawn by iconProcessing
 *   agent-card.json    (A2A listings) its A2A agent card
 *   a2a                (A2A listings) A2A JSON-RPC: message/send in, answer out
 *   mcp                (MCP listings) an MCP server with BOTH:
 *                        - its chosen tools, passed through to the agents that
 *                          publish them (no model, so they always work), and
 *                        - `ask`: its own instructions answering a question,
 *                          through the same consult-then-answer loop as the
 *                          owner's private try-run.
 *
 * Every pass-through is re-checked read-only (isMutating) at call time, and
 * `ask` is capped per agent per day: each one spends model calls from the
 * account-wide free budget (50 a day as measured 2026-09-26).
 *
 * PAID AGENTS (2026-10-02). A listing with a priceRaw charges per call with
 * x402 in U (convex/http.ts does the 402, lib/x402.ts and x402.ts the
 * payment). A paid call runs on the BUILDER'S own brain - their provider,
 * model and key - so Dolphin's free model budget is never resold; only a
 * listing with no usable brain falls back to Dolphin's model and its cap.
 */

export const HASH_PATTERN = /^d[0-9a-f]{15}$/;
const MAX_ASKS_PER_AGENT_PER_DAY = 25;
const MAX_QUESTION_CHARS = 2_000;
const MAX_TOOL_ROUNDS = 2;
const MAX_TOOL_CALLS = 6;

type Listing = Doc<"builtAgents">;

/* ---------------------------------------------------------------------------
 * Registration file (ERC-8004 registration-v1)
 * ------------------------------------------------------------------------ */

export function registrationFile(listing: Listing) {
  const base = `${apiBase()}/api/v1/built/${listing.hash}`;
  // "Just for me": registered to the owner's wallet, with no public door to call and no public page.
  const isPrivate = listing.purpose === "private";
  const services: Array<Record<string, unknown>> = isPrivate
    ? []
    : [
        { name: "web", endpoint: `${siteBase()}/agent/${listing.hash}` },
        listingProtocol(listing) === "a2a"
          ? { name: "A2A", endpoint: `${base}/agent-card.json`, version: A2A_PROTOCOL_VERSION }
          : { name: "MCP", endpoint: `${base}/mcp`, version: MCP_PROTOCOL_VERSION },
      ];
  // ERC-8004's agent-wallet form: where this agent is paid. The builder's own address.
  if (listing.payoutAddress) services.push({ name: "agentWallet", endpoint: `eip155:${listing.chainId}:${listing.payoutAddress}` });
  if (listing.links.email) services.push({ name: "email", endpoint: listing.links.email });
  if (listing.links.website) services.push({ name: "website", endpoint: listing.links.website });
  if (listing.links.x) services.push({ name: "x", endpoint: `https://x.com/${listing.links.x}` });

  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: listing.name,
    description: listing.description,
    image: `${base}/icon`,
    services,
    x402Support: Boolean(listing.priceRaw) && !isPrivate,
    active: listing.status !== "unpublished" && !isPrivate,
    registrations: listing.tokenId
      ? [{ agentId: Number(listing.tokenId), agentRegistry: `eip155:${listing.chainId}:${listing.registry}` }]
      : [],
    supportedTrust: ["reputation"],
    /*
     * Provenance in its own field, NEVER in the description: every built agent
     * sharing a "Built on Dolphin" line is exactly the template shape
     * lib/screen.ts rejects from other platforms.
     */
    builtWith: { platform: "Dolphin", url: siteBase(), network: NETWORKS[listing.network].label },
    category: listing.category,
    /*
     * "Others can hire it": the builder's asking price, stated honestly as not
     * yet open - paid delivery needs a signer Dolphin will not hold.
     */
    // What a call costs, for anyone reading the file before calling (the 402 says the same).
    ...(listing.priceRaw && !isPrivate
      ? {
          pricing: {
            model: "per-call",
            amount: listing.priceRaw,
            display: `${formatU(listing.priceRaw)} U`,
            asset: U_TOKEN,
            network: X402_NETWORK,
            payTo: listing.payoutAddress ?? listing.ownerAddress,
          },
        }
      : {}),
    // Listings from before per-call pricing kept their asking price, honestly marked as not open.
    ...(listing.purpose === "hire" && !listing.priceRaw ? { hire: { priceUsd: listing.hirePriceUsd ?? null, paidDeliveryOpen: false } } : {}),
  };
}

export const A2A_PROTOCOL_VERSION = "0.3.0";

/** Listings made before the protocol field are MCP. */
export function listingProtocol(listing: Listing): "mcp" | "a2a" {
  return listing.protocol ?? "mcp";
}

/** Who a paid call's U goes to: the payout wallet, or the owner when none was given. */
export function payTo(listing: Listing): string {
  return listing.payoutAddress ?? listing.ownerAddress;
}

/**
 * Whether this one message is a paid call. Only the call that does work is
 * charged; initialize, tools/list, ping and the agent card stay free, so
 * clients - and Dolphin's own probe - can see what is for sale.
 */
export function isPaidCall(listing: Listing, message: RpcRequest): boolean {
  if (!listing.priceRaw || message.id === undefined) return false;
  return listingProtocol(listing) === "a2a" ? message.method === "message/send" : message.method === "tools/call";
}

/* ---------------------------------------------------------------------------
 * A2A (2026-10-02): one skill, `ask`, answered by the same loop as MCP's ask.
 * ------------------------------------------------------------------------ */

export function agentCard(listing: Listing) {
  const base = `${apiBase()}/api/v1/built/${listing.hash}`;
  return {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name: listing.name,
    description: listing.description,
    url: `${base}/a2a`,
    preferredTransport: "JSONRPC",
    version: "1.0.0",
    iconUrl: `${base}/icon`,
    provider: { organization: "Built on Dolphin", url: siteBase() },
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [
      {
        id: "ask",
        name: listing.name,
        description: listing.description,
        tags: [listing.category],
        inputModes: ["text/plain"],
        outputModes: ["text/plain"],
      },
    ],
    ...(listing.priceRaw
      ? { pricing: { model: "per-call", amount: listing.priceRaw, display: `${formatU(listing.priceRaw)} U`, asset: U_TOKEN, network: X402_NETWORK, payTo: payTo(listing) } }
      : {}),
  };
}

/** The text of an A2A message: its text parts, plus a wallet from a data part when given. */
function a2aInput(params: Record<string, unknown> | undefined): { text: string; wallet: string | null } {
  const message = (params?.message ?? {}) as { parts?: Array<Record<string, unknown>> };
  let text = "";
  let wallet: string | null = null;
  for (const part of Array.isArray(message.parts) ? message.parts : []) {
    if ((part.kind === "text" || part.type === "text") && typeof part.text === "string") text += `${text ? "\n" : ""}${part.text}`;
    const data = part.data as Record<string, unknown> | undefined;
    if ((part.kind === "data" || part.type === "data") && data && typeof data === "object") {
      if (typeof data.wallet === "string" && /^0x[0-9a-fA-F]{40}$/.test(data.wallet)) wallet = data.wallet;
      if (!text && typeof data.question === "string") text = data.question;
    }
  }
  return { text: text.trim().slice(0, MAX_QUESTION_CHARS), wallet };
}

/** One A2A JSON-RPC message in, one out. A failed answer is a JSON-RPC error, so a paid call is not charged. */
export async function handleA2A(ctx: ActionCtx, listing: Listing, message: RpcRequest): Promise<Record<string, unknown> | null> {
  const id = message.id ?? null;
  const error = (code: number, text: string) => ({ jsonrpc: "2.0", id, error: { code, message: text } });
  if (message.id === undefined) return null;

  switch (message.method) {
    case "message/send": {
      const { text, wallet } = a2aInput(message.params);
      if (!text) return error(-32602, "Send a message with a text part.");
      const result = await ask(ctx, listing, text, wallet);
      const answer = result.content[0]?.text ?? "";
      if (result.isError) return error(-32603, answer);
      const contextId = typeof (message.params?.message as { contextId?: unknown } | undefined)?.contextId === "string"
        ? ((message.params?.message as { contextId: string }).contextId)
        : crypto.randomUUID();
      return {
        jsonrpc: "2.0",
        id,
        result: { kind: "message", role: "agent", messageId: crypto.randomUUID(), contextId, parts: [{ kind: "text", text: answer }] },
      };
    }
    case "tasks/get":
    case "tasks/cancel":
      // Every answer is returned directly as a message; there are no tasks to look up.
      return error(-32001, "Task not found.");
    default:
      return error(-32601, `Method not found: ${message.method ?? "(none)"}`);
  }
}

/* ---------------------------------------------------------------------------
 * MCP
 * ------------------------------------------------------------------------ */

/** The public name of one of the agent's tools: "<source>_<tool>", MCP-safe and unique. */
function toolNames(listing: Listing): Map<string, Listing["tools"][number]> {
  const names = new Map<string, Listing["tools"][number]>();
  for (const tool of listing.tools) {
    const source = tool.agentName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24);
    let name = `${source}_${tool.toolName.replace(/[^a-zA-Z0-9_-]/g, "_")}`.slice(0, 60);
    for (let n = 2; names.has(name); n++) name = `${name.slice(0, 57)}_${n}`;
    names.set(name, tool);
  }
  return names;
}

async function liveSources(ctx: ActionCtx, listing: Listing): Promise<CandidateAgent[]> {
  const rows = await ctx.runQuery(internal.agentBuilder.toolAgents, {
    agentKeys: [...new Set(listing.tools.map((tool) => tool.agentKey))],
  });
  return rows
    .filter((row) => row.status === "live" && row.protocol === "mcp")
    .map(({ agentKey, name, endpoint, protocol }) => ({ agentKey, name, endpoint, protocol }));
}

const ASK_TOOL = {
  name: "ask",
  description: "Ask this agent a question. It answers using its own instructions and tools.",
  inputSchema: {
    type: "object",
    properties: {
      question: { type: "string", maxLength: MAX_QUESTION_CHARS },
      /** Optional: the asker's wallet, for questions about their own positions. */
      wallet: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
    },
    required: ["question"],
  },
};

async function listTools(ctx: ActionCtx, listing: Listing) {
  const tools: Array<Record<string, unknown>> = [ASK_TOOL];
  const sources = await liveSources(ctx, listing);
  const names = toolNames(listing);

  for (const source of sources) {
    try {
      const session = await openMcpSession(source.endpoint);
      const published = await listMcpTools(session);
      for (const [name, tool] of names) {
        if (tool.agentKey !== source.agentKey || isMutating(tool.toolName)) continue;
        const live = published.find((candidate) => candidate.name === tool.toolName);
        if (!live) continue;
        tools.push({
          name,
          description: `[via ${source.name}] ${live.description ?? tool.toolName}`.slice(0, 1024),
          inputSchema: live.inputSchema ?? { type: "object", properties: {} },
        });
      }
    } catch {
      /* A source that is down contributes no tools; `ask` still answers. */
    }
  }
  return tools;
}

async function callPassThrough(ctx: ActionCtx, listing: Listing, name: string, args: Record<string, unknown>) {
  const tool = toolNames(listing).get(name);
  if (!tool) return { content: [{ type: "text", text: `No tool named ${name}.` }], isError: true };
  if (isMutating(tool.toolName)) return { content: [{ type: "text", text: "That tool is not available." }], isError: true };

  const source = (await liveSources(ctx, listing)).find((candidate) => candidate.agentKey === tool.agentKey);
  if (!source) {
    return { content: [{ type: "text", text: `${tool.agentName} is not listed on Dolphin right now, so ${tool.toolName} is unavailable.` }], isError: true };
  }
  try {
    const session = await openMcpSession(source.endpoint);
    const result = await callMcpTool(session, tool.toolName, args);
    return { content: [{ type: "text", text: result.text }], isError: result.isError };
  } catch (cause) {
    const detail = cause instanceof McpError ? cause.message : String(cause);
    return { content: [{ type: "text", text: `${tool.agentName} could not be reached: ${detail}` }], isError: true };
  }
}

/**
 * The builder's own brain for this listing, key decrypted for this call only,
 * or null when it has none (or its key is gone) - then Dolphin's model answers.
 */
async function builderBrain(ctx: ActionCtx, listing: Listing): Promise<BrainEndpoint | null> {
  const runtime = await ctx.runQuery(internal.agentBuilder.runtimeForDraft, { draftId: listing.draftId });
  const brain = runtime.brain;
  if (!brain || !isBrainProvider(brain.provider)) return null;
  const apiKey = await ctx.runAction(internal.envVars.reveal, { walletAddress: brain.walletAddress, name: brain.keyName });
  return apiKey ? { provider: brain.provider, apiKey, model: brain.model, baseUrl: brain.baseUrl ?? null } : null;
}

/** The built agent answering one question, with nothing stored but the day's count. */
async function ask(ctx: ActionCtx, listing: Listing, question: string, wallet: string | null) {
  const endpoint = listing.priceRaw ? await builderBrain(ctx, listing) : null;
  // Only Dolphin's own model budget is capped; a builder's brain is theirs to spend.
  if (!endpoint) {
    const allowed = await ctx.runMutation(internal.builtAgents.countAsk, { hash: listing.hash, limit: MAX_ASKS_PER_AGENT_PER_DAY });
    if (!allowed) {
      return { content: [{ type: "text", text: "This agent has answered as many questions as it can today. Its other tools still work." }], isError: true };
    }
  }

  const sources = await liveSources(ctx, listing);
  const allowedTools = new Set(listing.tools.map((tool) => `${tool.agentKey}\u0000${tool.toolName}`));
  const menu = await buildToolMenu(sources, (agentKey, toolName) => allowedTools.has(`${agentKey}\u0000${toolName}`));
  const addressNote = wallet
    ? `\n\nTHE ASKER'S WALLET ADDRESS: ${wallet}. When a tool asks for the user's address, pass this one.`
    : "\n\nNo wallet address was given. If a question needs one, say so.";

  const messages: ChatMessage[] = [
    { role: "system", content: `${TRY_CONSULT_PROMPT}${addressNote}` },
    { role: "user", content: question },
  ];

  try {
    let remaining = MAX_TOOL_CALLS;
    for (let round = 0; round < MAX_TOOL_ROUNDS && remaining > 0 && menu.tools.length > 0; round++) {
      const turn = await chatCompletion({ messages, tools: menu.tools, toolChoice: "auto", ...(endpoint ? { endpoint } : {}) });
      if (turn.toolCalls.length === 0) break;
      const batch = turn.toolCalls.slice(0, remaining);
      remaining -= batch.length;
      messages.push({ role: "assistant", content: null, tool_calls: batch });
      for (const call of batch) {
        const binding = menu.bindings.get(call.function.name);
        let content: string;
        if (!binding) {
          content = `No such tool: ${call.function.name}.`;
        } else {
          let callArgs: Record<string, unknown> = {};
          try {
            const parsed = JSON.parse(call.function.arguments || "{}") as unknown;
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) callArgs = parsed as Record<string, unknown>;
          } catch {
            callArgs = {};
          }
          try {
            const result = await callMcpTool(binding.session, binding.toolName, callArgs);
            content = `[${binding.agentName} -> ${binding.toolName}]\n${digestToolResult(result.text).slice(0, 6_000)}`;
          } catch (cause) {
            content = `[${binding.agentName} could not be reached] ${cause instanceof Error ? cause.message : String(cause)}`;
          }
        }
        messages.push({ role: "tool", tool_call_id: call.id, content });
      }
    }

    const unreachable = menu.unreachable.map((entry) => `- ${entry.agentName} did not answer.`);
    messages[0] = {
      role: "system",
      content:
        tryAnswerPrompt({ name: listing.name, description: listing.description, instructions: listing.instructions, tools: listing.tools }) +
        addressNote +
        (unreachable.length ? `\n\nTOOLS YOU COULD NOT USE THIS TURN:\n${unreachable.join("\n")}` : ""),
    };
    const final = await chatCompletion({ messages, ...(endpoint ? { endpoint } : {}) });
    const answer = stripRawPayloads(final.content).trim();
    if (!answer || looksLikeLeakedReasoning(answer)) {
      return { content: [{ type: "text", text: "This agent could not write an answer just now. Ask again." }], isError: true };
    }
    return { content: [{ type: "text", text: answer }], isError: false };
  } catch (cause) {
    const text =
      cause instanceof OpenRouterError && cause.isRateLimit
        ? "This agent can't answer questions right now: its model is out of capacity for the day. Its other tools still work."
        : "This agent could not answer just now. Ask again.";
    return { content: [{ type: "text", text }], isError: true };
  }
}

export type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

/** One JSON-RPC message in, one out (null for a notification). */
export async function handleMcp(ctx: ActionCtx, listing: Listing, message: RpcRequest): Promise<Record<string, unknown> | null> {
  const id = message.id ?? null;
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const error = (code: number, text: string) => ({ jsonrpc: "2.0", id, error: { code, message: text } });

  if (message.id === undefined) return null; // notification, e.g. notifications/initialized

  switch (message.method) {
    case "initialize":
      return reply({
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: `dolphin-built-${listing.hash}`, title: listing.name, version: "1.0.0" },
        instructions: listing.description,
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: await listTools(ctx, listing) });
    case "tools/call": {
      const name = typeof message.params?.name === "string" ? message.params.name : "";
      const args = (message.params?.arguments ?? {}) as Record<string, unknown>;
      if (name === "ask") {
        const question = typeof args.question === "string" ? args.question.trim().slice(0, MAX_QUESTION_CHARS) : "";
        if (!question) return reply({ content: [{ type: "text", text: "Pass a question." }], isError: true });
        const wallet = typeof args.wallet === "string" && /^0x[0-9a-fA-F]{40}$/.test(args.wallet) ? args.wallet : null;
        return reply(await ask(ctx, listing, question, wallet));
      }
      return reply(await callPassThrough(ctx, listing, name, args));
    }
    default:
      return error(-32601, `Method not found: ${message.method ?? "(none)"}`);
  }
}
