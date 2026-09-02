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
 * An endpoint still carrying an un-substituted `{…}` template is not a URL
 * anyone can call.
 *
 * MIRRORS the guard the payment path has always had at
 * convex/lib/erc8183.ts:319, which skips a templated endpoint rather than
 * fetching it literally. This module lacked the equivalent, and that gap is the
 * whole defect: 38 candidates - every TermiX-hosted agent in the ledger, whose
 * 8004scan record advertises `.../api/v1/a2a/agents/{agentId}/card` - were
 * being fetched with the literal braces, getting a 404, and accruing
 * `consecutiveProbeFailures` toward delisting for a request that could never
 * have succeeded.
 *
 * DELIBERATELY NOT SUBSTITUTED. Filling in the token id makes those URLs return
 * HTTP 200, and measured across all 38 the bodies pass `looksLikeAgentCard`
 * while reporting `endpoint: null`, `status: "UNBOUND"`, `presence: "offline"`.
 * Substituting would manufacture 32 false "verified-live" claims about agents
 * their own platform says are not bound. Guessing at a publisher's intended URL
 * is not this probe's job; reporting honestly that the advertised one is
 * uncallable is.
 */
function isUncallableTemplate(url: string): boolean {
  return url.includes("{");
}

/**
 * The A2A spec's well-known card location, plus the two placements publishers
 * actually use in the wild (card served directly at the advertised URL, and
 * card served under the advertised base rather than the origin).
 */
function a2aCandidates(url: string): string[] {
  const base = trimSlash(url);
  // Defence in depth. probeLiveness filters these out before we are called, so
  // this should be unreachable - but a templated URL must never become a
  // request, whichever path reaches here.
  if (isUncallableTemplate(base)) return [];
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

/* ---------------------------------------------------------------------------
 * THE DECLARED-SERVICE PROBE.
 *
 * WHY IT EXISTS. ERC-8004 does NOT define a service's `name` as a protocol
 * identifier. Checked against the spec text itself rather than inferred: the
 * example lists `web`, `A2A`, `MCP`, `OASF`, `ENS`, `DID` and `email` side by
 * side, the only normative sentence is "The number and type of endpoints are
 * fully customizable, allowing developers to add as many as they wish",
 * `version` is "a SHOULD, not a MUST", and the spec gives NO guidance at all on
 * how a consumer should work out which protocol an endpoint speaks.
 *
 * So `name` is a free-text label. This module used to treat every label that
 * did not contain "mcp" as A2A and then judge the response by A2A AgentCard
 * rules. That is how four live agents were marked unreachable and one of them
 * (token 315943, `confirmed`, score 25) was delisted: their manifests name
 * services `venus-health-factor-assessment`,
 * `pancakeswap-v3-lp-rebalance-assessment` and so on, which is entirely
 * spec-compliant, and their endpoints answer HTTP 200 with a JSON capability
 * descriptor that was never claiming to be an AgentCard.
 *
 * WHAT THIS IS NOT. It is not a lower bar for A2A or MCP - those paths are
 * untouched and still require their own protocol handshake. This branch only
 * decides what counts as a live response for a service that declared neither.
 * An agent must still prove it answers; we are fixing which probe we run.
 *
 * THE BAR, and every rule is a requirement. Validated by running it against
 * every group it has to separate before it was written:
 *
 *   R2  HTTP 2xx
 *   R3  Content-Type is JSON            <- rejects every HTML catch-all,
 *                                          including the useaiki.ai "Coming
 *                                          Soon" page that briefly fooled this
 *                                          investigation
 *   R4  body parses as a JSON OBJECT
 *   R5  not an error envelope
 *   R6  at least two top-level keys     <- a bare {"ok":true} is not evidence
 *                                          of a service
 *   R8  reject an explicit self-report of unavailability
 *
 * R8 is the one that carries its own caveat. Its key names (`status`,
 * `presence`, `endpoint`) come from observed responses, not from a spec, so it
 * is deliberately a DENY-list of stated unavailability rather than an
 * allow-list of stated health - it can only ever reject, never admit. It exists
 * because the 38 templated TermiX endpoints, if their `{agentId}` were ever
 * substituted upstream, return HTTP 200 JSON objects that satisfy R2-R6 while
 * reporting `status: "UNBOUND"`, `presence: "offline"` and `endpoint: null`.
 * Believing an agent that says it is not available is strictly stronger than
 * ignoring it. Measured: 11 of 12 sampled TermiX records are rejected by R8
 * alone, independently of the template guard above.
 * ------------------------------------------------------------------------ */

/** Stated unavailability. Lowercased before comparison. */
const UNAVAILABLE_STATUS = new Set([
  "unbound",
  "offline",
  "inactive",
  "disabled",
  "suspended",
]);

/**
 * Labels that name a REFERENCE, not a callable service.
 *
 * Every one of these appears in ERC-8004's own example services array beside
 * A2A and MCP, and none of them is something an agent answers on: a homepage, a
 * schema framework, a name-resolution system, a mailbox.
 *
 * FOUND BY RUNNING IT, not by reading it. Token 325413 advertises `oasf` ->
 * https://github.com/agntcy/oasf, which is the Open Agentic Schema Framework's
 * README. GitHub CONTENT-NEGOTIATES: sent `Accept: application/json` it returns
 * HTTP 200 `application/json` with `{meta:{...},payload:{...}}` - which
 * satisfies every rule of the declared-service bar and marked a spec page as a
 * live agent endpoint. Caught by the control set on the first run.
 *
 * These are failed without a request rather than filtered out of the endpoint
 * list: the agent DID advertise something, it just is not an endpoint, and the
 * distinction between "advertised nothing" and "advertised a link" is worth
 * keeping (AGENTS.md §5).
 */
const REFERENCE_ONLY_LABELS = new Set([
  "web",
  "website",
  "homepage",
  "oasf",
  "ens",
  "did",
  "email",
  "marketplace",
  "docs",
  "image",
  "icon",
]);

async function probeDeclaredService(
  url: string,
  protocol: string,
): Promise<{ ok: boolean; detail: string; probedUrl: string; latencyMs: number }> {
  // R1 - a label naming a reference is failed without a request. Probing it
  // would ask a homepage or a spec page to behave like an agent, and some of
  // them answer convincingly enough to pass (see REFERENCE_ONLY_LABELS).
  if (REFERENCE_ONLY_LABELS.has(protocol.toLowerCase())) {
    return {
      ok: false,
      detail: `${url} -> "${protocol}" names a reference, not a callable service endpoint; not probed.`,
      probedUrl: url,
      latencyMs: 0,
    };
  }

  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      ok: false,
      detail: `${url} -> ${error instanceof Error ? error.message : String(error)}.`,
      probedUrl: url,
      latencyMs: Date.now() - started,
    };
  }

  const latencyMs = Date.now() - started;
  // probeLiveness already prefixes `[protocol]` when it records a failure, so
  // this must not repeat it.
  const fail = (why: string) => ({
    ok: false,
    detail: `${url} -> ${why}.`,
    probedUrl: url,
    latencyMs,
  });

  // R2
  if (!response.ok) return fail(`HTTP ${response.status}`);

  // R3 - the single most load-bearing rule. A site that serves its app shell
  // for every path returns 200 for anything; requiring JSON is what tells a
  // service apart from a catch-all.
  const contentType = response.headers.get("content-type") ?? "";
  if (!/application\/(\w+\+)?json/i.test(contentType)) {
    return fail(`HTTP ${response.status} with Content-Type "${contentType || "none"}", not JSON`);
  }

  // R4
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return fail(`HTTP ${response.status} with a body that did not parse as JSON`);
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return fail(`HTTP ${response.status} but the body is not a JSON object`);
  }
  const record = payload as Record<string, unknown>;

  // R5
  if ("error" in record) {
    return fail(`HTTP ${response.status} but the body is an error envelope`);
  }
  const statusCode = record.statusCode ?? record.status_code;
  if (typeof statusCode === "number" && statusCode >= 400) {
    return fail(`HTTP ${response.status} but the body reports statusCode ${statusCode}`);
  }

  // R6
  const keys = Object.keys(record);
  if (keys.length < 2) {
    return fail(`HTTP ${response.status} but the body carries only ${keys.length} field(s)`);
  }

  // R8
  const status = typeof record.status === "string" ? record.status.toLowerCase() : null;
  if (status !== null && UNAVAILABLE_STATUS.has(status)) {
    return fail(`HTTP ${response.status} but the service reports status "${String(record.status)}"`);
  }
  if (typeof record.presence === "string" && record.presence.toLowerCase() === "offline") {
    return fail(`HTTP ${response.status} but the service reports presence "offline"`);
  }
  if ("endpoint" in record && record.endpoint === null && ("status" in record || "presence" in record)) {
    return fail(
      `HTTP ${response.status} but the body is a registry record with a null endpoint, not a live service`,
    );
  }

  return {
    ok: true,
    detail:
      `Declared service "${protocol}" returned HTTP ${response.status} in ${latencyMs}ms ` +
      `(JSON object, fields: ${keys.slice(0, 6).join(", ")}${keys.length > 6 ? ", …" : ""}). ` +
      `Verified as a declared ERC-8004 service endpoint, NOT as an A2A card or an MCP server.`,
    probedUrl: url,
    latencyMs,
  };
}

/** Protocol labels this module knows how to speak, matched loosely. */
function isMcpProtocol(protocol: string): boolean {
  return protocol.toLowerCase().includes("mcp");
}
function isA2aProtocol(protocol: string): boolean {
  const p = protocol.toLowerCase();
  return p.includes("a2a") || p.includes("agentcard") || p.includes("agent-card");
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

  const deduped = endpoints.filter(
    (endpoint, index, all) => all.findIndex((e) => e.url === endpoint.url) === index,
  );

  // Templated endpoints are removed BEFORE the emptiness check below, not
  // failed inside the probe loop. That placement is the whole point: an agent
  // whose only advertised endpoint is an un-substituted template has, in every
  // sense that matters, advertised no callable endpoint - so it lands in
  // `no-endpoint-advertised` and never accrues a probe failure it cannot avoid.
  const templated = deduped.filter((endpoint) => isUncallableTemplate(endpoint.url));
  const unique = deduped.filter((endpoint) => !isUncallableTemplate(endpoint.url));

  if (unique.length === 0) {
    return {
      state: "no-endpoint-advertised",
      protocol: null,
      probedUrl: null,
      latencyMs: null,
      // Two genuinely different situations, and the copy says which one it is
      // rather than rounding both to "advertises nothing" (AGENTS.md §5).
      detail:
        templated.length > 0
          ? `The agent advertises ${templated.length} endpoint(s), but every one still carries an un-substituted template and so cannot be called: ${templated
              .map((e) => `[${e.protocol}] ${e.url}`)
              .join("; ")}. Dolphin does not guess at the intended URL. This is a defect in the agent's own registration, not a failed probe - nothing was requested.`
          : "The agent advertises no A2A, MCP, or service endpoint in 8004scan's record or in its own registration file, so there is nothing to probe. This is not the same as being unreachable.",
      checkedAt,
    };
  }

  const failures: string[] = [];

  for (const endpoint of unique.slice(0, MAX_ATTEMPTS_PER_AGENT)) {
    // Three branches, not two. A label that names neither A2A nor MCP is not
    // assumed to be A2A - ERC-8004 lets a publisher name a service anything,
    // so guessing A2A and then failing the response by A2A rules marks live
    // agents dead. See probeDeclaredService.
    const outcome = isMcpProtocol(endpoint.protocol)
      ? await probeMCP(endpoint.url)
      : isA2aProtocol(endpoint.protocol)
        ? await probeA2A(endpoint.url)
        : await probeDeclaredService(endpoint.url, endpoint.protocol);
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
