"use client";

import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useState } from "react";

import type { AgentDraft } from "@/components/agent-draft-panel";
import { strategyApi } from "@/convex/api";

/**
 * PERMISSIONS: WHAT THIS AGENT MAY DO, IN ONE PLACE (owner, 2026-10-03; UI review point 5).
 *
 * Every line is a limit Dolphin actually enforces, read from where it lives - the
 * Risk block, the Binance block, the trading rules, the trade key - never a figure
 * made up to fill a row (AGENTS.md §5). The daily loss limit is set here and holds
 * across all trading rules, inside Dolphin and on the builder's own server; AI-proposed
 * swaps record no profit or loss, so it cannot cover them, and the row says so.
 * Shown only for an agent that trades.
 */
export function PermissionsSection({ conversationKey, draft }: { conversationKey: string; draft: AgentDraft }) {
  const view = useQuery(strategyApi.strategy.forConversation, { conversationKey });
  const setLimit = useMutation(strategyApi.strategy.setDailyLossLimit);
  const [limitText, setLimitText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const blocks = draft.blocks ?? [];
  const risk = blocks.find((block) => block.type === "risk");
  const binance = blocks.find((block) => block.type === "binance");
  const market = blocks.find((block) => block.type === "market");
  const swap = blocks.some((block) => block.type === "swap");
  const rules = view?.rules ?? [];
  if (!view || (rules.length === 0 && !swap)) return null;

  const sizes = [...rules.map((rule) => rule.sizeUsd), ...(swap && risk && risk.type === "risk" ? [risk.config.maxTradeUsd] : [])];
  const markets = [...new Set([...rules.map((rule) => rule.market), ...(swap && market && market.type === "market" ? [market.config.symbol] : [])])];
  const leverage = binance && binance.type === "binance" && binance.config.futures ? binance.config.maxLeverage : 1;
  const limit = view.dailyLossLimitUsd;
  const shown = limitText ?? (limit === null ? "" : String(limit));
  const money = (usd: number) => `$${usd.toLocaleString("en", { minimumFractionDigits: usd % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

  const save = async () => {
    setError(null);
    const text = shown.trim();
    const usd = text === "" ? null : Number(text);
    if (usd !== null && !(usd >= 1)) {
      setError("A daily loss limit is $1 or more - or empty for none.");
      setLimitText(null);
      return;
    }
    if (usd === limit) return setLimitText(null);
    try {
      await setLimit({ conversationKey, usd });
      setLimitText(null);
    } catch (cause) {
      setError(cause instanceof ConvexError && typeof cause.data === "string" ? cause.data : "That did not save.");
    }
  };

  const rows: { label: string; value: string }[] = [
    ...(rules.length
      ? [
          {
            label: "Trading rules",
            value:
              draft.paperMode === false
                ? `Live · ${binance && binance.type === "binance" && binance.config.network === "live" ? "Binance (real)" : "Binance testnet"} / Dolphin Wallet`
                : "Paper · switch Trading mode to Live for real orders",
          },
        ]
      : []),
    ...(swap ? [{ label: "Dolphin Wallet swaps", value: draft.paperMode === false ? "Live, with your trade key" : "On paper" }] : []),
    ...(sizes.length ? [{ label: "Most per trade", value: `$${Math.max(...sizes).toLocaleString("en")}` }] : []),
    { label: "Most leverage", value: `${leverage}x` },
    ...(markets.length ? [{ label: "Markets", value: markets.join(", ") }] : []),
  ];

  return (
    <div className="py-3">
      <p className="text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-muted">Permissions</p>
      <dl className="mt-1.5 divide-y divide-line/60">
        {rows.map((row) => (
          <div className="flex items-baseline justify-between gap-3 py-1.5" key={row.label}>
            <dt className="shrink-0 text-[0.74rem] text-muted">{row.label}</dt>
            <dd className="min-w-0 text-right text-[0.76rem] font-medium text-ink">{row.value}</dd>
          </div>
        ))}
        {rules.length ? (
          <div className="py-1.5">
            <div className="flex items-center justify-between gap-3">
              <dt className="shrink-0 text-[0.74rem] text-muted">Daily loss limit</dt>
              <dd>
                <label className="flex items-center gap-1 rounded-md border border-line/80 bg-paper px-1.5 py-0.5 text-[0.7rem] text-muted">
                  $
                  <input
                    aria-label="Daily loss limit in dollars"
                    className="w-14 bg-transparent text-right !text-[0.76rem] font-medium tabular-nums text-ink outline-none placeholder:text-faint"
                    inputMode="decimal"
                    onBlur={() => void save()}
                    onChange={(event) => setLimitText(event.target.value.replace(/[^0-9.]/g, ""))}
                    onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
                    placeholder="none"
                    value={shown}
                  />
                </label>
              </dd>
            </div>
            <p className="mt-1 text-[0.64rem] leading-snug text-faint">
              {limit !== null
                ? view.lossTodayUsd >= limit
                  ? `Reached: ${money(view.lossTodayUsd)} lost today. No new trades until midnight UTC; open positions can still close.`
                  : `${money(view.lossTodayUsd)} lost today. Once losses reach ${money(limit)}, its rules stop opening trades until midnight UTC.`
                : "Set one to stop its rules opening trades for the rest of the day after a bad run."}
            </p>
            {error ? (
              <p className="mt-1 text-[0.66rem] text-danger" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        ) : null}
      </dl>
    </div>
  );
}
