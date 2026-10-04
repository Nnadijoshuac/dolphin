"use client";

import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { useState } from "react";
import { createPortal } from "react-dom";

import { strategyApi, type RuleTemplateView } from "@/convex/api";
import { toast } from "@/store/use-toast-store";

/**
 * A STRATEGY TEMPLATE, ADDED AS A RULE (owner, 2026-10-04: "put it into a box"). The person picks the
 * coin, where it trades and the size; it is added on paper through the same checks as any rule, and its
 * rule view backtests it on that coin's real history. No result is promised here - the backtest says.
 */

const MARKETS = [
  { market: "BNBUSDT", label: "BNB" },
  { market: "BTCUSDT", label: "BTC" },
  { market: "ETHUSDT", label: "ETH" },
  { market: "CAKEUSDT", label: "CAKE" },
] as const;

const VENUES = [
  { venue: "dolphin-wallet", label: "Dolphin Wallet" },
  { venue: "binance-spot", label: "Binance spot" },
] as const;

export function StrategyTemplatePicker({ conversationKey, template, onClose }: { conversationKey: string; template: RuleTemplateView; onClose: () => void }) {
  const add = useMutation(strategyApi.strategy.addTemplate);
  const [market, setMarket] = useState<(typeof MARKETS)[number]["market"]>("BNBUSDT");
  const [venue, setVenue] = useState<(typeof VENUES)[number]["venue"]>("dolphin-wallet");
  const [size, setSize] = useState("20");
  const [busy, setBusy] = useState(false);
  const sizeUsd = Number(size);

  const submit = async () => {
    setBusy(true);
    try {
      await add({ conversationKey, templateId: template.id, market, venue, sizeUsd });
      toast.success(`${template.name} added on paper. Open it under Trading rules → View → Backtest to see how it did on ${market.replace("USDT", "")}.`);
      onClose();
    } catch (cause) {
      toast.error(cause instanceof ConvexError && typeof cause.data === "string" ? cause.data : "Could not add the template.");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div aria-labelledby="template-title" aria-modal className="confirm-scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()} role="dialog">
      <div className="confirm-card">
        <p className="text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-muted">
          Strategy · {template.timeframe} candles · stop {template.stopLossPct}% · target {template.takeProfitPct}%
        </p>
        <h3 className="mt-1 text-[1.05rem] font-semibold tracking-[-0.01em] text-ink" id="template-title">
          {template.name}
        </h3>
        <p className="mt-1.5 text-[0.8rem] leading-relaxed text-ink-soft">{template.idea}</p>

        <p className="mt-4 text-[0.7rem] font-semibold text-muted">Coin</p>
        <div className="template-pick mt-1" role="radiogroup">
          {MARKETS.map((option) => (
            <button aria-checked={market === option.market} key={option.market} onClick={() => setMarket(option.market)} role="radio" type="button">
              <span>{option.label}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-[0.7rem] font-semibold text-muted">Trades from</p>
        <div className="template-pick mt-1" role="radiogroup">
          {VENUES.map((option) => (
            <button aria-checked={venue === option.venue} key={option.venue} onClick={() => setVenue(option.venue)} role="radio" type="button">
              <span>{option.label}</span>
            </button>
          ))}
        </div>
        <label className="mt-3 flex items-center gap-2 text-[0.8rem] text-ink-soft">
          Each trade $
          <input
            className="w-20 rounded-md border border-line bg-paper-strong px-2 py-1 text-right font-mono text-[0.8rem] text-ink"
            inputMode="decimal"
            onChange={(event) => setSize(event.target.value.replace(/[^0-9.]/g, ""))}
            value={size}
          />
        </label>
        <p className="mt-3 text-[0.7rem] leading-relaxed text-muted">Added on paper. Past results don&rsquo;t predict future ones.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button className="h-9 rounded-lg border border-line px-4 !text-[13px] font-semibold text-ink" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="h-9 rounded-lg bg-ink px-4 !text-[13px] font-semibold disabled:opacity-40" disabled={busy || !(sizeUsd >= 1)} onClick={() => void submit()} type="button">
            <span className="text-canvas">{busy ? "Adding…" : "Add to agent"}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
