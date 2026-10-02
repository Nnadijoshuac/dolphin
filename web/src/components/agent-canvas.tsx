"use client";

import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  BaseEdge,
  ControlButton,
  Controls,
  getBezierPath,
  Handle,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import { useMutation } from "convex/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { AgentCanvasInspector } from "@/components/agent-canvas-inspector";
import { AgentIcon } from "@/components/agent-icon";
import type { AgentDraft } from "@/components/agent-draft-panel";
import { CategoryGlyph, type GlyphName } from "@/components/category-glyph";
import { TradingChart } from "@/components/trading-chart";
import { agentBuilderApi, brainProviderLabel, type AgentBlockData, type SignalCondition } from "@/convex/api";
import { useAgentsByKeys } from "@/hooks/use-agents";
import type { Agent } from "@/types/agent";
import { toast } from "@/store/use-toast-store";

/**
 * THE AGENT AS A FLOW DIAGRAM (owner, 2026-09-29: "from the trigger to the
 * brain... the brain consults the strategy and the strategy gives back... then
 * the brain reaches out to the other components... risk limit is a regulator,
 * it sits in between two things").
 *
 *                                           Strategy
 *                                              ⇅  consults, and is answered
 *   When asked ─┐
 *   Schedule ───┼──> TRIGGER ──(once)──>   BRAIN  ──> Answer
 *   Price ──────┤                            │   ──> Risk limits ──> Market (buy / sell)
 *   Wallet watch┘                            │   ──> Hired agent
 *                                            ▼
 *                        Price feed · Safety · Memory · Tools   (it reads them)
 *
 * (2026-09-29, the owner: "the schedule should hit the trigger and then the
 * trigger goes to the brain"; "the trigger is like a trigger of a gun - it
 * fires once and the action starts, like a domino".) Every source of a run
 * plugs into ONE Trigger, which fires into the Brain once per run. On the
 * canvas the trade block is called "Market" (where the purchase happens) and
 * the data block "Price feed"; in code they are still `swap` and `market`.
 *
 * Arrows run the way the work does: a trigger starts the Brain; the Brain
 * calls out to everything else. Nothing pushes into the Brain but its
 * trigger. Risk limits is a regulator on the trade line - no trade reaches
 * the market without passing it - and the Wallet at the end is where a trade
 * executes.
 *
 * The MELON is the agent's strategy - its instructions. Named for the organ in
 * a dolphin's forehead that focuses its echolocation: how it senses and
 * decides. When a Dolphin is sold, the Melon is what the buyer runs but never
 * reads (owner, 2026-09-28).
 *
 * STILL WHEN IDLE, ALIVE WHEN RUNNING (owner: "you've made an engine and you're
 * seeing that engine work"). During a private try-run the `run` prop, derived
 * from the real message status and the real tool-call records (a call is
 * recorded before it runs and completed after - convex/dolphin.ts), lights the
 * path as it happens: trigger -> brain, brain -> each tool while it runs, a
 * tick when it returns, brain -> answer. Nothing is animated that did not
 * happen.
 *
 * Blocks can be dragged; the curves follow. Positions are kept per draft in
 * this browser only (localStorage) - the owner keeps database I/O minimal, and
 * where a box sits is nobody's record.
 *
 * ONLY BLOCKS THAT WORK ARE DRAWN. An unfilled field renders as "Not drafted
 * yet", never as a plausible default (§5). Desktop only.
 */

type BlockKind = "trigger" | "tool" | "melon" | "brain" | "output" | "add" | "sense" | "risk" | "hands";
export type BlockState = "idle" | "active" | "done" | "error";

type BlockData = {
  kind: BlockKind;
  title: string;
  detail: string | null;
  /** Nothing drafted here yet: drawn dashed, and says so. */
  empty?: boolean;
  state?: BlockState;
  /** A toolbox block's own label and icon, over its kind's. */
  label?: string;
  glyph?: GlyphName;
  /** Its connection's id, for cutting and reconnecting (`detached` on the draft). */
  member?: string;
  /** Cut on the canvas: the agent will not use it until it is connected again. */
  detached?: boolean;
  /** A tool's publisher, drawn with its own icon rather than a spanner (owner, 2026-09-28). */
  agent?: { category: string; seed: string | null; uri: string | null };
  /** The toolbox block behind this node, when it is one. */
  blockType?: AgentBlockData["type"];
  /** Draw order, for the staggered entrance. */
  order?: number;
  /** The Market block's expand button: opens the chart over the canvas. */
  onExpand?: () => void;
  /** The one Trigger every run source plugs into. */
  hub?: boolean;
};

type BlockNode = Node<BlockData, "block">;
type FlowEdge = Edge<{ active?: boolean; reverse?: boolean; both?: boolean; once?: boolean; used?: boolean; member?: string; cutAt?: number }, "flow">;

/** What a try-run is doing right now. Null when nothing is running or has run. */
export type CanvasRun = {
  phase: "thinking" | "consulting" | "writing" | "done" | "error";
  tools: { agentKey: string; toolName: string; state: "running" | "done" | "error" }[];
  /** The trigger block type an autopilot run was started by, if any. */
  triggeredBy?: AgentBlockData["type"] | null;
};

const KIND_LABEL: Record<BlockKind, string> = {
  trigger: "Trigger",
  tool: "Tool",
  melon: "Melon · strategy",
  brain: "Brain",
  output: "Output",
  add: "Tool",
  sense: "Sense",
  risk: "Risk",
  hands: "Hands",
};

const KIND_GLYPH = {
  trigger: "arrow-right",
  tool: "spanner",
  melon: "sparkle",
  brain: "brain",
  output: "check",
  add: "add",
  sense: "layers",
  risk: "filter",
  hands: "wallet",
} as const;

const NODE_WIDTH = 248;
const COLUMN_GAP = 130;
/** Mirrors MAX_DRAFT_TOOLS in convex/lib/agentSpec.ts. */
const MAX_TOOLS = 8;

function BlockView({ data, selected }: NodeProps<BlockNode>) {
  const { kind } = data;
  const state = data.state ?? "idle";
  return (
    <div
      className={`agent-block agent-block--${kind} ${data.empty || kind === "add" ? "agent-block--empty" : ""}`}
      data-detached={data.detached || undefined}
      data-selected={selected || undefined}
      data-state={state}
      style={{ width: NODE_WIDTH, animationDelay: `${(data.order ?? 0) * 45}ms` }}
    >
      {kind === "brain" ? (
        <>
          <Handle id="in" position={Position.Left} type="target" />
          <Handle id="strategy" position={Position.Top} type="source" />
          <Handle id="reads" position={Position.Bottom} type="source" />
        </>
      ) : null}
      {kind === "output" || kind === "hands" || kind === "risk" || data.hub ? <Handle id="in" position={Position.Left} type="target" /> : null}
      {data.onExpand ? (
        <button
          aria-label="Expand the chart"
          className="agent-block__expand nodrag nopan"
          onClick={(event) => {
            event.stopPropagation();
            data.onExpand?.();
          }}
          title="Expand the chart"
          type="button"
        >
          <svg aria-hidden fill="none" height="12" viewBox="0 0 16 16" width="12">
            <path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
          </svg>
        </button>
      ) : null}

      <div className="flex items-start gap-2.5">
        {data.agent ? (
          <span className="agent-block__icon agent-block__icon--agent">
            <AgentIcon category={data.agent.category} seed={data.agent.seed ?? undefined} size={30} uri={data.agent.uri ?? undefined} />
          </span>
        ) : (
          <span className="agent-block__icon">
            <CategoryGlyph color="currentColor" name={data.glyph ?? KIND_GLYPH[kind]} size={15} strokeWidth={2} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-muted">{data.label ?? KIND_LABEL[kind]}</span>
            {state === "done" ? <span className="agent-block__tick" aria-label="Done">✓</span> : null}
            {state === "active" ? <span className="agent-block__live" aria-label="Running" /> : null}
            {data.detached ? <span className="agent-block__unplugged">Not connected</span> : null}
          </div>
          <p className={`mt-0.5 truncate text-[0.86rem] font-semibold ${data.empty ? "text-faint" : "text-ink"}`}>
            {data.title}
          </p>
          {data.detail ? (
            <p
              className={`mt-0.5 text-[0.72rem] leading-snug text-muted ${kind === "melon" ? "line-clamp-3" : "truncate"}`}
            >
              {data.detail}
            </p>
          ) : null}
        </div>
      </div>

      {kind === "trigger" ? <Handle id="out" position={Position.Right} type="source" /> : null}
      {kind === "tool" || kind === "sense" ? <Handle id="in" position={Position.Top} type="target" /> : null}
      {kind === "risk" || data.blockType === "swap" ? <Handle id="out" position={Position.Right} type="source" /> : null}
      {kind === "melon" ? <Handle id="in" position={Position.Bottom} type="target" /> : null}
      {kind === "brain" ? <Handle id="out" position={Position.Right} type="source" /> : null}
    </div>
  );
}

/**
 * A curve that bends with its blocks. Idle: a quiet line. Active: the line
 * warms and pulses of light travel along it - toward the brain, or out of it
 * (`reverse`) when the brain is calling a tool.
 */
function FlowEdgeView({ id, data, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }: EdgeProps<FlowEdge>) {
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, curvature: 0.35 });
  if (data?.cutAt !== undefined) return <CutEdge at={data.cutAt} path={path} />;
  const active = Boolean(data?.active);
  const reverse = Boolean(data?.reverse);
  const motion = reverse ? { keyPoints: "1;0", keyTimes: "0;1" } : { keyPoints: "0;1", keyTimes: "0;1" };

  return (
    <>
      <BaseEdge
        className={`agent-edge ${active ? "agent-edge--active" : data?.used ? "agent-edge--used" : ""}`}
        id={id}
        path={path}
        pathLength={1}
      />
      {active ? (
        <>
          <path className="agent-edge__glow" d={path} fill="none" />
          <path className="agent-edge__comet" d={path} data-once={data?.once || undefined} data-reverse={reverse || undefined} fill="none" pathLength={1} />
          {(data?.once ? [] : [0, 0.55]).map((delay, index) => (
            <circle className="agent-edge__pulse" key={delay} r={3.2}>
              <animateMotion
                begin={`${delay}s`}
                calcMode="spline"
                dur="1.1s"
                keySplines="0.45 0 0.25 1"
                path={path}
                repeatCount="indefinite"
                {...(data?.both && index === 1 ? { keyPoints: reverse ? "0;1" : "1;0", keyTimes: "0;1" } : motion)}
              />
            </circle>
          ))}
        </>
      ) : null}
    </>
  );
}

/**
 * A line being cut (owner: "it cuts from where the mouse clicked; one end goes
 * to its node, the other to the other node"). One path drawn as two dashes
 * split at the click, animated so the gap grows from that point while each
 * half retracts into its own block. d1 + gap + d2 stays the path's length.
 */
function CutEdge({ path, at }: { path: string; at: number }) {
  return (
    <path
      className="agent-edge agent-edge--cut"
      d={path}
      fill="none"
      ref={(element) => {
        if (!element || element.dataset.cut) return;
        element.dataset.cut = "1";
        const length = element.getTotalLength();
        const split = at * length;
        // Web Animations, not SMIL: an <animate> added late is timed from page
        // load, so it had already "finished" and the line simply vanished.
        element.animate(
          [
            { strokeDasharray: `${Math.max(0, split - 2)} 4 ${Math.max(0, length - split - 2)} ${length}` },
            { strokeDasharray: `0 ${length} 0 ${length}` },
          ],
          { duration: 420, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" },
        );
      }}
    />
  );
}

const nodeTypes = { block: BlockView };
const edgeTypes = { flow: FlowEdgeView };

/** How each toolbox block is drawn. */
export const BLOCK_LOOK: Record<AgentBlockData["type"], { kind: BlockKind; label: string; glyph: GlyphName }> = {
  schedule: { kind: "trigger", label: "Scheduler", glyph: "clock" },
  price: { kind: "trigger", label: "Price trigger", glyph: "dollar" },
  walletWatch: { kind: "trigger", label: "Wallet watch", glyph: "eye" },
  market: { kind: "sense", label: "Price feed", glyph: "layers" },
  safety: { kind: "sense", label: "Safety check", glyph: "shield" },
  risk: { kind: "risk", label: "Risk limits", glyph: "filter" },
  swap: { kind: "hands", label: "Market", glyph: "wallet" },
  hire: { kind: "hands", label: "Hired agent", glyph: "agents" },
  memory: { kind: "sense", label: "Memory", glyph: "receive" },
  indicators: { kind: "sense", label: "Indicators", glyph: "filter" },
  signal: { kind: "trigger", label: "Signal", glyph: "sparkle" },
  dataSource: { kind: "sense", label: "Data source", glyph: "external" },
  news: { kind: "sense", label: "News", glyph: "share" },
  quietHours: { kind: "risk", label: "Quiet hours", glyph: "clock" },
};

function money(value: number): string {
  return value >= 1 ? `$${value.toLocaleString("en", { maximumFractionDigits: 2 })}` : `$${value.toPrecision(3)}`;
}

function signalTitle(condition: SignalCondition, level: number | null): string {
  switch (condition) {
    case "rsiBelow":
      return `RSI below ${level ?? 30}`;
    case "rsiAbove":
      return `RSI above ${level ?? 70}`;
    case "maCrossUp":
      return "Golden cross (20/50)";
    case "maCrossDown":
      return "Death cross (20/50)";
    case "macdCrossUp":
      return "MACD crosses up";
    case "macdCrossDown":
      return "MACD crosses down";
  }
}

/** A block's one-line summary on the canvas. */
function blockSummary(block: AgentBlockData): { title: string; detail: string } {
  switch (block.type) {
    case "schedule": {
      const minutes = block.config.everyMinutes;
      return { title: minutes >= 60 ? `Every ${minutes / 60} hour${minutes === 60 ? "" : "s"}` : `Every ${minutes} minutes`, detail: "Fires the Trigger on a clock" };
    }
    case "price":
      return { title: `Price ${block.config.direction} ${money(block.config.priceUsd)}`, detail: "Fires once each time it crosses" };
    case "walletWatch":
      return {
        title: block.config.label || `${block.config.addresses.length} wallet${block.config.addresses.length === 1 ? "" : "s"}`,
        detail: `Watching ${block.config.addresses.map((a) => `${a.slice(0, 6)}…${a.slice(-4)}`).join(", ")}`,
      };
    case "market":
      return { title: block.config.symbol, detail: block.config.name || "Live price, liquidity and candles" };
    case "safety":
      return { title: "Token safety", detail: "Honeypot, taxes and owner powers" };
    case "risk":
      return { title: `${money(block.config.maxTradeUsd)} a trade`, detail: `At most ${block.config.maxTradesPerDay} trade${block.config.maxTradesPerDay === 1 ? "" : "s"} a day` };
    case "swap":
      return { title: "Buy / sell", detail: "On PancakeSwap, after the Risk gate" };
    case "hire":
      return { title: block.config.agentName, detail: "Paid A2A agent · you confirm each payment" };
    case "indicators":
      return { title: `${block.config.timeframe === "1d" ? "Daily" : block.config.timeframe === "4h" ? "4-hour" : "1-hour"} indicators`, detail: "RSI, MACD, Bollinger, averages - closed candles" };
    case "signal":
      return { title: signalTitle(block.config.condition, block.config.level), detail: `On each closed ${block.config.timeframe} candle` };
    case "dataSource":
      return { title: block.config.label, detail: block.config.url.replace(/^https:\/\//, "") };
    case "news": {
      const host = block.config.url.replace(/^https:\/\//, "").split("/")[0];
      return { title: "Headlines", detail: `${host}${block.config.keywords.length ? ` · ${block.config.keywords.join(", ")}` : ""}` };
    }
    case "quietHours": {
      const next = block.config.events.map((event) => event.at).filter((at) => Date.parse(at) > Date.now()).sort()[0];
      return { title: `${block.config.events.length} event${block.config.events.length === 1 ? "" : "s"} · ${block.config.marginHours}h aside`, detail: next ? `Next: ${new Date(next).toUTCString().slice(5, 22)} UTC` : "No upcoming event" };
    }
    case "memory":
      return block.config.url
        ? { title: "Your memory server", detail: block.config.url.replace(/^https:\/\//, "") }
        : { title: "Not connected yet", detail: "Add your memory server's address" };
  }
}

/* Layout rhythm. */
const TRIGGER_ROW = 96;
const SENSE_ROW = 104;
const SENSES_PER_ROW = 4;
const ACTION_ROW = 120;
const CHAIN_GAP = 64;

/** The default layout for a draft. Pure, so it is the same on every render. */
export function draftGraph(
  draft: AgentDraft,
  agents: ReadonlyMap<string, Agent> = new Map(),
): { nodes: BlockNode[]; edges: FlowEdge[] } {
  const blocks = draft.blocks ?? [];
  const cut = new Set(draft.detached ?? []);
  // Sources, then the one Trigger, then the Brain.
  const hubX = NODE_WIDTH + COLUMN_GAP;
  const brainX = hubX + NODE_WIDTH + COLUMN_GAP;
  const actionX = brainX + NODE_WIDTH + COLUMN_GAP;
  const brainY = 0;
  const nodes: BlockNode[] = [];
  let order = 0;
  const place = (id: string, x: number, y: number, data: BlockData) => {
    nodes.push({ id, type: "block", position: { x, y }, data: { ...data, order: order++ } });
  };
  const find = <T extends AgentBlockData["type"]>(type: T) =>
    blocks.find((block): block is Extract<AgentBlockData, { type: T }> => block.type === type);
  const agentLook = (agentKey: string): BlockData["agent"] => {
    const agent = agents.get(agentKey);
    return agent ? { category: agent.category, seed: agent.iconSeed ?? null, uri: agent.iconUrl ?? null } : undefined;
  };
  const blockData = (block: AgentBlockData, member = `block:${block.id}`): BlockData => {
    const look = BLOCK_LOOK[block.type];
    return { kind: look.kind, label: look.label, glyph: look.glyph, member, detached: cut.has(member), blockType: block.type, ...blockSummary(block) };
  };

  // BRAIN, with its strategy above it.
  const instructions = draft.instructions?.trim() || null;
  place("brain", brainX, brainY, {
    kind: "brain",
    title: draft.name?.trim() || "Unnamed agent",
    detail: draft.brain ? `${draft.brain.model} · your ${brainProviderLabel(draft.brain.provider)} key` : "No model yet · choose your key",
    empty: !draft.name?.trim() || !draft.brain,
  });
  place("melon", brainX, brainY - 190, { kind: "melon", title: instructions ? "Strategy" : "Not drafted yet", detail: instructions, empty: !instructions });

  // WHEN: what can start a run, down the left - each plugs into the one Trigger.
  const triggers: { id: string; data: BlockData }[] = [
    { id: "source-chat", data: { kind: "trigger", title: "When asked", detail: "Someone sends it a message" } },
  ];
  for (const type of ["schedule", "price", "signal", "walletWatch"] as const) {
    const block = find(type);
    if (block) triggers.push({ id: `block-${block.id}`, data: blockData(block) });
  }
  triggers.forEach((trigger, index) => place(trigger.id, 0, brainY + (index - (triggers.length - 1) / 2) * TRIGGER_ROW, trigger.data));
  place("trigger", hubX, brainY, { kind: "trigger", title: "Trigger", detail: "Fires once, and the run begins", hub: true });

  // KNOWS: what the Brain can read, in rows beneath it.
  const senses: { id: string; data: BlockData }[] = [];
  for (const type of ["market", "indicators", "safety", "dataSource", "news", "memory"] as const) {
    const block = find(type);
    if (block) senses.push({ id: `block-${block.id}`, data: blockData(block) });
  }
  draft.tools.forEach((tool, index) => {
    const member = `tool:${tool.agentKey}:${tool.toolName}`;
    senses.push({
      id: `tool-${index}`,
      data: { kind: "tool", title: tool.toolName, detail: `via ${tool.agentName}`, member, detached: cut.has(member), agent: agentLook(tool.agentKey) },
    });
  });
  if (draft.tools.length === 0) {
    senses.push({ id: "tool-empty", data: { kind: "tool", title: "No tools yet", detail: "From the free MCP agents on Dolphin", empty: true } });
  } else if (draft.tools.length < MAX_TOOLS) {
    senses.push({ id: "add-tool", data: { kind: "add", title: "Add a tool", detail: "From the free MCP agents on Dolphin" } });
  }
  senses.forEach((sense, index) => {
    const row = Math.floor(index / SENSES_PER_ROW);
    const inRow = Math.min(SENSES_PER_ROW, senses.length - row * SENSES_PER_ROW);
    const column = index % SENSES_PER_ROW;
    place(sense.id, brainX + (column - (inRow - 1) / 2) * (NODE_WIDTH + 28), brainY + 200 + row * SENSE_ROW, sense.data);
  });

  // DOES: the answer; the trade chain (gate -> swap -> wallet); a hired agent.
  const risk = find("risk");
  const quiet = find("quietHours");
  const swap = find("swap");
  const hire = find("hire");
  const chain: AgentBlockData[] = [];
  for (const block of [risk, quiet, swap]) if (block) chain.push(block);
  const rows: string[] = ["output", ...(chain.length ? ["chain"] : []), ...(hire ? ["hire"] : [])];
  const rowY = (name: string) => brainY + (rows.indexOf(name) - (rows.length - 1) / 2) * ACTION_ROW;
  place("output", actionX, rowY("output"), { kind: "output", title: "Answer", detail: "Replies with what its tools returned" });
  chain.forEach((block, index) => {
    const data = blockData(block, block.type === "risk" ? "limits" : `block:${block.id}`);
    if (block.type === "risk") Object.assign(data, { detail: `${data.detail} · every trade passes through` });
    place(`block-${block.id}`, actionX + index * (NODE_WIDTH + CHAIN_GAP), rowY("chain"), data);
  });
  if (hire) place(`block-${hire.id}`, actionX, rowY("hire"), { ...blockData(hire), agent: agentLook(hire.config.agentKey) });

  const edge = (source: string, target: string, targetHandle: string, member?: string, sourceHandle = "out"): FlowEdge => ({
    id: `${source}->${target}`,
    source,
    sourceHandle,
    target,
    targetHandle,
    type: "flow",
    data: member ? { member } : {},
  });
  const live = (member: string | undefined) => !member || !cut.has(member);
  const edges: FlowEdge[] = [
    // The Brain consults its strategy.
    edge("brain", "melon", "in", undefined, "strategy"),
    ...triggers.filter((t) => live(t.data.member)).map((t) => edge(t.id, "trigger", "in", t.data.member)),
    edge("trigger", "brain", "in"),
    // The Brain reaches down for what it reads.
    ...senses
      .filter((x) => x.id !== "tool-empty" && x.id !== "add-tool" && live(x.data.member))
      .map((x) => edge("brain", x.id, "in", x.data.member, "reads")),
    edge("brain", "output", "in"),
  ];
  // The trade chain, link by link. Cutting any link stops trades where it is cut.
  if (chain.length) {
    const head = chain[0];
    const headMember = head.type === "risk" ? (swap ? `block:${swap.id}` : "limits") : `block:${head.id}`;
    if (live(headMember)) edges.push(edge("brain", `block-${head.id}`, "in", headMember));
    for (let i = 1; i < chain.length; i++) {
      // Cutting the line out of a gate removes that gate: Risk limits (`limits`) or Quiet hours.
      const link = chain[i - 1].type === "risk" ? "limits" : `block:${chain[i - 1].id}`;
      if (live(link)) edges.push(edge(`block-${chain[i - 1].id}`, `block-${chain[i].id}`, "in", link));
    }
  }
  if (hire && live(`block:${hire.id}`)) edges.push(edge("brain", `block-${hire.id}`, "in", `block:${hire.id}`));

  return { nodes, edges };
}

/** Lights the graph for what a try-run is doing. Pure. */
function applyRun(
  draft: AgentDraft,
  graph: { nodes: BlockNode[]; edges: FlowEdge[] },
  run: CanvasRun | null,
): { nodes: BlockNode[]; edges: FlowEdge[] } {
  if (!run) return graph;
  const nodeState = new Map<string, BlockState>();
  const edgeState = new Map<string, FlowEdge["data"]>();
  const working = run.phase === "thinking" || run.phase === "consulting" || run.phase === "writing";

  if (working || run.phase === "done") {
    // One shot: the Trigger fires into the Brain once, then the line rests as "used".
    nodeState.set("trigger", "done");
    edgeState.set("trigger->brain", run.phase === "thinking" ? { active: true, once: true } : { used: true });
    if (!run.triggeredBy) {
      nodeState.set("source-chat", "done");
      edgeState.set("source-chat->trigger", run.phase === "thinking" ? { active: true, once: true } : { used: true });
    }
  }
  // Consulting the strategy: light both ways while it thinks.
  edgeState.set("brain->melon", run.phase === "thinking" ? { active: true, both: true } : working || run.phase === "done" ? { used: true } : {});
  if (run.phase === "thinking") nodeState.set("melon", "active");
  nodeState.set("brain", run.phase === "error" ? "error" : working ? "active" : run.phase === "done" ? "done" : "idle");

  draft.tools.forEach((tool, index) => {
    const calls = run.tools.filter((call) => call.agentKey === tool.agentKey && call.toolName === tool.toolName);
    if (calls.length === 0) return;
    const id = `tool-${index}`;
    if (calls.some((call) => call.state === "running")) {
      nodeState.set(id, "active");
      edgeState.set(`brain->${id}`, { active: true, both: true });
    } else {
      nodeState.set(id, calls.some((call) => call.state === "error") ? "error" : "done");
      edgeState.set(`brain->${id}`, { used: true });
    }
  });

  for (const block of draft.blocks ?? []) {
    const calls = run.tools.filter((call) => call.agentKey === `block:${block.id}`);
    if (calls.length === 0) continue;
    const id = `block-${block.id}`;
    const running = calls.some((call) => call.state === "running");
    const failed = calls.some((call) => call.state === "error");
    const blockState: BlockState = running ? "active" : failed ? "error" : "done";
    nodeState.set(id, blockState);
    const lit = running ? { active: true } : { used: true };
    if (block.type === "swap") {
      // A trade runs the chain: Brain -> Risk gate -> Market.
      // Every gate the trade passes through lights in order: Risk limits, Quiet hours, then the Market.
      const gates = ["risk", "quietHours"]
        .map((type) => (draft.blocks ?? []).find((candidate) => candidate.type === type))
        .filter((gate): gate is AgentBlockData => Boolean(gate))
        .map((gate) => `block-${gate.id}`);
      const path = ["brain", ...gates, id];
      for (let step = 1; step < path.length; step++) edgeState.set(`${path[step - 1]}->${path[step]}`, lit);
      for (const gate of gates) nodeState.set(gate, running ? "active" : "done");
    } else if (block.type === "hire") {
      edgeState.set(`brain->${id}`, lit);
    } else if (!["schedule", "price", "walletWatch", "signal"].includes(block.type)) {
      // The Brain reaches down for what it reads, and the answer comes back up.
      edgeState.set(`brain->${id}`, running ? { active: true, both: true } : { used: true });
    }
  }
  // A trigger run lights the trigger that started it.
  if (working || run.phase === "done") {
    for (const block of draft.blocks ?? []) {
      if (run.triggeredBy && run.triggeredBy === block.type) {
        nodeState.set(`block-${block.id}`, "done");
        edgeState.set(`block-${block.id}->trigger`, run.phase === "thinking" ? { active: true, once: true } : { used: true });
      }
    }
  }

  if (run.phase === "writing") {
    nodeState.set("output", "active");
    edgeState.set("brain->output", { active: true });
  } else if (run.phase === "done") {
    nodeState.set("output", "done");
    edgeState.set("brain->output", { used: true });
  }

  return {
    nodes: graph.nodes.map((node) =>
      nodeState.has(node.id) ? { ...node, data: { ...node.data, state: nodeState.get(node.id) } } : node,
    ),
    edges: graph.edges.map((edge) => (edgeState.has(edge.id) ? { ...edge, data: edgeState.get(edge.id) } : edge)),
  };
}

/* ── positions: this browser only ─────────────────────────────────────────── */

type Positions = Record<string, { x: number; y: number }>;
const POSITIONS_KEY = "dolphin.canvas-positions.v1";

function readPositions(layoutKey: string | null): Positions {
  if (!layoutKey) return {};
  try {
    const all = JSON.parse(window.localStorage.getItem(POSITIONS_KEY) ?? "{}") as Record<string, Positions>;
    return all[layoutKey] ?? {};
  } catch {
    return {};
  }
}

function writePositions(layoutKey: string, positions: Positions) {
  try {
    const all = JSON.parse(window.localStorage.getItem(POSITIONS_KEY) ?? "{}") as Record<string, Positions>;
    if (Object.keys(positions).length === 0) delete all[layoutKey];
    else all[layoutKey] = positions;
    // Newest drafts win; a browser keeps at most 30 layouts.
    const entries = Object.entries(all).slice(-30);
    window.localStorage.setItem(POSITIONS_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* Blocked storage: the layout simply is not remembered. */
  }
}

/**
 * `fitView` on <ReactFlow> fits once, on mount - and the canvas mounts inside
 * a column still animating open from 0px (use-panel-layout.ts). Re-fit when
 * the number of blocks changes or the canvas settles at a new size.
 */
function FitOnChange({ count, version }: { count: number; version: number }) {
  const flow = useReactFlow();
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  useEffect(() => {
    if (width < 120 || height < 120) return;
    const timer = window.setTimeout(() => void flow.fitView({ padding: 0.22, maxZoom: 1, duration: 320 }), 160);
    return () => window.clearTimeout(timer);
  }, [count, flow, width, height, version]);
  return null;
}

/**
 * THE TOOLBOX (owner, 2026-09-28): one quiet "Add block" button that opens a
 * panel of described blocks - what each does, whether it is on the canvas,
 * and what it needs first - grouped the way a trading desk thinks. The first
 * version was a strip of labelled buttons the owner found cheap.
 */
type ToolboxItem = {
  type: AgentBlockData["type"] | "tool";
  label: string;
  about: string;
  glyph: GlyphName;
  needs?: AgentBlockData["type"];
};

const TOOLBOX: { title: string; items: ToolboxItem[] }[] = [
  {
    title: "Triggers",
    items: [
      { type: "schedule", label: "Scheduler", about: "Fires on a clock, every 15 minutes to daily", glyph: "clock" },
      { type: "price", label: "Price", about: "Fires when the token crosses a level", glyph: "dollar", needs: "market" },
      { type: "signal", label: "Signal", about: "Fires on RSI levels, MA or MACD crosses", glyph: "sparkle", needs: "market" },
      { type: "walletWatch", label: "Wallet watch", about: "Fires when a KOL or whale transacts", glyph: "eye" },
    ],
  },
  {
    // The owner's trader mentor: technical traders read price history.
    title: "Technical",
    items: [
      { type: "market", label: "Price feed", about: "A token's live price, trend and chart", glyph: "layers" },
      { type: "indicators", label: "Indicators", about: "RSI, MACD, Bollinger, averages, volume", glyph: "filter", needs: "market" },
      { type: "safety", label: "Safety", about: "Honeypot, taxes and owner-power checks", glyph: "shield" },
    ],
  },
  {
    // ...and analytical traders (also called fundamental) read what is happening now.
    title: "Analytical",
    items: [
      { type: "dataSource", label: "Data source", about: "Your own API - any https source, your key", glyph: "external" },
      { type: "news", label: "News", about: "Headlines from a feed you choose; promos flagged", glyph: "share" },
      { type: "memory", label: "Memory", about: "Remembers past runs - on your own server", glyph: "receive" },
      { type: "tool", label: "Agent tool", about: "A tool from an agent listed on Dolphin", glyph: "agents" },
      { type: "hire", label: "Hire an agent", about: "A paid A2A agent - you confirm each payment", glyph: "bot" },
    ],
  },
  {
    title: "Hands",
    items: [
      { type: "risk", label: "Risk limits", about: "Dollars per trade and trades per day", glyph: "filter" },
      { type: "quietHours", label: "Quiet hours", about: "Stand aside around scheduled events", glyph: "clock", needs: "swap" },
      { type: "swap", label: "Market", about: "Buys and sells on PancakeSwap, after the Risk gate", glyph: "wallet", needs: "risk" },
    ],
  },
];

const NEEDS_LABEL: Partial<Record<AgentBlockData["type"], string>> = { market: "Needs a Price feed", risk: "Needs Risk limits", swap: "Needs a Market" };

function Toolbox({
  blocks,
  toolCount,
  selected,
  onPick,
}: {
  blocks: readonly AgentBlockData[];
  toolCount: number;
  selected: string | null;
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const needle = query.trim().toLowerCase();
  const groups = TOOLBOX.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => !needle || item.label.toLowerCase().includes(needle) || item.about.toLowerCase().includes(needle),
    ),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="relative flex flex-col items-center">
      {open ? (
        <>
          <button aria-label="Close the block panel" className="fixed inset-0 cursor-default" onClick={() => setOpen(false)} type="button" />
          <div aria-label="Add a block" className="block-panel" role="dialog">
            <input
              aria-label="Search blocks"
              autoFocus
              className="block-panel__search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search blocks…"
              value={query}
            />
            <div className="block-panel__scroll sleek-scroll">
              {groups.map((group) => (
                <section key={group.title}>
                  <p className="block-panel__group">{group.title}</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {group.items.map((item) => {
                      const existing = item.type === "tool" ? null : blocks.find((block) => block.type === item.type);
                      const missing =
                        item.type !== "tool" && item.needs && !blocks.some((block) => block.type === item.needs) ? item.needs : null;
                      const full = item.type === "tool" && toolCount >= MAX_TOOLS;
                      const id =
                        item.type === "tool"
                          ? toolCount === 0
                            ? "tool-empty"
                            : "add-tool"
                          : existing
                            ? `block-${existing.id}`
                            : `new-${item.type}`;
                      return (
                        <button
                          className="block-card"
                          data-active={selected === id || undefined}
                          disabled={Boolean(missing) || full}
                          key={item.type}
                          onClick={() => {
                            onPick(id);
                            setOpen(false);
                          }}
                          type="button"
                        >
                          <span className="block-card__icon">
                            <CategoryGlyph color="currentColor" name={item.glyph} size={15} strokeWidth={2} />
                          </span>
                          <span className="min-w-0 flex-1 text-left">
                            <span className="flex items-center gap-1.5">
                              <span className="block-card__name">{item.label}</span>
                              {existing ? <span className="block-card__badge">On canvas</span> : null}
                            </span>
                            <span className="block-card__about">
                              {missing ? NEEDS_LABEL[missing] : full ? `${MAX_TOOLS} tools is the most` : item.about}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
              {groups.length === 0 ? <p className="px-1 py-3 text-[0.76rem] text-muted">No block matches that.</p> : null}
            </div>
          </div>
        </>
      ) : null}
      <button
        aria-expanded={open}
        className="add-block-button"
        onClick={() => {
          setQuery("");
          setOpen((value) => !value);
        }}
        type="button"
      >
        <span className="add-block-button__plus" data-open={open || undefined}>
          <CategoryGlyph color="currentColor" name="add" size={15} strokeWidth={2.2} />
        </span>
        Add block
      </button>
    </div>
  );
}

export function AgentCanvas({
  draft,
  editKey,
  layoutKey,
  run = null,
}: {
  draft: AgentDraft;
  /** The build conversation when blocks may be edited; null for read-only (a try-run). */
  editKey: string | null;
  /** Which draft's saved layout to use - the build conversation key, in build and try alike. */
  layoutKey: string | null;
  run?: CanvasRun | null;
}) {
  // The tools' publishers and the hired agent, in one batched read, for their icons.
  const toolAgentKeys = useMemo(
    () => [
      ...draft.tools.map((tool) => tool.agentKey),
      ...(draft.blocks ?? []).flatMap((block) => (block.type === "hire" ? [block.config.agentKey] : [])),
    ],
    [draft.tools, draft.blocks],
  );
  const toolAgents = useAgentsByKeys(toolAgentKeys);
  const base = useMemo(() => applyRun(draft, draftGraph(draft, toolAgents), run), [draft, run, toolAgents]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Positions the person dragged, over the default layout. Read lazily on the
  // client only (this component never renders on the server - it sits behind
  // a started conversation), and re-read when the draft changes.
  const [positions, setPositions] = useState<{ key: string | null; value: Positions }>(() => ({
    key: layoutKey,
    value: typeof window === "undefined" ? {} : readPositions(layoutKey),
  }));
  if (positions.key !== layoutKey) setPositions({ key: layoutKey, value: readPositions(layoutKey) });
  /*
   * React Flow's own measurements of each block. With controlled nodes they
   * must be handed back on every render: without them a block counts as
   * unmeasured and is hidden for a frame, which is what made the whole canvas
   * blink on every step of a drag (owner, 2026-09-28).
   */
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});
  const [fitVersion, setFitVersion] = useState(0);

  /*
   * PRESS THE CANVAS, AND THE PANEL GOES (owner, 2026-09-29: "once I click
   * anything outside the modal it should close... so that I can do other
   * things"). On pointer DOWN anywhere on the canvas outside the panel - empty
   * space, or the start of a drag to pan - so it is gone before the drag
   * begins. Only the canvas: the chat and the draft panel have nothing to do
   * with it. A press on another block is left to React Flow, which opens that
   * block's panel instead.
   */
  const inspector = useRef<HTMLDivElement>(null);
  const canvasRoot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selectedId) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target || !canvasRoot.current?.contains(target) || inspector.current?.contains(target)) return;
      if (target.closest(".react-flow__node, .block-panel, .add-block-button, .toaster, [role='listbox']")) return;
      setSelectedId(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [selectedId]);

  // "new-<type>" is a block being added from the toolbox; it has no node yet.
  const selected =
    selectedId && (selectedId.startsWith("new-") || base.nodes.some((node) => node.id === selectedId)) ? selectedId : null;
  const market = (draft.blocks ?? []).find((block) => block.type === "market");

  /*
   * THE CHART, EXPANDED (owner, 2026-09-29: "it expands and fills the canvas
   * ... grow into the screen... with a curve, not linearly, and the same going
   * back"). The card's box is measured before and after the change and the
   * difference animated with the Web Animations API - left, top, width and
   * height, so the chart re-lays itself out as it grows instead of being
   * stretched. Offsets, not getBoundingClientRect: the page is CSS-zoomed and
   * offsets stay in the same units as the styles being animated.
   */
  const chartBox = useRef<HTMLDivElement>(null);
  const chartFrom = useRef<{ left: number; top: number; width: number; height: number } | null>(null);
  const [chartExpanded, setChartExpanded] = useState(false);
  const toggleChart = useCallback(() => {
    const element = chartBox.current;
    if (element) {
      element.getAnimations().forEach((animation) => animation.cancel());
      chartFrom.current = { left: element.offsetLeft, top: element.offsetTop, width: element.offsetWidth, height: element.offsetHeight };
    }
    setChartExpanded((value) => !value);
  }, []);
  useLayoutEffect(() => {
    const element = chartBox.current;
    const from = chartFrom.current;
    chartFrom.current = null;
    if (!element || !from || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const to = { left: element.offsetLeft, top: element.offsetTop, width: element.offsetWidth, height: element.offsetHeight };
    const px = (box: typeof to) => ({ left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
    element.animate([px(from), px(to)], {
      duration: chartExpanded ? 620 : 520,
      // Out: a long, soft settle. Back: eases in and lands softly.
      easing: chartExpanded ? "cubic-bezier(0.16, 1, 0.3, 1)" : "cubic-bezier(0.65, 0, 0.35, 1)",
    });
  }, [chartExpanded]);
  useEffect(() => {
    if (!chartExpanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") toggleChart();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chartExpanded, toggleChart]);

  const nodes = useMemo(
    () =>
      base.nodes.map((node) => ({
        ...node,
        position: positions.value[node.id] ?? node.position,
        selected: node.id === selected,
        ...(measured[node.id] ? { measured: measured[node.id] } : {}),
        ...(node.data.blockType === "market" && !chartExpanded ? { data: { ...node.data, onExpand: toggleChart } } : {}),
      })),
    [base.nodes, chartExpanded, measured, positions.value, selected, toggleChart],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<BlockNode>[]) => {
      const sized = changes.filter((change) => change.type === "dimensions" && change.dimensions);
      if (sized.length > 0) {
        setMeasured((current) => {
          let next = current;
          for (const change of sized) {
            if (change.type !== "dimensions" || !change.dimensions) continue;
            const old = current[change.id];
            if (old && old.width === change.dimensions.width && old.height === change.dimensions.height) continue;
            if (next === current) next = { ...current };
            next[change.id] = { width: change.dimensions.width, height: change.dimensions.height };
          }
          return next;
        });
      }
      const moved = changes.filter((change) => change.type === "position" && change.position);
      if (moved.length === 0) return;
      const next = applyNodeChanges(moved, nodes);
      setPositions((current) => {
        const value = { ...current.value };
        for (const change of moved) {
          if (change.type !== "position") continue;
          const node = next.find((candidate) => candidate.id === change.id);
          if (node) value[node.id] = node.position;
        }
        return { ...current, value };
      });
    },
    [nodes],
  );

  /*
   * CONNECT AND CUT (owner, 2026-09-28). A line means "plugged in"; the draft
   * keeps the few that were cut (`detached`) and the runtime honours them.
   * Dragging from a block's dot to where it belongs plugs it back in; a
   * double-click on a line snaps it at the click, both halves retracting.
   */
  const updateDraft = useMutation(agentBuilderApi.agentBuilder.updateDraft);
  const detached = useMemo(() => draft.detached ?? [], [draft.detached]);
  const [cutting, setCutting] = useState<{ edgeId: string; at: number } | null>(null);
  const [pendingCut, setPendingCut] = useState<string | null>(null);
  // Once the server has the cut, the graph drops the line itself.
  if (pendingCut && detached.includes(pendingCut)) setPendingCut(null);

  const saveDetached = useCallback(
    async (next: string[]) => {
      if (!editKey) return;
      try {
        await updateDraft({ conversationKey: editKey, detached: next });
      } catch (cause) {
        const data = (cause as { data?: unknown } | null)?.data;
        toast.error(typeof data === "string" ? data : "Could not change that connection.");
        setPendingCut(null);
      }
    },
    [editKey, updateDraft],
  );

  const memberFor = useCallback(
    (connection: { source: string | null; target: string | null; targetHandle?: string | null }): string | null => {
      const source = base.nodes.find((node) => node.id === connection.source);
      const target = base.nodes.find((node) => node.id === connection.target);
      if (!source || !target) return null;
      const blocks = draft.blocks ?? [];
      const swap = blocks.find((block) => block.type === "swap");
      const risk = blocks.find((block) => block.type === "risk");
      const from = source.data.blockType;
      const to = target.data.blockType;
      // A run source plugs into the Trigger; the Trigger's own line into the Brain is fixed.
      if (target.id === "trigger" && source.data.kind === "trigger" && !source.data.hub) return source.data.member ?? null;
      if (target.id === "brain") return null;
      if (source.id === "brain" && (target.data.kind === "tool" || target.data.kind === "sense")) return target.data.member ?? null;
      if (source.id === "brain") {
        if (to === "risk") return swap ? `block:${swap.id}` : "limits";
        if (to === "swap" && !risk) return target.data.member ?? null;
        if (to === "hire") return target.data.member ?? null;
        return null;
      }
      if (from === "risk" && (to === "swap" || to === "quietHours")) return "limits";
      if (from === "quietHours" && to === "swap") return source.data.member ?? null;
      return null;
    },
    [base.nodes, draft.blocks],
  );

  const isValidConnection = useCallback(
    (connection: Connection | FlowEdge) => memberFor(connection) !== null,
    [memberFor],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const member = memberFor(connection);
      if (!member || !detached.includes(member)) return;
      void saveDetached(detached.filter((id) => id !== member));
    },
    [detached, memberFor, saveDetached],
  );

  const onEdgeDoubleClick = useCallback(
    (event: React.MouseEvent, edge: FlowEdge) => {
      const member = edge.data?.member;
      if (!editKey || !member || cutting) return;
      // Where on the curve the click landed, as a fraction of its length.
      const element = document.querySelector<SVGPathElement>(
        `.react-flow__edge[data-id="${CSS.escape(edge.id)}"] .react-flow__edge-path`,
      );
      let at = 0.5;
      if (element) {
        const matrix = element.getScreenCTM();
        const total = element.getTotalLength();
        let best = Infinity;
        for (let i = 0; i <= 80 && matrix; i++) {
          const point = element.getPointAtLength((total * i) / 80);
          const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
          const distance = Math.hypot(screen.x - event.clientX, screen.y - event.clientY);
          if (distance < best) {
            best = distance;
            at = i / 80;
          }
        }
      }
      setCutting({ edgeId: edge.id, at: Math.min(0.92, Math.max(0.08, at)) });
      window.setTimeout(() => {
        setCutting(null);
        setPendingCut(member);
        void saveDetached([...detached, member]);
      }, 440);
    },
    [cutting, detached, editKey, saveDetached],
  );

  const edges = useMemo(
    () =>
      base.edges
        .filter((edge) => !(pendingCut && edge.data?.member === pendingCut))
        .map((edge) => (cutting && edge.id === cutting.edgeId ? { ...edge, data: { ...edge.data, cutAt: cutting.at } } : edge)),
    [base.edges, cutting, pendingCut],
  );

  const resetLayout = useCallback(() => {
    if (layoutKey) writePositions(layoutKey, {});
    setPositions({ key: layoutKey, value: {} });
    setFitVersion((version) => version + 1);
  }, [layoutKey]);

  return (
    <div aria-label="Agent canvas" className="agent-canvas relative h-full min-h-0 w-full" ref={canvasRoot} role="region">
      <ReactFlow
        connectionLineStyle={{ stroke: "var(--flow)", strokeWidth: 2, strokeDasharray: "5 5" }}
        connectionRadius={34}
        edgeTypes={edgeTypes}
        edges={edges}
        isValidConnection={isValidConnection}
        onConnect={editKey ? onConnect : undefined}
        onEdgeDoubleClick={editKey ? onEdgeDoubleClick : undefined}
        zoomOnDoubleClick={false}
        edgesFocusable={false}
        fitView
        fitViewOptions={{ padding: 0.22, maxZoom: 1 }}
        maxZoom={1.6}
        minZoom={0.35}
        nodeTypes={nodeTypes}
        nodes={nodes}
        nodesConnectable={Boolean(editKey)}
        onNodeClick={editKey ? (_, node) => setSelectedId(node.id) : undefined}
        onNodeDragStop={() => {
          if (layoutKey) writePositions(layoutKey, positions.value);
        }}
        onNodesChange={onNodesChange}
        onPaneClick={() => setSelectedId(null)}
      >
        <Background gap={22} size={1.3} variant={BackgroundVariant.Dots} />
        <Controls position="bottom-left" showInteractive={false}>
          <ControlButton aria-label="Reset layout" onClick={resetLayout} title="Reset layout">
            <CategoryGlyph color="currentColor" name="refresh" size={14} strokeWidth={2} />
          </ControlButton>
        </Controls>
        <FitOnChange count={base.nodes.length} version={fitVersion} />
      </ReactFlow>

      {market && market.type === "market" ? (
        <>
          <div
            aria-hidden
            className="chart-scrim absolute inset-0 z-20"
            data-open={chartExpanded || undefined}
            onClick={chartExpanded ? toggleChart : undefined}
          />
          <div
            className={`chart-box absolute z-30 ${chartExpanded ? "inset-4" : "left-3 top-3 w-[min(24rem,calc(100%-1.5rem))]"}`}
            data-expanded={chartExpanded || undefined}
            ref={chartBox}
          >
            <TradingChart
              expanded={chartExpanded}
              onToggleExpand={toggleChart}
              poolAddress={market.config.poolAddress}
              symbol={market.config.symbol}
              tokenAddress={market.config.tokenAddress}
            />
          </div>
        </>
      ) : null}

      {editKey ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center px-3">
          <div className="pointer-events-auto">
            <Toolbox
              blocks={draft.blocks ?? []}
              onPick={(id) => setSelectedId(id)}
              selected={selected}
              toolCount={draft.tools.length}
            />
          </div>
        </div>
      ) : null}

      {editKey && selected ? (
        // The frame spans the canvas's height but only the panel inside it takes clicks:
        // the empty space below a short panel is canvas, and must pan and close like canvas.
        <div className="inspector-pop pointer-events-none absolute bottom-3 right-3 top-3 z-10 flex w-[21rem] flex-col justify-start [&>*]:pointer-events-auto" ref={inspector}>
          <AgentCanvasInspector
            conversationKey={editKey}
            draft={draft}
            key={selected}
            onClose={() => setSelectedId(null)}
            selectedId={selected}
          />
        </div>
      ) : editKey && !market ? (
        <p className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-paper/80 px-3 py-1 text-[0.72rem] text-muted backdrop-blur">
          Click a block to change it · drag from a dot to connect · double-click a line to cut it
        </p>
      ) : run ? (
        <p className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-paper/80 px-3 py-1 text-[0.72rem] text-muted backdrop-blur">
          {run.phase === "thinking"
            ? "Thinking…"
            : run.phase === "consulting"
              ? "Calling its tools…"
              : run.phase === "writing"
                ? "Writing the answer…"
                : run.phase === "error"
                  ? "This run failed"
                  : "Last run"}
        </p>
      ) : null}
    </div>
  );
}
