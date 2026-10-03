"use client";

import { useMutation } from "convex/react";
import { useState } from "react";

import { KnowledgeSection } from "@/components/knowledge-section";
import { PermissionsSection } from "@/components/permissions-section";
import { TradingRulesSection } from "@/components/trading-rules-section";
import { CategoryGlyph } from "@/components/category-glyph";
import { AutoTradeCard } from "@/components/auto-trade-card";
import { PaperTradingCard } from "@/components/paper-trading-card";
import { EnvVarsPanel } from "@/components/env-vars-panel";
import { agentBuilderApi, type AgentBlockData, type AgentPurpose } from "@/convex/api";
import { toast } from "@/store/use-toast-store";

/**
 * The agent a user is building, as the Build mode of /dolphin shows it.
 *
 * Every field is nullable because a draft fills in over a conversation. An
 * unfilled field renders as "not drafted yet", never as a plausible default:
 * a name or tool list Dolphin made up would look exactly like one the user
 * chose (AGENTS.md §5, applied to a form rather than a metric).
 *
 * `tools` are always tools of agents already LISTED on Dolphin, named with the
 * agent that publishes them, because that is where a built agent's abilities
 * come from - it composes the free MCP agents in the catalog, it does not get
 * new powers of its own. See Agent/PLAN-2026-09-26-build-your-agent.md.
 */
export type AgentDraft = {
  name: string | null;
  description: string | null;
  instructions: string | null;
  tools: readonly { agentKey: string; agentName: string; toolName: string }[];
  /** The model it thinks with, on the builder's own key. Null until chosen. */
  brain?: { provider: string; model: string; keyName: string; baseUrl?: string | null } | null;
  /** Toolbox blocks: market, safety, risk, swap and triggers. */
  blocks?: readonly AgentBlockData[];
  /** Connections cut on the canvas: `tool:<agentKey>:<tool>`, `block:<id>`, `limits`. */
  detached?: readonly string[];
  autopilot?: { on: boolean; conversationKey: string } | null;
  /** Who it is for. Null until the builder or the person chooses. */
  purpose?: AgentPurpose | null;
  hirePriceUsd?: number | null;
  /** False only when switched to Live; absent means paper (convex/paperTrading.ts). */
  paperMode?: boolean;
  /** Switched-on document tools (knowledge) and trading rules: capabilities like tools and blocks. */
  knowledgeToolCount?: number;
  ruleCount?: number;
};

export const EMPTY_AGENT_DRAFT: AgentDraft = {
  name: null,
  description: null,
  instructions: null,
  tools: [],
};

/** What still stands between this draft and going on-chain, in the user's words. */
export function draftGaps(draft: AgentDraft): string[] {
  const gaps: string[] = [];
  if (!draft.name?.trim()) gaps.push("a name");
  if (!draft.description?.trim()) gaps.push("a description of what it does");
  if (!draft.instructions?.trim()) gaps.push("instructions");
  // A flow built from blocks needs no MCP tool (2026-09-29); nor does an agent of documents or rules (2026-10-03).
  const capabilities = (draft.blocks?.length ?? 0) + (draft.knowledgeToolCount ?? 0) + (draft.ruleCount ?? 0);
  if (draft.tools.length === 0 && capabilities === 0) gaps.push("at least one tool, block, document or rule");
  // No agent runs on Dolphin's model (owner, 2026-09-28).
  if (!draft.brain) gaps.push("a brain (your own model key)");
  return gaps;
}

function listGaps(gaps: string[]): string {
  if (gaps.length <= 1) return gaps.join("");
  return `${gaps.slice(0, -1).join(", ")} and ${gaps[gaps.length - 1]}`;
}

function Field({
  label,
  value,
  multiline = false,
}: {
  label: string;
  value: string | null;
  multiline?: boolean;
}) {
  const filled = value !== null && value.trim().length > 0;
  return (
    <div className="border-b border-line/60 py-3 last:border-b-0">
      <dt className="text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </dt>
      <dd
        className={`mt-1 text-[0.84rem] leading-relaxed ${
          filled ? "text-ink" : "text-faint"
        } ${multiline && filled ? "whitespace-pre-wrap" : ""}`}
      >
        {filled ? value : "Not drafted yet"}
      </dd>
    </div>
  );
}

/**
 * THE LIFECYCLE (owner, 2026-10-03: Draft → Test → Paper → Live). Each stage is a fact
 * about the agent, never a claim: Draft until nothing is missing; Test once it can be tried
 * privately; Paper while Autopilot runs it on paper - only for an agent that trades, so
 * the stage is absent otherwise; Live once it is registered on-chain.
 */
function lifecycle(draft: AgentDraft, ready: boolean, onChain: boolean): { steps: string[]; current: number } {
  const trades = (draft.ruleCount ?? 0) > 0 || Boolean(draft.blocks?.some((block) => block.type === "swap"));
  const steps = trades ? ["Draft", "Test", "Paper", "Live"] : ["Draft", "Test", "Live"];
  const current = onChain ? steps.length - 1 : trades && draft.autopilot?.on ? 2 : ready ? 1 : 0;
  return { steps, current };
}

export function AgentDraftPanel({
  draft,
  onClose,
  trying = false,
  onTry,
  onBack,
  isStartingTry = false,
  onPublish,
  published = [],
  onToggleAutopilot,
  onWatchRuns,
  autopilotBusy = false,
  tradeKeyConversation = null,
  knowledgeConversation = null,
  maximized = false,
  onMaximize,
  onPopOut,
  onPopIn,
}: {
  draft: AgentDraft;
  onClose?: () => void;
  /** The conversation beside this panel is a private try-run of the draft. */
  trying?: boolean;
  /** Opens a try-run. Absent until the conversation exists. */
  onTry?: () => void;
  /** Returns from a try-run to the build conversation. */
  onBack?: () => void;
  isStartingTry?: boolean;
  /** Opens the publish screen. Absent until the draft can be published. */
  onPublish?: () => void;
  /** Where this draft already lives on-chain, per network. */
  published?: readonly { hash: string; networkLabel: string; status: string; tokenId: string | null }[];
  /** Arms or disarms the draft's triggers. Absent outside Build mode. */
  onToggleAutopilot?: (on: boolean) => void;
  /** Opens the autopilot's run feed. */
  onWatchRuns?: () => void;
  autopilotBusy?: boolean;
  /** The build conversation, when this agent may be given a trade key (Build mode). */
  tradeKeyConversation?: string | null;
  /** The build conversation, when documents can be added (Build mode, not a try-run). */
  knowledgeConversation?: string | null;
  /** Desktop only: fill the page, open in its own tab, or (in that tab) go back. */
  maximized?: boolean;
  onMaximize?: () => void;
  onPopOut?: () => void;
  onPopIn?: () => void;
}) {
  // Draft, or the builder's own keys (owner, 2026-09-28: "a new tab ... to manage their envs").
  const [tab, setTab] = useState<"draft" | "keys">("draft");
  const gaps = draftGaps(draft);
  const ready = gaps.length === 0;
  // Step 1 is where every draft starts; the later steps light up as the
  // builder moves the draft through them.
  const live = published.filter((entry) => entry.status === "registered");
  const stages = lifecycle(draft, ready, live.length > 0);

  return (
    <aside
      aria-label="Agent draft"
      className="flex h-full min-h-0 flex-col border-l border-line/60 bg-paper px-3 pb-4 pt-3"
    >
      {/* WHO THIS AGENT IS, AND WHETHER IT ACTS ON ITS OWN (owner, 2026-10-03: UI review points 4 and 6). */}
      <div className="flex items-start gap-2.5 px-2 py-1.5">
        <div className="agent-identity__mark grid size-9 shrink-0 place-items-center rounded-xl text-ink">
          <CategoryGlyph name="brain" size={17} strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[14px] font-semibold tracking-[-0.01em] text-ink">{draft.name?.trim() || "Agent draft"}</h2>
            <StatusPill autopilot={Boolean(draft.autopilot?.on)} live={live.length > 0} paper={draft.paperMode !== false} />
          </div>
          <p className="text-[11px] text-muted">{live.length > 0 ? `On ${live[0].networkLabel} · #${live[0].tokenId}` : "Private · only you can run it"}</p>
        </div>
        {onMaximize || onPopOut || onPopIn ? (
          <div className="hidden shrink-0 items-center gap-0.5 lg:flex">
            {onMaximize ? (
              <button
                aria-label={maximized ? "Restore the agent panel" : "Maximize the agent panel"}
                className="panel-icon-button"
                onClick={onMaximize}
                title={maximized ? "Restore (Esc)" : "Maximize"}
                type="button"
              >
                <svg aria-hidden fill="none" height={14} viewBox="0 0 24 24" width={14}>
                  <path
                    d={maximized ? "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" : "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"}
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                  />
                </svg>
              </button>
            ) : null}
            {onPopOut || onPopIn ? (
              <button
                aria-label={onPopIn ? "Put the agent panel back" : "Open the agent panel in a new tab"}
                className="panel-icon-button"
                onClick={onPopIn ?? onPopOut}
                title={onPopIn ? "Put it back" : "Open in a new tab"}
                type="button"
              >
                <svg aria-hidden fill="none" height={14} viewBox="0 0 24 24" width={14}>
                  <path
                    d={onPopIn ? "M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5M10 14l10-10M10 8v6h6" : "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"}
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                  />
                </svg>
              </button>
            ) : null}
          </div>
        ) : null}
        {onClose ? (
          <button
            aria-label="Close agent draft"
            className="grid size-9 place-items-center rounded-full text-muted transition-colors hover:bg-paper-muted"
            onClick={onClose}
            type="button"
          >
            <span aria-hidden className="text-lg leading-none">×</span>
          </button>
        ) : null}
      </div>

      {/* A visibly darker track and a white selected pill (owner, 2026-09-28: "you can't tell if it's on Keys or Draft"). */}
      <div aria-label="Panel" className="panel-tabs relative mx-2 mt-2 grid grid-cols-2 rounded-full p-[3px]" role="tablist">
        {/* The white pill glides to the open tab rather than jumping (owner: micro-animations). */}
        <span aria-hidden className="panel-tabs__pill" data-tab={tab} />
        {(["draft", "keys"] as const).map((option) => (
          <button
            aria-selected={tab === option}
            className="panel-tabs__tab rounded-full py-1 !text-[12px] font-semibold transition-all"
            key={option}
            onClick={() => setTab(option)}
            role="tab"
            type="button"
          >
            {option === "draft" ? "Draft" : "Keys"}
          </button>
        ))}
      </div>

      {/*
        * Both pages sit side by side and slide across together, so switching
        * tabs moves the page with the pill instead of snapping. The hidden one
        * is inert: no focus, no screen reader.
        */}
      <div className="relative mt-0 min-h-0 flex-1 overflow-hidden">
        <div className="panel-slider flex h-full" data-tab={tab}>
      <div className="flex h-full w-1/2 min-w-0 flex-col" inert={tab !== "draft"}>
      <ol className="mt-3 flex items-center gap-1.5 px-2" aria-label="Lifecycle">
        {stages.steps.map((step, index) => {
          const done = index < stages.current;
          const active = index === stages.current;
          return (
            <li
              aria-current={active ? "step" : undefined}
              className="flex min-w-0 flex-1 flex-col gap-1.5"
              key={step}
            >
              {/* Gold marks where the agent is now: the brand's colour, for the active state only. */}
              <span className={`lifecycle-bar h-1 rounded-full ${done ? "bg-ink/70" : active ? "lifecycle-bar--active" : "bg-line"}`} />
              <span
                className={`truncate text-[0.64rem] font-medium ${
                  active ? "text-ink" : "text-muted"
                }`}
              >
                {step}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="sleek-scroll mt-4 min-h-0 flex-1 overflow-y-auto px-2">
        <dl>
          {tradeKeyConversation && !trying ? (
            <EditableName conversationKey={tradeKeyConversation} name={draft.name} />
          ) : (
            <Field label="Name" value={draft.name} />
          )}
          <Field label="What it does" value={draft.description} />
          <Field label="Instructions" multiline value={draft.instructions} />
        </dl>

        <div className="py-3">
          <p className="text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-muted">
            Tools
          </p>
          {draft.tools.length === 0 ? (
            <p className="mt-1 text-[0.8rem] leading-relaxed text-faint">
              None yet. Your agent uses tools from the free MCP agents listed on
              Dolphin, and each one is shown here with the agent that publishes it.
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {draft.tools.map((tool) => (
                <li
                  className="rounded-lg bg-paper-muted/70 px-3 py-2"
                  key={`${tool.agentKey}:${tool.toolName}`}
                >
                  <span className="block truncate font-mono text-[0.78rem] text-ink">
                    {tool.toolName}
                  </span>
                  <span className="block truncate text-[0.68rem] text-muted">
                    via {tool.agentName}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {knowledgeConversation && !trying ? <PermissionsSection conversationKey={knowledgeConversation} draft={draft} /> : null}
        {knowledgeConversation && !trying ? <KnowledgeSection conversationKey={knowledgeConversation} /> : null}
        {knowledgeConversation && !trying ? <TradingRulesSection conversationKey={knowledgeConversation} /> : null}
      </div>

      {onToggleAutopilot ? (
        <AutopilotCard busy={autopilotBusy} draft={draft} onToggle={onToggleAutopilot} onWatchRuns={onWatchRuns} />
      ) : null}

      {tradeKeyConversation ? (
        <PaperTradingCard
          conversationKey={tradeKeyConversation}
          hasRules={(draft.ruleCount ?? 0) > 0}
          hasSwap={Boolean(draft.blocks?.some((block) => block.type === "swap"))}
        />
      ) : null}

      {/* Live trading only: in paper mode no real trade is made, so no trade key is offered. */}
      {tradeKeyConversation && draft.paperMode === false ? (
        <AutoTradeCard
          conversationKey={tradeKeyConversation}
          // A rules agent trades from the Dolphin Wallet with the same key (owner, 2026-10-03).
          hasSwap={Boolean(draft.blocks?.some((block) => block.type === "swap")) || (draft.ruleCount ?? 0) > 0}
          riskDailyUsd={(() => {
            const risk = draft.blocks?.find((block) => block.type === "risk");
            return risk && risk.type === "risk" ? risk.config.maxTradeUsd * risk.config.maxTradesPerDay : null;
          })()}
        />
      ) : null}

      <div className="mt-3 space-y-2 border-t border-line/60 px-2 pt-3">
        {trying ? (
          <button
            className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-line/80 px-4 text-[13px] font-semibold text-ink transition-colors hover:bg-paper-muted disabled:cursor-not-allowed disabled:opacity-30"
            disabled={!onBack}
            onClick={onBack}
            type="button"
          >
            Back to the draft
          </button>
        ) : (
          <button
            className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-ink px-4 text-[13px] font-semibold text-canvas transition-opacity disabled:cursor-not-allowed disabled:opacity-30"
            disabled={!ready || !onTry || isStartingTry}
            onClick={onTry}
            type="button"
          >
            {/* The span carries the colour for the same reason ChatHistory's
                "New conversation" does: globals.css colours button text. */}
            <span className="text-canvas">{isStartingTry ? "Opening…" : "Try it privately"}</span>
          </button>
        )}
        {live.map((entry) => (
          <a
            className="flex items-center justify-between rounded-lg bg-success/10 px-3 py-2 text-[12px] text-ink no-underline"
            href={`/agent/${entry.hash}`}
            key={entry.hash}
          >
            <span>
              On {entry.networkLabel} · #{entry.tokenId}
            </span>
            <span className="font-semibold">View</span>
          </a>
        ))}
        <button
          className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-line/80 px-4 text-[13px] font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!ready || !onPublish || trying}
          onClick={onPublish}
          type="button"
        >
          Put on-chain
        </button>
        <p className="text-[0.7rem] leading-relaxed text-muted">
          {trying
            ? "This run is private. Only you can see it, and it uses only the tools in the draft."
            : ready
              ? "Putting it on-chain registers it from your own wallet. Until then it stays free and private to you."
              : `Needs ${listGaps(gaps)} before you can try it. It stays free and private.`}
        </p>
      </div>
      </div>
      <div className="sleek-scroll h-full w-1/2 min-w-0 overflow-y-auto px-2 pb-2 pt-4" inert={tab !== "keys"}>
        <EnvVarsPanel />
      </div>
        </div>
      </div>
    </aside>
  );
}

// "signal" was missing here (the backend has always armed on it) - added 2026-10-03.
const TRIGGER_TYPES = ["schedule", "price", "walletWatch", "signal"];

/** Draft, Autopilot (on paper or live) or Live on-chain - the one word that says what the agent is doing. */
function StatusPill({ live, autopilot, paper }: { live: boolean; autopilot: boolean; paper: boolean }) {
  const [label, tone] = live ? ["Live", "live"] : autopilot ? [paper ? "Autopilot · paper" : "Autopilot", "auto"] : ["Draft", "draft"];
  return (
    <span className="agent-status shrink-0" data-tone={tone}>
      {label}
    </span>
  );
}

/**
 * AUTOPILOT, WHERE IT ALWAYS WAS (owner, 2026-10-03: a Manual | Autopilot switch at the top
 * "doesn't look good" - keep the card, add the question). Turning it on asks first, and says exactly what the agent
 * will then do by itself - only what is true for THIS agent: its triggers, its trading
 * rules (paper, or real orders once Trading mode is Live), and Dolphin
 * Wallet trading only when its Swap block trades live.
 */
function AutopilotCard({
  draft,
  busy,
  onToggle,
  onWatchRuns,
}: {
  draft: AgentDraft;
  busy: boolean;
  onToggle: (on: boolean) => void;
  onWatchRuns?: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const triggers = (draft.blocks ?? []).filter((block) => TRIGGER_TYPES.includes(block.type));
  const rules = draft.ruleCount ?? 0;
  const armable = triggers.length + rules > 0;
  const on = Boolean(draft.autopilot?.on);
  const risk = draft.blocks?.find((block) => block.type === "risk");
  const swap = draft.blocks?.some((block) => block.type === "swap");

  const consequences = [
    triggers.length
      ? `It runs by itself on ${triggers.length} trigger${triggers.length === 1 ? "" : "s"}, up to 48 times a day. Each run uses your own model key.`
      : null,
    rules
      ? `${rules === 1 ? "Its trading rule watches" : `Its ${rules} trading rules watch`} Binance and acts on every closed candle, with no AI in the way - ${
          draft.paperMode === false ? "LIVE: real orders, on Binance or from your Dolphin Wallet." : "on paper, until you switch Trading mode to Live."
        }`.replace("watch Binance and acts", "watch Binance and act")
      : null,
    swap
      ? draft.paperMode === false
        ? `It can trade from your Dolphin Wallet without asking, if you have given it a trade key${risk && risk.type === "risk" ? ` - at most $${risk.config.maxTradeUsd} a trade and ${risk.config.maxTradesPerDay} a day` : ""}.`
        : "Its Dolphin Wallet trades stay on paper: Paper trading is on."
      : null,
    "You can switch Autopilot off at any time. What it does is your decision and your responsibility - not financial advice.",
  ].filter((line): line is string => Boolean(line));

  return (
    <div className="mx-2 mt-3 rounded-xl border border-line bg-paper-strong px-3 py-2.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold text-ink">Autopilot</p>
          <p className="text-[0.68rem] leading-snug text-muted">
            {!armable
              ? "Add a Schedule, Price, Signal or Wallet watch from the toolbox, or ask for a trading rule, to let it run on its own."
              : on
                ? [
                    triggers.length ? `${triggers.length} trigger${triggers.length === 1 ? "" : "s"}, up to 48 runs a day on your key` : null,
                    rules ? `${rules} rule${rules === 1 ? "" : "s"} watching Binance, on paper` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                    .replace(/^/, "On · ")
                : "Off · it runs only when you ask it"}
          </p>
        </div>
        <button
          aria-checked={on}
          aria-label="Autopilot"
          className="autopilot-switch"
          disabled={busy || (!armable && !on)}
          // Off is immediate; on asks first (owner, 2026-10-03).
          onClick={() => (on ? onToggle(false) : setAsking(true))}
          role="switch"
          type="button"
        >
          <span className="autopilot-switch__knob" />
        </button>
      </div>
      {draft.autopilot && onWatchRuns ? (
        <button className="mt-1.5 !text-[0.72rem] font-semibold text-accent-ink hover:underline" onClick={onWatchRuns} type="button">
          Watch its runs →
        </button>
      ) : null}

      {asking ? (
        <div aria-labelledby="autopilot-confirm-title" aria-modal className="confirm-scrim" role="dialog">
          <div className="confirm-card">
            <p className="text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-muted">Autopilot</p>
            <h3 className="mt-1 text-[1.05rem] font-semibold tracking-[-0.01em] text-ink" id="autopilot-confirm-title">
              Let {draft.name?.trim() || "this agent"} act on its own?
            </h3>
            <ul className="mt-3 space-y-2">
              {consequences.map((line, index) => (
                <li className="flex gap-2 text-[0.82rem] leading-relaxed text-ink-soft" key={`${index}:${line}`}>
                  <span aria-hidden className="mt-[0.55em] size-1.5 shrink-0 rounded-full bg-ink/40" />
                  {line}
                </li>
              ))}
            </ul>
            <div className="mt-5 flex justify-end gap-2">
              <button className="h-9 rounded-lg border border-line px-4 !text-[13px] font-semibold text-ink" onClick={() => setAsking(false)} type="button">
                Cancel
              </button>
              <button
                className="h-9 rounded-lg bg-ink px-4 !text-[13px] font-semibold"
                onClick={() => {
                  setAsking(false);
                  onToggle(true);
                }}
                type="button"
              >
                <span className="text-canvas">Turn on Autopilot</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * THE NAME, EDITABLE IN PLACE (owner, 2026-09-29: "let the person be able to
 * edit the name of his agent from the right panel"). Click it to edit; Enter
 * or leaving the field saves, Escape puts it back.
 */
function EditableName({ conversationKey, name }: { conversationKey: string; name: string | null }) {
  const update = useMutation(agentBuilderApi.agentBuilder.updateDraft);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name ?? "");
  const save = () => {
    setEditing(false);
    const next = value.trim().slice(0, 60);
    if (!next || next === (name ?? "")) return setValue(name ?? "");
    void update({ conversationKey, name: next }).catch((cause) => {
      setValue(name ?? "");
      toast.error(errorText(cause, "Could not rename the agent."));
    });
  };
  return (
    <div className="border-b border-line/60 py-3">
      <dt className="text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-muted">Name</dt>
      <dd className="mt-1">
        {editing ? (
          <input
            aria-label="Agent name"
            autoFocus
            className="w-full rounded-md border border-line bg-paper-strong px-2 py-1 text-[0.84rem] text-ink"
            maxLength={60}
            onBlur={save}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") save();
              if (event.key === "Escape") {
                setValue(name ?? "");
                setEditing(false);
              }
            }}
            value={value}
          />
        ) : (
          <button
            className="group flex w-full items-center gap-2 rounded-md text-left text-[0.84rem] text-ink"
            onClick={() => {
              setValue(name ?? "");
              setEditing(true);
            }}
            title="Rename"
            type="button"
          >
            <span className={name?.trim() ? "" : "text-faint"}>{name?.trim() || "Not drafted yet"}</span>
            <span className="text-[0.68rem] text-muted opacity-0 transition-opacity group-hover:opacity-100">Rename</span>
          </button>
        )}
      </dd>
    </div>
  );
}

function errorText(cause: unknown, fallback: string): string {
  const data = (cause as { data?: unknown } | null)?.data;
  return typeof data === "string" ? data : fallback;
}
