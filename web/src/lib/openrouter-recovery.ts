export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

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
 * Pulls tool calls out of a message body that should have been a `tool_calls` array.
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
