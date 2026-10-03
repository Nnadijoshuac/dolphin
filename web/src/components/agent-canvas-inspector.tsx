"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";

import type { AgentDraft } from "@/components/agent-draft-panel";
import { AgentIcon } from "@/components/agent-icon";
import { ChoiceList, type Choice } from "@/components/choice-list";
import {
  agentBuilderApi,
  agentMemoryApi,
  SIGNAL_OPTIONS,
  type SignalCondition,
  api,
  brainModelsApi,
  BRAIN_PROVIDER_OPTIONS,
  envVarsApi,
  type AgentBlockData,
  type BrainProviderId,
} from "@/convex/api";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { toast } from "@/store/use-toast-store";
import { toUserMessage } from "@/wallet/wallet-errors";
import { useWallet } from "@/wallet/wallet-provider";
import { useWalletSession } from "@/wallet/wallet-session";

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
      <div className="sleek-scroll min-h-0 overflow-y-auto px-4 py-3">{children}</div>
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
      className="mt-3 flex h-8 w-full items-center justify-center rounded-lg bg-ink !text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-30"
      disabled={disabled || saving}
      onClick={onClick}
      type="button"
    >
      <span className="text-canvas">{saving ? "Saving…" : "Save"}</span>
    </button>
  );
}

const fieldClass =
  "mt-1 w-full rounded-lg border border-line bg-paper-strong px-2.5 py-1.5 text-[0.84rem] text-ink outline-none";

/**
 * Which provider a pasted key is for, by its prefix alone - only to NAME it
 * (ANTHROPIC_API_KEY...). The real answer comes from convex/brainModels.ts,
 * which asks the provider. Mirrors candidatesFor's first choice there.
 */
function providerFromPrefix(key: string): BrainProviderId | null {
  const k = key.trim();
  if (k.startsWith("sk-ant-")) return "anthropic";
  if (k.startsWith("sk-or-")) return "openrouter";
  if (k.startsWith("gsk_")) return "groq";
  if (k.startsWith("xai-")) return "xai";
  if (k.startsWith("AIza")) return "google";
  if (k.startsWith("fw_")) return "fireworks";
  if (/^sk-[0-9a-f]{32}$/i.test(k)) return "deepseek";
  if (k.startsWith("sk-")) return "openai";
  return null;
}

type Detection = { for: string; provider: BrainProviderId | null; models: string[]; note: string | null };

function BrainEditor({ conversationKey, draft, onClose }: { conversationKey: string; draft: AgentDraft; onClose: () => void }) {
  const [name, setName] = useState(draft.name ?? "");
  const [description, setDescription] = useState(draft.description ?? "");
  // null: the provider is whatever the key turns out to be for. Set: the builder chose it.
  const [providerChoice, setProviderChoice] = useState<BrainProviderId | null>(
    (draft.brain?.provider as BrainProviderId | undefined) ?? null,
  );
  const [changingProvider, setChangingProvider] = useState(false);
  const [baseUrl, setBaseUrl] = useState(draft.brain?.baseUrl ?? "");
  const [model, setModel] = useState(draft.brain?.model ?? "");
  const [keyName, setKeyName] = useState(draft.brain?.keyName ?? "");
  const [pasting, setPasting] = useState(false);
  const [pastedKey, setPastedKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [detection, setDetection] = useState<Detection | null>(null);
  const session = useWalletSession();
  const wallet = useWallet();
  // The builder's own keys, by name only (convex/envVars.ts never returns a value).
  const keys = useQuery(
    envVarsApi.envVars.list,
    session.sessionToken ? { sessionToken: session.sessionToken } : "skip",
  );
  const setVariable = useAction(envVarsApi.envVars.set);
  const detect = useAction(brainModelsApi.brainModels.detect);
  const { save, saving } = useSaveDraft(conversationKey);

  // Ask the backend which provider the chosen key is for, and what models it offers.
  const detectFor = keyName && session.sessionToken && providerChoice !== "custom" ? `${keyName}|${providerChoice ?? ""}` : null;
  useEffect(() => {
    if (!detectFor || !session.sessionToken) return;
    let live = true;
    detect({ sessionToken: session.sessionToken, keyName, ...(providerChoice ? { provider: providerChoice } : {}) })
      .then((result) => {
        if (live) setDetection({ for: detectFor, ...result });
      })
      .catch((cause) => {
        if (live) setDetection({ for: detectFor, provider: null, models: [], note: errorText(cause, "Could not read that key.") });
      });
    return () => {
      live = false;
    };
  }, [detect, detectFor, keyName, providerChoice, session.sessionToken]);

  const current = detectFor && detection?.for === detectFor ? detection : null;
  const detecting = Boolean(detectFor) && !current;
  const provider: BrainProviderId | null = providerChoice ?? current?.provider ?? null;
  const option = provider ? BRAIN_PROVIDER_OPTIONS.find((candidate) => candidate.id === provider)! : null;
  const models = current?.models ?? [];

  const textChanged = name !== (draft.name ?? "") || description !== (draft.description ?? "");
  const brainChanged =
    (provider ?? "") !== (draft.brain?.provider ?? "") ||
    model.trim() !== (draft.brain?.model ?? "") ||
    keyName !== (draft.brain?.keyName ?? "") ||
    baseUrl.trim() !== (draft.brain?.baseUrl ?? "");
  // What still stands between this brain and being saved, in words - never a silently dead button.
  const brainMissing = !session.sessionToken
    ? "Sign in with your wallet first - the key must belong to you."
    : !keyName
      ? "Choose one of your keys, or paste one."
      : detecting
        ? "Reading your key…"
        : !provider
          ? "Dolphin could not tell which provider this key is for - choose it."
          : provider === "custom" && !baseUrl.trim().startsWith("https://")
            ? "Enter the custom endpoint's https:// address."
            : model.trim().length < 2
              ? "Choose a model."
              : null;

  /** Saves a pasted key under its provider's usual name (never over an existing key) and selects it. */
  const saveKey = async () => {
    if (!session.sessionToken || !pastedKey.trim()) return;
    const guessed = providerFromPrefix(pastedKey);
    const base = guessed ? BRAIN_PROVIDER_OPTIONS.find((candidate) => candidate.id === guessed)!.keyName : "BRAIN_API_KEY";
    const taken = new Set((keys ?? []).map((key) => key.name));
    let keyNameToUse = base;
    for (let n = 2; taken.has(keyNameToUse) && n < 20; n++) keyNameToUse = `${base}_${n}`;
    setSavingKey(true);
    try {
      const saved = await setVariable({ sessionToken: session.sessionToken, name: keyNameToUse, value: pastedKey });
      setKeyName(saved.name);
      setProviderChoice(null);
      setModel("");
      setPastedKey("");
      setPasting(false);
      toast.success(`${saved.name} saved, encrypted. It will not be shown again.`);
    } catch (cause) {
      toast.error(errorText(cause, "Could not save that key."));
    } finally {
      setSavingKey(false);
    }
  };

  const keyChoices: Choice[] = (keys ?? []).map((key) => ({
    value: key.name,
    label: key.name,
    hint: key.last4 ? `••••${key.last4}` : undefined,
  }));
  const providerChoices: Choice[] = [
    { value: "", label: "Work it out from the key" },
    ...BRAIN_PROVIDER_OPTIONS.map((candidate) => ({ value: candidate.id, label: candidate.label })),
  ];
  const modelChoices: Choice[] = models.map((id) => ({ value: id, label: id }));
  const showPaste = pasting || (keys !== undefined && keys.length === 0);

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
          rows={3}
          value={description}
        />
      </label>

      <div className="mt-4 border-t border-line/60 pt-3">
        <Label>Model · on your own key</Label>

        {session.status === "unavailable" ? null : !session.sessionToken ? (
          <div className="mt-2 rounded-lg bg-paper-muted/70 px-3 py-2.5">
            <p className="text-[0.72rem] leading-relaxed text-muted">
              The brain runs on a key that belongs to your wallet. {session.status === "wallet-disconnected" ? "Connect it" : "Sign in"} to choose one.
            </p>
            <button
              className="mt-2 rounded-full bg-ink px-3 py-1 !text-[12px] font-semibold disabled:opacity-40"
              disabled={session.isSigningIn || wallet.isConnecting}
              onClick={() => void (session.status === "wallet-disconnected" ? wallet.connect() : session.signIn())}
              type="button"
            >
              <span className="text-canvas">
                {session.status === "wallet-disconnected" ? "Connect wallet" : session.isSigningIn ? "Check your wallet…" : "Sign in"}
              </span>
            </button>
          </div>
        ) : (
          <>
            {keyChoices.length > 0 ? (
              <div className="mt-1.5">
                <ChoiceList
                  ariaLabel="Key"
                  choices={keyChoices}
                  footer={{ label: "+ Paste a new key", onSelect: () => setPasting(true) }}
                  mono
                  onChange={(next) => {
                    if (next === keyName) return;
                    setKeyName(next);
                    setProviderChoice(null);
                    setChangingProvider(false);
                    setModel("");
                  }}
                  placeholder="Choose a key…"
                  searchable={false}
                  value={keyName}
                />
              </div>
            ) : null}

            {showPaste ? (
              <div className="mt-2 flex gap-1.5">
                <input
                  aria-label="Paste your API key"
                  autoComplete="off"
                  className={`${fieldClass} secret-field !mt-0 font-mono`}
                  data-1p-ignore
                  data-lpignore="true"
                  name="dolphin-secret"
                  onChange={(e) => setPastedKey(e.target.value)}
                  placeholder="Paste any provider's API key"
                  spellCheck={false}
                  type="text"
                  value={pastedKey}
                />
                <button
                  className="shrink-0 rounded-lg border border-line px-2.5 !text-[12px] font-semibold text-ink hover:bg-paper-muted disabled:opacity-40"
                  disabled={savingKey || pastedKey.trim().length === 0}
                  onClick={() => void saveKey()}
                  type="button"
                >
                  {savingKey ? "Saving…" : "Add"}
                </button>
              </div>
            ) : null}

            {keyName ? (
              <div className="brain-provider mt-2">
                <span aria-hidden className="brain-provider__dot" data-state={detecting ? "reading" : provider ? "known" : "unknown"} />
                <p className="min-w-0 flex-1 truncate text-[0.74rem] text-ink-soft">
                  {detecting
                    ? "Reading your key…"
                    : option
                      ? `${option.label}${providerChoice ? "" : " · worked out from your key"}`
                      : "Provider unknown"}
                </p>
                <button
                  className="shrink-0 !text-[0.72rem] font-semibold text-muted hover:text-ink"
                  onClick={() => setChangingProvider((open) => !open)}
                  type="button"
                >
                  {changingProvider ? "Done" : "Change"}
                </button>
              </div>
            ) : null}
            {current?.note && !detecting ? <p className="mt-1 text-[0.7rem] leading-snug text-muted">{current.note}</p> : null}

            {keyName && (changingProvider || (!detecting && !provider)) ? (
              <ChoiceList
                ariaLabel="Provider"
                choices={providerChoices}
                onChange={(next) => {
                  setProviderChoice(next ? (next as BrainProviderId) : null);
                  setModel("");
                  setChangingProvider(false);
                }}
                searchable={false}
                value={providerChoice ?? ""}
              />
            ) : null}

            {provider === "custom" ? (
              <input
                aria-label="Endpoint base URL"
                className={`${fieldClass} mt-2 font-mono`}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1 (OpenAI-compatible)"
                spellCheck={false}
                value={baseUrl}
              />
            ) : null}

            {keyName && provider ? (
              <div className="mt-2">
                <ChoiceList
                  allowCustom
                  ariaLabel="Model"
                  choices={modelChoices}
                  mono
                  onChange={setModel}
                  placeholder={models.length > 0 ? `Choose from ${models.length} models…` : `Type a model id, e.g. ${option?.example ?? ""}`}
                  value={model}
                />
              </div>
            ) : null}
          </>
        )}
      </div>

      <SaveButton
        disabled={!textChanged && !brainChanged}
        onClick={() => {
          if (brainChanged && brainMissing) {
            toast.notice(brainMissing);
            if (!textChanged) return;
          }
          void save({
            ...(textChanged ? { name, description } : {}),
            ...(brainChanged && !brainMissing && provider && session.sessionToken
              ? {
                  brain: { provider, model: model.trim(), keyName, baseUrl: provider === "custom" ? baseUrl.trim() : null },
                  sessionToken: session.sessionToken,
                }
              : {}),
          }).then((ok) => {
            if (ok) toast.success(brainChanged && !brainMissing ? "Brain saved." : "Saved.");
          });
        }}
        saving={saving}
      />
      {brainChanged && brainMissing ? <p className="mt-1.5 text-[0.7rem] leading-snug text-muted">{brainMissing}</p> : null}
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
        className="mt-4 flex h-8 w-full items-center justify-center rounded-lg border border-line !text-[12.5px] font-semibold text-ink transition-colors hover:bg-paper-muted disabled:opacity-40"
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
  if (selectedId.startsWith("new-") || selectedId.startsWith("block-")) {
    return <BlockEditor conversationKey={conversationKey} draft={draft} onClose={onClose} selectedId={selectedId} />;
  }
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
    return (
      <InfoPanel
        body="Every run starts here. Whatever plugs into it - a message, the Scheduler, a price crossing, a watched wallet - fires it once, and it hands one run to the Brain."
        onClose={onClose}
        title="Trigger"
      />
    );
  }
  if (selectedId === "source-chat") {
    return <InfoPanel body="Fires the Trigger when someone sends your agent a message. It answers in the conversation." onClose={onClose} title="When asked" />;
  }
  if (selectedId === "output") {
    return <InfoPanel body="It replies with what its tools returned. It quotes no number a tool did not give it." onClose={onClose} title="Output" />;
  }
  return null;
}

/* ── Toolbox blocks (2026-09-28) ─────────────────────────────────────────── */

type BlockType = AgentBlockData["type"];

const BLOCK_TITLES: Record<BlockType, string> = {
  market: "Price feed",
  safety: "Safety check",
  swap: "Market",
  risk: "Risk limits",
  schedule: "Scheduler",
  price: "Price trigger",
  walletWatch: "Wallet watch",
  hire: "Hire an agent",
  memory: "Memory",
  indicators: "Indicators",
  signal: "Signal",
  dataSource: "Data source",
  news: "News",
  quietHours: "Quiet hours",
  binance: "Binance",
};

const BLOCK_ABOUT: Record<BlockType, string> = {
  market: "The token this agent watches and trades. Its live chart appears on the canvas, and every run reads its price, liquidity, volume, candles and daily trend for the Brain. Indicators use closed candles only - the candle still forming is left out, so nothing is decided on a price that could still change. The live price is reported separately.",
  safety: "Lets the Brain check a token's contract before acting: honeypot, taxes, owner powers and holder concentration.",
  swap: "Where the agent buys and sells, on PancakeSwap - after every order passes your Risk limits. Each trade comes to you as a ticket to sign, unless you turn on \"Trade without asking\" in the Draft tab.",
  risk: "Hard limits on what the agent may propose, checked in code on every trade, whatever the Brain decides.",
  schedule: "Makes its own signal: it fires the Trigger on a clock while Autopilot is on. Every run uses your own model key.",
  price: "Makes its own signal: it fires the Trigger when the Price feed's token crosses your level - once per crossing, not on every check. This one watches the live price, not closed candles.",
  walletWatch: "Makes its own signal: it fires the Trigger when a watched wallet transacts - a KOL, a whale, a fund. It sees any transaction they send, and exactly which tokens moved for your Price feed token and Dolphin's verified list.",
  dataSource: "Your own API, read on every run and handed to the Brain as data. Any https address that answers JSON or text; if it needs a key, add it in the Keys tab and choose it here. The key and the data serve only your agent: nothing is cached or shown to anyone else, and the transcript records only that it was read.",
  news: "Headlines from a feed you choose - RSS, Atom or a JSON news API - filtered to your keywords (the Price feed's token by default). Only the headline, source and time reach the Brain, never article text, and anything the source marks as sponsored or sends through a press-release wire is flagged as paid promotion. You choose the feed and are responsible for its terms.",
  quietHours: "Stands aside around scheduled events - a rate decision, an inflation release. List them in UTC; no trade goes through within the margin either side of any of them. Checked in code on every trade, whatever the Brain decides.",
  indicators: "Technical indicators for the Price feed's token, computed in code on closed candles only and read on every run: RSI(14), MACD(12,26,9), Bollinger bands (20,2), the 20- and 50-candle averages, volume against its average, and any cross that just happened.",
  signal: "Makes its own signal: it fires the Trigger when a technical condition turns true on a newly closed candle - an RSI level, a moving-average cross or a MACD cross. Checked every 5 minutes; fires once per candle, never on a candle still forming.",
  memory: "Your agent's memory, kept on your own server - Dolphin stores none of it. Before every run it reads what it did last time; after it, a record of the run is saved. It can also note things down itself.",
  binance: "Where the agent's trading rules trade for real once you run it on your own server: your Binance Wallet (the keyless Agentic Wallet - spot only) or the Binance Exchange (spot, and futures if you switch them on). Dolphin never sees a Binance key or session - they stay on your server. Inside Dolphin, rules trade on paper at live Binance prices.",
  hire: "A paid agent from Dolphin's catalog that yours can call on. When it asks for work, the agent quotes a price and you confirm each payment from your Dolphin Wallet with your passkey. It delivers on-chain afterwards.",
};

const SCHEDULES = [15, 30, 60, 240, 1440];

function shortId(type: BlockType): string {
  return `${type.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`;
}

type MarketPick = { tokenAddress: string; symbol: string; name: string; poolAddress: string; liquidityUsd: number };

/** BNB Chain tokens matching a name, symbol or address, deepest pool first (DexScreener search, keyless). */
async function searchMarkets(query: string): Promise<MarketPick[]> {
  const response = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) return [];
  const data = (await response.json()) as {
    pairs?: Array<{ chainId: string; pairAddress: string; baseToken: { address: string; symbol: string; name: string }; liquidity?: { usd?: number } }>;
  };
  const best = new Map<string, MarketPick>();
  for (const pair of data.pairs ?? []) {
    if (pair.chainId !== "bsc") continue;
    const key = pair.baseToken.address.toLowerCase();
    const liquidityUsd = pair.liquidity?.usd ?? 0;
    if (!best.has(key) || best.get(key)!.liquidityUsd < liquidityUsd) {
      best.set(key, {
        tokenAddress: pair.baseToken.address,
        symbol: pair.baseToken.symbol,
        name: pair.baseToken.name,
        poolAddress: pair.pairAddress,
        liquidityUsd,
      });
    }
  }
  return [...best.values()].sort((a, b) => b.liquidityUsd - a.liquidityUsd).slice(0, 6);
}

function usd(value: number): string {
  return value >= 1 ? `$${value.toLocaleString("en", { maximumFractionDigits: 0 })}` : `$${value.toPrecision(3)}`;
}

function BlockEditor({
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
  const blocks = draft.blocks ?? [];
  const existing = selectedId.startsWith("block-") ? blocks.find((block) => `block-${block.id}` === selectedId) : undefined;
  const type = (existing?.type ?? selectedId.slice("new-".length)) as BlockType;
  const { save, saving } = useSaveDraft(conversationKey);
  const config = (existing?.config ?? {}) as Record<string, unknown>;

  // Per-type form state, seeded from the block being edited.
  const [market, setMarket] = useState<MarketPick | null>(
    type === "market" && existing
      ? { tokenAddress: String(config.tokenAddress), symbol: String(config.symbol), name: String(config.name), poolAddress: String(config.poolAddress ?? ""), liquidityUsd: 0 }
      : null,
  );
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query.trim(), 400);
  const [results, setResults] = useState<MarketPick[] | null>(null);
  const [everyMinutes, setEveryMinutes] = useState<number>(Number(config.everyMinutes ?? 60));
  const [direction, setDirection] = useState<"above" | "below">((config.direction as "above" | "below") ?? "above");
  const [priceUsd, setPriceUsd] = useState(config.priceUsd ? String(config.priceUsd) : "");
  const [addresses, setAddresses] = useState(Array.isArray(config.addresses) ? (config.addresses as string[]).join("\n") : "");
  const [label, setLabel] = useState(typeof config.label === "string" ? config.label : "");
  const [maxTradeUsd, setMaxTradeUsd] = useState(config.maxTradeUsd ? String(config.maxTradeUsd) : "25");
  const [maxTradesPerDay, setMaxTradesPerDay] = useState(config.maxTradesPerDay ? String(config.maxTradesPerDay) : "3");
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [hirePick, setHirePick] = useState<{ agentKey: string; agentName: string } | null>(
    type === "hire" && existing ? { agentKey: String(config.agentKey), agentName: String(config.agentName) } : null,
  );
  const session = useWalletSession();
  const [sourceLabel, setSourceLabel] = useState(typeof config.label === "string" ? config.label : "");
  const [sourceUrl, setSourceUrl] = useState(typeof config.url === "string" && (type === "dataSource" || type === "news") ? config.url : "");
  const [authMode, setAuthMode] = useState<"none" | "bearer" | "header" | "query">((config.authMode as "none") ?? "none");
  const [authParam, setAuthParam] = useState(typeof config.authParam === "string" ? config.authParam : "");
  const [sourceKey, setSourceKey] = useState(typeof config.keyName === "string" ? config.keyName : "");
  const [keywords, setKeywords] = useState(Array.isArray(config.keywords) ? (config.keywords as string[]).join(", ") : "");
  const [eventsText, setEventsText] = useState(
    Array.isArray(config.events) ? (config.events as { label: string; at: string }[]).map((event) => `${event.label} | ${event.at.slice(0, 16).replace("T", " ")}`).join("\n") : "",
  );
  const [marginHours, setMarginHours] = useState(config.marginHours ? String(config.marginHours) : "2");
  // Binance (fast rules, phase 3). Leverage defaults to 1x (owner, 2026-10-03).
  const [binanceAccount, setBinanceAccount] = useState<"wallet" | "exchange">(config.account === "wallet" ? "wallet" : "exchange");
  const [binanceFutures, setBinanceFutures] = useState(config.futures === true);
  const [binanceLeverage, setBinanceLeverage] = useState(Number(config.maxLeverage ?? 1) || 1);
  const [timeframe, setTimeframe] = useState<"1h" | "4h" | "1d">((config.timeframe as "1h" | "4h" | "1d") ?? (type === "signal" ? "1h" : "1d"));
  const [condition, setCondition] = useState<SignalCondition>((config.condition as SignalCondition) ?? "rsiBelow");
  const [level, setLevel] = useState(config.level ? String(config.level) : "");
  const [memoryUrl, setMemoryUrl] = useState(typeof config.url === "string" ? config.url : "");
  const [memoryKey, setMemoryKey] = useState<string>(typeof config.keyName === "string" ? config.keyName : "");
  const [memoryCheck, setMemoryCheck] = useState<{ ok: boolean; text: string } | "checking" | null>(null);
  const testMemory = useAction(agentMemoryApi.agentMemoryCheck.test);
  const keys = useQuery(
    envVarsApi.envVars.list,
    (type === "memory" || type === "dataSource" || type === "news") && session.sessionToken ? { sessionToken: session.sessionToken } : "skip",
  );
  // Paid agents a flow can hire: live A2A agents in the catalog.
  const hireResults = useQuery(
    api.agents.search,
    type === "hire" && !hirePick ? { text: debounced, protocol: "a2a", paginationOpts: { numItems: 8, cursor: null } } : "skip",
  );

  useEffect(() => {
    if (type !== "market" || debounced.length < 2) return;
    let cancelled = false;
    void searchMarkets(debounced).then((found) => {
      if (!cancelled) setResults(found);
    });
    return () => {
      cancelled = true;
    };
  }, [debounced, type]);

  const marketBlock = blocks.find((block) => block.type === "market");
  useEffect(() => {
    if (type !== "price" || !marketBlock || marketBlock.type !== "market") return;
    let cancelled = false;
    void fetch(`https://api.dexscreener.com/latest/dex/tokens/${marketBlock.config.tokenAddress}`)
      .then((response) => response.json())
      .then((data: { pairs?: Array<{ chainId: string; priceUsd?: string; priceNative?: string; baseToken: { address: string }; liquidity?: { usd?: number } }> }) => {
        const pairs = (data.pairs ?? []).filter((pair) => pair.chainId === "bsc").sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
        const best = pairs[0];
        if (!best || cancelled) return;
        const isBase = best.baseToken.address.toLowerCase() === marketBlock.config.tokenAddress.toLowerCase();
        const value = isBase ? Number(best.priceUsd) : Number(best.priceUsd) / Number(best.priceNative);
        if (Number.isFinite(value)) setLivePrice(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [marketBlock, type]);

  const built = ((): AgentBlockData | null => {
    const id = existing?.id ?? shortId(type);
    switch (type) {
      case "market":
        return market ? { id, type, config: { tokenAddress: market.tokenAddress, symbol: market.symbol, name: market.name, poolAddress: market.poolAddress || null } } : null;
      case "schedule":
        return { id, type, config: { everyMinutes } };
      case "price":
        return Number(priceUsd) > 0 ? { id, type, config: { direction, priceUsd: Number(priceUsd) } } : null;
      case "walletWatch": {
        const list = addresses.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean);
        return list.length ? { id, type, config: { addresses: list, label: label.trim() || null } } : null;
      }
      case "risk":
        return Number(maxTradeUsd) > 0 && Number(maxTradesPerDay) > 0
          ? { id, type, config: { maxTradeUsd: Number(maxTradeUsd), maxTradesPerDay: Math.round(Number(maxTradesPerDay)) } }
          : null;
      case "hire":
        return hirePick ? { id, type, config: hirePick } : null;
      case "dataSource":
      case "news": {
        if (!sourceUrl.trim().startsWith("https://")) return null;
        const auth = { authMode, authParam: authMode === "header" || authMode === "query" ? authParam.trim() || null : null, keyName: authMode === "none" ? null : sourceKey || null };
        return type === "dataSource"
          ? { id, type, config: { label: sourceLabel.trim() || "Data source", url: sourceUrl.trim(), ...auth } }
          : { id, type, config: { url: sourceUrl.trim(), keywords: keywords.split(",").map((word) => word.trim()).filter(Boolean), ...auth } };
      }
      case "quietHours": {
        const events = eventsText
          .split("\n")
          .map((line) => line.split("|").map((part) => part.trim()))
          .filter((parts) => parts.length === 2 && Number.isFinite(Date.parse(`${parts[1].replace(" ", "T")}:00Z`)))
          .map(([label, at]) => ({ label: label || "Event", at: new Date(Date.parse(`${at.replace(" ", "T")}:00Z`)).toISOString() }));
        return events.length ? { id, type, config: { events, marginHours: Number(marginHours) || 2 } } : null;
      }
      case "indicators":
        return { id, type, config: { timeframe } };
      case "binance": {
        const futures = binanceAccount === "exchange" && binanceFutures;
        return { id, type, config: { account: binanceAccount, futures, maxLeverage: futures ? binanceLeverage : 1 } };
      }
      case "signal":
        return {
          id,
          type,
          config: {
            condition,
            timeframe,
            level: condition === "rsiBelow" || condition === "rsiAbove" ? Number(level) || (condition === "rsiBelow" ? 30 : 70) : null,
          },
        };
      case "memory":
        return memoryUrl.trim().startsWith("https://") ? { id, type, config: { url: memoryUrl.trim(), keyName: memoryKey || null } } : null;
      case "safety":
      case "swap":
        return { id, type, config: {} } as AgentBlockData;
    }
  })();

  const commit = async (next: AgentBlockData[]) => {
    if (await save({ blocks: next })) onClose();
  };


  return (
    <Shell onClose={onClose} title={existing ? BLOCK_TITLES[type] : `Add ${BLOCK_TITLES[type]}`}>
      <p className="text-[0.74rem] leading-relaxed text-muted">{BLOCK_ABOUT[type]}</p>

      {type === "market" ? (
        <div className="mt-3">
          {market ? (
            <div className="flex items-center gap-2 rounded-lg bg-paper-muted/70 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-[0.84rem] font-semibold text-ink">{market.symbol}</p>
                <p className="truncate font-mono text-[0.66rem] text-muted">{market.tokenAddress}</p>
              </div>
              <button className="!text-[0.7rem] font-semibold text-muted hover:text-ink" onClick={() => setMarket(null)} type="button">
                Change
              </button>
            </div>
          ) : (
            <>
              <input
                aria-label="Find a token"
                autoFocus
                className={fieldClass}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Token name, symbol or 0x address"
                spellCheck={false}
                value={query}
              />
              <ul className="mt-2 space-y-1">
                {(results ?? []).map((pick) => (
                  <li key={pick.tokenAddress}>
                    <button
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-paper-muted"
                      onClick={() => setMarket(pick)}
                      type="button"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block !text-[0.8rem] font-semibold text-ink">{pick.symbol}</span>
                        <span className="block truncate !text-[0.66rem] text-muted">{pick.name}</span>
                      </span>
                      <span className="shrink-0 font-mono !text-[0.66rem] text-muted">{usd(pick.liquidityUsd)} liq.</span>
                    </button>
                  </li>
                ))}
                {results && results.length === 0 ? (
                  <li className="px-2 py-1 text-[0.74rem] text-muted">No BNB Chain token with a pool matches that.</li>
                ) : null}
              </ul>
            </>
          )}
        </div>
      ) : null}

      {type === "schedule" ? (
        <div className="mt-3">
          <Label>Run every</Label>
          <ChoiceList
            ariaLabel="Run every"
            choices={SCHEDULES.map((minutes) => ({
              value: String(minutes),
              label: minutes >= 60 ? `${minutes / 60} hour${minutes === 60 ? "" : "s"}` : `${minutes} minutes`,
            }))}
            onChange={(next) => setEveryMinutes(Number(next))}
            searchable={false}
            value={String(everyMinutes)}
          />
        </div>
      ) : null}

      {type === "price" ? (
        <div className="mt-3">
          <div className="grid grid-cols-2 rounded-full bg-paper-muted/70 p-[3px]" role="radiogroup">
            {(["above", "below"] as const).map((option) => (
              <button
                aria-checked={direction === option}
                className={`rounded-full py-1 !text-[12px] font-medium ${direction === option ? "bg-paper-strong text-ink shadow-sm" : "text-muted"}`}
                key={option}
                onClick={() => setDirection(option)}
                role="radio"
                type="button"
              >
                {option === "above" ? "Rises above" : "Falls below"}
              </button>
            ))}
          </div>
          <input
            aria-label="Price in USD"
            className={`${fieldClass} mt-2 font-mono`}
            inputMode="decimal"
            onChange={(event) => setPriceUsd(event.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="Price in USD"
            value={priceUsd}
          />
          {livePrice !== null && marketBlock?.type === "market" ? (
            <p className="mt-1 text-[0.7rem] text-muted">
              {marketBlock.config.symbol} is ${livePrice >= 1 ? livePrice.toFixed(4) : livePrice.toPrecision(4)} now.
            </p>
          ) : null}
        </div>
      ) : null}

      {type === "walletWatch" ? (
        <div className="mt-3 space-y-2">
          <textarea
            aria-label="Wallets to watch"
            className={`${fieldClass} resize-none font-mono text-[0.72rem]`}
            onChange={(event) => setAddresses(event.target.value)}
            placeholder={"0x… one wallet per line (up to 10)"}
            rows={4}
            spellCheck={false}
            value={addresses}
          />
          <input
            aria-label="Label"
            className={fieldClass}
            maxLength={40}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Label, e.g. KOLs I follow"
            value={label}
          />
        </div>
      ) : null}


      {type === "hire" ? (
        <div className="mt-3">
          {hirePick ? (
            <div className="flex items-center gap-2 rounded-lg bg-paper-muted/70 px-3 py-2">
              <p className="min-w-0 flex-1 truncate text-[0.84rem] font-semibold text-ink">{hirePick.agentName}</p>
              <button className="!text-[0.7rem] font-semibold text-muted hover:text-ink" onClick={() => setHirePick(null)} type="button">
                Change
              </button>
            </div>
          ) : (
            <>
              <input
                aria-label="Find an agent"
                autoFocus
                className={fieldClass}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search paid agents"
                spellCheck={false}
                value={query}
              />
              <ul className="mt-2 space-y-1">
                {(hireResults?.page ?? []).map((agent) => (
                  <li key={agent.agentKey}>
                    <button
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-paper-muted"
                      onClick={() => setHirePick({ agentKey: agent.agentKey, agentName: agent.name })}
                      type="button"
                    >
                      <AgentIcon category={agent.category} seed={agent.iconSeed ?? undefined} size={26} uri={agent.iconUrl ?? undefined} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate !text-[0.8rem] font-semibold text-ink">{agent.name}</span>
                        <span className="block truncate !text-[0.66rem] text-muted">{agent.description}</span>
                      </span>
                      {agent.pricing?.display ? (
                        <span className="shrink-0 !text-[0.66rem] text-muted">{agent.pricing.display}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
                {hireResults && hireResults.page.length === 0 ? (
                  <li className="px-2 py-1 text-[0.74rem] text-muted">No A2A agent matches that.</li>
                ) : null}
              </ul>
            </>
          )}
        </div>
      ) : null}

      {type === "dataSource" || type === "news" ? (
        <div className="mt-3 space-y-3">
          {type === "dataSource" ? (
            <label className="block">
              <Label>Name</Label>
              <input className={fieldClass} maxLength={40} onChange={(event) => setSourceLabel(event.target.value)} placeholder="e.g. FX rates" value={sourceLabel} />
            </label>
          ) : null}
          <label className="block">
            <Label>{type === "news" ? "Feed address" : "Address"}</Label>
            <input
              className={`${fieldClass} font-mono`}
              data-1p-ignore
              data-lpignore="true"
              name="dolphin-source-url"
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder={type === "news" ? "https://… (RSS, Atom or a JSON news API)" : "https://api.example.com/…"}
              spellCheck={false}
              value={sourceUrl}
            />
          </label>
          {type === "news" ? (
            <label className="block">
              <Label>Keywords</Label>
              <input className={fieldClass} onChange={(event) => setKeywords(event.target.value)} placeholder="Blank: the Price feed's token" value={keywords} />
            </label>
          ) : null}
          <div>
            <Label>Its key</Label>
            <ChoiceList
              ariaLabel="How it takes a key"
              choices={[
                { value: "none", label: "No key" },
                { value: "bearer", label: "Bearer token" },
                { value: "header", label: "In a header" },
                { value: "query", label: "In the address (query)" },
              ]}
              onChange={(next) => setAuthMode(next as "none")}
              searchable={false}
              value={authMode}
            />
            {authMode === "header" || authMode === "query" ? (
              <input className={`${fieldClass} mt-2 font-mono`} onChange={(event) => setAuthParam(event.target.value)} placeholder={authMode === "header" ? "Header name, e.g. X-API-Key" : "Parameter name, e.g. apikey"} value={authParam} />
            ) : null}
            {authMode !== "none" ? (
              <div className="mt-2">
                <ChoiceList
                  ariaLabel="Key"
                  choices={(keys ?? []).map((key) => ({ value: key.name, label: key.name, hint: key.last4 ? `••••${key.last4}` : undefined }))}
                  mono
                  onChange={setSourceKey}
                  placeholder="Choose a key from your Keys…"
                  searchable={false}
                  value={sourceKey}
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {type === "quietHours" ? (
        <div className="mt-3 space-y-3">
          <label className="block">
            <Label>Events (UTC), one per line</Label>
            <textarea
              className={`${fieldClass} resize-none font-mono text-[0.74rem]`}
              onChange={(event) => setEventsText(event.target.value)}
              placeholder={"FOMC decision | 2026-10-28 18:00\nUS CPI | 2026-11-12 12:30"}
              rows={4}
              spellCheck={false}
              value={eventsText}
            />
          </label>
          <label className="flex items-center gap-2 text-[0.76rem] text-ink-soft">
            Stand aside
            <input className="w-14 rounded-lg border border-line bg-paper-strong px-2 py-1 font-mono text-[0.8rem] text-ink" inputMode="decimal" onChange={(event) => setMarginHours(event.target.value.replace(/[^0-9.]/g, ""))} value={marginHours} />
            hours either side
          </label>
        </div>
      ) : null}

      {type === "indicators" || type === "signal" ? (
        <div className="mt-3 space-y-3">
          {type === "signal" ? (
            <div>
              <Label>Fires when</Label>
              <ChoiceList ariaLabel="Fires when" choices={SIGNAL_OPTIONS} onChange={(next) => setCondition(next as SignalCondition)} searchable={false} value={condition} />
              {condition === "rsiBelow" || condition === "rsiAbove" ? (
                <label className="mt-2 flex items-center gap-2 text-[0.74rem] text-ink-soft">
                  Level
                  <input
                    className="w-16 rounded-lg border border-line bg-paper-strong px-2 py-1 font-mono text-[0.8rem] text-ink"
                    inputMode="decimal"
                    onChange={(event) => setLevel(event.target.value.replace(/[^0-9.]/g, ""))}
                    placeholder={condition === "rsiBelow" ? "30" : "70"}
                    value={level}
                  />
                </label>
              ) : null}
            </div>
          ) : null}
          <div>
            <Label>Candles</Label>
            <ChoiceList
              ariaLabel="Candles"
              choices={[
                { value: "1h", label: "1-hour" },
                { value: "4h", label: "4-hour" },
                { value: "1d", label: "Daily" },
              ]}
              onChange={(next) => setTimeframe(next as "1h" | "4h" | "1d")}
              searchable={false}
              value={timeframe}
            />
          </div>
          <p className="text-[0.7rem] leading-snug text-muted">Closed candles only: the candle still forming never counts.</p>
        </div>
      ) : null}

      {type === "binance" ? (
        <div className="mt-3 space-y-3">
          <div>
            <Label>Trade through</Label>
            <ChoiceList
              ariaLabel="Trade through"
              choices={[
                { value: "exchange", label: "Binance Exchange (order book)" },
                { value: "wallet", label: "Binance Wallet (Agentic Wallet, on-chain)" },
              ]}
              onChange={(next) => setBinanceAccount(next as "wallet" | "exchange")}
              searchable={false}
              value={binanceAccount}
            />
          </div>
          {binanceAccount === "exchange" ? (
            <label className="flex items-center gap-2 text-[0.78rem] text-ink-soft">
              <input checked={binanceFutures} className="size-3.5 accent-[var(--ink)]" onChange={(event) => setBinanceFutures(event.target.checked)} type="checkbox" />
              Futures too - lets rules short, with leverage
            </label>
          ) : (
            <p className="text-[0.7rem] leading-snug text-muted">The Binance Wallet buys and sells on-chain (spot). It cannot short.</p>
          )}
          {binanceAccount === "exchange" && binanceFutures ? (
            <div>
              <Label>Most leverage a rule may use</Label>
              <ChoiceList
                ariaLabel="Most leverage"
                choices={[1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: `${value}x${value === 1 ? " (default)" : value > 3 ? " - high risk" : ""}` }))}
                onChange={(next) => setBinanceLeverage(Number(next))}
                searchable={false}
                value={String(binanceLeverage)}
              />
              {binanceLeverage > 3 ? (
                <p className="mt-1.5 rounded-md border border-[#d9901a]/40 bg-[#d9901a]/10 px-2 py-1 text-[0.7rem] leading-snug text-ink-soft">
                  {binanceLeverage}x is above the usual 1-3x. A move of about {Math.round(100 / binanceLeverage)}% against a position would liquidate it, and everything in it would be lost.
                </p>
              ) : null}
            </div>
          ) : null}
          <p className="text-[0.7rem] leading-snug text-muted">No key goes in here. When you run the agent on your own server, its key or wallet session stays there.</p>
        </div>
      ) : null}

      {type === "memory" ? (
        <div className="mt-3">
          <Label>Memory server</Label>
          <input
            aria-label="Memory server address"
            className={`${fieldClass} font-mono`}
            data-1p-ignore
            data-lpignore="true"
            name="dolphin-memory-url"
            onChange={(event) => {
              setMemoryUrl(event.target.value);
              setMemoryCheck(null);
            }}
            placeholder="https://memory.example.com"
            spellCheck={false}
            value={memoryUrl}
          />
          <div className="mt-3">
            <Label>Its key</Label>
            <ChoiceList
              ariaLabel="Memory key"
              choices={[{ value: "", label: "No key" }, ...(keys ?? []).map((key) => ({ value: key.name, label: key.name, hint: key.last4 ? `••••${key.last4}` : undefined }))]}
              mono
              onChange={(next) => {
                setMemoryKey(next);
                setMemoryCheck(null);
              }}
              searchable={false}
              value={memoryKey}
            />
            <p className="mt-1 text-[0.68rem] leading-snug text-muted">Sent to your server as a bearer token. Add it in the Keys tab.</p>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              className="shrink-0 rounded-lg border border-line px-3 py-1.5 !text-[12px] font-semibold text-ink hover:bg-paper-muted disabled:opacity-40"
              disabled={!memoryUrl.trim().startsWith("https://") || memoryCheck === "checking"}
              onClick={() => {
                void (async () => {
                  const sessionToken = session.sessionToken ?? (await session.signIn());
                  if (!sessionToken) return;
                  setMemoryCheck("checking");
                  try {
                    setMemoryCheck(await testMemory({ sessionToken, url: memoryUrl.trim(), keyName: memoryKey || null }));
                  } catch (cause) {
                    setMemoryCheck({ ok: false, text: errorText(cause, "Could not test it.") });
                  }
                })();
              }}
              type="button"
            >
              {memoryCheck === "checking" ? "Testing…" : "Test connection"}
            </button>
            {memoryCheck && memoryCheck !== "checking" ? (
              <p className={`min-w-0 text-[0.72rem] leading-snug ${memoryCheck.ok ? "text-success" : "text-danger"}`}>{memoryCheck.text}</p>
            ) : null}
          </div>
          <div className="mt-3 rounded-lg bg-paper-muted/70 px-3 py-2.5">
            <p className="text-[0.72rem] font-semibold text-ink">No memory server yet?</p>
            <p className="mt-1 text-[0.7rem] leading-relaxed text-muted">
              Run Dolphin&apos;s one-file server on any machine you control (Node 18+, nothing to install), put it behind https, and paste its address above.
            </p>
            <a
              className="mt-2 inline-flex !text-[0.72rem] font-semibold text-ink underline-offset-2 hover:underline"
              download
              href="/memory/dolphin-memory-server.mjs"
            >
              Download the server
            </a>
          </div>
        </div>
      ) : null}

      {type === "risk" ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="block">
            <Label>Max per trade ($)</Label>
            <input className={`${fieldClass} mt-1 font-mono`} inputMode="decimal" onChange={(event) => setMaxTradeUsd(event.target.value.replace(/[^0-9.]/g, ""))} value={maxTradeUsd} />
          </label>
          <label className="block">
            <Label>Trades a day</Label>
            <input className={`${fieldClass} mt-1 font-mono`} inputMode="numeric" onChange={(event) => setMaxTradesPerDay(event.target.value.replace(/[^0-9]/g, ""))} value={maxTradesPerDay} />
          </label>
        </div>
      ) : null}

      {(
        <SaveButton
          disabled={!built}
          onClick={() => {
            if (!built) return;
            const next = existing ? blocks.map((block) => (block.id === existing.id ? built : block)) : [...blocks, built];
            void commit(next);
          }}
          saving={saving}
        />
      )}
      {existing ? (
        <button
          className="mt-2 flex h-8 w-full items-center justify-center rounded-lg border border-line !text-[12.5px] font-semibold text-ink transition-colors hover:bg-paper-muted disabled:opacity-40"
          disabled={saving}
          onClick={() => void commit(blocks.filter((block) => block.id !== existing.id))}
          type="button"
        >
          Remove from agent
        </button>
      ) : null}
    </Shell>
  );
}
