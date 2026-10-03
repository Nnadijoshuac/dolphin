"use client";

import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useState } from "react";

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
  if (!view || view.rules.length === 0) return null;
  return (
    <div className="py-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-muted">Trading rules</p>
        <p className={`text-[0.64rem] ${view.running ? "text-success" : "text-faint"}`}>{view.running ? "Watching · paper" : "Off until Autopilot is on"}</p>
      </div>
      <p className="mt-0.5 text-[0.68rem] leading-relaxed text-faint">
        They act on every closed candle with no AI in the way. Here they trade on paper at live Binance prices; real money comes when you run the agent on your own server.
      </p>
      <ul className="mt-2 space-y-1.5">
        {view.rules.map((rule) => (
          <RuleRow conversationKey={conversationKey} key={rule.id} rule={rule} />
        ))}
      </ul>
      {view.trades.length > 0 ? <Trades trades={view.trades} /> : null}
    </div>
  );
}

function RuleRow({ conversationKey, rule }: { conversationKey: string; rule: TradingRuleView }) {
  const update = useMutation(strategyApi.strategy.updateRule);
  const remove = useMutation(strategyApi.strategy.removeRule);
  const [error, setError] = useState<string | null>(null);
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
          : rule.lastCheckedAt
            ? " · watching"
            : " · not started"}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <NumberBox label="Size" onSave={(value) => value !== null && void save({ sizeUsd: value })} prefix="$" value={rule.sizeUsd} />
        {futures ? <NumberBox label="Leverage" onSave={(value) => value !== null && void save({ leverage: value })} suffix="x" value={rule.leverage} /> : null}
        <NumberBox allowEmpty label="Stop" onSave={(value) => void save({ stopLossPct: value })} suffix="%" value={rule.stopLossPct} />
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

function Trades({ trades }: { trades: TradingRuleTrade[] }) {
  return (
    <div className="mt-3">
      <p className="text-[0.64rem] font-semibold uppercase tracking-[0.08em] text-muted">Recent paper trades</p>
      <ul className="mt-1 divide-y divide-line/60">
        {trades.slice(0, 8).map((trade) => (
          <li className="flex items-baseline justify-between gap-2 py-1 text-[0.68rem]" key={trade._id}>
            <span className="min-w-0 truncate text-ink-soft" title={trade.reason}>
              {trade.kind === "enter" ? (trade.side === "short" ? "Shorted" : "Bought") : "Closed"} {trade.market} at {price(trade.price)}
              {trade.leverage > 1 ? ` · ${trade.leverage}x` : ""}
            </span>
            <span
              className={`shrink-0 tabular-nums ${
                trade.pnlPct === null ? "text-muted" : trade.pnlPct > 0 ? "text-success" : trade.pnlPct < 0 ? "text-danger" : "text-muted"
              }`}
            >
              {trade.pnlPct === null ? `$${trade.sizeUsd}` : `${trade.pnlPct > 0 ? "+" : ""}${trade.pnlPct}%`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
