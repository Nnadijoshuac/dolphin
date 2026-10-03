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
    required: ["reply", "name", "description", "instructions", "toolIds", "blocks"],
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
export function capabilityCount(row: { blocks?: unknown[] | null; knowledgeTools?: { enabled: boolean }[] | null } | null): number {
  return (row?.blocks?.length ?? 0) + (row?.knowledgeTools ?? []).filter((tool) => tool.enabled).length;
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
