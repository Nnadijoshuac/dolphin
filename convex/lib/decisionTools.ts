import { McpError, listMcpTools, openMcpSession, type McpSession } from "./mcpClient";
import type { ToolDefinition } from "./openrouter";

/**
 * Turns marketplace agents into a tool menu a model can choose from.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THIS FILE EXISTS TO ENFORCE
 * ---------------------------------------------------------------------------
 * The model may choose WHICH catalog agent to consult and WHAT arguments to
 * pass it. It may never supply an endpoint, an address, or a price. Those are
 * re-derived from the agent's own row every time, and on the payment path
 * `convex/lib/erc8183.ts` independently refuses any payee that is not the
 * agent's registered ERC-8004 wallet.
 *
 * That check was written against a lying SELLER. It defends identically
 * against a lying model, which matters more here than it would with a frontier
 * model: this agent runs on a free 12B-active model that will hallucinate an
 * address if given the chance. It is not given the chance. Model output narrows
 * a choice; it never supplies a value.
 *
 * ---------------------------------------------------------------------------
 * WHY THE MENU IS SMALL
 * ---------------------------------------------------------------------------
 * The catalog advertises 226 tools across 26 MCP servers. Putting all of them
 * in front of a small model produces worse selection, not better coverage, and
 * burns context that the free tier charges for in latency. Candidates are
 * ranked by ordinary catalog code BEFORE the model sees anything, and only a
 * handful reach it. Retrieval is deterministic; only the final choice is not.
 */

/** How many agents may be offered to the model at once. */
export const MAX_AGENTS_PER_DECISION = 4;

/** How many tools from any one agent may be offered. */
export const MAX_TOOLS_PER_AGENT = 3;

/**
 * The total menu size, and the most important number in this file.
 *
 * MEASURED 2026-09-08. At 28 tools, `nvidia/nemotron-3-super-120b-a12b:free`
 * stopped emitting structured tool calls and instead wrote the call as JSON
 * into the message body - `finish_reason: "stop"`, `tool_calls: []`, and a
 * content of `[{"name": "a1__find_agents_on_bnb_chain", "parameters": {...}}]`.
 * The same model against a hand-written one-tool menu emits a correct
 * structured call every time.
 *
 * That is the degradation mode of a small model given too much surface, and it
 * is silent: nothing errors, the caller simply sees no tool calls. Ten is
 * chosen to sit far below where it was observed to break, not adjacent to it.
 *
 * If a bigger model is ever used here, raise this deliberately and re-measure -
 * do not assume it inherited the ceiling.
 */
export const MAX_TOOLS_TOTAL = 10;

/**
 * Tool-name fragments that indicate a tool DOES something rather than reports
 * something. Any match is excluded from the menu.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * Found by reading a real menu on 2026-09-08. A query about Venus lending
 * selected "Aave powered by HeyAnon", and the menu Dolphin was about to hand a
 * free model contained `borrow`, `supply`, `withdraw`, `repay`,
 * `repayWithATokens`, `liquidationCall`, `setEModeCategory` and
 * `setUsageAsCollateral`.
 *
 * Dolphin's stated guarantee is that it cannot spend or take on-chain actions.
 * Putting write verbs in front of the model contradicts that in the one place
 * where it matters, whatever the prompt says - a prompt is a request, and a
 * tool menu is a capability.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS AND IS NOT
 * ---------------------------------------------------------------------------
 * This is a DENYLIST over names a stranger chose, so it is defence in depth and
 * not a guarantee. Something will eventually be named in a way it does not
 * catch. Two things stand behind it:
 *
 *   1. Dolphin holds no key and can sign nothing. An MCP tool cannot move funds
 *      without a signature, and one such tool in this catalog was verified to
 *      return UNSIGNED CALLDATA rather than execute
 *      (SESSION-LOG-2026-09-07-backend-rebuild.md §12).
 *   2. Every call is recorded in `dolphinToolCalls` before it is made, so an
 *      unexpected one is visible after the fact rather than silent.
 *
 * Neither makes the denylist optional. It is the layer that stops the model
 * being ASKED to do these things at all.
 */
const MUTATING_TOOL_PATTERNS = [
  "borrow", "supply", "withdraw", "repay", "liquidat", "swap", "transfer",
  "approve", "execute", "send", "buy", "sell", "stake", "claim", "mint",
  "burn", "deposit", "bridge", "sign", "rebalance", "cancel", "pause",
  "resume", "close", "open_position", "set_", "set-", "act", "trade",
  "allocate", "migrate", "route",
];

/**
 * Verbs that are only mutating when they START the name.
 *
 * Kept separate because as substrings they are everywhere and harmless -
 * "asset" contains "set", "budget" contains "get", "created_at" contains
 * "create". `setEModeCategory` and `setUsageAsCollateral` both survived the
 * substring list on 2026-09-08 for exactly that reason: the pattern was written
 * as "set_" and these are camelCase.
 */
const MUTATING_PREFIXES = [
  "set", "add", "remove", "update", "create", "delete", "enable", "disable",
  "toggle", "start", "stop", "run",
];

function isMutating(toolName: string): boolean {
  const name = toolName.toLowerCase();
  if (MUTATING_PREFIXES.some((prefix) => name.startsWith(prefix))) return true;
  // camelCase and snake_case both appear in this catalog, so match on the raw
  // lowercased string rather than tokenizing.
  return MUTATING_TOOL_PATTERNS.some((pattern) => name.includes(pattern));
}

/** OpenAI-compatible function names: letters, digits, underscore, hyphen. */
const NAME_SAFE = /[^a-zA-Z0-9_-]/g;

export type CandidateAgent = {
  agentKey: string;
  name: string;
  endpoint: string;
  protocol: "a2a" | "mcp";
};

/**
 * What a function name the model emitted actually maps to. The model never
 * sees an endpoint - it sees `a0__get_health`, and this is how that becomes a
 * real call to a real server.
 */
export type ToolBinding = {
  functionName: string;
  agentKey: string;
  agentName: string;
  endpoint: string;
  /** The tool's real name on the server, which the function name may have mangled. */
  toolName: string;
  session: McpSession;
};

export type ToolMenu = {
  tools: ToolDefinition[];
  bindings: Map<string, ToolBinding>;
  /** Agents that were offered but could not be reached, for honest reporting. */
  unreachable: { agentKey: string; agentName: string; reason: string }[];
};

/**
 * Builds the menu by asking each candidate what it can do, right now.
 *
 * Live rather than from stored `skills` because the probe keeps only names and
 * descriptions - it discards `inputSchema`, and a caller that intends to INVOKE
 * a tool cannot construct arguments from a prose sentence. One extra round trip
 * per agent buys the schema, and it also means the menu reflects what the server
 * offers today rather than what it offered when it was last probed.
 *
 * An agent that cannot be reached is recorded and skipped, never silently
 * dropped: "three agents answered and one was down" is a materially different
 * statement from "three agents answered", and the second one hides a fact the
 * user is entitled to.
 */
export async function buildToolMenu(candidates: CandidateAgent[]): Promise<ToolMenu> {
  const tools: ToolDefinition[] = [];
  const bindings = new Map<string, ToolBinding>();
  const unreachable: ToolMenu["unreachable"] = [];

  const mcpCandidates = candidates
    .filter((candidate) => candidate.protocol === "mcp")
    .slice(0, MAX_AGENTS_PER_DECISION);

  // Sequential rather than parallel: these are strangers' servers on a free
  // tier, and a burst of simultaneous connections is how a marketplace earns a
  // reputation for hammering the people listed in it.
  for (let index = 0; index < mcpCandidates.length; index++) {
    const candidate = mcpCandidates[index];
    try {
      const session = await openMcpSession(candidate.endpoint);
      const available = await listMcpTools(session);

      // Read-only tools only, then a per-agent cap so one chatty server cannot
      // consume the whole menu and crowd out the other agents' answers.
      const readable = available
        .filter((tool) => !isMutating(tool.name))
        .slice(0, MAX_TOOLS_PER_AGENT);

      for (const tool of readable) {
        if (tools.length >= MAX_TOOLS_TOTAL) break;

        const functionName = `a${index}__${tool.name.replace(NAME_SAFE, "_")}`.slice(0, 64);
        if (bindings.has(functionName)) continue;

        bindings.set(functionName, {
          functionName,
          agentKey: candidate.agentKey,
          agentName: candidate.name,
          endpoint: candidate.endpoint,
          toolName: tool.name,
          session,
        });

        tools.push({
          type: "function",
          function: {
            name: functionName,
            // The agent's name is in the description rather than the function
            // name because names are length-capped and get mangled; the model
            // still needs to know whose tool this is to cite it.
            description:
              `[via ${candidate.name}] ${tool.description ?? `The ${tool.name} tool.`}`.slice(0, 1024),
            parameters: normalizeSchema(tool.inputSchema),
          },
        });
      }
    } catch (cause) {
      unreachable.push({
        agentKey: candidate.agentKey,
        agentName: candidate.name,
        reason:
          cause instanceof McpError
            ? cause.message
            : cause instanceof Error
              ? cause.message
              : String(cause),
      });
    }
  }

  return { tools, bindings, unreachable };
}

/**
 * A tool's published schema, made safe to hand to a model.
 *
 * A server may publish no schema at all. That is not permission to invent one -
 * an empty object means "this tool takes no arguments", which is the only
 * reading that cannot cause a malformed call. If the tool really did want
 * arguments, it fails visibly at call time and is recorded as having failed,
 * rather than being called with arguments Dolphin made up.
 */
function normalizeSchema(schema: Record<string, unknown> | null): Record<string, unknown> {
  if (!schema || typeof schema !== "object") {
    return { type: "object", properties: {} };
  }
  if (schema.type !== "object") {
    return { type: "object", properties: {} };
  }
  return {
    type: "object",
    properties: (schema.properties as Record<string, unknown>) ?? {},
    ...(Array.isArray(schema.required) ? { required: schema.required } : {}),
  };
}
