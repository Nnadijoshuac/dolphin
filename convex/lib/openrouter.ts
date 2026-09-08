/**
 * OpenRouter - the model behind the Dolphin agent.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT safeFetch
 * ---------------------------------------------------------------------------
 * `safeFetch` exists for URLs a STRANGER chose - agent cards, MCP endpoints,
 * anything derived from an on-chain tokenURI. OpenRouter is a fixed host this
 * project picked, reached over a constant URL that no publisher can influence,
 * so the SSRF defence it provides has nothing to defend here.
 *
 * This is a deliberate exception, not an oversight. Do not "fix" it by routing
 * this through safeFetch, and do NOT read the opposite lesson either: every
 * call to a marketplace agent still goes through safeFetch, without exception.
 *
 * ---------------------------------------------------------------------------
 * WHY A FREE MODEL, AND WHAT THAT COSTS
 * ---------------------------------------------------------------------------
 * Measured against OpenRouter's live model list on 2026-09-08: of 426 models,
 * 19 are free, 16 of those support tool calling, and only 3 of those also
 * support structured outputs. That last filter is not a preference - the
 * decision shape this agent returns is enforced by a JSON schema, because a
 * model free-typing numbers into prose is precisely the fabricated-metric
 * failure AGENTS.md §5 forbids.
 *
 * `nvidia/nemotron-3-super-120b-a12b:free` is the primary: tools, tool_choice,
 * structured_outputs, response_format, 262K context, and NVIDIA describes it as
 * built for multi-agent applications.
 *
 * `openrouter/free` is deliberately NOT the primary. It selects a free model at
 * random per request, so tool-calling reliability becomes non-deterministic -
 * the wrong property for the one path this product demonstrates. It sits last
 * in the fallback chain, where a random model beats no answer.
 *
 * ---------------------------------------------------------------------------
 * RATE LIMITS ARE A PRODUCT CONSTRAINT HERE, NOT AN EDGE CASE
 * ---------------------------------------------------------------------------
 * Free variants are capped per-minute AND per-day, tiered on whether the
 * account has ever purchased credits, and OpenRouter governs that capacity
 * globally - more API keys do not help. Their own FAQ says free models are
 * "usually not suitable for production use".
 *
 * Two consequences the caller must honour: reuse a cached answer when the same
 * question is asked twice (see dolphinMessages.promptHash), and surface a
 * rate-limit refusal as a plain sentence rather than a generic failure, because
 * "we are out of free calls today" and "the agent is broken" are different
 * facts and only one of them is true.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Verified present in OpenRouter's live model list on 2026-09-08. */
export const DOLPHIN_PRIMARY_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";

/**
 * Tried in order when the primary is exhausted or unavailable. Both carry
 * tools + structured outputs; the router is last for the reason above.
 */
export const DOLPHIN_FALLBACK_MODELS = ["dots-studio/dots-3-note-preview:free"];

/*
 * `openrouter/free` WAS the last entry here and was REMOVED on 2026-09-08,
 * after it did the thing this file already warned it would do.
 *
 * It selects a free model at random per request. On a live run it selected
 * `liquid/lfm-2.5-2.6b:free` - a 2.6B model - which answered a synthesis call
 * with a raw `<|tool_call_start|>` block instead of prose. A router that can
 * hand a user-facing answer to an arbitrarily small model is not a safety net;
 * it is an unbounded quality floor.
 *
 * Keeping it as "better than no answer" was the wrong trade: a garbage answer
 * is worse than a stated failure, because only one of the two tells the user
 * something true.
 */

const REQUEST_TIMEOUT_MS = 90_000;

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatResult = {
  /** The assistant's prose. Empty string when it only called tools. */
  content: string;
  toolCalls: ToolCall[];
  /** Which model actually answered - the fallback chain makes this vary. */
  model: string;
  finishReason: string | null;
};

/**
 * Thrown for anything the caller should say out loud rather than retry blindly.
 * `isRateLimit` separates "no free calls left" from "something is broken",
 * because telling a user the second when the first is true is a lie.
 */
export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly isRateLimit: boolean = false,
  ) {
    super(message);
  }
}

function readApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key || key.trim().length === 0) {
    throw new OpenRouterError(
      "OPENROUTER_API_KEY is not set on this Convex deployment, so the Dolphin " +
        "agent has no model to think with. Set it with `npx convex env set`.",
    );
  }
  return key.trim();
}

/**
 * One chat completion, with tools.
 *
 * `tool_choice` is exposed because a weak model left to its own judgement will
 * often answer from its own knowledge rather than consult an agent - which
 * would produce exactly the confident unsourced number this product exists to
 * not produce. Forcing the first call is how the evidence gets gathered.
 */
/**
 * Transient upstream failures, retried rather than surfaced.
 *
 * Nvidia returned "Service temporarily overloaded" on three separate runs
 * during one afternoon of testing, and a demo that dies on a provider hiccup is
 * not a demo. Deliberately NOT retried: a 429. A free-tier daily cap does not
 * clear in two seconds, and hammering it is how an account earns a longer one.
 */
const TRANSIENT_UPSTREAM = /overloaded|temporarily|timeout|502|503|504|unavailable/i;

const MAX_ATTEMPTS = 3;

/**
 * `chatCompletion` with retries on transient upstream failure.
 *
 * Wraps rather than complicates the single-shot version below, so the retry
 * policy is readable in one place and the request-building logic is not
 * threaded through a loop.
 */
export async function chatCompletion(
  options: Parameters<typeof chatCompletionOnce>[0],
): Promise<ChatResult> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await chatCompletionOnce(options);
    } catch (cause) {
      lastError = cause;

      const retryable =
        cause instanceof OpenRouterError &&
        !cause.isRateLimit &&
        TRANSIENT_UPSTREAM.test(cause.message);

      if (!retryable || attempt === MAX_ATTEMPTS - 1) throw cause;

      // 1s, then 2s. Long enough for a provider blip, short enough that a user
      // watching a spinner does not conclude the app has hung.
      await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
    }
  }

  throw lastError;
}

async function chatCompletionOnce(options: {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  toolChoice?: "auto" | "required" | "none";
  /** A JSON Schema. Turns the reply into a validated object rather than prose. */
  responseSchema?: { name: string; schema: Record<string, unknown> };
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /**
   * Whether OpenRouter may substitute another free model when the primary is
   * exhausted. Defaults to true, and MUST be false whenever `tools` are
   * attached - see the block comment below.
   */
  allowFallbacks?: boolean;
}): Promise<ChatResult> {
  const apiKey = readApiKey();
  const model = options.model ?? DOLPHIN_PRIMARY_MODEL;
  const hasTools = Boolean(options.tools && options.tools.length > 0);

  /*
   * FALLBACKS ARE SAFE WITHOUT TOOLS AND DANGEROUS WITH THEM.
   *
   * Measured 2026-09-08, second end-to-end run. The primary was unavailable,
   * OpenRouter fell back to dots-3-note-preview, and that model emitted its
   * tool call as TEXT - a literal `<dots_function_call><invoke name=...>` block
   * in the message body - instead of a structured `tool_calls` array. The
   * caller saw zero tool calls, concluded the model had finished, and rendered
   * the raw XML to the user as the answer.
   *
   * It advertises `tools` support on the model list. It does not reliably
   * deliver it, which is the concrete form of OpenRouter's own warning that
   * free models are "usually not suitable for production use".
   *
   * So: a call WITH tools is pinned to one model and fails loudly when that
   * model is gone, because a wrong model here produces silent garbage rather
   * than an error. A call WITHOUT tools is plain prose generation that any of
   * these models can do, so the chain stays on and buys real resilience.
   */
  /*
   * REVERSED 2026-09-08, same day, after measurement. This defaulted to
   * `!hasTools` - fallbacks off whenever tools were attached - because a
   * fallback model had leaked its tool call as text and that garbage reached a
   * user as an answer.
   *
   * That reasoning was right about the danger and wrong about the remedy. Three
   * guards now stand between a bad generation and a user: LEAKED_TOOL_SYNTAX
   * rejects a call written as markup, recoverTextToolCalls salvages the JSON
   * dialect, and convex/dolphin.ts refuses to answer at all when nothing was
   * consulted. Garbage can no longer be presented as an answer.
   *
   * What remains is availability, and the primary is genuinely flaky: Nvidia
   * returned "Service temporarily overloaded" on three separate runs. With
   * fallbacks off, every one of those is a dead turn. With them on, the worst
   * case is a clear error the guards produce.
   */
  const useFallbacks = options.allowFallbacks ?? true;

  const body: Record<string, unknown> = {
    model,
    messages: options.messages,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.2,
  };

  if (useFallbacks) {
    // OpenRouter's own fallback: when every provider for `model` is exhausted
    // it tries these in order rather than failing the request.
    body.models = [model, ...DOLPHIN_FALLBACK_MODELS.filter((m) => m !== model)];
  }

  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
    body.tool_choice = options.toolChoice ?? "auto";
  }

  if (options.responseSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: options.responseSchema.name,
        strict: true,
        schema: options.responseSchema.schema,
      },
    };
  }

  let response: Response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        // OpenRouter attributes usage to an app by these. Neither carries
        // anything about the user.
        "http-referer": "https://dolphinamp.vercel.app",
        "x-title": "Dolphin",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new OpenRouterError(
      `Could not reach OpenRouter: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const text = await response.text();

  if (response.status === 429) {
    throw new OpenRouterError(
      "Dolphin has used up its free model calls for now. Free-tier limits reset " +
        "on a daily cycle, and they are counted per account rather than per key.",
      true,
    );
  }
  if (!response.ok) {
    throw new OpenRouterError(
      `OpenRouter answered HTTP ${response.status}: ${text.slice(0, 400)}`,
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new OpenRouterError("OpenRouter returned a body that was not JSON.");
  }

  /*
   * A rate limit hit AFTER the response opened arrives in the body with an
   * `error` member and HTTP 200, not as a 429. Reading only the status code
   * would surface this as an empty answer with no explanation - which is what
   * "the agent stopped mid-sentence for no reason" looks like to a user.
   */
  const inlineError = parsed.error as Record<string, unknown> | undefined;
  if (inlineError) {
    const message = typeof inlineError.message === "string" ? inlineError.message : "unknown error";
    const code = inlineError.code;
    throw new OpenRouterError(`OpenRouter refused the request: ${message}`, code === 429);
  }

  const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
  const first = (choices[0] ?? {}) as Record<string, unknown>;
  const message = (first.message ?? {}) as Record<string, unknown>;

  const rawToolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const toolCalls: ToolCall[] = [];
  for (const entry of rawToolCalls) {
    const call = entry as Record<string, unknown>;
    const fn = (call.function ?? {}) as Record<string, unknown>;
    if (typeof call.id !== "string" || typeof fn.name !== "string") continue;
    toolCalls.push({
      id: call.id,
      type: "function",
      function: {
        name: fn.name,
        arguments: typeof fn.arguments === "string" ? fn.arguments : "{}",
      },
    });
  }

  const content = typeof message.content === "string" ? message.content : "";
  const answeredBy = typeof parsed.model === "string" ? parsed.model : model;

  /*
   * RECOVERY: the model asked for a tool in the wrong envelope.
   *
   * MEASURED 2026-09-08, three identical requests to nemotron-3-super with the
   * same 10-tool menu and the same prompt: two returned `finish_reason: "stop"`
   * with a JSON array in the message body, one returned a correct structured
   * call. So this is not a prompt problem or a menu-size problem - the model is
   * non-deterministically unreliable at structured tool calling, roughly one
   * failure in three, and no amount of prompting fixes a coin flip.
   *
   * What it emits when it fails is unambiguous:
   *
   *   [{"name": "a1__find_agents_on_bnb_chain",
   *     "parameters": {"query": "Venus supply APY"}}]
   *
   * Correct tool name, sensible arguments, wrong envelope. Discarding that and
   * failing the turn would be pedantry: NOTHING downstream trusts this shape
   * anyway. The name must resolve to a binding that was built from the catalog,
   * the arguments are re-parsed as JSON, and an unrecognised name is reported
   * back to the model as "no such tool". A recovered call passes through
   * exactly the same gates as a structured one.
   *
   * This is a workaround for a weak free model, not a design. If a model that
   * reliably emits structured calls is ever used here, this stays harmless -
   * it only ever runs when `tool_calls` came back empty.
   */
  if (toolCalls.length === 0 && content.trim().length > 0) {
    toolCalls.push(...recoverTextToolCalls(content));
  }

  /*
   * A model that writes its tool call as prose has not answered - it has
   * failed in a way that looks like an answer, which is worse than failing.
   * See the fallback block above for the run where this reached a user as raw
   * `<dots_function_call>` XML.
   *
   * Only treated as a failure when there are no structured tool calls: a model
   * that correctly emitted `tool_calls` AND happens to mention the syntax in
   * its prose is not malfunctioning.
   */
  if (toolCalls.length === 0 && LEAKED_TOOL_SYNTAX.test(content)) {
    throw new OpenRouterError(
      `The model (${answeredBy}) wrote a tool call as text instead of calling the tool, ` +
        "so its reply was not a usable answer. This is a known failure of some free " +
        "models under tool use.",
    );
  }

  return {
    content,
    toolCalls,
    model: answeredBy,
    finishReason: typeof first.finish_reason === "string" ? first.finish_reason : null,
  };
}

/**
 * Tool-call markup leaking into message text.
 *
 * Two dialects observed live on 2026-09-08, and they do not share a delimiter -
 * which is why this is deliberately loose rather than a precise grammar:
 *
 *   dots-3-note-preview   <dots_function_call><invoke name="a1__call_agent">
 *   liquid/lfm-2.5-2.6b   <|tool_call_start|>[a1_find_agents(...)]<|tool_call_end|>
 *
 * The first version of this regex only matched the angle-bracket form and let
 * the pipe-delimited one straight through to a user. Expect a third dialect;
 * match the shape, not the syntax.
 */
const LEAKED_TOOL_SYNTAX =
  /<\s*\|?\s*(?:[a-z0-9_]*function_call|tool_call|invoke\s+name=)/i;

/**
 * Pulls tool calls out of a message body that should have been a `tool_calls`
 * array. See the recovery block in `chatCompletion` for why this exists.
 *
 * Handles the JSON-array dialect only - `[{"name": ..., "parameters": {...}}]`
 * possibly wrapped in stray brackets or a code fence, which is what
 * nemotron-3-super emits. The pipe-delimited and XML dialects of other free
 * models are NOT recovered: they are caught by LEAKED_TOOL_SYNTAX and reported
 * as a failure, because guessing at a call from a syntax nobody documented is
 * how you invoke the wrong tool.
 *
 * Returns an empty array for anything it cannot read with confidence. Prose
 * that merely mentions a tool name must not become a call.
 */
function recoverTextToolCalls(content: string): ToolCall[] {
  /*
   * Anchored on the BRACES, not the brackets. The first version of this looked
   * for a literal "[{" and never fired once, because what the model actually
   * emits is `[[\n\n{ "name": ... }\n]` - stray opening brackets, newlines
   * between them, and an unbalanced tail. Any bracket-counting parser has to
   * be right about malformed input, which is a bad bet; the object bodies are
   * well-formed even when the array around them is not.
   */
  const first = content.indexOf("{");
  const last = content.lastIndexOf("}");
  if (first < 0 || last <= first) return [];

  const body = content.slice(first, last + 1);

  let parsed: unknown;
  try {
    // Wrapping in brackets covers both one object and several comma-separated.
    parsed = JSON.parse(`[${body}]`);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const recovered: ToolCall[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (name.length === 0) continue;

    // Both spellings appear; `parameters` is what this model uses, `arguments`
    // is what the wire format calls it.
    const args = record.parameters ?? record.arguments ?? {};

    recovered.push({
      id: `recovered-${recovered.length}-${Date.now()}`,
      type: "function",
      function: {
        name,
        arguments: typeof args === "string" ? args : JSON.stringify(args),
      },
    });
  }
  return recovered;
}
