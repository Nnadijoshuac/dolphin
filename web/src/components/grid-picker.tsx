"use client";

import { useAction, useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { strategyApi, type GridPreview, type GridSpecArgs } from "@/convex/api";
import { toast } from "@/store/use-toast-store";

/**
 * A GRID, SET UP AND BACKTESTED BEFORE IT IS ADDED (owner, 2026-10-04: "make the grid agent"). The person
 * picks the coin, the range, the levels and the money; Dolphin shows each level, what fees take, and how
 * those exact levels would have done over the last few days. Added on paper, like every rule.
 */

const MARKETS = [
  { market: "BNBUSDT", label: "BNB" },
  { market: "ETHUSDT", label: "ETH" },
  { market: "BTCUSDT", label: "BTC" },
  { market: "CAKEUSDT", label: "CAKE" },
] as const;

const VENUES = [
  { venue: "dolphin-wallet", label: "Dolphin Wallet" },
  { venue: "binance-spot", label: "Binance spot" },
] as const;

const usd = (value: number) => `${value < 0 ? "−" : ""}$${Math.abs(value).toFixed(2)}`;
const fig = (value: number) => (value >= 100 ? value.toFixed(2) : value >= 1 ? value.toFixed(3) : value.toPrecision(4));

export function GridPicker({ conversationKey, onClose }: { conversationKey: string; onClose: () => void }) {
  const preview = useAction(strategyApi.strategy.previewGrid);
  const add = useMutation(strategyApi.strategy.addGrid);
  const [market, setMarket] = useState<(typeof MARKETS)[number]["market"]>("BNBUSDT");
  const [venue, setVenue] = useState<(typeof VENUES)[number]["venue"]>("dolphin-wallet");
  const [lower, setLower] = useState("");
  const [upper, setUpper] = useState("");
  const [levels, setLevels] = useState("5");
  const [total, setTotal] = useState("50");
  const [stop, setStop] = useState("5");
  const [result, setResult] = useState<GridPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);

  const spec: GridSpecArgs = {
    market,
    venue,
    lower: Number(lower),
    upper: Number(upper),
    levels: Number(levels),
    totalUsd: Number(total),
    stopBelowPct: stop.trim() === "" ? null : Number(stop),
  };
  const filled = spec.lower > 0 && spec.upper > 0 && spec.levels > 0 && spec.totalUsd > 0;

  // Re-checked a moment after the numbers stop changing: the levels, the fees and the backtest.
  const key = JSON.stringify(spec);
  useEffect(() => {
    if (!filled) return;
    let current = true;
    const timer = setTimeout(() => {
      setChecking(true);
      preview(JSON.parse(key) as GridSpecArgs)
        .then((next) => current && setResult(next))
        .catch(() => current && setResult({ problems: ["The check could not run just now. Try again."] }))
        .finally(() => current && setChecking(false));
    }, 600);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [key, filled, preview]);

  const ok = result && result.problems.length === 0 && "buyPrices" in result ? result : null;

  const submit = async () => {
    setBusy(true);
    try {
      const made = await add({ conversationKey, ...spec });
      toast.success(`Grid added on paper: ${made.levels} levels. Turn on Autopilot to start it.`);
      onClose();
    } catch (cause) {
      toast.error(cause instanceof ConvexError && typeof cause.data === "string" ? cause.data : "Could not add the grid.");
    } finally {
      setBusy(false);
    }
  };

  const box = (label: string, value: string, set: (next: string) => void, prefix?: string, suffix?: string, width = "w-24") => (
    <label className="flex items-center gap-1.5 text-[0.8rem] text-ink-soft">
      <span className="w-24 text-[0.72rem] text-muted">{label}</span>
      {prefix}
      <input
        className={`${width} rounded-md border border-line bg-paper-strong px-2 py-1 text-right font-mono text-[0.8rem] text-ink`}
        inputMode="decimal"
        onChange={(event) => set(event.target.value.replace(/[^0-9.]/g, ""))}
        value={value}
      />
      {suffix}
    </label>
  );

  return createPortal(
    <div aria-labelledby="grid-title" aria-modal className="confirm-scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()} role="dialog">
      <div className="confirm-card max-h-[90vh] overflow-y-auto">
        <p className="text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-muted">Strategy · grid trading</p>
        <h3 className="mt-1 text-[1.05rem] font-semibold tracking-[-0.01em] text-ink" id="grid-title">
          Grid
        </h3>
        <p className="mt-1.5 text-[0.8rem] leading-relaxed text-ink-soft">
          Splits a price range into steps. Each step buys when the price drops under it and sells one step higher. It earns when the price moves up and down inside the range.
        </p>

        <div className="template-pick mt-4" role="radiogroup">
          {MARKETS.map((option) => (
            <button aria-checked={market === option.market} key={option.market} onClick={() => setMarket(option.market)} role="radio" type="button">
              <span>{option.label}</span>
            </button>
          ))}
        </div>
        <div className="template-pick mt-2" role="radiogroup">
          {VENUES.map((option) => (
            <button aria-checked={venue === option.venue} key={option.venue} onClick={() => setVenue(option.venue)} role="radio" type="button">
              <span>{option.label}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-2">
          {box("Bottom", lower, setLower, "$")}
          {box("Top", upper, setUpper, "$")}
          {box("Levels", levels, setLevels, undefined, "2 to 10", "w-16")}
          {box("Money in", total, setTotal, "$")}
          {box("Stop below", stop, setStop, undefined, "% (empty: none)", "w-16")}
        </div>
        {ok?.price ? (
          <p className={`mt-2 text-[0.7rem] ${ok.price > spec.upper || ok.price < spec.lower ? "font-semibold text-danger" : "text-muted"}`}>
            {market.replace("USDT", "")} is ${fig(ok.price)} now.
            {ok.price > spec.upper
              ? ` The whole range is below it, so nothing buys until it falls under $${fig(ok.buyPrices[ok.buyPrices.length - 1])}.`
              : ok.price < spec.lower
                ? " The whole range is above it, so every level buys at once and waits for the price to climb back."
                : ""}
          </p>
        ) : null}

        {!filled ? (
          <p className="mt-4 text-[0.74rem] text-muted">Fill in the range to see the levels and the backtest.</p>
        ) : checking && !result ? (
          <p className="mt-4 text-[0.74rem] text-muted">Checking…</p>
        ) : result && result.problems.length > 0 ? (
          <p className="mt-4 rounded-md bg-paper-muted px-2.5 py-2 text-[0.74rem] leading-relaxed text-danger">{result.problems.join(" ")}</p>
        ) : ok ? (
          <div className={`mt-4 ${checking ? "opacity-60" : ""}`}>
            <p className="text-[0.7rem] font-semibold text-muted">
              {ok.buyPrices.length} levels of ${ok.perLevelUsd}
            </p>
            <ol className="mt-1 space-y-0.5">
              {[...ok.buyPrices].reverse().map((buy, index) => {
                const level = ok.buyPrices.length - 1 - index;
                return (
                  <li className="flex justify-between text-[0.72rem] tabular-nums text-ink-soft" key={buy}>
                    <span>Buy under ${fig(buy)}</span>
                    <span className="text-muted">sell +{ok.stepPcts[level]}%</span>
                  </li>
                );
              })}
            </ol>
            <p className="mt-2 text-[0.72rem] leading-relaxed text-ink-soft">
              Each buy and sell costs about {usd(ok.costPerRoundTripUsd)} in fees{venue === "dolphin-wallet" ? " and gas" : ""}. The thinnest step keeps {usd(ok.worstNetPerRoundTripUsd)}.
              {ok.buysAtStart ? ` ${ok.buysAtStart} ${ok.buysAtStart === 1 ? "level buys" : "levels buy"} as soon as it starts, because the price is under ${ok.buysAtStart === 1 ? "it" : "them"}.` : ""}
            </p>
            {ok.backtest ? (
              <div className="mt-3 rounded-lg bg-paper-muted px-3 py-2">
                <p className="text-[0.66rem] font-semibold uppercase tracking-[0.06em] text-muted">
                  Backtest · last {ok.backtest.fromTime && ok.backtest.toTime ? Math.max(1, Math.round((ok.backtest.toTime - ok.backtest.fromTime) / 86_400_000)) : "few"} days
                </p>
                <p className="mt-1 text-[0.8rem] text-ink">
                  <b className={ok.backtest.totalUsd >= 0 ? "pnl-up" : "pnl-down"}>{usd(ok.backtest.totalUsd)}</b> ({ok.backtest.returnPct >= 0 ? "+" : ""}
                  {ok.backtest.returnPct}%) · {ok.backtest.roundTrips} round {ok.backtest.roundTrips === 1 ? "trip" : "trips"}
                </p>
                <p className="mt-0.5 text-[0.7rem] text-muted">
                  After {usd(ok.backtest.feesUsd + ok.backtest.gasUsd)} in costs. Worst dip {usd(-ok.backtest.maxDrawdownUsd)}. Holding {market.replace("USDT", "")} did {ok.backtest.buyHoldPct >= 0 ? "+" : ""}
                  {ok.backtest.buyHoldPct}%.
                </p>
              </div>
            ) : (
              <p className="mt-3 text-[0.7rem] text-muted">The backtest could not read price history just now.</p>
            )}
            {ok.warnings
              .filter((warning) => !/as soon as Autopilot starts/.test(warning))
              .map((warning) => (
                <p className="mt-2 rounded-md border border-[#d9901a]/40 bg-[#d9901a]/10 px-2 py-1 text-[0.68rem] leading-relaxed text-ink-soft" key={warning}>
                  {warning}
                </p>
              ))}
          </div>
        ) : null}

        <p className="mt-3 text-[0.7rem] leading-relaxed text-muted">Added on paper. Past results don&rsquo;t predict future ones.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button className="h-9 rounded-lg border border-line px-4 !text-[13px] font-semibold text-ink" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="h-9 rounded-lg bg-ink px-4 !text-[13px] font-semibold disabled:opacity-40" disabled={busy || !ok || checking} onClick={() => void submit()} type="button">
            <span className="text-canvas">{busy ? "Adding…" : "Add to agent"}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
