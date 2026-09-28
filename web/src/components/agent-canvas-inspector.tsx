"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";

import type { AgentDraft } from "@/components/agent-draft-panel";
import { agentBuilderApi, envVarsApi, type AgentBlockData } from "@/convex/api";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { toast } from "@/store/use-toast-store";
import { toUserMessage } from "@/wallet/wallet-errors";
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
  "mt-1 w-full rounded-lg border border-line bg-paper-strong px-2.5 py-1.5 text-[0.84rem] text-ink outline-none focus:border-line-strong";

const PROVIDERS = [
  { id: "openai", label: "OpenAI", example: "gpt-4o-mini" },
  { id: "openrouter", label: "OpenRouter", example: "openai/gpt-4o-mini" },
] as const;

function BrainEditor({ conversationKey, draft, onClose }: { conversationKey: string; draft: AgentDraft; onClose: () => void }) {
  const [name, setName] = useState(draft.name ?? "");
  const [description, setDescription] = useState(draft.description ?? "");
  const [provider, setProvider] = useState<"openai" | "openrouter">(draft.brain?.provider ?? "openai");
  const [model, setModel] = useState(draft.brain?.model ?? "");
  const [keyName, setKeyName] = useState(draft.brain?.keyName ?? "");
  const session = useWalletSession();
  // The builder's own keys, by name only (convex/envVars.ts never returns a value).
  const keys = useQuery(
    envVarsApi.envVars.list,
    session.sessionToken ? { sessionToken: session.sessionToken } : "skip",
  );
  const { save, saving } = useSaveDraft(conversationKey);

  const textChanged = name !== (draft.name ?? "") || description !== (draft.description ?? "");
  const brainChanged =
    provider !== (draft.brain?.provider ?? "openai") ||
    model.trim() !== (draft.brain?.model ?? "") ||
    keyName !== (draft.brain?.keyName ?? "");
  const brainComplete = model.trim().length >= 2 && keyName.length > 0;
  const example = PROVIDERS.find((option) => option.id === provider)!.example;

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
        <div className="mt-1.5 grid grid-cols-2 rounded-full bg-paper-muted/70 p-[3px]" role="radiogroup">
          {PROVIDERS.map((option) => (
            <button
              aria-checked={provider === option.id}
              className={`rounded-full py-1 !text-[12px] font-medium transition-colors ${
                provider === option.id ? "bg-paper-strong text-ink shadow-sm" : "text-muted hover:text-ink"
              }`}
              key={option.id}
              onClick={() => setProvider(option.id)}
              role="radio"
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
        <input
          aria-label="Model"
          className={`${fieldClass} mt-2 font-mono`}
          onChange={(e) => setModel(e.target.value)}
          placeholder={example}
          spellCheck={false}
          value={model}
        />
        {!session.sessionToken ? (
          <p className="mt-2 text-[0.72rem] leading-relaxed text-muted">
            Sign in from the Keys tab to choose which of your keys it runs on.
          </p>
        ) : keys && keys.length === 0 ? (
          <p className="mt-2 text-[0.72rem] leading-relaxed text-muted">
            You have no keys yet. Add your {provider === "openai" ? "OpenAI" : "OpenRouter"} key in the Keys tab.
          </p>
        ) : (
          <select
            aria-label="Key"
            className={`${fieldClass} mt-2 font-mono`}
            onChange={(e) => setKeyName(e.target.value)}
            value={keyName}
          >
            <option value="">Choose a key…</option>
            {(keys ?? []).map((key) => (
              <option key={key.name} value={key.name}>
                {key.name}
                {key.last4 ? ` (••••${key.last4})` : ""}
              </option>
            ))}
          </select>
        )}
      </div>

      <SaveButton
        disabled={!textChanged && !(brainChanged && brainComplete)}
        onClick={() =>
          void save({
            ...(textChanged ? { name, description } : {}),
            ...(brainChanged && brainComplete && session.sessionToken
              ? { brain: { provider, model: model.trim(), keyName }, sessionToken: session.sessionToken }
              : {}),
          })
        }
        saving={saving}
      />
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
    return <InfoPanel body="Your agent runs when someone sends it a message, and answers in the conversation." onClose={onClose} title="Trigger" />;
  }
  if (selectedId === "output") {
    return <InfoPanel body="It replies with what its tools returned. It quotes no number a tool did not give it." onClose={onClose} title="Output" />;
  }
  return null;
}

/* ── Toolbox blocks (2026-09-28) ─────────────────────────────────────────── */

type BlockType = AgentBlockData["type"];

const BLOCK_TITLES: Record<BlockType, string> = {
  market: "Market",
  safety: "Safety check",
  swap: "Swap",
  risk: "Risk limits",
  schedule: "Schedule",
  price: "Price trigger",
  walletWatch: "Wallet watch",
};

const BLOCK_ABOUT: Record<BlockType, string> = {
  market: "The token this agent trades. Its live chart appears on the canvas, and the Brain can read its price, liquidity, volume and recent candles.",
  safety: "Lets the Brain check a token's contract before acting: honeypot, taxes, owner powers and holder concentration.",
  swap: "Lets the Brain propose a PancakeSwap trade within your Risk limits. Every trade comes to you as a ticket: you approve and sign it from your Dolphin Wallet. The agent never signs.",
  risk: "Hard limits on what the agent may propose, checked in code on every trade, whatever the Brain decides.",
  schedule: "Runs the agent on a clock while Autopilot is on. Every run uses your own model key.",
  price: "Runs the agent when the Market token's price crosses your level - once per crossing, not on every check.",
  walletWatch: "Runs the agent when a watched wallet transacts - a KOL, a whale, a fund. It sees any transaction they send, and exactly which tokens moved for your Market token and Dolphin's verified list.",
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
        <label className="mt-3 block">
          <Label>Run every</Label>
          <select className={`${fieldClass} mt-1`} onChange={(event) => setEveryMinutes(Number(event.target.value))} value={everyMinutes}>
            {SCHEDULES.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes >= 60 ? `${minutes / 60} hour${minutes === 60 ? "" : "s"}` : `${minutes} minutes`}
              </option>
            ))}
          </select>
        </label>
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

      <SaveButton
        disabled={!built}
        onClick={() => {
          if (!built) return;
          void commit(existing ? blocks.map((block) => (block.id === existing.id ? built : block)) : [...blocks, built]);
        }}
        saving={saving}
      />
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
