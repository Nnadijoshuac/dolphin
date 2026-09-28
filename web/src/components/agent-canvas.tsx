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
import { useCallback, useEffect, useMemo, useState } from "react";

import { AgentCanvasInspector } from "@/components/agent-canvas-inspector";
import { AgentIcon } from "@/components/agent-icon";
import type { AgentDraft } from "@/components/agent-draft-panel";
import { CategoryGlyph, type GlyphName } from "@/components/category-glyph";
import { TradingChart } from "@/components/trading-chart";
import { agentBuilderApi, brainProviderLabel, type AgentBlockData } from "@/convex/api";
import { useAgentsByKeys } from "@/hooks/use-agents";
import type { Agent } from "@/types/agent";
import { toast } from "@/store/use-toast-store";

/**
 * THE AGENT AS A GRAPH (owner, 2026-09-28: "like n8n").
 *
 *   Trigger ──┐
 *   Tools ────┼──> Brain ──> Output
 *   Melon ────┘ (from above)
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
};

type BlockNode = Node<BlockData, "block">;
type FlowEdge = Edge<{ active?: boolean; reverse?: boolean; used?: boolean; member?: string; cutAt?: number }, "flow">;

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
  brain: "bot",
  output: "check",
  add: "add",
  sense: "layers",
  risk: "filter",
  hands: "wallet",
} as const;

const NODE_WIDTH = 248;
const COLUMN_GAP = 130;
const TOOL_ROW = 100;
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
      style={{ width: NODE_WIDTH }}
    >
      {kind === "brain" ? (
        <>
          <Handle id="in" position={Position.Left} type="target" />
          <Handle id="strategy" position={Position.Top} type="target" />
        </>
      ) : null}
      {kind === "output" ? <Handle id="in" position={Position.Left} type="target" /> : null}
      {kind === "hands" ? (
        <>
          <Handle id="in" position={Position.Left} type="target" />
          <Handle id="limits" position={Position.Top} type="target" />
        </>
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

      {kind === "trigger" || kind === "tool" || kind === "sense" ? <Handle id="out" position={Position.Right} type="source" /> : null}
      {kind === "risk" ? <Handle id="out" position={Position.Bottom} type="source" /> : null}
      {kind === "melon" ? <Handle id="out" position={Position.Bottom} type="source" /> : null}
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
      <BaseEdge className={`agent-edge ${active ? "agent-edge--active" : data?.used ? "agent-edge--used" : ""}`} id={id} path={path} />
      {active ? (
        <>
          <path className="agent-edge__flow" d={path} data-reverse={reverse || undefined} fill="none" />
          {[0, 0.55].map((delay) => (
            <circle className="agent-edge__pulse" key={delay} r={3.2}>
              <animateMotion
                begin={`${delay}s`}
                calcMode="spline"
                dur="1.1s"
                keySplines="0.45 0 0.25 1"
                path={path}
                repeatCount="indefinite"
                {...motion}
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
  schedule: { kind: "trigger", label: "Schedule", glyph: "clock" },
  price: { kind: "trigger", label: "Price trigger", glyph: "dollar" },
  walletWatch: { kind: "trigger", label: "Wallet watch", glyph: "eye" },
  market: { kind: "sense", label: "Market", glyph: "layers" },
  safety: { kind: "sense", label: "Safety check", glyph: "shield" },
  risk: { kind: "risk", label: "Risk limits", glyph: "filter" },
  swap: { kind: "hands", label: "Swap", glyph: "wallet" },
};

function money(value: number): string {
  return value >= 1 ? `$${value.toLocaleString("en", { maximumFractionDigits: 2 })}` : `$${value.toPrecision(3)}`;
}

/** A block's one-line summary on the canvas. */
function blockSummary(block: AgentBlockData): { title: string; detail: string } {
  switch (block.type) {
    case "schedule": {
      const minutes = block.config.everyMinutes;
      return { title: minutes >= 60 ? `Every ${minutes / 60} hour${minutes === 60 ? "" : "s"}` : `Every ${minutes} minutes`, detail: "Runs the agent on a clock" };
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
      return { title: "Propose a swap", detail: "You approve and sign every trade" };
  }
}

/** The default layout for a draft. Pure, so it is the same on every render. */
export function draftGraph(
  draft: AgentDraft,
  agents: ReadonlyMap<string, Agent> = new Map(),
): { nodes: BlockNode[]; edges: FlowEdge[] } {
  const blocks = draft.blocks ?? [];
  const cut = new Set(draft.detached ?? []);
  const middle = NODE_WIDTH + COLUMN_GAP;
  const right = middle * 2;
  const nodes: BlockNode[] = [];

  // Left column: everything that feeds the brain, top to bottom.
  let y = 0;
  const pushLeft = (node: Omit<BlockNode, "position">) => {
    nodes.push({ ...node, position: { x: 0, y } } as BlockNode);
    y += TOOL_ROW;
  };
  pushLeft({
    id: "trigger",
    type: "block",
    data: { kind: "trigger", title: "When asked", detail: "Runs when someone sends it a message" },
  });
  for (const type of ["schedule", "price", "walletWatch", "market", "safety"] as const) {
    const block = blocks.find((candidate) => candidate.type === type);
    if (!block) continue;
    const look = BLOCK_LOOK[type];
    const member = `block:${block.id}`;
    pushLeft({
      id: `block-${block.id}`,
      type: "block",
      data: { kind: look.kind, label: look.label, glyph: look.glyph, member, detached: cut.has(member), ...blockSummary(block) },
    });
  }
  if (draft.tools.length === 0) {
    pushLeft({
      id: "tool-empty",
      type: "block",
      data: { kind: "tool", title: "No tools yet", detail: "From the free MCP agents on Dolphin", empty: true },
    });
  } else {
    draft.tools.forEach((tool, index) => {
      const member = `tool:${tool.agentKey}:${tool.toolName}`;
      pushLeft({
        id: `tool-${index}`,
        type: "block",
        data: {
          kind: "tool",
          title: tool.toolName,
          detail: `via ${tool.agentName}`,
          member,
          detached: cut.has(member),
          agent: agents.get(tool.agentKey)
            ? {
                category: agents.get(tool.agentKey)!.category,
                seed: agents.get(tool.agentKey)!.iconSeed ?? null,
                uri: agents.get(tool.agentKey)!.iconUrl ?? null,
              }
            : undefined,
        },
      });
    });
    if (draft.tools.length < MAX_TOOLS) {
      pushLeft({ id: "add-tool", type: "block", data: { kind: "add", title: "Add a tool", detail: "From the free MCP agents on Dolphin" } });
    }
  }
  const brainY = Math.max(140, (y - TOOL_ROW) / 2);

  const instructions = draft.instructions?.trim() || null;
  nodes.push(
    {
      id: "melon",
      type: "block",
      position: { x: middle, y: brainY - 200 },
      data: { kind: "melon", title: instructions ? "Strategy" : "Not drafted yet", detail: instructions, empty: !instructions },
    },
    {
      id: "brain",
      type: "block",
      position: { x: middle, y: brainY },
      data: {
        kind: "brain",
        title: draft.name?.trim() || "Unnamed agent",
        detail: draft.brain
          ? `${draft.brain.model} · your ${brainProviderLabel(draft.brain.provider)} key`
          : "No model yet · choose your key",
        empty: !draft.name?.trim() || !draft.brain,
      },
    },
    {
      id: "output",
      type: "block",
      position: { x: right, y: brainY },
      data: { kind: "output", title: "Answer", detail: "Replies with what its tools returned" },
    },
  );

  // Right column above the answer: the hands, and the limits on them.
  const swap = blocks.find((block) => block.type === "swap");
  const risk = blocks.find((block) => block.type === "risk");
  if (swap) {
    const member = `block:${swap.id}`;
    nodes.push({
      id: `block-${swap.id}`,
      type: "block",
      position: { x: right, y: brainY - 150 },
      data: { kind: "hands", label: "Swap", glyph: "wallet", member, detached: cut.has(member), ...blockSummary(swap) },
    });
  }
  if (risk) {
    nodes.push({
      id: `block-${risk.id}`,
      type: "block",
      position: { x: right, y: brainY - (swap ? 300 : 150) },
      data: { kind: "risk", label: "Risk limits", glyph: "filter", member: "limits", detached: cut.has("limits"), ...blockSummary(risk) },
    });
  }

  const edge = (source: string, target: string, targetHandle = "in", member?: string): FlowEdge => ({
    id: `${source}->${target}`,
    source,
    sourceHandle: "out",
    target,
    targetHandle,
    type: "flow",
    data: member ? { member } : {},
  });
  const edges: FlowEdge[] = [
    ...nodes
      .filter((node) => ["trigger", "tool", "sense"].includes(node.data.kind) && node.id !== "tool-empty" && !node.data.detached)
      .map((node) => edge(node.id, "brain", "in", node.data.member)),
    edge("melon", "brain", "strategy"),
    edge("brain", "output"),
  ];
  if (swap && !cut.has(`block:${swap.id}`)) edges.push(edge("brain", `block-${swap.id}`, "in", `block:${swap.id}`));
  if (swap && risk && !cut.has("limits")) edges.push(edge(`block-${risk.id}`, `block-${swap.id}`, "limits", "limits"));

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
    nodeState.set("trigger", "done");
    edgeState.set("trigger->brain", run.phase === "thinking" ? { active: true } : { used: true });
  }
  edgeState.set("melon->brain", working ? { active: run.phase === "thinking" } : {});
  nodeState.set("brain", run.phase === "error" ? "error" : working ? "active" : run.phase === "done" ? "done" : "idle");

  draft.tools.forEach((tool, index) => {
    const calls = run.tools.filter((call) => call.agentKey === tool.agentKey && call.toolName === tool.toolName);
    if (calls.length === 0) return;
    const id = `tool-${index}`;
    if (calls.some((call) => call.state === "running")) {
      nodeState.set(id, "active");
      edgeState.set(`${id}->brain`, { active: true, reverse: true });
    } else {
      nodeState.set(id, calls.some((call) => call.state === "error") ? "error" : "done");
      edgeState.set(`${id}->brain`, { used: true });
    }
  });

  for (const block of draft.blocks ?? []) {
    const calls = run.tools.filter((call) => call.agentKey === `block:${block.id}`);
    if (calls.length === 0) continue;
    const id = `block-${block.id}`;
    const running = calls.some((call) => call.state === "running");
    const failed = calls.some((call) => call.state === "error");
    nodeState.set(id, running ? "active" : failed ? "error" : "done");
    // The brain reaches out to a sense; it hands a trade to the swap.
    const edgeId = block.type === "swap" ? `brain->${id}` : `${id}->brain`;
    edgeState.set(edgeId, running ? { active: true, reverse: block.type !== "swap" } : { used: true });
  }
  // A trigger run lights the trigger that started it.
  if (working || run.phase === "done") {
    for (const block of draft.blocks ?? []) {
      if (run.triggeredBy && run.triggeredBy === block.type) {
        nodeState.set(`block-${block.id}`, "done");
        edgeState.set(`block-${block.id}->brain`, run.phase === "thinking" ? { active: true } : { used: true });
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
      { type: "schedule", label: "Schedule", about: "Run on a clock, every 15 minutes to daily", glyph: "clock" },
      { type: "price", label: "Price", about: "Run when the token crosses a level", glyph: "dollar", needs: "market" },
      { type: "walletWatch", label: "Wallet watch", about: "Run when a KOL or whale transacts", glyph: "eye" },
    ],
  },
  {
    title: "Senses",
    items: [
      { type: "market", label: "Market", about: "A token's live price, candles and chart", glyph: "layers" },
      { type: "safety", label: "Safety", about: "Honeypot, taxes and owner-power checks", glyph: "shield" },
      { type: "tool", label: "Agent tool", about: "A tool from an agent listed on Dolphin", glyph: "agents" },
    ],
  },
  {
    title: "Hands",
    items: [
      { type: "risk", label: "Risk limits", about: "Dollars per trade and trades per day", glyph: "filter" },
      { type: "swap", label: "Swap", about: "Propose PancakeSwap trades within the limits", glyph: "wallet", needs: "risk" },
    ],
  },
];

const NEEDS_LABEL: Partial<Record<AgentBlockData["type"], string>> = { market: "Needs a Market", risk: "Needs Risk limits" };

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
  // The tools' publishers, in one batched read, for their icons.
  const toolAgentKeys = useMemo(() => draft.tools.map((tool) => tool.agentKey), [draft.tools]);
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

  // "new-<type>" is a block being added from the toolbox; it has no node yet.
  const selected =
    selectedId && (selectedId.startsWith("new-") || base.nodes.some((node) => node.id === selectedId)) ? selectedId : null;
  const market = (draft.blocks ?? []).find((block) => block.type === "market");
  const nodes = useMemo(
    () =>
      base.nodes.map((node) => ({
        ...node,
        position: positions.value[node.id] ?? node.position,
        selected: node.id === selected,
        ...(measured[node.id] ? { measured: measured[node.id] } : {}),
      })),
    [base.nodes, measured, positions.value, selected],
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
      if (target.id === "brain" && connection.targetHandle !== "strategy" && ["trigger", "tool", "sense"].includes(source.data.kind)) {
        return source.data.member ?? null;
      }
      if (target.data.kind === "hands" && source.id === "brain" && connection.targetHandle !== "limits") return target.data.member ?? null;
      if (target.data.kind === "hands" && source.data.kind === "risk" && connection.targetHandle === "limits") return "limits";
      return null;
    },
    [base.nodes],
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
    <div aria-label="Agent canvas" className="agent-canvas relative h-full min-h-0 w-full" role="region">
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
        <div className="absolute left-3 top-3 z-10 w-[min(24rem,calc(100%-1.5rem))]">
          <TradingChart poolAddress={market.config.poolAddress} symbol={market.config.symbol} tokenAddress={market.config.tokenAddress} />
        </div>
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
        <div className="absolute bottom-3 right-3 top-3 z-10 flex w-[21rem] flex-col justify-start">
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
          Click a block to change it · drag dots to connect · double-click a line to cut it
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
