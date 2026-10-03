"use client";

import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useState } from "react";

import { RuleView } from "@/components/rule-view";
import { strategyApi, type TradingRuleTrade, type TradingRuleView } from "@/convex/api";

/**
 * TRADING RULES, IN THE DRAFT PANEL (owner, 2026-10-03; Agent/PLAN-2026-10-03-fast-rules-binance-export.md, phase 2).
 *
 * The AI writes the rules in the build chat; this shows each one in words,
 * lets the builder change its size, leverage and stop-loss, and shows what it
 * did. Inside Dolphin the rules trade on PAPER at live Binance prices while
 * Autopilot is on. Shown only once the agent has a rule.
 */

const VENUE_WORDS: Record<TradingRuleView["venue"], string> = {
  "dolphin-wallet": "Dolphin Wallet",
  "binance-wallet": "Binance Wallet",
  "binance-spot": "Binance spot",
  "binance-futures": "Binance futures",
};

function reason(cause: unknown, fallback: string): string {
  if (cause instanceof ConvexError && typeof cause.data === "string") return cause.data;
  return fallback;
}

function price(value: number): string {
  return value >= 1 ? value.toLocaleString("en", { maximumFractionDigits: 2 }) : value.toPrecision(4);
}

export function TradingRulesSection({ conversationKey }: { conversationKey: string }) {
  const view = useQuery(strategyApi.strategy.forConversation, { conversationKey });
  const exportForRunner = useMutation(strategyApi.strategy.exportForRunner);
  const [exported, setExported] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  if (!view || view.rules.length === 0) return null;

  /** Downloads agent.json - the rules and a fresh report token - for the builder's own server (phase 4). */
  const download = async () => {
    setExportError(null);
    try {
      const file = await exportForRunner({ conversationKey });
      const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "agent.json";
      link.click();
      URL.revokeObjectURL(url);
      setExported(true);
    } catch (cause) {
      setExportError(reason(cause, "The file could not be made. Try again."));
    }
  };
  return (
    <div className="py-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-muted">Trading rules</p>
        <p className={`text-[0.64rem] ${view.running ? "text-success" : "text-faint"}`}>{view.running ? "Watching · paper" : "Off until Autopilot is on"}</p>
      </div>
      <p className="mt-0.5 text-[0.68rem] leading-relaxed text-faint">They act on every closed candle, with no AI in the way.</p>
      <ul className="mt-2 space-y-1.5">
        {view.rules.map((rule) => (
          <RuleRow conversationKey={conversationKey} key={rule.id} rule={rule} trades={view.trades.filter((trade) => trade.ruleId === rule.id)} />
        ))}
      </ul>
      <Timeline rules={view.rules} running={view.running} trades={view.trades} />

      {/* A link, not a full-width button: most people never run it themselves (owner, 2026-10-03: give the panel room). */}
      <button className="mt-2 !text-[0.7rem] font-semibold text-muted hover:text-ink hover:underline" onClick={() => void download()} type="button">
        Run it on your own server instead
      </button>
      {exportError ? (
        <p className="mt-1.5 text-[0.68rem] text-danger" role="alert">
          {exportError}
        </p>
      ) : null}
      {exported ? <RunnerSteps /> : null}
    </div>
  );
}

/** What to do with agent.json - on any server with Node 20+ that can reach Binance. */
function RunnerSteps() {
  const runner = `${typeof window === "undefined" ? "https://dolphinamp.xyz" : window.location.origin}/runner/dolphin-runner.mjs`;
  const lines = [
    "# 1. On your server (Node 20+), in a new folder, put the agent.json you just downloaded",
    `curl -LO ${runner}`,
    "",
    "# 2. Watch it trade on paper first - no orders, no keys",
    "node dolphin-runner.mjs",
    "",
    "# 3a. Real orders on the Binance Exchange: an API key with trading on and WITHDRAWALS OFF,",
    "#     restricted to this server's IP",
    "export BINANCE_API_KEY=...  BINANCE_API_SECRET=...",
    "node dolphin-runner.mjs --live",
    "",
    "# 3b. Real orders from your Binance Wallet (Agentic Wallet): sign in once, approve in the Binance app",
    "npm i -g @binance/agentic-wallet && baw auth signin",
    "node dolphin-runner.mjs --live",
  ].join("\n");
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 rounded-lg border border-line/80 bg-paper px-3 py-2">
      <p className="text-[0.7rem] font-semibold text-ink">agent.json downloaded</p>
      <p className="mt-0.5 text-[0.66rem] leading-relaxed text-muted">
        Your keys and wallet session stay on your server; Dolphin never sees them. Each trade is reported back here. Downloading again gives a new file and the old one stops reporting.
      </p>
      <pre className="mt-1.5 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-paper-muted px-2 py-1.5 font-mono text-[0.62rem] leading-relaxed text-ink-soft">{lines}</pre>
      <button
        className="mt-1.5 !text-[0.68rem] font-semibold text-accent-ink hover:underline"
        onClick={() =>
          void navigator.clipboard?.writeText(lines).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
        type="button"
      >
        {copied ? "Copied" : "Copy the steps"}
      </button>
      <p className="mt-1 text-[0.62rem] leading-relaxed text-faint">Keep it running with pm2 or Docker. Futures stops are also placed on Binance, so they hold if your server goes down.</p>
    </div>
  );
}

function RuleRow({ conversationKey, rule, trades }: { conversationKey: string; rule: TradingRuleView; trades: TradingRuleTrade[] }) {
  const update = useMutation(strategyApi.strategy.updateRule);
  const remove = useMutation(strategyApi.strategy.removeRule);
  const setPaused = useMutation(strategyApi.strategy.setRulePaused);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);
  const futures = rule.venue === "binance-futures";

  const save = async (change: { sizeUsd?: number; leverage?: number; stopLossPct?: number | null }) => {
    setError(null);
    try {
      await update({ conversationKey, ruleId: rule.id, ...change });
    } catch (cause) {
      setError(reason(cause, "That change did not save."));
    }
  };

  return (
    <li className="rounded-lg bg-paper-muted/70 px-3 py-2">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[0.76rem] leading-relaxed text-ink">{rule.words}</p>
        <button
          aria-label="Remove this rule"
          className="grid size-6 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-paper hover:text-ink"
          onClick={() => void remove({ conversationKey, ruleId: rule.id }).catch((cause) => setError(reason(cause, "That rule could not be removed.")))}
          type="button"
        >
          <span aria-hidden className="text-base leading-none">×</span>
        </button>
      </div>
      <p className="mt-1 text-[0.66rem] text-muted">
        {VENUE_WORDS[rule.venue]}
        {rule.position
          ? ` · holding a ${rule.position.side} from ${price(rule.position.entryPrice)}`
          : rule.paused
            ? ""
            : rule.lastCheckedAt
              ? " · watching"
              : " · not started"}
        {rule.paused ? <span className="font-semibold text-ink-soft"> · paused</span> : null}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <NumberBox label="Size" onSave={(value) => value !== null && void save({ sizeUsd: value })} prefix="$" value={rule.sizeUsd} />
        {futures ? <NumberBox label="Leverage" onSave={(value) => value !== null && void save({ leverage: value })} suffix="x" value={rule.leverage} /> : null}
        <NumberBox allowEmpty label="Stop" onSave={(value) => void save({ stopLossPct: value })} suffix="%" value={rule.stopLossPct} />
        <span className="ml-auto flex items-center gap-1">
          <button
            className="rounded-md px-1.5 py-0.5 !text-[0.68rem] font-semibold text-muted transition-colors hover:bg-paper hover:text-ink"
            onClick={() => void setPaused({ conversationKey, ruleId: rule.id, paused: !rule.paused }).catch((cause) => setError(reason(cause, "That did not save.")))}
            type="button"
          >
            {rule.paused ? "Resume" : "Pause"}
          </button>
          <button className="rounded-md border border-line/80 bg-paper px-2 py-0.5 !text-[0.68rem] font-semibold text-ink transition-colors hover:border-ink" onClick={() => setViewing(true)} type="button">
            View
          </button>
        </span>
      </div>
      {rule.warnings.map((warning) => (
        <p className="mt-1.5 rounded-md border border-[#d9901a]/40 bg-[#d9901a]/10 px-2 py-1 text-[0.66rem] leading-relaxed text-ink-soft" key={warning}>
          {warning}
        </p>
      ))}
      {rule.lastError ? <p className="mt-1 text-[0.66rem] text-danger">{rule.lastError}</p> : null}
      {error ? (
        <p className="mt-1 text-[0.66rem] text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {viewing ? <RuleView conversationKey={conversationKey} onClose={() => setViewing(false)} rule={rule} trades={trades} /> : null}
    </li>
  );
}

function NumberBox({
  label,
  value,
  onSave,
  prefix,
  suffix,
  allowEmpty = false,
}: {
  label: string;
  value: number | null;
  onSave: (value: number | null) => void;
  prefix?: string;
  suffix?: string;
  allowEmpty?: boolean;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const commit = () => {
    const trimmed = text.trim();
    if (trimmed === (value === null ? "" : String(value))) return;
    if (trimmed === "" && allowEmpty) return onSave(null);
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setText(value === null ? "" : String(value));
      return;
    }
    onSave(parsed);
  };
  return (
    <label className="flex items-center gap-1 rounded-md border border-line/80 bg-paper px-1.5 py-0.5 text-[0.68rem] text-muted">
      {label}
      {prefix ? <span>{prefix}</span> : null}
      <input
        className="w-10 bg-transparent text-right !text-[0.72rem] tabular-nums text-ink outline-none placeholder:text-faint"
        inputMode="decimal"
        onBlur={commit}
        onChange={(event) => setText(event.target.value.replace(/[^0-9.]/g, ""))}
        onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
        placeholder={allowEmpty ? "none" : ""}
        value={text}
      />
      {suffix ? <span>{suffix}</span> : null}
    </label>
  );
}

/**
 * WHY? (owner, 2026-10-03; UI review point 11). The reason the engine recorded at the time,
 * with the values it saw ("RSI was 28.4, below 30"), and the limits the trade ran under.
 * Trades recorded before 2026-10-03 carry the older reason without values; shown as stored.
 */
function TradeWhy({ trade, rule }: { trade: TradingRuleTrade; rule: TradingRuleView | undefined }) {
  const limits = [
    `$${trade.sizeUsd} a trade`,
    ...(trade.leverage > 1 ? [`${trade.leverage}x`] : []),
    ...(rule && rule.stopLossPct !== null ? [`stop-loss ${rule.stopLossPct}%`] : []),
    trade.source === "runner"
      ? "on your server"
      : trade.network === "live"
        ? `real order on Binance${trade.orderId ? ` #${trade.orderId}` : ""}`
        : trade.network === "testnet"
          ? `Binance testnet order${trade.orderId ? ` #${trade.orderId}` : ""}`
          : trade.network === "bsc"
            ? "real swap from the Dolphin Wallet"
            : "on paper, at Binance's price",
  ];
  return (
    <div className="trade-why">
      <p className="text-ink-soft">{trade.reason}</p>
      <p className="mt-0.5 text-muted">{limits.join(" · ")}</p>
    </div>
  );
}

/** "08:42:11", with the day when it was not today. */
function clock(at: number): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return date.toDateString() === new Date().toDateString() ? time : `${date.toLocaleDateString("en", { month: "short", day: "numeric" })} ${time}`;
}

/**
 * THE EXECUTION TIMELINE (owner, 2026-10-03; UI review point 9): what the agent did, in
 * order, newest first - each rule's latest check with the values it saw, and every trade
 * with its Why?. The check is the one stored on the rule's state row, not a log, so only the
 * latest one per rule appears; trades are every trade.
 */
function Timeline({ trades, rules, running }: { trades: TradingRuleTrade[]; rules: TradingRuleView[]; running: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const checks = running
    ? rules.flatMap((rule) =>
        // A check that traded is already its trade's row (and its Why?).
        rule.lastCheckedAt !== null &&
        (rule.lastReason || rule.lastError) &&
        !trades.some((trade) => trade.ruleId === rule.id && Math.abs(trade.at - (rule.lastCheckedAt ?? 0)) < 5_000)
          ? [{ key: `check:${rule.id}`, at: rule.lastCheckedAt, rule, text: rule.lastError ?? rule.lastReason ?? "" }]
          : [],
      )
    : [];
  const rows = [
    ...checks.map((check) => ({ kind: "check" as const, ...check })),
    ...trades.slice(0, 10).map((trade) => ({ kind: "trade" as const, key: trade._id, at: trade.at, trade })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 10);
  if (rows.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-[0.64rem] font-semibold uppercase tracking-[0.08em] text-muted">Timeline</p>
      <ol className="exec-timeline mt-1.5">
        {rows.map((row) =>
          row.kind === "check" ? (
            <li className="exec-timeline__row" data-kind="check" key={row.key}>
              <span className="exec-timeline__time">{clock(row.at)}</span>
              <div className="min-w-0">
                <p className="text-ink-soft">
                  Checked the {row.rule.market} {row.rule.timeframe} candle
                  {row.rule.lastLagMs !== null ? <span className="text-muted"> · {(row.rule.lastLagMs / 1000).toFixed(1)} s after it closed</span> : null}
                </p>
                <p className="text-muted">{row.text}</p>
              </div>
            </li>
          ) : (
            <li className="exec-timeline__row" data-kind={row.trade.kind} key={row.key}>
              <span className="exec-timeline__time">{clock(row.at)}</span>
              <div className="min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="min-w-0 truncate text-ink-soft">
                    {row.trade.kind === "enter" ? (row.trade.side === "short" ? "Shorted" : "Bought") : "Closed"} {row.trade.market} at ${price(row.trade.price)}
                    {row.trade.leverage > 1 ? ` · ${row.trade.leverage}x` : ""}
                    {/* Where it happened: Dolphin's paper run, or the builder's server - reported, so never shown as verified. */}
                    <span className="ml-1 text-muted">
                      ·{" "}
                      {row.trade.source === "runner"
                        ? `your server${row.trade.paper ? ", paper" : ", live - reported"}`
                        : row.trade.network === "live"
                          ? "Binance, real"
                          : row.trade.network === "testnet"
                            ? "Binance testnet"
                            : row.trade.network === "bsc"
                              ? "Dolphin Wallet, real"
                              : "paper"}
                    </span>
                  </p>
                  <span
                    className={`shrink-0 tabular-nums ${
                      row.trade.pnlPct === null ? "text-muted" : row.trade.pnlPct > 0 ? "text-success" : row.trade.pnlPct < 0 ? "text-danger" : "text-muted"
                    }`}
                  >
                    {row.trade.pnlPct === null ? `$${row.trade.sizeUsd}` : `${row.trade.pnlPct > 0 ? "+" : ""}${row.trade.pnlPct}%`}
                  </span>
                  <button
                    aria-expanded={open === row.key}
                    className="shrink-0 !text-[0.66rem] font-semibold text-accent-ink hover:underline"
                    onClick={() => setOpen((current) => (current === row.key ? null : row.key))}
                    type="button"
                  >
                    Why?
                  </button>
                </div>
                {open === row.key ? <TradeWhy rule={rules.find((rule) => rule.id === row.trade.ruleId)} trade={row.trade} /> : null}
              </div>
            </li>
          ),
        )}
      </ol>
    </div>
  );
}
