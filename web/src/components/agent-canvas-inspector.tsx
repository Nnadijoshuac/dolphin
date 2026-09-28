"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import type { AgentDraft } from "@/components/agent-draft-panel";
import { agentBuilderApi } from "@/convex/api";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { toast } from "@/store/use-toast-store";
import { toUserMessage } from "@/wallet/wallet-errors";

/**
 * What a clicked block on the canvas lets a person change. (2026-09-28)
 *
 * Every write goes through agentBuilder.updateDraft, which applies the same
 * rules the builder model is held to - so editing by hand can do nothing the
 * chat could not. Text saves on an explicit Save rather than per keystroke:
 * each write re-runs the draft's subscription, and the database I/O budget is
 * shared with prod.
 *
 * Caps mirror convex/lib/agentSpec.ts and are enforced there; these only stop
 * the form from offering what the backend would refuse.
 */
const NAME_MAX = 60;
const DESCRIPTION_MAX = 280;
const INSTRUCTIONS_MAX = 4_000;
const MAX_TOOLS = 8;

function errorText(cause: unknown, fallback: string): string {
  // A ConvexError carries its sentence in `data`; `message` has the request id.
  const data = (cause as { data?: unknown } | null)?.data;
  return typeof data === "string" ? data : toUserMessage(cause, fallback);
}

function useSaveDraft(conversationKey: string) {
  const update = useMutation(agentBuilderApi.agentBuilder.updateDraft);
  const [saving, setSaving] = useState(false);
  const save = async (patch: Omit<Parameters<typeof update>[0], "conversationKey">) => {
    setSaving(true);
    try {
      await update({ conversationKey, ...patch });
      return true;
    } catch (cause) {
      toast.error(errorText(cause, "Could not save that change."));
      return false;
    } finally {
      setSaving(false);
    }
  };
  return { save, saving };
}

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="flex max-h-full min-h-0 flex-col rounded-2xl border border-line bg-paper shadow-[0_12px_32px_-16px_rgba(15,23,42,0.25)]">
      <div className="flex items-center gap-2 border-b border-line/60 px-4 py-2.5">
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{title}</h3>
        <button
          aria-label="Close"
          className="grid size-7 place-items-center rounded-full text-muted transition-colors hover:bg-paper-muted hover:text-ink"
          onClick={onClose}
          type="button"
        >
          <span aria-hidden className="text-base leading-none">×</span>
        </button>
      </div>
      <div className="min-h-0 overflow-y-auto px-4 py-3">{children}</div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-muted">{children}</span>
  );
}

function SaveButton({ disabled, saving, onClick }: { disabled: boolean; saving: boolean; onClick: () => void }) {
  return (
    <button
      className="mt-3 flex h-8 w-full items-center justify-center rounded-lg bg-ink text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-30"
      disabled={disabled || saving}
      onClick={onClick}
      type="button"
    >
      <span className="text-canvas">{saving ? "Saving…" : "Save"}</span>
    </button>
  );
}

const fieldClass =
  "mt-1 w-full rounded-lg border border-line bg-paper-strong px-2.5 py-1.5 text-[0.84rem] text-ink outline-none focus:border-line-strong";

function BrainEditor({ conversationKey, draft, onClose }: { conversationKey: string; draft: AgentDraft; onClose: () => void }) {
  const [name, setName] = useState(draft.name ?? "");
  const [description, setDescription] = useState(draft.description ?? "");
  const { save, saving } = useSaveDraft(conversationKey);
  const changed = name !== (draft.name ?? "") || description !== (draft.description ?? "");

  return (
    <Shell onClose={onClose} title="Brain">
      <label className="block">
        <Label>Name</Label>
        <input className={fieldClass} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} value={name} />
      </label>
      <label className="mt-3 block">
        <Label>What it does</Label>
        <textarea
          className={`${fieldClass} resize-none`}
          maxLength={DESCRIPTION_MAX}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          value={description}
        />
      </label>
      <p className="mt-3 text-[0.72rem] leading-relaxed text-muted">
        Model: Dolphin&apos;s free model, shared by every agent built here.
      </p>
      <SaveButton disabled={!changed} onClick={() => void save({ name, description })} saving={saving} />
    </Shell>
  );
}

function MelonEditor({ conversationKey, draft, onClose }: { conversationKey: string; draft: AgentDraft; onClose: () => void }) {
  const [instructions, setInstructions] = useState(draft.instructions ?? "");
  const { save, saving } = useSaveDraft(conversationKey);
  const changed = instructions !== (draft.instructions ?? "");

  return (
    <Shell onClose={onClose} title="Melon · strategy">
      <p className="text-[0.74rem] leading-relaxed text-muted">
        How your agent thinks: what it does, which tool it uses for what, and what to do when a tool
        returns nothing. Write it to the agent (&ldquo;You check…&rdquo;).
      </p>
      <textarea
        aria-label="Strategy"
        className={`${fieldClass} mt-2 resize-y font-mono text-[0.78rem] leading-relaxed`}
        maxLength={INSTRUCTIONS_MAX}
        onChange={(e) => setInstructions(e.target.value)}
        rows={14}
        value={instructions}
      />
      <p className="mt-1 text-right text-[0.66rem] text-faint">
        {instructions.length.toLocaleString()} / {INSTRUCTIONS_MAX.toLocaleString()}
      </p>
      <SaveButton disabled={!changed} onClick={() => void save({ instructions })} saving={saving} />
    </Shell>
  );
}

function ToolEditor({
  conversationKey,
  draft,
  index,
  onClose,
}: {
  conversationKey: string;
  draft: AgentDraft;
  index: number;
  onClose: () => void;
}) {
  const { save, saving } = useSaveDraft(conversationKey);
  const tool = draft.tools[index];
  if (!tool) return null;

  return (
    <Shell onClose={onClose} title="Tool">
      <p className="font-mono text-[0.84rem] text-ink">{tool.toolName}</p>
      <p className="mt-0.5 text-[0.74rem] text-muted">Published by {tool.agentName}. It reads; it cannot sign or move funds.</p>
      <button
        className="mt-4 flex h-8 w-full items-center justify-center rounded-lg border border-line text-[12.5px] font-semibold text-ink transition-colors hover:bg-paper-muted disabled:opacity-40"
        disabled={saving}
        onClick={async () => {
          const ok = await save({
            tools: draft.tools
              .filter((_, i) => i !== index)
              .map(({ agentKey, toolName }) => ({ agentKey, toolName })),
          });
          if (ok) onClose();
        }}
        type="button"
      >
        {saving ? "Removing…" : "Remove from agent"}
      </button>
    </Shell>
  );
}

function ToolPicker({ conversationKey, draft, onClose }: { conversationKey: string; draft: AgentDraft; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search.trim(), 350);
  // Subscribed only while this picker is open - see toolPalette.
  const palette = useQuery(agentBuilderApi.agentBuilder.toolPalette, { search: debounced || undefined });
  const { save, saving } = useSaveDraft(conversationKey);
  const has = (agentKey: string, toolName: string) =>
    draft.tools.some((tool) => tool.agentKey === agentKey && tool.toolName === toolName);
  const full = draft.tools.length >= MAX_TOOLS;

  return (
    <Shell onClose={onClose} title="Add a tool">
      <input
        aria-label="Search tools"
        className={fieldClass}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search agents: Venus, PancakeSwap, yield…"
        value={search}
      />
      {full ? (
        <p className="mt-2 text-[0.74rem] text-muted">This agent has {MAX_TOOLS} tools, the most one agent can run.</p>
      ) : null}
      <div className="mt-3 space-y-3">
        {palette === undefined ? (
          <p className="text-[0.78rem] text-muted">Loading the catalog…</p>
        ) : palette.length === 0 ? (
          <p className="text-[0.78rem] text-muted">No live agent with read-only tools matches that.</p>
        ) : (
          palette.map((agent) => (
            <div key={agent.agentKey}>
              <p className="truncate text-[0.72rem] font-semibold text-ink-soft">{agent.agentName}</p>
              <ul className="mt-1 space-y-1">
                {agent.tools.map((tool) => {
                  const added = has(agent.agentKey, tool.name);
                  return (
                    <li key={tool.name}>
                      <button
                        className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-paper-muted disabled:cursor-default disabled:hover:bg-transparent"
                        disabled={added || full || saving}
                        onClick={() =>
                          void save({
                            tools: [
                              ...draft.tools.map(({ agentKey, toolName }) => ({ agentKey, toolName })),
                              { agentKey: agent.agentKey, toolName: tool.name },
                            ],
                          })
                        }
                        type="button"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-[0.76rem] text-ink">{tool.name}</span>
                          {tool.description ? (
                            <span className="line-clamp-2 block text-[0.68rem] leading-snug text-muted">{tool.description}</span>
                          ) : null}
                        </span>
                        <span className="shrink-0 text-[0.7rem] font-semibold text-muted">{added ? "Added" : "Add"}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>
    </Shell>
  );
}

function InfoPanel({ title, body, onClose }: { title: string; body: string; onClose: () => void }) {
  return (
    <Shell onClose={onClose} title={title}>
      <p className="text-[0.8rem] leading-relaxed text-ink-soft">{body}</p>
    </Shell>
  );
}

/** The panel for one selected block, or nothing. Keyed by the caller on the selection. */
export function AgentCanvasInspector({
  conversationKey,
  draft,
  selectedId,
  onClose,
}: {
  conversationKey: string;
  draft: AgentDraft;
  selectedId: string;
  onClose: () => void;
}) {
  if (selectedId === "brain") return <BrainEditor conversationKey={conversationKey} draft={draft} onClose={onClose} />;
  if (selectedId === "melon") return <MelonEditor conversationKey={conversationKey} draft={draft} onClose={onClose} />;
  if (selectedId === "add-tool" || selectedId === "tool-empty") {
    return <ToolPicker conversationKey={conversationKey} draft={draft} onClose={onClose} />;
  }
  if (selectedId.startsWith("tool-")) {
    const index = Number(selectedId.slice("tool-".length));
    return <ToolEditor conversationKey={conversationKey} draft={draft} index={index} onClose={onClose} />;
  }
  if (selectedId === "trigger") {
    return <InfoPanel body="Your agent runs when someone sends it a message, and answers in the conversation." onClose={onClose} title="Trigger" />;
  }
  if (selectedId === "output") {
    return <InfoPanel body="It replies with what its tools returned. It quotes no number a tool did not give it." onClose={onClose} title="Output" />;
  }
  return null;
}
