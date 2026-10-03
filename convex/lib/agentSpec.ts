/**
 * THE AGENT A USER BUILDS, and the rules a model's proposal for it must pass.
 *
 * See Agent/PLAN-2026-09-26-build-your-agent.md. A built agent is a saved
 * configuration of the loop Dolphin already runs: a name, a description,
 * instructions, and a set of READ-ONLY tools taken from MCP agents already
 * listed in the catalog. It gets no powers of its own.
 *
 * ---------------------------------------------------------------------------
 * THE MODEL PROPOSES, THIS FILE DECIDES
 * ---------------------------------------------------------------------------
 * The builder model returns a JSON object (`BUILDER_REPLY_SCHEMA`). Nothing in
 * it is trusted as a value:
 *
 *   - Tools are chosen by the id of an entry in a list this backend built from
 *     the catalog (`t1`, `t2`, ...). The model never supplies an agent key, an
 *     endpoint or a tool name, the same rule decisionTools.ts enforces for the
 *     chat: model output narrows a choice, it never supplies a value.
 *   - Text fields are trimmed and length-capped here, not by asking nicely.
 *   - `null` means "leave this field as it is". A free model that forgets a
 *     field must not be able to wipe it.
 *
 * The chat runs on a free model whose structured calls fail about one time in
 * three (measured 2026-09-08), so `parseBuilderReply` also has to survive a
 * reply that is not the requested JSON.
 */

import type { BuilderBlock } from "./builderBlocks";
import { MAX_AGENTS_PER_DECISION, MAX_TOOLS_PER_AGENT } from "./decisionTools";

export const NAME_MAX_CHARS = 60;
export const DESCRIPTION_MAX_CHARS = 280;
export const INSTRUCTIONS_MAX_CHARS = 4_000;

/**
 * At most this many tools in one agent. Below decisionTools' MAX_TOOLS_TOTAL
 * (10), because a try-run hands every one of them to the same free model and
 * that ceiling is where it was measured to stop emitting structured calls.
 */
export const MAX_DRAFT_TOOLS = 8;

/*
 * The per-agent and agent-count caps are decisionTools' own, because a try-run
 * builds its menu with buildToolMenu, which enforces them. A draft that
 * exceeded them would run with tools silently missing.
 */
export const MAX_DRAFT_TOOLS_PER_AGENT = MAX_TOOLS_PER_AGENT;
export const MAX_DRAFT_AGENTS = MAX_AGENTS_PER_DECISION;

export type DraftTool = { agentKey: string; agentName: string; toolName: string };

export type DraftSpec = {
  name: string | null;
  description: string | null;
  instructions: string | null;
  tools: DraftTool[];
};

export const EMPTY_DRAFT: DraftSpec = {
  name: null,
  description: null,
  instructions: null,
  tools: [],
};

/** One tool the builder may pick, as the model sees it: by id only. */
export type OfferedTool = DraftTool & { id: string; description: string | null };

export type BuilderReply = {
  reply: string;
  name: string | null;
  description: string | null;
  instructions: string | null;
  toolIds: string[] | null;
  /** Blocks to add or update (lib/builderBlocks.ts decides). Null or absent: none. */
  blocks: BuilderBlock[] | null;
  /** Who it is for, once the person has said. Null: unchanged. */
  purpose: "private" | "tools" | "hire" | null;
  /**
   * Tools the person described in words (knowledge, step 5): "add a tool that
   * writes a storyboard". lib/knowledgeTools.ts cleanDescribedTool decides. Null: none.
   */
  describedTools?: { name: string; description: string; inputs: { name: string; description: string }[]; instructions: string }[] | null;
  /** Trading rules (fast rules, phase 2): raw, checked by lib/strategy.ts cleanRule before anything is saved. Null: none. */
  rules?: unknown[] | null;
};

/**
 * Strict json_schema for `chatCompletion({ responseSchema })`. Strict mode
 * requires every property to be listed in `required`, so "no change" is
 * expressed as null rather than as a missing key.
 */
export const BUILDER_REPLY_SCHEMA = {
  name: "agent_builder_turn",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["reply", "name", "description", "instructions", "toolIds", "blocks", "describedTools", "rules"],
    properties: {
      reply: {
        type: "string",
        description: "What you say to the person this turn. Short, plain prose.",
      },
      name: { type: ["string", "null"], description: "The agent's name, or null to keep it." },
      description: {
        type: ["string", "null"],
        description: "One or two sentences on what the agent does, or null to keep it.",
      },
      instructions: {
        type: ["string", "null"],
        description: "The agent's full instructions, written to the agent, or null to keep them.",
      },
      toolIds: {
        type: ["array", "null"],
        items: { type: "string" },
        description: "The complete set of tool ids the agent should have, or null to keep them.",
      },
      rules: {
        type: ["array", "null"],
        description:
          "Trading rules the agent runs with NO model call, or null for none. Only for an agent that trades on market conditions. Each acts on CLOSED candles.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "venue", "market", "timeframe", "when", "action", "sizeUsd", "until", "stopLossPct", "takeProfitPct", "leverage", "maxTradesPerDay", "cooldownMinutes"],
          properties: {
            name: { type: ["string", "null"], description: "A short name, or null to describe it automatically." },
            venue: { type: "string", enum: ["dolphin-wallet", "binance-wallet", "binance-spot", "binance-futures"] },
            market: { type: "string", description: "A Binance pair such as BNBUSDT." },
            timeframe: { type: "string", enum: ["1m", "5m", "15m", "1h", "4h", "1d"] },
            when: { type: "array", description: "Entry: ALL must hold on the same closed candle.", items: {
            type: "object",
            additionalProperties: false,
            required: ["kind", "op", "direction", "value", "period", "ma", "length", "fast", "slow", "candles"],
            properties: {
              kind: { type: "string", enum: ["rsi", "price_vs_ma", "ma_cross", "macd_cross", "trend", "price", "change_pct"] },
              op: { type: ["string", "null"], description: "above or below (rsi, price_vs_ma, price, change_pct)." },
              direction: { type: ["string", "null"], description: "up or down (ma_cross, macd_cross, trend)." },
              value: { type: ["number", "null"], description: "rsi level, price, or % for change_pct (negative for drops)." },
              period: { type: ["number", "null"], description: "rsi period, usually 14." },
              ma: { type: ["string", "null"], description: "sma or ema." },
              length: { type: ["number", "null"], description: "price_vs_ma: the moving average length." },
              fast: { type: ["number", "null"], description: "ma_cross: fast length." },
              slow: { type: ["number", "null"], description: "ma_cross: slow length." },
              candles: { type: ["number", "null"], description: "trend: candles in a row; change_pct: over how many candles." },
            },
          } },
            action: { type: "string", enum: ["buy", "short"], description: "buy goes long; short only on binance-futures. A rule sells by its exits." },
            sizeUsd: { type: "number", description: "Dollars per entry." },
            until: { type: "array", description: "Exit: ALL must hold. Empty: only stop-loss / take-profit.", items: {
            type: "object",
            additionalProperties: false,
            required: ["kind", "op", "direction", "value", "period", "ma", "length", "fast", "slow", "candles"],
            properties: {
              kind: { type: "string", enum: ["rsi", "price_vs_ma", "ma_cross", "macd_cross", "trend", "price", "change_pct"] },
              op: { type: ["string", "null"], description: "above or below (rsi, price_vs_ma, price, change_pct)." },
              direction: { type: ["string", "null"], description: "up or down (ma_cross, macd_cross, trend)." },
              value: { type: ["number", "null"], description: "rsi level, price, or % for change_pct (negative for drops)." },
              period: { type: ["number", "null"], description: "rsi period, usually 14." },
              ma: { type: ["string", "null"], description: "sma or ema." },
              length: { type: ["number", "null"], description: "price_vs_ma: the moving average length." },
              fast: { type: ["number", "null"], description: "ma_cross: fast length." },
              slow: { type: ["number", "null"], description: "ma_cross: slow length." },
              candles: { type: ["number", "null"], description: "trend: candles in a row; change_pct: over how many candles." },
            },
          } },
            stopLossPct: { type: ["number", "null"] },
            takeProfitPct: { type: ["number", "null"] },
            leverage: { type: ["number", "null"], description: "binance-futures only; 1 unless the person asked for leverage (max 5)." },
            maxTradesPerDay: { type: ["number", "null"] },
            cooldownMinutes: { type: ["number", "null"] },
          },
        },
      },
      describedTools: {
        type: ["array", "null"],
        description:
          "Tools the person asked for in words that buyers call directly (\"add a tool that writes a storyboard from a style and a length\"), or null for none. Only when they asked for a tool.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "description", "inputs", "instructions"],
          properties: {
            name: { type: "string", description: "snake_case, starts with a verb: make_storyboard." },
            description: { type: "string", description: "One sentence a buyer reads: what it returns." },
            inputs: {
              type: "array",
              description: "Up to three text inputs the caller gives.",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["name", "description"],
                properties: { name: { type: "string" }, description: { type: "string" } },
              },
            },
            instructions: { type: "string", description: "How to do it, written to the model that runs it; say which documents or sections to use." },
          },
        },
      },
      blocks: {
        type: ["array", "null"],
        description: "Toolbox blocks to add or update this turn, or null for none. Fields a block type does not use are null.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["type", "symbol", "everyMinutes", "direction", "priceUsd", "maxTradeUsd", "maxTradesPerDay", "timeframe", "condition", "level"],
          properties: {
            type: { type: "string", enum: ["schedule", "price", "market", "safety", "risk", "swap", "indicators", "signal", "memory"] },
            symbol: { type: ["string", "null"], description: "market: a token symbol from the verified list." },
            everyMinutes: { type: ["number", "null"], description: "schedule: 15, 30, 60, 240 or 1440." },
            direction: { type: ["string", "null"], description: "price: above or below." },
            priceUsd: { type: ["number", "null"], description: "price: the level in USD." },
            maxTradeUsd: { type: ["number", "null"], description: "risk: dollars per trade." },
            maxTradesPerDay: { type: ["number", "null"], description: "risk: trades per day." },
            timeframe: { type: ["string", "null"], description: "indicators and signal: 1h, 4h or 1d." },
            condition: { type: ["string", "null"], description: "signal: rsiBelow, rsiAbove, maCrossUp, maCrossDown, macdCrossUp or macdCrossDown." },
            level: { type: ["number", "null"], description: "signal: the RSI level for rsiBelow/rsiAbove." },
          },
        },
      },
    },
  },
} as const;

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/**
 * The builder's reply as an object, or null when there is no usable one.
 *
 * Tries the whole body first, then the outermost `{...}` in it, because the
 * free model's failure mode is to wrap the JSON in prose or a code fence.
 */
export function parseBuilderReply(content: string): BuilderReply | null {
  const attempts = [content.trim()];
  const first = content.indexOf("{");
  const last = content.lastIndexOf("}");
  if (first >= 0 && last > first) attempts.push(content.slice(first, last + 1));

  for (const attempt of attempts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(attempt);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
    const record = parsed as Record<string, unknown>;

    if (typeof record.reply !== "string") continue;
    /* A missing key reads as "no change"; a wrong type makes the reply unusable. */
    const name = record.name ?? null;
    const description = record.description ?? null;
    const instructions = record.instructions ?? null;
    const toolIds = record.toolIds ?? null;
    // Blocks are optional and lenient: a malformed list is dropped, never the whole reply.
    const blocks = Array.isArray(record.blocks)
      ? (record.blocks as unknown[])
          .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && typeof (item as { type?: unknown }).type === "string")
          .map((item) => ({
            type: String(item.type),
            symbol: typeof item.symbol === "string" ? item.symbol : null,
            everyMinutes: typeof item.everyMinutes === "number" ? item.everyMinutes : null,
            direction: typeof item.direction === "string" ? item.direction : null,
            priceUsd: typeof item.priceUsd === "number" ? item.priceUsd : null,
            maxTradeUsd: typeof item.maxTradeUsd === "number" ? item.maxTradeUsd : null,
            maxTradesPerDay: typeof item.maxTradesPerDay === "number" ? item.maxTradesPerDay : null,
            timeframe: typeof item.timeframe === "string" ? item.timeframe : null,
            condition: typeof item.condition === "string" ? item.condition : null,
            level: typeof item.level === "number" ? item.level : null,
          }))
      : null;
    // Rules pass through raw: lib/strategy.ts cleanRule checks each one before anything is saved.
    const rules = Array.isArray(record.rules) ? (record.rules as unknown[]).filter((item) => typeof item === "object" && item !== null) : null;
    // Described tools are lenient too: an entry missing its words is dropped, never the reply.
    const describedTools = Array.isArray(record.describedTools)
      ? (record.describedTools as unknown[])
          .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && typeof (item as { name?: unknown }).name === "string")
          .map((item) => ({
            name: String(item.name),
            description: typeof item.description === "string" ? item.description : "",
            instructions: typeof item.instructions === "string" ? item.instructions : "",
            inputs: Array.isArray(item.inputs)
              ? (item.inputs as unknown[])
                  .filter((input): input is Record<string, unknown> => typeof input === "object" && input !== null && typeof (input as { name?: unknown }).name === "string")
                  .map((input) => ({ name: String(input.name), description: typeof input.description === "string" ? input.description : "" }))
              : [],
          }))
      : null;
    if (!isStringOrNull(name) || !isStringOrNull(description) || !isStringOrNull(instructions)) {
      continue;
    }
    if (
      toolIds !== null &&
      !(Array.isArray(toolIds) && toolIds.every((id) => typeof id === "string"))
    ) {
      continue;
    }

    return {
      reply: record.reply,
      name,
      description,
      instructions,
      toolIds: toolIds as string[] | null,
      describedTools,
      rules,
      blocks: blocks && blocks.length ? blocks : null,
      purpose: record.purpose === "private" || record.purpose === "tools" || record.purpose === "hire" ? record.purpose : null,
    };
  }

  return null;
}

/**
 * The builder's list ids (`t3`) replaced by what they name.
 *
 * Ids exist only for one builder turn. Measured on dev: instructions came back
 * as "invoke the analyse tool (t1)", which means nothing to the agent at run
 * time, where its tools are named differently. A parenthetical id is dropped,
 * because the sentence already names the tool; a bare one becomes the tool's
 * name.
 */
export function resolveToolIdReferences(text: string, offered: readonly OfferedTool[]): string {
  const byId = new Map(offered.map((tool) => [tool.id, tool]));
  return text
    .replace(/\s*\((?:\s*t\d{1,2}\s*,?)+\)/g, "")
    .replace(/\bt\d{1,2}\b/g, (id) => byId.get(id)?.toolName ?? id);
}

/** Trimmed, whitespace-collapsed and capped; null when nothing is left. */
export function cleanLine(value: string, max: number): string | null {
  const cleaned = value.replace(/\s+/g, " ").trim().slice(0, max).trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** Instructions keep their line breaks; only runs of blank lines are collapsed. */
export function cleanBlock(value: string, max: number): string | null {
  const cleaned = value
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max)
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

export type AppliedReply = {
  draft: DraftSpec;
  /** Which fields actually changed, for a reply when the model wrote none. */
  changed: ("name" | "description" | "instructions" | "tools")[];
  /** Tool ids the model named that were not offered. Logged, never applied. */
  unknownToolIds: string[];
  /** Offered tools dropped because a cap was reached. */
  overLimit: DraftTool[];
};

/**
 * The draft after one builder turn.
 *
 * An EMPTY `toolIds` array is treated like null ("keep"), not as "remove every
 * tool". A draft needs at least one tool to run, and a free model emitting `[]`
 * is far more often forgetfulness than a request to strip the agent bare.
 */
export function applyBuilderReply(
  current: DraftSpec,
  reply: BuilderReply,
  offered: readonly OfferedTool[],
): AppliedReply {
  const next: DraftSpec = { ...current, tools: [...current.tools] };
  const changed: AppliedReply["changed"] = [];

  const name = reply.name === null ? null : cleanLine(reply.name, NAME_MAX_CHARS);
  if (name !== null && name !== current.name) {
    next.name = name;
    changed.push("name");
  }

  const description =
    reply.description === null
      ? null
      : cleanLine(resolveToolIdReferences(reply.description, offered), DESCRIPTION_MAX_CHARS);
  if (description !== null && description !== current.description) {
    next.description = description;
    changed.push("description");
  }

  const instructions =
    reply.instructions === null
      ? null
      : cleanBlock(resolveToolIdReferences(reply.instructions, offered), INSTRUCTIONS_MAX_CHARS);
  if (instructions !== null && instructions !== current.instructions) {
    next.instructions = instructions;
    changed.push("instructions");
  }

  const unknownToolIds: string[] = [];
  const overLimit: DraftTool[] = [];

  if (reply.toolIds !== null && reply.toolIds.length > 0) {
    const byId = new Map(offered.map((tool) => [tool.id, tool]));
    const picked: DraftTool[] = [];
    const perAgent = new Map<string, number>();
    const seen = new Set<string>();

    for (const rawId of reply.toolIds) {
      const tool = byId.get(rawId.trim());
      if (!tool) {
        unknownToolIds.push(rawId);
        continue;
      }
      const identity = `${tool.agentKey}\u0000${tool.toolName}`;
      if (seen.has(identity)) continue;
      seen.add(identity);

      const agentCount = perAgent.get(tool.agentKey) ?? 0;
      const isNewAgent = agentCount === 0;
      if (
        picked.length >= MAX_DRAFT_TOOLS ||
        agentCount >= MAX_DRAFT_TOOLS_PER_AGENT ||
        (isNewAgent && perAgent.size >= MAX_DRAFT_AGENTS)
      ) {
        overLimit.push({ agentKey: tool.agentKey, agentName: tool.agentName, toolName: tool.toolName });
        continue;
      }

      perAgent.set(tool.agentKey, agentCount + 1);
      picked.push({ agentKey: tool.agentKey, agentName: tool.agentName, toolName: tool.toolName });
    }

    /* Every id unknown is the model misfiring, not a request for no tools. */
    if (picked.length > 0 && !sameTools(picked, current.tools)) {
      next.tools = picked;
      changed.push("tools");
    }
  }

  return { draft: next, changed, unknownToolIds, overLimit };
}

function sameTools(a: readonly DraftTool[], b: readonly DraftTool[]): boolean {
  if (a.length !== b.length) return false;
  const key = (tool: DraftTool) => `${tool.agentKey}\u0000${tool.toolName}`;
  const left = new Set(a.map(key));
  return b.every((tool) => left.has(key(tool)));
}

/** What a draft still needs before it can be tried. Empty means runnable. */
/**
 * What a draft can do besides catalog tools: its blocks, and the knowledge
 * tools its documents give (step 2 of Agent/PLAN-2026-10-03-knowledge-mcps.md).
 * One count for every readiness check, so they cannot disagree.
 */
export function capabilityCount(
  row: { blocks?: unknown[] | null; knowledgeTools?: { enabled: boolean }[] | null; rules?: unknown[] | null } | null,
): number {
  // Trading rules (fast rules, phase 2) are a capability too: an agent of rules alone is complete.
  return (row?.blocks?.length ?? 0) + (row?.knowledgeTools ?? []).filter((tool) => tool.enabled).length + (row?.rules?.length ?? 0);
}

export function draftGaps(draft: DraftSpec, blockCount = 0): string[] {
  const gaps: string[] = [];
  if (!draft.name) gaps.push("a name");
  if (!draft.description) gaps.push("a description of what it does");
  if (!draft.instructions) gaps.push("instructions");
  // A flow built from blocks (a Price feed, a Market...) needs no MCP tool (2026-09-29).
  if (draft.tools.length === 0 && blockCount === 0) gaps.push("at least one tool, block or document");
  return gaps;
}
