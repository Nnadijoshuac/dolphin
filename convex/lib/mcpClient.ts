import type { FailureClass } from "../model/agent";
import { MAX_JSON_BYTES, UnsafeUrlError, assertSafeUrl, safeFetch } from "./safeFetch";

/**
 * MCP over Streamable HTTP - the one client both the probe and the Dolphin
 * agent speak.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------------------------------------------------------
 * `probe.ts` had a private `mcpCall` and a private `parseJsonRpc`. When the
 * Dolphin agent needed to invoke `tools/call`, the obvious move was to write a
 * second MCP client next to it. That is the exact mistake `probe.ts`'s own
 * header documents four times over on the A2A side: a prober that resolves or
 * addresses its target differently from the caller is measuring a different
 * endpoint, and every one of those divergences made working agents look dead.
 *
 * So the transport was extracted rather than duplicated, and `probe.ts` now
 * imports from here. There is one MCP client in this codebase. If it is wrong,
 * it is wrong identically for the probe and for the agent, which is the only
 * property that makes the probe's verdict evidence about anything.
 *
 * ---------------------------------------------------------------------------
 * SESSIONS - THE PART THE PROBE NEVER NEEDED
 * ---------------------------------------------------------------------------
 * The MCP spec's Streamable HTTP transport lets a server issue an
 * `Mcp-Session-Id` header on `initialize`; a stateful server then rejects any
 * later request that does not echo it back.
 *
 * The probe never carried one and all 26 MCP servers in this catalog answered
 * `initialize` and `tools/list` anyway. That is a real measurement, but it is a
 * measurement about those two calls. `tools/call` has never been sent to any of
 * them, and a server is entitled to be lenient about listing a menu and strict
 * about cooking from it. So this client captures the session when one is
 * offered and echoes it on every subsequent request - correct for a stateful
 * server, invisible to a stateless one.
 *
 * It also sends `notifications/initialized` after a successful handshake,
 * which the spec requires of a real client and which the probe skipped. Same
 * reasoning as the `kind: "message"` fix on the A2A side: the lenient servers
 * never noticed its absence, and there is no way to know a strict one exists
 * until it refuses.
 */

/** Matches the version `probe.ts` has been handshaking with since 2026-09-07. */
export const MCP_PROTOCOL_VERSION = "2025-06-18";

export const MCP_RPC_TIMEOUT_MS = 20_000;

const MCP_SESSION_HEADER = "mcp-session-id";

/**
 * A raw transport outcome, before anything is said about what the body means.
 *
 * The ok/not-ok split carries `failureClass` rather than throwing so callers
 * can tell "this URL must never be requested" from "somebody's server is down"
 * - the same distinction `safeFetch` draws and `probe.ts` records.
 */
export type McpRawCall =
  | { ok: true; body: string; sessionId: string | null }
  | { ok: false; failureClass: FailureClass; detail: string };

/**
 * An open MCP conversation. `sessionId` is null against a stateless server,
 * which is the common case in this catalog and not an error.
 */
export type McpSession = {
  endpoint: string;
  sessionId: string | null;
  /** Whatever the server said about itself during the handshake. */
  serverName: string | null;
};

/** One tool as the server advertises it, with the schema kept. */
export type McpTool = {
  name: string;
  description: string | null;
  /**
   * The tool's JSON Schema, verbatim.
   *
   * `probe.ts` reads `tools/list` and keeps only name and description, because
   * all it needs to decide is whether a menu exists. A caller that intends to
   * INVOKE a tool cannot work from prose - the schema is the only thing that
   * says what arguments are legal - so this client keeps it and the probe goes
   * on discarding it.
   */
  inputSchema: Record<string, unknown> | null;
};

/**
 * Either a JSON body or an SSE frame carrying one; both are valid answers from
 * a Streamable HTTP transport server.
 *
 * Moved here verbatim from `probe.ts`, which now imports it.
 */
export function parseJsonRpc(body: string): Record<string, unknown> | null {
  const start = body.indexOf("{");
  if (start < 0) return null;
  try {
    const parsed = JSON.parse(body.slice(start)) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * One JSON-RPC request to an MCP endpoint.
 *
 * `sessionId` is threaded through rather than held in module state because two
 * decisions can be in flight against different servers at once and a shared
 * mutable session would cross them.
 */
export async function mcpCall(
  endpoint: string,
  method: string,
  params: unknown,
  options: { sessionId?: string | null; timeoutMs?: number; isNotification?: boolean } = {},
): Promise<McpRawCall> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    // Streamable HTTP transport servers require both to be acceptable.
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": MCP_PROTOCOL_VERSION,
  };
  if (options.sessionId) headers["mcp-session-id"] = options.sessionId;

  // A notification carries no `id` and expects no result. Sending one with an
  // id makes a strict server answer it, which is not what the spec describes.
  const payload = options.isNotification
    ? { jsonrpc: "2.0", method, params }
    : { jsonrpc: "2.0", id: 1, method, params };

  try {
    const response = await safeFetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      timeoutMs: options.timeoutMs ?? MCP_RPC_TIMEOUT_MS,
      maxBytes: MAX_JSON_BYTES,
      exposeHeaders: [MCP_SESSION_HEADER],
    });
    if (!response.ok) {
      return { ok: false, failureClass: "http", detail: `MCP ${method} -> HTTP ${response.status}` };
    }
    return {
      ok: true,
      body: response.text,
      sessionId: response.headers[MCP_SESSION_HEADER] ?? null,
    };
  } catch (cause) {
    if (cause instanceof UnsafeUrlError) {
      return { ok: false, failureClass: "unsafe-url", detail: cause.message };
    }
    return {
      ok: false,
      failureClass: "transport",
      detail: `MCP ${method} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
}

export class McpError extends Error {
  constructor(
    message: string,
    readonly failureClass: FailureClass,
  ) {
    super(message);
  }
}

/**
 * `initialize`, capture the session, then `notifications/initialized`.
 *
 * The client identifies itself as the agent rather than as the probe, because
 * a publisher reading its own logs should be able to tell a marketplace
 * health-check apart from a user actually asking their agent something. The
 * REQUEST is identical either way - only the name differs.
 */
export async function openMcpSession(
  endpoint: string,
  clientName = "dolphin-agent",
): Promise<McpSession> {
  assertSafeUrl(endpoint);

  const init = await mcpCall(endpoint, "initialize", {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: clientName, version: "1.0.0" },
  });
  if (!init.ok) throw new McpError(init.detail, init.failureClass);

  const envelope = parseJsonRpc(init.body);
  if (!envelope || envelope.error !== undefined || envelope.result === undefined) {
    throw new McpError(
      `MCP initialize at ${endpoint} did not return a JSON-RPC result.`,
      "protocol",
    );
  }

  const result = envelope.result as Record<string, unknown> | undefined;
  const serverInfo = result?.serverInfo as Record<string, unknown> | undefined;

  const session: McpSession = {
    endpoint,
    sessionId: init.sessionId,
    serverName: typeof serverInfo?.name === "string" ? serverInfo.name : null,
  };

  // Fire-and-forget by design: the spec expects this notification, but a server
  // that ignores it is not broken and a transport blip here should not cost the
  // user a working session that `initialize` already established.
  await mcpCall(endpoint, "notifications/initialized", {}, {
    sessionId: session.sessionId,
    isNotification: true,
  }).catch(() => undefined);

  return session;
}

/**
 * The server's tool menu, with schemas.
 *
 * Unbounded on purpose, unlike `probe.ts`'s 40-tool slice: the probe is
 * deciding whether a menu exists and 40 is plenty of evidence for that, whereas
 * a caller picking a tool should see everything on offer. Callers narrow the
 * list themselves before putting it in front of a model.
 */
export async function listMcpTools(session: McpSession): Promise<McpTool[]> {
  const response = await mcpCall(session.endpoint, "tools/list", {}, {
    sessionId: session.sessionId,
  });
  if (!response.ok) throw new McpError(response.detail, response.failureClass);

  const envelope = parseJsonRpc(response.body);
  const result = envelope?.result as Record<string, unknown> | undefined;
  const raw = Array.isArray(result?.tools) ? (result.tools as unknown[]) : [];

  const tools: McpTool[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const tool = entry as Record<string, unknown>;
    const name = typeof tool.name === "string" ? tool.name.trim() : "";
    if (name.length === 0) continue;
    tools.push({
      name,
      description:
        typeof tool.description === "string" && tool.description.trim().length > 0
          ? tool.description.trim()
          : null,
      inputSchema:
        typeof tool.inputSchema === "object" && tool.inputSchema !== null
          ? (tool.inputSchema as Record<string, unknown>)
          : null,
    });
  }
  return tools;
}

/** What a tool returned, flattened to what a caller can actually show or read. */
export type McpToolResult = {
  /** Text content blocks joined. Empty string when the tool returned none. */
  text: string;
  /**
   * The server's own `isError` flag. A tool that fails is answering correctly -
   * this is NOT a transport failure and must not be recorded as one.
   */
  isError: boolean;
  /** The untouched result, kept so a disagreement is inspectable afterwards. */
  raw: string;
};

/**
 * Invokes one tool.
 *
 * ---------------------------------------------------------------------------
 * EVERYTHING THIS RETURNS IS A STRANGER'S TEXT
 * ---------------------------------------------------------------------------
 * The body is written by whoever published the agent. It reaches a language
 * model, so it is prompt-injection material by construction, and callers must
 * treat it as DATA rather than instruction: the set of tools a decision may
 * call is fixed before the first result is read, and no address, endpoint or
 * price is ever taken from here - those are re-derived from the agent's own
 * row and checked against its registered ERC-8004 wallet.
 *
 * There is precedent for the weaker failure too. A `collectFees` tool in this
 * catalog answered `note: "Fees collected"` when nothing had been collected
 * (SESSION-LOG-2026-09-07-backend-rebuild.md §12). An agent's prose is a claim
 * by that agent, never an outcome - attribute it, never restate it.
 */
export async function callMcpTool(
  session: McpSession,
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const response = await mcpCall(session.endpoint, "tools/call", {
    name,
    arguments: args,
  }, { sessionId: session.sessionId });
  if (!response.ok) throw new McpError(response.detail, response.failureClass);

  const envelope = parseJsonRpc(response.body);
  if (!envelope) {
    throw new McpError(`MCP tools/call on ${name} returned no JSON-RPC envelope.`, "protocol");
  }
  if (envelope.error !== undefined) {
    const error = envelope.error as Record<string, unknown>;
    const message = typeof error?.message === "string" ? error.message : "unknown error";
    throw new McpError(`MCP tools/call on ${name} was refused: ${message}`, "protocol");
  }

  const result = (envelope.result ?? {}) as Record<string, unknown>;
  const blocks = Array.isArray(result.content) ? (result.content as unknown[]) : [];

  const text = blocks
    .map((block) => {
      const record = typeof block === "object" && block !== null ? (block as Record<string, unknown>) : null;
      return record?.type === "text" && typeof record.text === "string" ? record.text : "";
    })
    .filter((part) => part.length > 0)
    .join("\n");

  return { text, isError: result.isError === true, raw: response.body };
}
