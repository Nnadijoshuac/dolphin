import { describe, it, expect } from "vitest";
import {
  recoverTextToolCalls,
  stripToolCallMarkup,
  LEAKED_TOOL_SYNTAX,
} from "@/lib/openrouter-recovery";


describe("openrouter recovery and anti-leak guards", () => {
  it("recovers standard JSON tool calls in an array", () => {
    const raw = `[{"name": "a1__call_agent", "parameters": {"query": "Venus supply APY"}}]`;
    const recovered = recoverTextToolCalls(raw);
    expect(recovered).toHaveLength(1);
    expect(recovered[0].function.name).toBe("a1__call_agent");
    expect(JSON.parse(recovered[0].function.arguments)).toEqual({
      query: "Venus supply APY",
    });
  });

  it("recovers JSON tool calls wrapped in markdown code fence with trailing commas", () => {
    const raw = `I will look into this for you.
\`\`\`json
[
  {
    "name": "a0__get_positions",
    "parameters": {
      "userAddress": "0x123",
    },
  }
]
\`\`\`
Let me know if you need anything else.`;

    const recovered = recoverTextToolCalls(raw);
    expect(recovered).toHaveLength(1);
    expect(recovered[0].function.name).toBe("a0__get_positions");
    expect(JSON.parse(recovered[0].function.arguments)).toEqual({
      userAddress: "0x123",
    });
  });

  it("recovers single JSON object with arguments field", () => {
    const raw = `{"name": "a2__report", "arguments": {"reportType": "summary"}}`;
    const recovered = recoverTextToolCalls(raw);
    expect(recovered).toHaveLength(1);
    expect(recovered[0].function.name).toBe("a2__report");
    expect(JSON.parse(recovered[0].function.arguments)).toEqual({
      reportType: "summary",
    });
  });

  it("recovers XML dots_function_call / invoke dialect", () => {
    const raw = `<dots_function_call>
<invoke name="a1__call_agent">
<parameter name="query">Venus supply APY</parameter>
</invoke>
</dots_function_call>`;

    const recovered = recoverTextToolCalls(raw);
    expect(recovered).toHaveLength(1);
    expect(recovered[0].function.name).toBe("a1__call_agent");
    expect(JSON.parse(recovered[0].function.arguments)).toEqual({
      query: "Venus supply APY",
    });
  });

  it("recovers python/pipe dialect <|tool_call_start|>[tool_name(args)]<|tool_call_end|>", () => {
    const raw = `<|tool_call_start|>[a1__find_agents(query="PancakeSwap Grid")]<|tool_call_end|>`;
    const recovered = recoverTextToolCalls(raw);
    expect(recovered).toHaveLength(1);
    expect(recovered[0].function.name).toBe("a1__find_agents");
    expect(JSON.parse(recovered[0].function.arguments)).toEqual({
      query: "PancakeSwap Grid",
    });
  });

  it("strips XML markup completely from prose", () => {
    const raw = `Here is the plan. <dots_function_call><invoke name="a1__test"><parameter name="q">123</parameter></invoke></dots_function_call> All done.`;
    const cleaned = stripToolCallMarkup(raw);
    expect(cleaned).toBe("Here is the plan.  All done.");
  });

  it("strips code fences with pure tool JSON and pipe syntax", () => {
    const raw = `\`\`\`json
[{"name": "a1__call", "parameters": {}}]
\`\`\``;
    const cleaned = stripToolCallMarkup(raw);
    expect(cleaned).toBe("");
  });

  it("correctly identifies LEAKED_TOOL_SYNTAX", () => {
    expect(LEAKED_TOOL_SYNTAX.test(`<dots_function_call>`)).toBe(true);
    expect(LEAKED_TOOL_SYNTAX.test(`<tool_call>`)).toBe(true);
    expect(LEAKED_TOOL_SYNTAX.test(`<invoke name="test">`)).toBe(true);
    expect(LEAKED_TOOL_SYNTAX.test(`<|tool_call_start|>`)).toBe(true);
    expect(LEAKED_TOOL_SYNTAX.test(`[{"name": "a1"}]`)).toBe(true);
    expect(LEAKED_TOOL_SYNTAX.test(`Hello, I am Dolphin!`)).toBe(false);
  });
});
