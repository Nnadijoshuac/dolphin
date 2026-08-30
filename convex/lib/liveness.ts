/**
 * STAGE 3 of the discovery pipeline: liveness verification.
 *
 * WHY 8004SCAN'S `is_active` IS NOT ENOUGH (Task 3). `is_active` is an
 * indexer's flag, and this session watched it be wrong in both directions:
 * 8004scan reported token 304494 as `overall_status: "unhealthy"`,
 * `health_score: 0`, while a direct probe got its A2A agent card back in
 * 1217ms; and its `health_status` messages carry the literal string "(cached)"
 * with `checked_at` timestamps up to 12 hours stale. Listing an agent to
 * somebody who might actually try to use it is a claim that it works, so
 * Dolphin makes that check itself.
 *
 * THE PROBE IS PROTOCOL-APPROPRIATE, NOT A PING. An A2A agent gets its agent
 * card fetched; an MCP server gets a real JSON-RPC `initialize` call. A bare
 * TCP/HTTP 200 from some unrelated path is not evidence the agent's service
 * works, and this deliberately does not count one.
 *
 * PATH RESOLUTION MATTERS, AND WAS LEARNED THE HARD WAY. Token 304494's
 * registration advertises an `/a2a` base, but its card actually resolves at the
 * A2A spec's `/.well-known/agent-card.json`. A probe that fetched only the
 * advertised URL verbatim would have called a live agent unreachable. So each
 * A2A endpoint is tried at several spec-sanctioned paths before it is called
 * dead.
 *
 * THREE OUTCOMES, NOT TWO. "No endpoint advertised" is a real and common third
 * state - token 12046 (the editorial "Yield Maximizer") has `mcp_server`,
 * `a2a_endpoint`, `agent_url` and `services` all null - and it is not the same
 * claim as "we tried and it did not answer". Collapsing the two would be
 * exactly the kind of rounded-up certainty AGENTS.md §5 exists to prevent.
 */

export type LivenessState =
  /** A protocol-appropriate request got a valid response, just now. */
  | "verified-live"
  /** An endpoint is advertised, we called it, and it failed or timed out. */
  | "unreachable"
  /** The agent advertises no endpoint at all, so there is nothing to probe. */
  | "no-endpoint-advertised";

export interface LivenessResult {
  state: LivenessState;
  /** "a2a", "mcp", or the service name, when one answered. */
  protocol: string | null;
  /** The exact URL that answered, or the last one tried. */
  probedUrl: string | null;
  latencyMs: number | null;
  /** Human-readable evidence: what answered, or why each attempt failed. */
  detail: string;
  checkedAt: string;
}

export interface ProbeEndpoint {
  protocol: string;
  url: string;
}

const PROBE_TIMEOUT_MS = 8_000;
/** Cap the work one agent can cost, however many endpoints it advertises. */
const MAX_ATTEMPTS_PER_AGENT = 6;

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * The A2A spec's well-known card location, plus the two placements publishers
 * actually use in the wild (card served directly at the advertised URL, and
 * card served under the advertised base rather than the origin).
 */
function a2aCandidates(url: string): string[] {
  const base = trimSlash(url);
  const candidates = [base];
  if (!/\.json($|\?)/i.test(base)) {
    candidates.push(`${base}/.well-known/agent-card.json`);
    try {
      const origin = new URL(base).origin;
      candidates.push(`${origin}/.well-known/agent-card.json`);
      // The pre-0.3 name, still served by some deployed agents.
      candidates.push(`${origin}/.well-known/agent.json`);
    } catch {
      // Not a parseable URL; the bare base is the only candidate.
    }
  }
  return [...new Set(candidates)];
}

/** An A2A agent card is recognisable: it names itself and lists skills or a version. */
function looksLikeAgentCard(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return false;
  const record = payload as Record<string, unknown>;
  const hasName = typeof record.name === "string" && record.name.trim().length > 0;
  const hasShape =
    Array.isArray(record.skills) ||
    typeof record.protocolVersion === "string" ||
    typeof record.version === "string" ||
    typeof record.url === "string" ||
    typeof record.capabilities === "object";
  return hasName && hasShape;
}

async function probeA2A(url: string): Promise<{ ok: boolean; detail: string; probedUrl: string; latencyMs: number }> {
  const failures: string[] = [];
  for (const candidate of a2aCandidates(url)) {
    const started = Date.now();
    try {
      const response = await fetch(candidate, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      const latencyMs = Date.now() - started;
      if (!response.ok) {
        failures.push(`${candidate} -> HTTP ${response.status}`);
        continue;
      }
      const payload = (await response.json()) as unknown;
      if (!looksLikeAgentCard(payload)) {
        failures.push(`${candidate} -> HTTP 200 but the body is not an A2A agent card`);
        continue;
      }
      const card = payload as Record<string, unknown>;
      const skills = Array.isArray(card.skills) ? card.skills.length : 0;
      return {
        ok: true,
        detail: `A2A agent card returned HTTP ${response.status} in ${latencyMs}ms (name="${String(card.name)}", skills=${skills}, protocol ${String(card.protocolVersion ?? card.version ?? "unversioned")}).`,
        probedUrl: candidate,
        latencyMs,
      };
    } catch (error) {
      failures.push(`${candidate} -> ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    ok: false,
    detail: `No A2A card resolved. Tried: ${failures.join("; ")}.`,
    probedUrl: url,
    latencyMs: 0,
  };
}

/**
 * A real MCP handshake. `initialize` is the one call every MCP server must
 * answer before anything else, which makes it the correct liveness probe and
 * also a harmless one - it starts a session and does not invoke a tool.
 */
async function probeMCP(url: string): Promise<{ ok: boolean; detail: string; probedUrl: string; latencyMs: number }> {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Streamable HTTP transport servers require both to be acceptable.
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "dolphin-liveness-probe", version: "1.0.0" },
        },
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - started;
    if (!response.ok) {
      return { ok: false, detail: `MCP initialize -> HTTP ${response.status}.`, probedUrl: url, latencyMs };
    }
    const body = await response.text();
    // Either a JSON body or an SSE frame carrying one; both are valid answers.
    const jsonStart = body.indexOf("{");
    if (jsonStart < 0) {
      return { ok: false, detail: `MCP initialize -> HTTP ${response.status} with a non-JSON body.`, probedUrl: url, latencyMs };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.slice(jsonStart));
    } catch {
      return { ok: false, detail: `MCP initialize -> HTTP ${response.status} but the body did not parse as JSON-RPC.`, probedUrl: url, latencyMs };
    }
    const record = parsed as Record<string, unknown>;
    const result = record.result as Record<string, unknown> | undefined;
    if (record.error !== undefined || result === undefined) {
      return { ok: false, detail: `MCP initialize returned a JSON-RPC error rather than a result.`, probedUrl: url, latencyMs };
    }
    const serverInfo = result.serverInfo as Record<string, unknown> | undefined;
    return {
      ok: true,
      detail: `MCP initialize returned HTTP ${response.status} in ${latencyMs}ms (serverInfo=${String(serverInfo?.name ?? "unnamed")} ${String(serverInfo?.version ?? "")}).`.trim(),
      probedUrl: url,
      latencyMs,
    };
  } catch (error) {
    return {
      ok: false,
      detail: `MCP initialize failed: ${error instanceof Error ? error.message : String(error)}.`,
      probedUrl: url,
      latencyMs: Date.now() - started,
    };
  }
}

/**
 * Probes every endpoint an agent advertises until one answers.
 *
 * Endpoints should be passed most-specific-first (a2a, mcp, then anything
 * else); the caller assembles them from 8004scan's detail record and from the
 * agent's own registration file, so a drifted endpoint that only the agent
 * itself knows about still gets tried.
 */
export async function probeLiveness(endpoints: readonly ProbeEndpoint[]): Promise<LivenessResult> {
  const checkedAt = new Date().toISOString();

  const unique = endpoints.filter(
    (endpoint, index, all) => all.findIndex((e) => e.url === endpoint.url) === index,
  );

  if (unique.length === 0) {
    return {
      state: "no-endpoint-advertised",
      protocol: null,
      probedUrl: null,
      latencyMs: null,
      detail:
        "The agent advertises no A2A, MCP, or service endpoint in 8004scan's record or in its own registration file, so there is nothing to probe. This is not the same as being unreachable.",
      checkedAt,
    };
  }

  const failures: string[] = [];

  for (const endpoint of unique.slice(0, MAX_ATTEMPTS_PER_AGENT)) {
    const isMcp = endpoint.protocol.toLowerCase().includes("mcp");
    const outcome = isMcp ? await probeMCP(endpoint.url) : await probeA2A(endpoint.url);
    if (outcome.ok) {
      return {
        state: "verified-live",
        protocol: endpoint.protocol,
        probedUrl: outcome.probedUrl,
        latencyMs: outcome.latencyMs,
        detail: outcome.detail,
        checkedAt,
      };
    }
    failures.push(`[${endpoint.protocol}] ${outcome.detail}`);
  }

  return {
    state: "unreachable",
    protocol: null,
    probedUrl: unique[0].url,
    latencyMs: null,
    detail: failures.join(" "),
    checkedAt,
  };
}
