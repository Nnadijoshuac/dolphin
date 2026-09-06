/**
 * Can this agent actually be hired to do a job?
 *
 * ---------------------------------------------------------------------------
 * WHY LIVENESS WAS NOT ENOUGH (2026-09-06)
 * ---------------------------------------------------------------------------
 * convex/lib/liveness.ts already probes every candidate and the publish gate
 * already delists after three consecutive failures. It has never delisted the
 * agents that cannot be hired, because it measures a different thing: it fetches
 * `/.well-known/agent-card.json` and POSTs a JSON-RPC `initialize`, while an
 * actual hire POSTs `{skill: "negotiate"}` to the A2A endpoint.
 *
 * Measured the same day: of 31 listed agents, 15 published a callable endpoint
 * and only 9 returned a real price. Three answered 405 to the negotiate call
 * while serving a perfectly valid agent card. An agent can be alive and
 * unsellable, and a marketplace that lists the second is selling a promise it
 * cannot keep.
 *
 * ---------------------------------------------------------------------------
 * THE PROBE ASKS WHAT THE AGENT SELLS, NOT FOR A QUOTE
 * ---------------------------------------------------------------------------
 * `{skill: "list"}` is the seller's own menu endpoint - the same call
 * `describeMenu` in convex/agentPayments.ts already makes to improve an error
 * message. It is the right probe for three reasons:
 *
 *   It commits nothing. A quote proposes a specific task and some sellers treat
 *   that as the start of a negotiation. Asking for a menu is a question.
 *
 *   It is cheap and identical every time, so it can run on a schedule against
 *   every listed agent without inventing a fake task per category.
 *
 *   It answers exactly the listing question: does this agent offer work for
 *   sale? A menu with priced services is an agent that can perform a task. No
 *   menu is not.
 *
 * ---------------------------------------------------------------------------
 * A FAILED PROBE IS NOT IMMEDIATELY A DELISTING
 * ---------------------------------------------------------------------------
 * Structural failure and transport failure are different, and conflating them
 * would delist good agents on a bad afternoon:
 *
 *   no-endpoint    structural. Nothing to probe, nothing will change on its own.
 *                  Excluded at once - no tolerance, because no amount of
 *                  waiting turns an unpublished endpoint into a published one.
 *
 *   unreachable    transport. Somebody's server is down, which is exactly the
 *   http-error     kind of thing that recovers. Tolerated until
 *   no-menu        SELL_FAILURES_BEFORE_DELIST consecutive failures, the same
 *                  shape of rule convex/lib/pipelineStatus.ts already applies
 *                  to liveness.
 *
 *   sells          included, and the failure counter resets.
 *
 *   unknown        never probed yet. Included, deliberately: a brand-new agent
 *                  should not be invisible for up to six hours because nothing
 *                  has got round to asking it a question. It will be probed on
 *                  the next refresh.
 */

import {
  QuoteRejected,
  buildA2ARequest,
  normalizeQuote,
  resolveA2AEndpoint,
} from "./erc8183";

/** Consecutive transport failures before a previously-selling agent is hidden. */
export const SELL_FAILURES_BEFORE_DELIST = 2;

const PROBE_TIMEOUT_MS = 20_000;

export type SellState =
  | "sells"
  | "no-endpoint"
  | "unreachable"
  | "http-error"
  | "no-menu"
  | "unknown";

export type SellProbe = {
  state: SellState;
  /** One checkable sentence. Stored, so "why is this hidden" is answerable later. */
  detail: string;
  /** How many services the agent listed, when it listed any. */
  serviceCount: number | null;
  /**
   * The endpoint that was actually probed, resolved from the agent's card.
   *
   * Persisted so the hire path uses the SAME url the probe proved works,
   * instead of re-deriving it with the path heuristic and knocking on a
   * different door than the one that answered.
   */
  endpoint: string | null;
};

/**
 * The A2A endpoint to probe.
 *
 * RE-EXPORTS selectNegotiationEndpoint rather than reimplementing it. The first
 * version of this file had its own copy that returned the registered endpoint
 * verbatim, and that is wrong for most of this catalog: the `a2a` service these
 * agents publish is the DISCOVERY DOCUMENT - a static
 * /.well-known/agent-card.json - and the JSON-RPC endpoint is its directory.
 * POSTing to the card file returns 404 or 405, which is exactly what the probe
 * reported for nine agents, five of which return real quotes through the very
 * function this should have been calling.
 *
 * The lesson is in the shape of the bug, not the bug: a probe that resolves its
 * target differently from the hire path is measuring a different endpoint and
 * cannot be evidence about hireability. There is now one implementation.
 */
export const sellableEndpoint = resolveA2AEndpoint;

/*
 * The envelope comes from buildA2ARequest, NOT from a copy written here.
 *
 * The first version of this file hand-rolled `params: { skill: "list" }`, which
 * is not the shape any of these sellers speak: the real envelope nests the
 * payload at params.message.parts[0].data. Every agent except the Brain on BNB
 * family rejected it, and the probe reported nine working agents as broken -
 * it would have delisted five that demonstrably sell.
 *
 * A probe that does not send exactly what a hire sends is not measuring
 * hireability, it is measuring itself. Importing the builder makes that
 * impossible to get wrong again.
 */
function buildListRequest() {
  return buildA2ARequest({ skill: "list" });
}

/**
 * What the fallback probe asks for, per category.
 *
 * MANUAL MIRROR of TASK_TEMPLATES in src/wallet/erc8183-policy.ts, shortened -
 * Convex cannot import from src/, the same rule convex/lib/agentCatalog.ts and
 * convex/lib/liveMetric.ts already carry. These are shorter than the real
 * templates on purpose: a probe only needs a task specific enough for the
 * seller to price, and the real hire sends the full text.
 *
 * The address is Dolphin's own probe subject rather than a user's - asking a
 * seller to price work on a real customer's wallet, on a schedule, would leak
 * that customer to every agent in the catalog.
 */
const PROBE_ADDRESS = "0x0000000000000000000000000000000000000001";

const PROBE_TASKS: Readonly<Record<string, string>> = {
  "health-factor": `Report the current health factor for ${PROBE_ADDRESS} on BNB Chain and the repayment that would restore a safe position.`,
  rebalancing: `Price the rebalance for the portfolio held by ${PROBE_ADDRESS} on BNB Chain, including swap fees and price impact.`,
  yield: `Rank the yield venues available to ${PROBE_ADDRESS} on BNB Chain and state whether moving the position pays for itself.`,
  "grid-trading": `Size a grid for the position held by ${PROBE_ADDRESS} on BNB Chain and cost it against the pool, including break-even spacing.`,
  monitoring: `Report the current on-chain activity and notable changes for ${PROBE_ADDRESS} on BNB Chain.`,
  trading: `State the trades you would place for ${PROBE_ADDRESS} on BNB Chain right now, with entry, exit, invalidation and size.`,
};

function buildNegotiateRequest(category: string) {
  const task = PROBE_TASKS[category] ?? PROBE_TASKS.monitoring;
  return buildA2ARequest({
    skill: "negotiate",
    task_description: task,
    // Both live dialects REQUIRE both keys and reject the call without them.
    terms: {
      deliverables: task,
      quality_standards: "Figures read from BNB Chain at request time.",
    },
  });
}

type RawProbe =
  | { ok: true; body: string }
  | { ok: false; state: "unreachable" | "http-error"; detail: string };

async function post(endpoint: string, payload: unknown): Promise<RawProbe> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (cause) {
    return {
      ok: false,
      state: "unreachable",
      detail: `Could not reach ${endpoint}: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }

  const body = await response.text().catch(() => "");
  if (!response.ok) {
    return {
      ok: false,
      state: "http-error",
      detail: `${endpoint} answered HTTP ${response.status}`,
    };
  }
  return { ok: true, body };
}

/**
 * TWO QUESTIONS, CHEAPEST FIRST, AND THE SECOND ONE IS THE DEFINITIVE ONE.
 *
 * The first version of this asked only `{skill:"list"}` and would have delisted
 * five agents that demonstrably sell. Measured 2026-09-06: of the agents that
 * return a real quote, only the Brain on BNB family implements `list` at all -
 * BNB LP Range Rebalancer, Portfolio Rebalancer, Grid Trader, Health Factor
 * Monitor and BNB Grid Trader all answer 405 to it and 200 with a real price to
 * `negotiate`. `list` is an optional convenience, which is exactly why
 * describeMenu in convex/agentPayments.ts treats it as best-effort.
 *
 * So a `list` failure proves nothing and must not be a verdict. It is tried
 * first because it is cheap and commits nothing; when it does not answer, the
 * probe asks the question a hire actually asks. Only failing BOTH is a failure.
 *
 * A DECLINE IS A PASS. A seller that answers "I don't do that particular task,
 * here is what I do sell" is a working, hireable agent responding correctly to a
 * generic probe. What is being tested is whether anyone is home and selling, not
 * whether this exact synthetic task is on the menu.
 */
export async function probeSellability(
  services: readonly { name: string; endpoint: string }[],
  category: string,
  agentWallet: string | null,
): Promise<SellProbe> {
  const endpoint = await sellableEndpoint(services);
  if (!endpoint) {
    return {
      state: "no-endpoint",
      detail:
        "The agent advertises no callable A2A endpoint, so there is no way to ask it for a price or send it work.",
      serviceCount: null,
      endpoint: null,
    };
  }

  // 1. The menu, if it publishes one.
  const listed = await post(endpoint, buildListRequest());
  if (listed.ok) {
    try {
      const envelope = JSON.parse(listed.body) as {
        result?: { services?: unknown };
        error?: { message?: string };
      };
      const menu = envelope?.result?.services;
      if (Array.isArray(menu) && menu.length > 0) {
        return {
          state: "sells",
          detail: `Publishes a menu of ${menu.length} service${menu.length === 1 ? "" : "s"} over its A2A endpoint.`,
          endpoint,
      serviceCount: menu.length,
        };
      }
    } catch {
      // Fall through to the definitive probe rather than judging on a parse.
    }
  }

  // 2. The question a hire actually asks.
  const quoted = await post(endpoint, buildNegotiateRequest(category));
  if (!quoted.ok) {
    return {
      state: quoted.state,
      detail: `${quoted.detail} to the A2A call a hire begins with, and it publishes no service menu either.`,
      endpoint,
      serviceCount: null,
    };
  }

  let envelope: { result?: unknown; error?: { message?: string } };
  try {
    envelope = JSON.parse(quoted.body) as typeof envelope;
  } catch {
    return {
      state: "no-menu",
      detail: `${endpoint} answered with something that is not JSON, so it cannot be negotiated with.`,
      endpoint,
      serviceCount: null,
    };
  }

  if (envelope?.error) {
    return {
      state: "no-menu",
      detail: `The agent returned a JSON-RPC error when asked to price work: ${envelope.error.message ?? "unspecified"}.`,
      endpoint,
      serviceCount: null,
    };
  }

  if (envelope?.result === undefined || envelope.result === null) {
    return {
      state: "no-menu",
      detail: "The agent answered the negotiate call with an empty result.",
      endpoint,
      serviceCount: null,
    };
  }

  /*
   * ANSWERING IS NOT THE SAME AS BEING HIREABLE.
   *
   * Two agents answered this call with HTTP 200 and a quote whose price
   * requestQuote then refused: "cannot read as atomic token units: undefined".
   * Listing them would put a Hire button in front of a checkout that always
   * fails, which is the same broken promise as listing a dead endpoint - just
   * discovered one screen later, after the user has committed attention to it.
   *
   * So the probe runs the SAME validation the hire runs. Passing it means
   * requestQuote would have produced a payable quote.
   *
   * A DECLINE STILL PASSES. QuoteRejected is a seller saying "I don't do that
   * particular task" - a correct response to a generic probe from a working,
   * hireable agent. That is the one failure mode here that is evidence of
   * health rather than against it, which is why it is caught separately from
   * every other reason normalizeQuote throws.
   */
  if (!agentWallet) {
    return {
      state: "no-menu",
      detail:
        "The agent answered, but has no registered on-chain wallet, so Dolphin cannot verify who a payment would go to and will not offer a hire it could not settle.",
      endpoint,
      serviceCount: null,
    };
  }

  try {
    normalizeQuote(envelope.result, {
      agentWallet,
      taskDescription: PROBE_TASKS[category] ?? PROBE_TASKS.monitoring,
    });
  } catch (cause) {
    if (cause instanceof QuoteRejected) {
      return {
        state: "sells",
        detail:
          "Declined this specific probe task but answered correctly, which is a working seller responding to a task it does not offer.",
        endpoint,
      serviceCount: null,
      };
    }
    return {
      state: "no-menu",
      detail: `The agent answered but its quote could not be honoured: ${cause instanceof Error ? cause.message : String(cause)}`,
      endpoint,
      serviceCount: null,
    };
  }

  return {
    state: "sells",
    detail:
      "Returned a payable quote for the A2A negotiate call a hire begins with. It publishes no separate service menu, which is optional.",
    endpoint,
    serviceCount: null,
  };
}

/**
 * Whether an agent with this recorded probe result should appear in the
 * catalog.
 *
 * The single place this decision is made. `listAgents` calls it and nothing
 * else does, so "why can I not see this agent" has exactly one answer.
 */
export function isListable(
  state: SellState | null | undefined,
  consecutiveFailures: number | null | undefined,
): boolean {
  if (!state || state === "unknown") return true;
  if (state === "sells") return true;
  if (state === "no-endpoint") return false;
  return (consecutiveFailures ?? 0) < SELL_FAILURES_BEFORE_DELIST;
}
