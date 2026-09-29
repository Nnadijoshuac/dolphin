"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";

import { paperTradingApi } from "@/convex/api";
import { toast } from "@/store/use-toast-store";

/**
 * PAPER TRADING (convex/paperTrading.ts): pretend money, real prices. On by
 * default, so an agent practises before it touches funds - the mentor
 * review's "paper mode before indicators". Switching to Live brings back
 * tickets and "Trade without asking". Shown only when the agent can trade.
 */

function amount(value: string): string {
  const n = Number(value);
  return n >= 1 ? n.toLocaleString("en", { maximumFractionDigits: 4 }) : n.toPrecision(4);
}

export function PaperTradingCard({ conversationKey, hasSwap }: { conversationKey: string; hasSwap: boolean }) {
  const state = useQuery(paperTradingApi.paperTrading.forDraft, hasSwap ? { conversationKey } : "skip");
  const setMode = useMutation(paperTradingApi.paperTrading.setMode);
  const reset = useMutation(paperTradingApi.paperTrading.reset);
  const valuation = useAction(paperTradingApi.paperTrading.valuation);
  const [value, setValue] = useState<{ valueUsd: number | null; startUsd: number } | "loading" | null>(null);
  const [version, setVersion] = useState(0);
  const tradeCount = state?.trades.length ?? 0;

  // Valued at live prices when the account changes or on Refresh - never polled.
  useEffect(() => {
    if (!hasSwap || !state?.paperMode) return;
    let live = true;
    valuation({ conversationKey })
      .then((result) => {
        if (live) setValue(result);
      })
      .catch(() => {
        if (live) setValue(null);
      });
    return () => {
      live = false;
    };
  }, [conversationKey, hasSwap, state?.paperMode, tradeCount, valuation, version]);

  if (!hasSwap || !state) return null;
  const change = typeof value === "object" && value?.valueUsd != null ? value.valueUsd - value.startUsd : null;

  return (
    <div className="mx-2 mt-2 rounded-xl border border-line bg-paper-strong px-3 py-2.5">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[12.5px] font-semibold text-ink">Trading mode</p>
        <div className="panel-tabs grid grid-cols-2 rounded-full p-[2px]" role="radiogroup" aria-label="Trading mode">
          {([true, false] as const).map((paper) => (
            <button
              aria-checked={state.paperMode === paper}
              className={`rounded-full px-2.5 py-0.5 !text-[11px] font-semibold transition-colors ${
                state.paperMode === paper ? "bg-white text-[#171813] shadow-sm" : "text-muted hover:text-ink"
              }`}
              key={String(paper)}
              onClick={() => void setMode({ conversationKey, paperMode: paper }).catch(() => toast.error("Could not switch the mode."))}
              role="radio"
              type="button"
            >
              {paper ? "Paper" : "Live"}
            </button>
          ))}
        </div>
      </div>

      {state.paperMode ? (
        <>
          <p className="mt-1 text-[0.7rem] leading-snug text-muted">
            Practice with pretend money at real PancakeSwap prices - fees, price impact and gas included. No real funds move.
          </p>
          <div className="mt-2 flex items-baseline gap-2">
            <p className="text-[1rem] font-semibold text-ink">
              {value === "loading" || value === null ? "…" : value.valueUsd === null ? "Unpriced" : `$${value.valueUsd.toFixed(2)}`}
            </p>
            {change !== null ? (
              <p className={`text-[0.74rem] font-semibold ${change >= 0 ? "text-success" : "text-danger"}`}>
                {change >= 0 ? "+" : ""}
                {change.toFixed(2)} since the ${state.startUsd.toLocaleString()} start
              </p>
            ) : null}
            <button className="ml-auto !text-[0.7rem] font-semibold text-muted hover:text-ink" onClick={() => { setValue("loading"); setVersion((n) => n + 1); }} type="button">
              Refresh
            </button>
          </div>
          <p className="mt-1 truncate font-mono text-[0.7rem] text-ink-soft">
            {state.holdings.map((holding) => `${amount(holding.amount)} ${holding.symbol}`).join(" · ")}
          </p>
          {state.trades.length > 0 ? (
            <ul className="mt-2 space-y-0.5">
              {state.trades.slice(0, 4).map((trade) => (
                <li className="truncate text-[0.68rem] text-muted" key={trade.at}>
                  {new Date(trade.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} · sold{" "}
                  {amount(trade.sellAmount)} {trade.sellSymbol} → {amount(trade.buyAmount)} {trade.buySymbol}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[0.68rem] text-muted">No paper trades yet. Run the agent to see what it would do.</p>
          )}
          <button
            className="mt-2 !text-[0.7rem] font-semibold text-muted hover:text-ink"
            onClick={() => void reset({ conversationKey }).then(() => toast.success("Paper account reset to $1,000 USDT."))}
            type="button"
          >
            Reset the paper account
          </button>
        </>
      ) : (
        <p className="mt-1 text-[0.7rem] leading-snug text-muted">
          Live: every trade comes to you as a ticket to sign, unless you allow &ldquo;Trade without asking&rdquo; below.
        </p>
      )}
    </div>
  );
}
