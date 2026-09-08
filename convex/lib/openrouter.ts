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
export const DOLPHIN_FALLBACK_MODELS = [
  "dots-studio/dots-3-note-preview:free",
  "openrouter/free",
];

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
export async function chatCompletion(options: {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  toolChoice?: "auto" | "required" | "none";
  /** A JSON Schema. Turns the reply into a validated object rather than prose. */
  responseSchema?: { name: string; schema: Record<string, unknown> };
  model?: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<ChatResult> {
  const apiKey = readApiKey();
  const model = options.model ?? DOLPHIN_PRIMARY_MODEL;

  const body: Record<string, unknown> = {
    model,
    // OpenRouter's own fallback: when every provider for `model` is exhausted
    // it tries these in order rather than failing the request.
    models: [model, ...DOLPHIN_FALLBACK_MODELS.filter((m) => m !== model)],
    messages: options.messages,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.2,
  };

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

  return {
    content: typeof message.content === "string" ? message.content : "",
    toolCalls,
    model: typeof parsed.model === "string" ? parsed.model : model,
    finishReason: typeof first.finish_reason === "string" ? first.finish_reason : null,
  };
}
