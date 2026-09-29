"use client";

import { useMutation } from "convex/react";
import { useState } from "react";

import { CategoryGlyph } from "@/components/category-glyph";
import { AutoTradeCard } from "@/components/auto-trade-card";
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
  // A flow built from blocks needs no MCP tool (2026-09-29).
  if (draft.tools.length === 0 && (draft.blocks?.length ?? 0) === 0) gaps.push("at least one tool or block");
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

const STEPS = ["Draft it", "Try it privately", "Put it on-chain"] as const;

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
}) {
  // Draft, or the builder's own keys (owner, 2026-09-28: "a new tab ... to manage their envs").
  const [tab, setTab] = useState<"draft" | "keys">("draft");
  const gaps = draftGaps(draft);
  const ready = gaps.length === 0;
  // Step 1 is where every draft starts; the later steps light up as the
  // builder moves the draft through them.
  const live = published.filter((entry) => entry.status === "registered");
  const currentStep = live.length > 0 ? 3 : ready ? 1 : 0;

  return (
    <aside
      aria-label="Agent draft"
      className="flex h-full min-h-0 flex-col border-l border-line/60 bg-paper px-3 pb-4 pt-3"
    >
      <div className="flex items-center gap-2.5 px-2 py-1.5">
        <div className="grid size-8 place-items-center rounded-lg bg-paper-muted text-ink">
          <CategoryGlyph name="brain" size={16} strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13px] font-semibold text-ink">
            {draft.name?.trim() || "Agent draft"}
          </h2>
          <p className="text-[11px] text-muted">Private · only you can run it</p>
        </div>
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
      <ol className="mt-3 flex items-center gap-1.5 px-2" aria-label="Build steps">
        {STEPS.map((step, index) => {
          const done = index < currentStep;
          const active = index === currentStep;
          return (
            <li
              aria-current={active ? "step" : undefined}
              className="flex min-w-0 flex-1 flex-col gap-1.5"
              key={step}
            >
              <span
                className={`h-1 rounded-full ${
                  done ? "bg-success" : active ? "bg-ink" : "bg-line"
                }`}
              />
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
        {tradeKeyConversation && !trying ? <PurposePicker conversationKey={tradeKeyConversation} draft={draft} /> : null}
        <dl>
          <Field label="Name" value={draft.name} />
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
      </div>

      {onToggleAutopilot ? (
        <AutopilotCard
          busy={autopilotBusy}
          draft={draft}
          onToggle={onToggleAutopilot}
          onWatchRuns={onWatchRuns}
        />
      ) : null}

      {tradeKeyConversation ? (
        <AutoTradeCard
          conversationKey={tradeKeyConversation}
          hasSwap={Boolean(draft.blocks?.some((block) => block.type === "swap"))}
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
        {/* "Just for me" is never published, so it offers no button that could publish it. */}
        {draft.purpose === "private" ? null : (
          <button
            className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-line/80 px-4 text-[13px] font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!ready || !onPublish || trying}
            onClick={onPublish}
            type="button"
          >
            Put on-chain
          </button>
        )}
        <p className="text-[0.7rem] leading-relaxed text-muted">
          {trying
            ? "This run is private. Only you can see it, and it uses only the tools in the draft."
            : ready && draft.purpose === "private"
              ? "Just for you: it runs privately and is never published. Change who it is for above to share it."
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

const TRIGGER_TYPES = ["schedule", "price", "walletWatch"];

/**
 * AUTOPILOT (2026-09-28): the agent runs on its own triggers, on its builder's
 * key, up to 48 times a day (convex/autopilot.ts). Shown only once there is a
 * trigger to arm - before that it says how to get one.
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
  const triggers = (draft.blocks ?? []).filter((block) => TRIGGER_TYPES.includes(block.type));
  const on = Boolean(draft.autopilot?.on);
  return (
    <div className="mx-2 mt-3 rounded-xl border border-line bg-paper-strong px-3 py-2.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold text-ink">Autopilot</p>
          <p className="text-[0.68rem] leading-snug text-muted">
            {triggers.length === 0
              ? "Add a Schedule, Price or Wallet watch from the toolbox to let it run on its own."
              : on
                ? `On · runs on ${triggers.length} trigger${triggers.length === 1 ? "" : "s"}, up to 48 times a day, on your key`
                : "Off · it runs only when you ask it"}
          </p>
        </div>
        <button
          aria-checked={on}
          aria-label="Autopilot"
          className="autopilot-switch"
          disabled={busy || triggers.length === 0}
          onClick={() => onToggle(!on)}
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
    </div>
  );
}

/**
 * WHO IS IT FOR (mentor review, 2026-09-29: ask in plain language; keep the
 * protocol names - MCP, A2A - out of the way). Saved to the draft at once.
 */
const PURPOSES: { value: AgentPurpose; label: string; about: string }[] = [
  { value: "private", label: "Just for me", about: "A private automation. It runs for you and is never published." },
  { value: "tools", label: "Others can use it", about: "Published so other apps and agents can call its tools (as an MCP server)." },
  { value: "hire", label: "Others can hire it", about: "Published with a price per job. Paid delivery is not open on Dolphin yet - your price and payout wallet are recorded for when it is." },
];

function PurposePicker({ conversationKey, draft }: { conversationKey: string; draft: AgentDraft }) {
  const update = useMutation(agentBuilderApi.agentBuilder.updateDraft);
  const [price, setPrice] = useState(draft.hirePriceUsd ? String(draft.hirePriceUsd) : "");
  const choose = (purpose: AgentPurpose) => {
    void update({ conversationKey, purpose }).catch((cause) => toast.error(errorText(cause, "Could not save that.")));
  };
  const savePrice = () => {
    const value = Number(price);
    if (!price.trim() || !(value > 0)) return;
    void update({ conversationKey, hirePriceUsd: value }).catch((cause) => toast.error(errorText(cause, "Could not save that price.")));
  };
  const current = PURPOSES.find((option) => option.value === draft.purpose) ?? null;
  return (
    <div className="border-b border-line/60 pb-3">
      <p className="text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-muted">Who is it for?</p>
      <div className="mt-1.5 grid grid-cols-3 gap-1" role="radiogroup" aria-label="Who is it for">
        {PURPOSES.map((option) => (
          <button
            aria-checked={draft.purpose === option.value}
            className={`rounded-lg border px-1.5 py-1.5 !text-[11px] font-semibold leading-tight transition-colors ${
              draft.purpose === option.value ? "border-ink bg-paper-strong text-ink" : "border-line/80 text-muted hover:text-ink"
            }`}
            key={option.value}
            onClick={() => choose(option.value)}
            role="radio"
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[0.7rem] leading-snug text-muted">{current ? current.about : "Choose one - Dolphin's builder will also ask you."}</p>
      {draft.purpose === "hire" ? (
        <label className="mt-2 flex items-center gap-2 text-[0.74rem] text-ink-soft">
          Price per job ($)
          <input
            className="w-24 rounded-lg border border-line bg-paper-strong px-2 py-1 font-mono text-[0.8rem] text-ink"
            inputMode="decimal"
            onBlur={savePrice}
            onChange={(event) => setPrice(event.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="e.g. 0.50"
            value={price}
          />
        </label>
      ) : null}
    </div>
  );
}

function errorText(cause: unknown, fallback: string): string {
  const data = (cause as { data?: unknown } | null)?.data;
  return typeof data === "string" ? data : fallback;
}
