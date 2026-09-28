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
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AgentCanvasInspector } from "@/components/agent-canvas-inspector";
import type { AgentDraft } from "@/components/agent-draft-panel";
import { CategoryGlyph } from "@/components/category-glyph";

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

type BlockKind = "trigger" | "tool" | "melon" | "brain" | "output" | "add";
export type BlockState = "idle" | "active" | "done" | "error";

type BlockData = {
  kind: BlockKind;
  title: string;
  detail: string | null;
  /** Nothing drafted here yet: drawn dashed, and says so. */
  empty?: boolean;
  state?: BlockState;
};

type BlockNode = Node<BlockData, "block">;
type FlowEdge = Edge<{ active?: boolean; reverse?: boolean; used?: boolean }, "flow">;

/** What a try-run is doing right now. Null when nothing is running or has run. */
export type CanvasRun = {
  phase: "thinking" | "consulting" | "writing" | "done" | "error";
  tools: { agentKey: string; toolName: string; state: "running" | "done" | "error" }[];
};

const KIND_LABEL: Record<BlockKind, string> = {
  trigger: "Trigger",
  tool: "Tool",
  melon: "Melon · strategy",
  brain: "Brain",
  output: "Output",
  add: "Tool",
};

const KIND_GLYPH = {
  trigger: "arrow-right",
  tool: "spanner",
  melon: "sparkle",
  brain: "bot",
  output: "check",
  add: "add",
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

      <div className="flex items-start gap-2.5">
        <span className="agent-block__icon">
          <CategoryGlyph color="currentColor" name={KIND_GLYPH[kind]} size={15} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-muted">{KIND_LABEL[kind]}</span>
            {state === "done" ? <span className="agent-block__tick" aria-label="Done">✓</span> : null}
            {state === "active" ? <span className="agent-block__live" aria-label="Running" /> : null}
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

      {kind === "trigger" || kind === "tool" ? <Handle id="out" position={Position.Right} type="source" /> : null}
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

const nodeTypes = { block: BlockView };
const edgeTypes = { flow: FlowEdgeView };

/** The default layout for a draft. Pure, so it is the same on every render. */
export function draftGraph(draft: AgentDraft): { nodes: BlockNode[]; edges: FlowEdge[] } {
  const toolCount = Math.max(draft.tools.length, 1);
  const toolsTop = 140;
  const brainY = toolsTop + ((toolCount - 1) * TOOL_ROW) / 2;
  const middle = NODE_WIDTH + COLUMN_GAP;
  const right = middle * 2;

  const nodes: BlockNode[] = [
    {
      id: "trigger",
      type: "block",
      position: { x: 0, y: 0 },
      data: { kind: "trigger", title: "When asked", detail: "Runs when someone sends it a message" },
    },
  ];

  if (draft.tools.length === 0) {
    nodes.push({
      id: "tool-empty",
      type: "block",
      position: { x: 0, y: toolsTop },
      data: { kind: "tool", title: "No tools yet", detail: "From the free MCP agents on Dolphin", empty: true },
    });
  } else {
    draft.tools.forEach((tool, index) => {
      nodes.push({
        id: `tool-${index}`,
        type: "block",
        position: { x: 0, y: toolsTop + index * TOOL_ROW },
        data: { kind: "tool", title: tool.toolName, detail: `via ${tool.agentName}` },
      });
    });
    if (draft.tools.length < MAX_TOOLS) {
      nodes.push({
        id: "add-tool",
        type: "block",
        position: { x: 0, y: toolsTop + draft.tools.length * TOOL_ROW },
        data: { kind: "add", title: "Add a tool", detail: "From the free MCP agents on Dolphin" },
      });
    }
  }

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
          ? `${draft.brain.model} · your ${draft.brain.provider === "openai" ? "OpenAI" : "OpenRouter"} key`
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

  const edge = (source: string, target: string, targetHandle = "in"): FlowEdge => ({
    id: `${source}->${target}`,
    source,
    sourceHandle: "out",
    target,
    targetHandle,
    type: "flow",
    data: {},
  });

  const edges: FlowEdge[] = [
    edge("trigger", "brain"),
    ...nodes.filter((node) => node.data.kind === "tool").map((node) => edge(node.id, "brain")),
    edge("melon", "brain", "strategy"),
    edge("brain", "output"),
  ];

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
  const base = useMemo(() => applyRun(draft, draftGraph(draft), run), [draft, run]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Positions the person dragged, over the default layout. Read lazily on the
  // client only (this component never renders on the server - it sits behind
  // a started conversation), and re-read when the draft changes.
  const [positions, setPositions] = useState<{ key: string | null; value: Positions }>(() => ({
    key: layoutKey,
    value: typeof window === "undefined" ? {} : readPositions(layoutKey),
  }));
  if (positions.key !== layoutKey) setPositions({ key: layoutKey, value: readPositions(layoutKey) });
  const [fitVersion, setFitVersion] = useState(0);

  const selected = selectedId && base.nodes.some((node) => node.id === selectedId) ? selectedId : null;
  const nodes = useMemo(
    () =>
      base.nodes.map((node) => ({
        ...node,
        position: positions.value[node.id] ?? node.position,
        selected: node.id === selected,
      })),
    [base.nodes, positions.value, selected],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<BlockNode>[]) => {
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

  const resetLayout = useCallback(() => {
    if (layoutKey) writePositions(layoutKey, {});
    setPositions({ key: layoutKey, value: {} });
    setFitVersion((version) => version + 1);
  }, [layoutKey]);

  return (
    <div aria-label="Agent canvas" className="agent-canvas relative h-full min-h-0 w-full" role="region">
      <ReactFlow
        edgeTypes={edgeTypes}
        edges={base.edges}
        edgesFocusable={false}
        fitView
        fitViewOptions={{ padding: 0.22, maxZoom: 1 }}
        maxZoom={1.6}
        minZoom={0.35}
        nodeTypes={nodeTypes}
        nodes={nodes}
        nodesConnectable={false}
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
      ) : editKey ? (
        <p className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-paper/80 px-3 py-1 text-[0.72rem] text-muted backdrop-blur">
          Click a block to change it · drag to move it
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
