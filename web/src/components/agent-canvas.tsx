"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";

import { AgentCanvasInspector } from "@/components/agent-canvas-inspector";
import type { AgentDraft } from "@/components/agent-draft-panel";
import { CategoryGlyph } from "@/components/category-glyph";

/**
 * THE AGENT AS A GRAPH (owner, 2026-09-28: "like n8n").
 *
 * The same draft the panel beside it lists, drawn as the blocks an agent is
 * made of and what feeds what:
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
 * ONLY BLOCKS THAT WORK ARE DRAWN (owner's rule: a feature that cannot work is
 * not shown). The one trigger that exists today is "when asked", and the one
 * brain is Dolphin's own free model; schedules, a person's own model key and
 * wallet actions become blocks when each has a backend behind it. An unfilled
 * field renders as "Not drafted yet", never as a plausible default (§5).
 *
 * Desktop only: a node graph at 390px is a worse way to read five fields than
 * the draft sheet phones already have.
 */

type BlockKind = "trigger" | "tool" | "melon" | "brain" | "output" | "add";

type BlockData = {
  kind: BlockKind;
  title: string;
  detail: string | null;
  /** Nothing drafted here yet: drawn dashed, and says so. */
  empty?: boolean;
};

type BlockNode = Node<BlockData, "block">;

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

const NODE_WIDTH = 240;
/** Mirrors MAX_DRAFT_TOOLS in convex/lib/agentSpec.ts. */
const MAX_TOOLS = 8;
const COLUMN_GAP = 120;
const TOOL_ROW = 92;

function BlockView({ data, selected }: NodeProps<BlockNode>) {
  const { kind } = data;
  return (
    <div
      className={`cursor-pointer rounded-xl border bg-paper px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition-colors hover:border-line-strong ${
        data.empty || kind === "add" ? "border-dashed border-line-strong" : "border-line"
      } ${selected ? "ring-2 ring-ink/70" : kind === "melon" ? "ring-1 ring-accent/40" : ""}`}
      style={{ width: NODE_WIDTH }}
    >
      {kind === "brain" ? (
        <>
          <Handle id="in" position={Position.Left} type="target" />
          <Handle id="strategy" position={Position.Top} type="target" />
        </>
      ) : null}
      {kind === "output" ? <Handle id="in" position={Position.Left} type="target" /> : null}

      <div className="flex items-center gap-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.09em] text-muted">
        <CategoryGlyph color="currentColor" name={KIND_GLYPH[kind]} size={12} strokeWidth={2} />
        {KIND_LABEL[kind]}
      </div>
      <p className={`mt-1 truncate text-[0.84rem] font-semibold ${data.empty ? "text-faint" : "text-ink"}`}>
        {data.title}
      </p>
      {data.detail ? (
        <p
          className={`mt-0.5 text-[0.72rem] leading-snug text-muted ${
            kind === "melon" ? "line-clamp-3" : "truncate"
          }`}
        >
          {data.detail}
        </p>
      ) : null}

      {kind === "trigger" || kind === "tool" ? (
        <Handle id="out" position={Position.Right} type="source" />
      ) : null}
      {kind === "melon" ? <Handle id="out" position={Position.Bottom} type="source" /> : null}
      {kind === "brain" ? <Handle id="out" position={Position.Right} type="source" /> : null}
    </div>
  );
}

const nodeTypes = { block: BlockView };

/** The graph for a draft. Pure, so the layout is the same on every render. */
export function draftGraph(draft: AgentDraft): { nodes: BlockNode[]; edges: Edge[] } {
  const toolCount = Math.max(draft.tools.length, 1);
  const toolsTop = 130;
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
      data: {
        kind: "tool",
        title: "No tools yet",
        detail: "From the free MCP agents on Dolphin",
        empty: true,
      },
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
  }

  // The door to the tool picker, under the tools, while there is room for another.
  if (draft.tools.length > 0 && draft.tools.length < MAX_TOOLS) {
    nodes.push({
      id: "add-tool",
      type: "block",
      position: { x: 0, y: toolsTop + draft.tools.length * TOOL_ROW },
      data: { kind: "add", title: "Add a tool", detail: "From the free MCP agents on Dolphin" },
    });
  }

  const instructions = draft.instructions?.trim() || null;
  nodes.push(
    {
      id: "melon",
      type: "block",
      position: { x: middle, y: brainY - 190 },
      data: {
        kind: "melon",
        title: instructions ? "Strategy" : "Not drafted yet",
        detail: instructions,
        empty: !instructions,
      },
    },
    {
      id: "brain",
      type: "block",
      position: { x: middle, y: brainY },
      data: {
        kind: "brain",
        title: draft.name?.trim() || "Unnamed agent",
        detail: "Dolphin's free model",
        empty: !draft.name?.trim(),
      },
    },
    {
      id: "output",
      type: "block",
      position: { x: right, y: brainY },
      data: { kind: "output", title: "Answer", detail: "Replies with what its tools returned" },
    },
  );

  const edge = (source: string, target: string, targetHandle = "in"): Edge => ({
    id: `${source}->${target}`,
    source,
    sourceHandle: "out",
    target,
    targetHandle,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
  });

  const edges: Edge[] = [
    edge("trigger", "brain"),
    ...nodes.filter((node) => node.data.kind === "tool").map((node) => edge(node.id, "brain")),
    edge("melon", "brain", "strategy"),
    { ...edge("brain", "output"), animated: true },
  ];

  return { nodes, edges };
}

/**
 * `fitView` on <ReactFlow> fits once, on mount - and the canvas mounts inside
 * a column that is still animating open from 0px (use-panel-layout.ts), so a
 * one-off fit would size the agent to a sliver. Re-fit whenever the number of
 * blocks changes (a new tool would land below the fold) or the canvas settles
 * at a new width or height - after the slide-in, and after a person drags a
 * panel border.
 */
function FitOnChange({ count }: { count: number }) {
  const flow = useReactFlow();
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  useEffect(() => {
    if (width < 120 || height < 120) return;
    const timer = window.setTimeout(() => void flow.fitView({ padding: 0.2, maxZoom: 1, duration: 300 }), 160);
    return () => window.clearTimeout(timer);
  }, [count, flow, width, height]);
  return null;
}

export function AgentCanvas({
  draft,
  conversationKey,
}: {
  draft: AgentDraft;
  /** The build conversation. Without it the canvas is read-only. */
  conversationKey: string | null;
}) {
  const graph = useMemo(() => draftGraph(draft), [draft]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // A selection whose block has gone (a removed tool) closes rather than dangling.
  const selected = selectedId && graph.nodes.some((node) => node.id === selectedId) ? selectedId : null;
  const nodes = useMemo(
    () => graph.nodes.map((node) => ({ ...node, selected: node.id === selected })),
    [graph.nodes, selected],
  );

  return (
    <div aria-label="Agent canvas" className="agent-canvas relative h-full min-h-0 w-full" role="region">
      <ReactFlow
        edges={graph.edges}
        edgesFocusable={false}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        maxZoom={1.5}
        minZoom={0.4}
        nodeTypes={nodeTypes}
        nodes={nodes}
        nodesConnectable={false}
        nodesDraggable={false}
        onNodeClick={conversationKey ? (_, node) => setSelectedId(node.id) : undefined}
        onPaneClick={() => setSelectedId(null)}
      >
        <Background gap={20} size={1.2} variant={BackgroundVariant.Dots} />
        <Controls position="bottom-left" showInteractive={false} />
        <FitOnChange count={graph.nodes.length} />
      </ReactFlow>

      {conversationKey && selected ? (
        <div className="absolute bottom-3 right-3 top-3 z-10 flex w-[21rem] flex-col justify-start">
          <AgentCanvasInspector
            conversationKey={conversationKey}
            draft={draft}
            key={selected}
            onClose={() => setSelectedId(null)}
            selectedId={selected}
          />
        </div>
      ) : conversationKey ? (
        <p className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-paper/80 px-3 py-1 text-[0.72rem] text-muted">
          Click a block to change it
        </p>
      ) : null}
    </div>
  );
}
