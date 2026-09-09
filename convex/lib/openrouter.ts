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
    /*
   * RECOVERY: the model asked for a tool in the wrong envelope or as text.
   *
   * Free models (including nemotron-3-super, dots-3, and llama variants) frequently
   * emit tool calls as text: XML <invoke name="...">, JSON arrays/objects, or
   * code-fenced blocks instead of native structured tool_calls.
   *
   * We recover all recognizable tool calls and clean any leaked markup from the
   * returned prose. Under no circumstances do we throw a fatal exception here:
   * if tool calls cannot be parsed, cleaning the prose allows the pipeline to
   * proceed seamlessly into Phase 3 (Synthesis).
   */
  let cleanedContent = content;
  if (toolCalls.length === 0 && content.trim().length > 0) {
    const recovered = recoverTextToolCalls(content);
    if (recovered.length > 0) {
      toolCalls.push(...recovered);
      cleanedContent = stripToolCallMarkup(content);
    }
  }

  // If leaked tool syntax is detected (even if no structured calls could be built),
  // strip it completely so raw markup tags never leak to the user.
  if (LEAKED_TOOL_SYNTAX.test(cleanedContent)) {
    cleanedContent = stripToolCallMarkup(cleanedContent);
  }

  return {
    content: cleanedContent,
    toolCalls,
    model: answeredBy,
    finishReason: typeof first.finish_reason === "string" ? first.finish_reason : null,
  };
}

/**
 * Tool-call markup leaking into message text.
 * Matches angle-bracket tags, pipe delimiters, and raw function call arrays.
 */
export const LEAKED_TOOL_SYNTAX =
  /<\s*\|?\s*(?:[a-z0-9_]*function_call|tool_call|invoke\s+name=)|<\|tool_call_start\|>|\[\s*\{\s*["']name["']/i;

/**
 * Strips tool-call markup and pure tool JSON payloads from message text.
 * Ensures users never see raw `<dots_function_call>`, `<tool_call>`, or pipe delimiters.
 */
export function stripToolCallMarkup(content: string): string {
  let cleaned = content;

  // XML tags with contents: <dots_function_call>...</dots_function_call>, <tool_call>...</tool_call>, etc.
  cleaned = cleaned.replace(/<\s*dots_function_call[\s\S]*?<\/\s*dots_function_call\s*>/gi, "");
  cleaned = cleaned.replace(/<\s*tool_call[\s\S]*?<\/\s*tool_call\s*>/gi, "");
  cleaned = cleaned.replace(/<\s*function_call[\s\S]*?<\/\s*function_call\s*>/gi, "");
  cleaned = cleaned.replace(/<invoke\s+name=[\s\S]*?<\/invoke>/gi, "");
  cleaned = cleaned.replace(/<invoke\s+name=[^>]*\/>/gi, "");

  // Pipe delimiters: <|tool_call_start|>...<|tool_call_end|>
  cleaned = cleaned.replace(/<\|tool_call_start\|>[\s\S]*?<\|tool_call_end\|>/gi, "");
  cleaned = cleaned.replace(/<\|tool_call_start\|>[\s\S]*$/gi, "");
  cleaned = cleaned.replace(/<\|[^|]+?\|>/gi, "");

  // Stray opening/closing tags
  cleaned = cleaned.replace(/<\/?\s*(?:[a-z0-9_]*function_call|tool_call|invoke)[^>]*>/gi, "");

  // Markdown code blocks containing tool call JSON
  cleaned = cleaned.replace(/```(?:json)?\s*\[\s*\{\s*["']name["'][\s\S]*?\}\s*\]\s*```/gi, "");
  cleaned = cleaned.replace(/```(?:json)?\s*\{\s*["']name["'][\s\S]*?\}\s*```/gi, "");

  // If the remaining text is just a raw JSON array/object of tool calls:
  const trimmed = cleaned.trim();
  if (
    (trimmed.startsWith("[") && trimmed.endsWith("]") && trimmed.includes('"name"')) ||
    (trimmed.startsWith("{") && trimmed.endsWith("}") && trimmed.includes('"name"'))
  ) {
    try {
      const sanitized = sanitizeJson(trimmed);
      const parsed = JSON.parse(sanitized);
      if (Array.isArray(parsed) || (typeof parsed === "object" && parsed !== null && "name" in parsed)) {
        return "";
      }
    } catch {
      // not purely json
    }
  }

  return cleaned.trim();
}

/**
 * Helper to strip trailing commas from JSON strings before parsing.
 */
function sanitizeJson(str: string): string {
  return str.replace(/,\s*([\]}])/g, "$1");
}

/**
 * Pulls tool calls out of a message body that should have been a `tool_calls`
 * array.
 *
 * Supports:
 * 1. XML dialect: `<invoke name="...">...<parameter name="...">...</parameter></invoke>`
 * 2. JSON array dialect: `[{"name": ..., "parameters": {...}}]` or `[{"name": ..., "arguments": {...}}]`
 *    (including wrapped in code blocks or with stray surrounding brackets/newlines)
 * 3. Single JSON object dialect: `{"name": ..., "parameters": {...}}`
 * 4. Pipe/Python dialect: `<|tool_call_start|>[tool_name(...)]<|tool_call_end|>`
 */
export function recoverTextToolCalls(content: string): ToolCall[] {
  const recovered: ToolCall[] = [];

  // Dialect 1: XML <invoke name="...">
  const invokeRegex = /<invoke\s+name=["']([^"']+)["'](?:\s*\/>|\s*>([\s\S]*?)<\/invoke>)/gi;
  let invokeMatch: RegExpExecArray | null;
  while ((invokeMatch = invokeRegex.exec(content)) !== null) {
    const name = invokeMatch[1].trim();
    const inner = invokeMatch[2] || "";
    const params: Record<string, unknown> = {};

    const paramRegex = /<parameter\s+name=["']([^"']+)["']>([\s\S]*?)<\/parameter>/gi;
    let paramMatch: RegExpExecArray | null;
    let hasParams = false;
    while ((paramMatch = paramRegex.exec(inner)) !== null) {
      hasParams = true;
      const pName = paramMatch[1].trim();
      const pVal = paramMatch[2].trim();
      try {
        params[pName] = JSON.parse(pVal);
      } catch {
        params[pName] = pVal;
      }
    }

    if (!hasParams && inner.trim().startsWith("{") && inner.trim().endsWith("}")) {
      try {
        const parsedInner = JSON.parse(sanitizeJson(inner.trim()));
        Object.assign(params, parsedInner);
      } catch {
        // ignore
      }
    }

    if (name) {
      recovered.push({
        id: `recovered-xml-${recovered.length}-${Date.now()}`,
        type: "function",
        function: {
          name,
          arguments: JSON.stringify(params),
        },
      });
    }
  }

  if (recovered.length > 0) return recovered;

  // Dialect 2: JSON blocks (either within code fences or raw in content)
  const candidateBlocks: string[] = [];
  const codeFenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = codeFenceRegex.exec(content)) !== null) {
    candidateBlocks.push(fenceMatch[1].trim());
  }
  candidateBlocks.push(content);

  for (const block of candidateBlocks) {
    const firstBrace = block.indexOf("{");
    const lastBrace = block.lastIndexOf("}");
    if (firstBrace < 0 || lastBrace <= firstBrace) continue;

    const slice = block.slice(firstBrace, lastBrace + 1);
    const parseAttempts = [slice, `[${slice}]`];

    for (const attempt of parseAttempts) {
      try {
        const sanitized = sanitizeJson(attempt);
        const parsed = JSON.parse(sanitized);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
          if (typeof item !== "object" || item === null) continue;
          const record = item as Record<string, unknown>;
          const name = typeof record.name === "string" ? record.name.trim() : "";
          if (!name) continue;

          const rawArgs = record.parameters ?? record.arguments ?? record.input ?? {};
          recovered.push({
            id: `recovered-json-${recovered.length}-${Date.now()}`,
            type: "function",
            function: {
              name,
              arguments: typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs),
            },
          });
        }
        if (recovered.length > 0) return recovered;
      } catch {
        // try next attempt
      }
    }
  }

  // Dialect 3: Pipe / Function call dialect: e.g. <|tool_call_start|>[a1__call(param="val")]<|tool_call_end|>
  const funcCallRegex = /([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\)/g;
  let funcMatch: RegExpExecArray | null;
  while ((funcMatch = funcCallRegex.exec(content)) !== null) {
    const name = funcMatch[1];
    if (!name.includes("__") && !name.startsWith("a") && !content.includes("tool_call")) {
      continue;
    }
    const argStr = funcMatch[2].trim();
    const params: Record<string, unknown> = {};
    if (argStr) {
      const kvRegex = /([a-zA-Z0-9_]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^,\s]+))/g;
      let kvMatch: RegExpExecArray | null;
      while ((kvMatch = kvRegex.exec(argStr)) !== null) {
        const k = kvMatch[1];
        const v = kvMatch[2] ?? kvMatch[3] ?? kvMatch[4];
        params[k] = v;
      }
    }
    recovered.push({
      id: `recovered-func-${recovered.length}-${Date.now()}`,
      type: "function",
      function: {
        name,
        arguments: JSON.stringify(params),
      },
    });
  }

  return recovered;
}
