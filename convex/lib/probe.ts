/**
 * VERIFICATION: can this agent actually be hired?
 *
 * ---------------------------------------------------------------------------
 * THE ONE INVARIANT, AND IT IS NON-NEGOTIABLE
 * ---------------------------------------------------------------------------
 * The probe sends EXACTLY what a hire sends. Same envelope builder, same
 * endpoint resolver, same quote validator - imported from convex/lib/erc8183.ts
 * rather than reimplemented here.
 *
 * This is not a style preference. Four separate violations of it are on the
 * record, each of which made working agents look dead, and two of them were
 * real defects in the HIRE path that the probe's disagreement is what exposed:
 *
 *   probe asked only the optional {skill:"list"}      5 sellers reported broken
 *   envelope hand-rolled as params:{skill}            all but one family rejected
 *   endpoint derived by stripping the card path       wrong URL for 2 of 3 shapes
 *   buildA2ARequest omitted spec-required kind        3 strict sellers rejected
 *
 * A probe that resolves its target differently from the hire path is measuring
 * a different endpoint and cannot be evidence about hireability.
 *
 * ---------------------------------------------------------------------------
 * WHY LIVENESS AND SELLABILITY ARE ONE FUNCTION NOW
 * ---------------------------------------------------------------------------
 * The previous backend had two: `liveness.ts` decided what got PUBLISHED, and
 * `sellability.ts` decided what got LISTED. They measured different things and
 * disagreed - 26 agents were `published` while 12 were visible - so
 * "is this agent in the marketplace" had two answers and neither was
 * authoritative. Agent/TODO.md C.4 recorded it as an open defect.
 *
 * There is one gate here. An agent is LIVE if it answers a protocol-appropriate
 * call AND offers work for sale. Anything less is not listed.
 *
 * ---------------------------------------------------------------------------
 * MCP AGENTS CAN NOW PASS
 * ---------------------------------------------------------------------------
 * The old sellability probe spoke only A2A. An MCP agent could satisfy the
 * liveness check and could never satisfy the listing check, so no MCP agent
 * could ever be listed - 5,474 agents on BSC mainnet (measured 2026-09-07)
 * excluded by an oversight rather than a decision. `tools/list` returning at
 * least one tool is the MCP equivalent of a service menu, and it is checked.
 */

import { assertSafeUrl, MAX_JSON_BYTES, safeFetch, UnsafeUrlError } from "./safeFetch";
import {
  QuoteRejected,
  TEXT_PARTS_ONLY,
  buildA2ARequest,
  normalizeQuote,
  resolveA2AEndpoint,
} from "./erc8183";
// The one MCP client. See the note where this file's private copies used to be.
import { bscPublicClient } from "./bscClient";
import { mcpCall, parseJsonRpc } from "./mcpClient";
import type { AgentProtocol, AgentPricing, FailureClass, VerificationState } from "../model/agent";


/** ERC-20 metadata, the two fields a price is meaningless without. */
const ERC20_METADATA_ABI = [
  { name: "symbol", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

/**
 * Reads the quoted token's symbol and decimals FROM THE TOKEN.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT THE THING §5 FORBIDS (2026-09-12)
 * ---------------------------------------------------------------------------
 * This used to store `tokenSymbol: ""` and `tokenDecimals: 0`, with a comment
 * saying a guess here would be a fabricated number on a price. That reasoning
 * was right about guessing and wrong about the alternative: reading the token
 * contract is not a guess, it is the same `eth_call` agentPayments.ts already
 * makes at payment time.
 *
 * The cost of not reading it was paid on every screen. A price of
 * `100000000000000000` with no decimals cannot be rendered at all, so the
 * catalog fell back to a live per-card RPC read that never happened - every
 * agent card showed "Not available" where its price should be.
 *
 * Failure stays honest: unreadable metadata leaves the fields empty exactly as
 * before, and a caller that cannot format a price says so rather than assuming
 * 18 decimals. One read per probe, not per view.
 */
async function readTokenMetadata(
  token: string,
): Promise<{ symbol: string; decimals: number }> {
  try {
    const [symbol, decimals] = await Promise.all([
      bscPublicClient.readContract({
        address: token as `0x${string}`,
        abi: ERC20_METADATA_ABI,
        functionName: "symbol",
      }),
      bscPublicClient.readContract({
        address: token as `0x${string}`,
        abi: ERC20_METADATA_ABI,
        functionName: "decimals",
      }),
    ]);
    return { symbol: String(symbol), decimals: Number(decimals) };
  } catch {
    return { symbol: "", decimals: 0 };
  }
}
/** Fetching a card is cheap; asking for a quote is not. */
const CARD_TIMEOUT_MS = 8_000;
const RPC_TIMEOUT_MS = 20_000;

export interface ProbeSkill {
  name: string;
  description: string | null;
  /**
   * Whether this tool REQUIRES any argument. MCP only; null for A2A.
   *
   * Added 2026-09-12 for the free tool preview on a listing
   * (convex/agentTrials.ts), which will only run a tool that needs no input -
   * that rule is what keeps a visitor's text from ever reaching a stranger's
   * server, and what stops Dolphin inventing a value and presenting the reply
   * as that agent's answer.
   *
   * Recorded HERE rather than discovered at click time because the alternative
   * is a listing full of buttons that turn out to error. Measured over the
   * live catalog, the split is real and uneven: `getSupportedChains`,
   * `topaz_get_protocol_stats`, `bnb_agent_census` and `bobai_token_info` take
   * nothing, while every read tool on Aave-powered-by-HeyAnon wants at least
   * `chainName`. A UI that cannot tell them apart offers four chips and errors
   * on all four.
   *
   * Null means "not known" - an A2A skill, or an MCP row probed before this
   * field existed. A null is NOT treated as runnable; see agentTrials.ts.
   */
  requiresInput: boolean | null;
}

export interface ProbeResult {
  state: VerificationState;
  failureClass: FailureClass | null;
  /** One checkable sentence. Stored; capped by the caller. */
  detail: string;
  protocol: AgentProtocol | null;
  /** The URL that answered, or the last one tried. */
  probedEndpoint: string | null;
  /** From the agent's own card. Drives categorization and the detail page. */
  skills: ProbeSkill[];
  /** The agent's own name, when its card publishes one. */
  cardName: string | null;
  /** Populated only when a negotiate call returned a quote we could validate. */
  pricing: AgentPricing | null;
}

function fail(
  failureClass: FailureClass,
  detail: string,
  extras: Partial<ProbeResult> = {},
): ProbeResult {
  return {
    state: failureClass === "no-endpoint" || failureClass === "unsafe-url" ? "invalid" : "unavailable",
    failureClass,
    detail: detail.slice(0, 300),
    protocol: null,
    probedEndpoint: null,
    skills: [],
    cardName: null,
    pricing: null,
    ...extras,
  };
}

/* ---------------------------------------------------------------------------
 * SERVICE LABELS THAT ARE NOT SERVICES
 *
 * ERC-8004 does NOT define a service's `name` as a protocol identifier - the
 * spec's own example lists `web`, `A2A`, `MCP`, `OASF`, `ENS`, `DID` and
 * `email` side by side and gives no guidance on how a consumer should work out
 * what an endpoint speaks. So `name` is free text.
 *
 * These label a REFERENCE, not something an agent answers on, and they are
 * failed WITHOUT a request. Found by running it: token 325413 advertises
 * `oasf` -> a GitHub README, and GitHub CONTENT-NEGOTIATES - sent
 * `Accept: application/json` it returns 200 with a JSON object, which passed
 * every structural test a generic probe could apply and marked a spec page as a
 * live agent endpoint.
 * ------------------------------------------------------------------------ */
const REFERENCE_ONLY_LABELS = new Set([
  "web", "website", "homepage", "oasf", "ens", "did", "email",
  "marketplace", "docs", "image", "icon",
]);

function isMcpLabel(name: string): boolean {
  return name.toLowerCase().includes("mcp");
}

/* ---------------------------------------------------------------------------
 * A2A
 * ------------------------------------------------------------------------ */

/**
 * The A2A spec's well-known card location, plus the two placements publishers
 * actually use: the card served directly at the advertised URL, and served
 * under the advertised base rather than the origin.
 *
 * Learned the hard way - token 304494 advertises an `/a2a` base while its card
 * resolves at `/.well-known/agent-card.json`. A probe that fetched only the
 * advertised URL verbatim called a live agent unreachable.
 */
function cardCandidates(url: string): string[] {
  const base = url.replace(/\/+$/, "");
  const candidates = [base];
  if (!/\.json($|\?)/i.test(base)) {
    candidates.push(`${base}/.well-known/agent-card.json`);
    try {
      const origin = new URL(base).origin;
      candidates.push(`${origin}/.well-known/agent-card.json`);
      // The pre-0.3 name, still served by some deployed agents.
      candidates.push(`${origin}/.well-known/agent.json`);
    } catch {
      /* not parseable; the bare base is the only candidate */
    }
  }
  return [...new Set(candidates)];
}

interface AgentCard {
  name: string;
  /** The JSON-RPC endpoint. Frequently NOT the URL the card was fetched from. */
  url: string | null;
  skills: ProbeSkill[];
}

function parseCard(payload: unknown): AgentCard | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;

  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (name.length === 0) return null;

  // A card names itself AND says something about its shape. Name alone matches
  // far too much JSON on the open web.
  const hasShape =
    Array.isArray(record.skills) ||
    typeof record.protocolVersion === "string" ||
    typeof record.version === "string" ||
    typeof record.url === "string" ||
    (typeof record.capabilities === "object" && record.capabilities !== null);
  if (!hasShape) return null;

  const skills: ProbeSkill[] = [];
  if (Array.isArray(record.skills)) {
    for (const raw of record.skills.slice(0, 40)) {
      if (typeof raw !== "object" || raw === null) continue;
      const skill = raw as Record<string, unknown>;
      const skillName = typeof skill.name === "string" ? skill.name.trim() : "";
      if (skillName.length === 0) continue;
      skills.push({
        name: skillName.slice(0, 80),
        description:
          typeof skill.description === "string" && skill.description.trim().length > 0
            ? skill.description.trim().slice(0, 300)
            : null,
        /*
         * Null, not false. An A2A skill is a prose capability on an agent
         * card, not a callable tool with a schema - "does it require input"
         * is not a question its card answers. Recording false would claim it
         * takes none, and the preview would then offer it.
         */
        requiresInput: null,
      });
    }
  }

  return {
    name,
    url: typeof record.url === "string" && record.url.trim().length > 0 ? record.url.trim() : null,
    skills,
  };
}

/** Fetches the card from whichever spec-sanctioned path serves it. */
async function fetchCard(
  advertised: string,
): Promise<{ card: AgentCard; from: string } | { failures: string[] }> {
  const failures: string[] = [];
  for (const candidate of cardCandidates(advertised)) {
    try {
      const response = await safeFetch(candidate, {
        timeoutMs: CARD_TIMEOUT_MS,
        maxBytes: MAX_JSON_BYTES,
      });
      if (!response.ok) {
        failures.push(`${candidate} -> HTTP ${response.status}`);
        continue;
      }
      let payload: unknown;
      try {
        payload = JSON.parse(response.text);
      } catch {
        failures.push(`${candidate} -> 200 but the body is not JSON`);
        continue;
      }
      const card = parseCard(payload);
      if (!card) {
        failures.push(`${candidate} -> 200 but the body is not an A2A agent card`);
        continue;
      }
      return { card, from: candidate };
    } catch (cause) {
      failures.push(
        `${candidate} -> ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }
  return { failures };
}

type RawCall =
  | { ok: true; body: string }
  | { ok: false; failureClass: FailureClass; detail: string };

async function postJson(endpoint: string, payload: unknown): Promise<RawCall> {
  try {
    const response = await safeFetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
      timeoutMs: RPC_TIMEOUT_MS,
      maxBytes: MAX_JSON_BYTES,
    });
    if (!response.ok) {
      return {
        ok: false,
        failureClass: "http",
        detail: `${endpoint} answered HTTP ${response.status}`,
      };
    }
    return { ok: true, body: response.text };
  } catch (cause) {
    if (cause instanceof UnsafeUrlError) {
      return { ok: false, failureClass: "unsafe-url", detail: cause.message };
    }
    return {
      ok: false,
      failureClass: "transport",
      detail: `Could not reach ${endpoint}: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
}

/**
 * One call, retried in the text dialect if the endpoint refuses data parts.
 *
 * Both are legal A2A - a Part may be text or data and a server may accept
 * whichever it likes - and the Singularry platform answers
 * `-32005 Only text parts are accepted` to every data-part call. Without this
 * retry the probe records an ENCODING complaint as the agent's verdict, and an
 * operator reading it blames the wrong party.
 */
async function callWithDialect(
  endpoint: string,
  build: (partKind: "data" | "text") => unknown,
): Promise<RawCall> {
  const first = await postJson(endpoint, build("data"));
  if (!first.ok) return first;
  try {
    const envelope = JSON.parse(first.body) as { error?: { message?: string } };
    if (envelope?.error && TEXT_PARTS_ONLY.test(envelope.error.message ?? "")) {
      return postJson(endpoint, build("text"));
    }
  } catch {
    /* not JSON - let the caller judge it */
  }
  return first;
}

/**
 * What the negotiate probe asks for.
 *
 * ONE GENERIC TASK, not one per category - which is a change, and it follows
 * from categories no longer being a closed set. The old probe kept a
 * hand-written task per category and defaulted to the monitoring one for
 * anything else; with categories now open, "the template for this agent's
 * category" is not always a thing that exists.
 *
 * The address is Dolphin's own probe subject rather than a real user's. Asking
 * every seller in the catalog, on a schedule, to price work on a customer's
 * wallet would leak that customer to all of them.
 */
const PROBE_ADDRESS = "0x0000000000000000000000000000000000000001";
const PROBE_TASK =
  `Describe the service you would perform for ${PROBE_ADDRESS} on BNB Chain, ` +
  `and quote a price for it.`;

function buildNegotiate(partKind: "data" | "text") {
  return buildA2ARequest(
    {
      skill: "negotiate",
      task_description: PROBE_TASK,
      // Both live dialects REQUIRE both keys and reject the call without them.
      terms: {
        deliverables: PROBE_TASK,
        quality_standards: "Figures read from BNB Chain at request time.",
      },
    },
    partKind,
  );
}

/**
 * The A2A probe.
 *
 * THREE STAGES, CHEAPEST FIRST, AND THE THIRD IS THE DEFINITIVE ONE.
 *
 * `{skill:"list"}` is an OPTIONAL convenience. Measured: of the agents that
 * return a real quote, only the Brain on BNB family implements `list` at all -
 * five others answer 405 to it and 200 with a real price to `negotiate`. So a
 * `list` failure proves nothing and must never be a verdict. It is tried first
 * because it is cheap and commits nothing.
 */
async function probeA2A(
  advertisedEndpoints: readonly { name: string; endpoint: string }[],
  agentWallet: string | null,
): Promise<ProbeResult> {
  // resolveA2AEndpoint reads the card's own `url` - the same resolution the
  // hire path uses. Re-deriving one with a path heuristic knocks on a different
  // door than the one that answers.
  let endpoint: string | null;
  try {
    endpoint = await resolveA2AEndpoint(advertisedEndpoints);
  } catch {
    endpoint = null;
  }

  // Fetch the card regardless: it is where the skills come from, and skills are
  // what categorization and the detail page are built on.
  const advertised = advertisedEndpoints.find((s) => !isMcpLabel(s.name))?.endpoint ?? null;
  const cardOutcome = advertised ? await fetchCard(advertised) : { failures: ["no A2A service advertised"] };
  const card = "card" in cardOutcome ? cardOutcome.card : null;
  const skills = card?.skills ?? [];
  const cardName = card?.name ?? null;

  // The card's own `url` beats everything, then the resolver, then the
  // advertised URL as a last resort.
  const target = card?.url ?? endpoint ?? advertised;
  if (!target) {
    return fail(
      "no-endpoint",
      "The agent advertises no callable A2A endpoint, so there is no way to ask it for a price or send it work.",
    );
  }

  try {
    assertSafeUrl(target);
  } catch (cause) {
    return fail("unsafe-url", cause instanceof Error ? cause.message : String(cause));
  }

  const base: Partial<ProbeResult> = {
    protocol: "a2a",
    probedEndpoint: target,
    skills,
    cardName,
  };

  // 1. The menu, if it publishes one.
  const listed = await callWithDialect(target, (kind) =>
    buildA2ARequest({ skill: "list" }, kind),
  );
  if (listed.ok) {
    try {
      const envelope = JSON.parse(listed.body) as { result?: { services?: unknown } };
      const menu = envelope?.result?.services;
      if (Array.isArray(menu) && menu.length > 0) {
        return {
          state: "live",
          failureClass: null,
          detail: `Publishes a menu of ${menu.length} service${menu.length === 1 ? "" : "s"} over its A2A endpoint.`,
          protocol: "a2a",
          probedEndpoint: target,
          skills,
          cardName,
          pricing: null,
        };
      }
    } catch {
      /* fall through to the definitive probe rather than judging on a parse */
    }
  }

  // 2. The question a hire actually asks.
  const quoted = await callWithDialect(target, buildNegotiate);
  if (!quoted.ok) {
    return fail(
      quoted.failureClass,
      `${quoted.detail} on the A2A call a hire begins with, and it publishes no service menu either.`,
      base,
    );
  }

  let envelope: { result?: unknown; error?: { message?: string } };
  try {
    envelope = JSON.parse(quoted.body) as typeof envelope;
  } catch {
    return fail("protocol", `${target} answered with something that is not JSON.`, base);
  }
  if (envelope?.error) {
    return fail(
      "no-menu",
      `The agent returned a JSON-RPC error when asked to price work: ${envelope.error.message ?? "unspecified"}.`,
      base,
    );
  }
  if (envelope?.result === undefined || envelope.result === null) {
    return fail("no-menu", "The agent answered the negotiate call with an empty result.", base);
  }

  // 3. Answering is not the same as being hireable.
  //
  // Two agents once answered with HTTP 200 and a quote whose price the hire path
  // then refused ("cannot read as atomic token units: undefined"). Listing them
  // puts a Hire button in front of a checkout that always fails - the same
  // broken promise as a dead endpoint, just discovered one screen later, after
  // the user has committed attention to it. So the probe runs the SAME
  // validation the hire runs.
  if (!agentWallet) {
    return fail(
      "no-menu",
      "The agent answered, but has no registered on-chain wallet, so Dolphin cannot verify who a payment would go to and will not offer a hire it could not settle.",
      base,
    );
  }

  try {
    const quote = normalizeQuote(envelope.result, {
      agentWallet,
      taskDescription: PROBE_TASK,
    });
    const tokenMeta = await readTokenMetadata(quote.paymentToken);
    return {
      state: "live",
      failureClass: null,
      detail:
        "Returned a payable quote for the A2A negotiate call a hire begins with. It publishes no separate service menu, which is optional.",
      protocol: "a2a",
      probedEndpoint: target,
      skills,
      cardName,
      pricing: {
        // Already a decimal string of atomic units - NormalizedQuote guarantees
        // it, because a price must never travel as a JS number.
        amountRaw: quote.priceRaw,
        token: quote.paymentToken,
        // Read from the token itself, not assumed - see readTokenMetadata.
        tokenSymbol: tokenMeta.symbol,
        tokenDecimals: tokenMeta.decimals,
        display: null,
        escrowContract: quote.verifyingContract,
      },
    };
  } catch (cause) {
    if (cause instanceof QuoteRejected) {
      /*
       * A DECLINE IS ONLY EVIDENCE OF SELLING IF THERE IS A MENU BEHIND IT.
       *
       * An earlier version treated every QuoteRejected as a pass, reasoning
       * that "I don't do that particular task" is a healthy seller answering a
       * generic probe. Measured against the Singularry platform that is exactly
       * backwards: three agents answer every call - list and negotiate alike -
       * with "Identity tier only, deeper data is not served during beta", which
       * is not a decline of a task at all. Passing it listed three agents that
       * sell nothing.
       *
       * Reaching this line means `list` returned no menu, because a menu returns
       * early above. So there is no evidence this agent sells anything.
       */
      return fail(
        "no-menu",
        `Declined to quote and publishes no menu of anything else it sells: ${cause.message}`,
        base,
      );
    }
    return fail(
      "no-menu",
      `The agent answered but its quote could not be honoured: ${cause instanceof Error ? cause.message : String(cause)}`,
      base,
    );
  }
}

/* ---------------------------------------------------------------------------
 * MCP
 * ------------------------------------------------------------------------ */

/*
 * `parseJsonRpc` and `mcpCall` USED TO LIVE HERE (until 2026-09-08).
 *
 * They moved to convex/lib/mcpClient.ts when the Dolphin agent needed
 * `tools/call`, so that the probe and the agent speak one MCP client rather
 * than two that happen to agree today. This is the same invariant this file's
 * header states for the A2A path, applied to MCP: a probe that addresses its
 * target differently from the caller is measuring a different endpoint.
 *
 * Behaviour here is unchanged. The shared client additionally carries an
 * `Mcp-Session-Id` when a server issues one and sends the spec's
 * `notifications/initialized` after the handshake - both of which are no-ops
 * against the stateless servers this probe has always talked to.
 */

/**
 * `initialize`, then `tools/list`.
 *
 * `initialize` is the one call every MCP server must answer before anything
 * else, which makes it the correct handshake and also a harmless one - it opens
 * a session and invokes no tool. `tools/list` is then the MCP equivalent of the
 * A2A service menu: a server advertising at least one tool is offering work.
 * A server that handshakes and exposes nothing is alive and unhireable, which
 * is the same distinction the A2A path draws.
 */
async function probeMCP(endpoint: string): Promise<ProbeResult> {
  try {
    assertSafeUrl(endpoint);
  } catch (cause) {
    return fail("unsafe-url", cause instanceof Error ? cause.message : String(cause));
  }

  const init = await mcpCall(endpoint, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "dolphin-verification-probe", version: "2.0.0" },
  });
  if (!init.ok) return fail(init.failureClass, init.detail, { protocol: "mcp", probedEndpoint: endpoint });

  const initEnvelope = parseJsonRpc(init.body);
  if (!initEnvelope || initEnvelope.error !== undefined || initEnvelope.result === undefined) {
    return fail(
      "protocol",
      `MCP initialize at ${endpoint} did not return a JSON-RPC result.`,
      { protocol: "mcp", probedEndpoint: endpoint },
    );
  }

  const tools = await mcpCall(endpoint, "tools/list", {});
  if (!tools.ok) {
    return fail(
      tools.failureClass,
      `${tools.detail}. It completed the MCP handshake but would not list its tools.`,
      { protocol: "mcp", probedEndpoint: endpoint },
    );
  }

  const toolEnvelope = parseJsonRpc(tools.body);
  const result = toolEnvelope?.result as Record<string, unknown> | undefined;
  const list = Array.isArray(result?.tools) ? (result.tools as unknown[]) : [];
  if (list.length === 0) {
    return fail(
      "no-menu",
      "The MCP server completed a handshake but advertises no tools, so there is no work to hire it for.",
      { protocol: "mcp", probedEndpoint: endpoint },
    );
  }

  const skills: ProbeSkill[] = [];
  for (const raw of list.slice(0, 40)) {
    if (typeof raw !== "object" || raw === null) continue;
    const tool = raw as Record<string, unknown>;
    const name = typeof tool.name === "string" ? tool.name.trim() : "";
    if (name.length === 0) continue;
    /*
     * The tool's own JSON Schema decides this, not a guess from its name. An
     * absent or malformed `required` means nothing is required, which is what
     * the MCP spec says and what every server in this catalog does.
     */
    const schema = tool.inputSchema as { required?: unknown } | null | undefined;
    const required = Array.isArray(schema?.required) ? schema.required : [];

    skills.push({
      name: name.slice(0, 80),
      description:
        typeof tool.description === "string" && tool.description.trim().length > 0
          ? tool.description.trim().slice(0, 300)
          : null,
      requiresInput: required.length > 0,
    });
  }

  const serverInfo = result?.serverInfo as Record<string, unknown> | undefined;
  return {
    state: "live",
    failureClass: null,
    detail:
      `MCP server ${String(serverInfo?.name ?? "")} completed the handshake and advertises ` +
      `${list.length} tool${list.length === 1 ? "" : "s"}.`.replace(/\s+/g, " "),
    protocol: "mcp",
    probedEndpoint: endpoint,
    skills,
    cardName: typeof serverInfo?.name === "string" ? serverInfo.name : null,
    // MCP has no price negotiation in the ERC-8183 sense. Null is the honest
    // answer, and it means "no price published", not "free".
    pricing: null,
  };
}

/* ---------------------------------------------------------------------------
 * THE ENTRY POINT
 * ------------------------------------------------------------------------ */

export interface ProbeInput {
  services: readonly { name: string; endpoint: string }[];
  agentWallet: string | null;
}

/**
 * Probes one agent. Never throws: every failure is a ProbeResult, because the
 * caller writes one row per agent either way and an exception there would lose
 * the reason.
 *
 * A2A is tried before MCP when an agent advertises both, because A2A is the
 * transport every ERC-8183 seller in this catalog speaks and the only one that
 * can produce a price.
 */
export async function probeAgent(input: ProbeInput): Promise<ProbeResult> {
  const callable = input.services.filter(
    (service) => !REFERENCE_ONLY_LABELS.has(service.name.toLowerCase()),
  );

  if (callable.length === 0) {
    const skipped = input.services.length;
    return fail(
      "no-endpoint",
      skipped > 0
        ? `The agent advertises ${skipped} endpoint(s), but every label names a reference (a homepage, a spec page, an ENS name) rather than a callable service. Nothing was requested.`
        : "The agent advertises no endpoint at all, so there is nothing to probe. This is not the same as being unreachable.",
    );
  }

  const a2a = callable.filter((service) => !isMcpLabel(service.name));
  const mcp = callable.filter((service) => isMcpLabel(service.name));

  if (a2a.length > 0) {
    const result = await probeA2A(a2a, input.agentWallet);
    if (result.state === "live" || mcp.length === 0) return result;
    // A2A failed and there is an MCP server to try. Fall through rather than
    // reporting the agent dead on the strength of one transport.
  }

  if (mcp.length > 0) {
    return probeMCP(mcp[0].endpoint);
  }

  return fail("no-endpoint", "No callable endpoint remained after filtering reference-only labels.");
}
