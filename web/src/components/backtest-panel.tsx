"use client";

import { useState } from "react";

import { findPool, loadCandles, type Frame } from "@/components/trading-chart";
import { runBacktest, type BacktestResult, type Rule } from "@/lib/backtest";

/**
 * THE BACKTEST VIEW, in the expanded chart (mentor review, 2026-09-29).
 * Tests a simple RULE on this token's real history - never the Brain - with
 * fees, slippage and gas on every fill, signals on closed candles filled at
 * the next open, and buy-and-hold beside it. Runs in the browser: no database
 * reads, candles straight from GeckoTerminal.
 */

type RuleKind = Rule["kind"];
const RULES: { kind: RuleKind; label: string; about: string }[] = [
  { kind: "trend", label: "Trend", about: "Hold while the close is above the slow average and the fast one is above it; otherwise hold USDT." },
  { kind: "rsi", label: "RSI dip", about: "Buy when RSI drops below a level; sell when it rises above another." },
  { kind: "dca", label: "DCA", about: "Buy a fixed amount every few candles, whatever the price, and hold." },
];

function pct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function Curve({ result }: { result: BacktestResult }) {
  const W = 640;
  const H = 180;
  const values = [...result.equity.map((p) => p.value), ...result.buyHold.map((p) => p.value)];
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || 1;
  const path = (points: { value: number }[]) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${((i / (points.length - 1)) * W).toFixed(1)},${(H - ((p.value - low) / span) * H).toFixed(1)}`).join(" ");
  return (
    <svg aria-label="Equity curve against buy-and-hold" className="block h-44 w-full" preserveAspectRatio="none" role="img" viewBox={`0 0 ${W} ${H}`}>
      <path d={path(result.buyHold)} fill="none" stroke="var(--muted)" strokeDasharray="4 4" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
      <path d={path(result.equity)} fill="none" stroke="var(--accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function BacktestPanel({ tokenAddress, poolAddress, symbol }: { tokenAddress: string; poolAddress: string | null; symbol: string }) {
  const [kind, setKind] = useState<RuleKind>("trend");
  const [frame, setFrame] = useState<Frame>("1d");
  const [fast, setFast] = useState("20");
  const [slow, setSlow] = useState("50");
  const [buyBelow, setBuyBelow] = useState("30");
  const [sellAbove, setSellAbove] = useState("70");
  const [every, setEvery] = useState("7");
  const [dcaUsd, setDcaUsd] = useState("50");
  const [slippage, setSlippage] = useState("0.5");
  const [gas, setGas] = useState("0.05");
  const [state, setState] = useState<{ status: "idle" } | { status: "running" } | { status: "error"; message: string } | { status: "done"; result: BacktestResult; candles: number; from: number; to: number }>({ status: "idle" });

  const rule = (): Rule =>
    kind === "trend"
      ? { kind, fast: Math.max(1, Number(fast) || 20), slow: Math.max(2, Number(slow) || 50) }
      : kind === "rsi"
        ? { kind, period: 14, buyBelow: Number(buyBelow) || 30, sellAbove: Number(sellAbove) || 70 }
        : { kind, everyCandles: Math.max(1, Number(every) || 7), amountUsd: Math.max(1, Number(dcaUsd) || 50) };

  const run = async () => {
    setState({ status: "running" });
    try {
      const pool = poolAddress ?? (await findPool(tokenAddress));
      if (!pool) throw new Error(`No BNB Chain pool with trading for ${symbol}.`);
      const period = frame === "1d" ? 86_400 : 14_400;
      // Closed candles only: the one still forming is left out.
      const candles = (await loadCandles(pool, tokenAddress, frame, 1000)).filter((c) => c.t + period <= Date.now() / 1000);
      const result = runBacktest(candles, rule(), { feeBps: 25, slippageBps: Math.round((Number(slippage) || 0) * 100), gasUsd: Number(gas) || 0 });
      setState({ status: "done", result, candles: candles.length, from: candles[0].t, to: candles[candles.length - 1].t });
    } catch (cause) {
      setState({ status: "error", message: cause instanceof Error ? cause.message : "The backtest could not run." });
    }
  };

  const input = (label: string, value: string, set: (v: string) => void, width = "w-16") => (
    <label className="flex items-center gap-1.5 text-[0.74rem] text-ink-soft">
      {label}
      <input className={`${width} rounded-md border border-line bg-paper-strong px-1.5 py-0.5 font-mono text-[0.76rem] text-ink`} inputMode="decimal" onChange={(e) => set(e.target.value.replace(/[^0-9.]/g, ""))} value={value} />
    </label>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-full bg-paper-muted p-[2px]" role="radiogroup" aria-label="Rule">
          {RULES.map((option) => (
            <button
              aria-checked={kind === option.kind}
              className={`rounded-full px-3 py-1 !text-[11.5px] font-semibold ${kind === option.kind ? "bg-paper-strong text-ink shadow-sm" : "text-muted hover:text-ink"}`}
              key={option.kind}
              onClick={() => setKind(option.kind)}
              role="radio"
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex rounded-full bg-paper-muted p-[2px]" role="radiogroup" aria-label="Candles">
          {(["1d", "4h"] as const).map((option) => (
            <button
              aria-checked={frame === option}
              className={`rounded-full px-2.5 py-1 !text-[11px] font-semibold ${frame === option ? "bg-paper-strong text-ink shadow-sm" : "text-muted hover:text-ink"}`}
              key={option}
              onClick={() => setFrame(option)}
              role="radio"
              type="button"
            >
              {option === "1d" ? "Daily" : "4-hour"}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[0.74rem] text-muted">{RULES.find((option) => option.kind === kind)!.about}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {kind === "trend" ? (
          <>
            {input("Fast average", fast, setFast)}
            {input("Slow average", slow, setSlow)}
          </>
        ) : kind === "rsi" ? (
          <>
            {input("Buy below", buyBelow, setBuyBelow)}
            {input("Sell above", sellAbove, setSellAbove)}
          </>
        ) : (
          <>
            {input("Every N candles", every, setEvery)}
            {input("Amount $", dcaUsd, setDcaUsd)}
          </>
        )}
        <span className="text-[0.74rem] text-ink-soft">Pool fee 0.25%</span>
        {input("Slippage %", slippage, setSlippage, "w-12")}
        {input("Gas $", gas, setGas, "w-14")}
        <button
          className="ml-auto h-8 rounded-lg bg-ink px-4 !text-[12px] font-semibold disabled:opacity-40"
          disabled={state.status === "running"}
          onClick={() => void run()}
          type="button"
        >
          <span className="text-canvas">{state.status === "running" ? "Testing…" : "Run backtest"}</span>
        </button>
      </div>

      {state.status === "error" ? <p className="text-[0.78rem] text-danger">{state.message}</p> : null}
      {state.status === "done" ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              { label: "This rule", value: pct(state.result.returnPct), tone: state.result.returnPct >= 0 ? "text-success" : "text-danger" },
              { label: "Buy and hold", value: pct(state.result.buyHoldPct), tone: "text-ink" },
              { label: "Worst drop", value: `${state.result.maxDrawdownPct.toFixed(1)}%`, tone: "text-ink" },
              { label: "Trades", value: `${state.result.fills.length}${state.result.winRate === null ? "" : ` · ${Math.round(state.result.winRate * 100)}% won`}`, tone: "text-ink" },
              { label: "Costs paid", value: `$${state.result.costsUsd.toFixed(2)}`, tone: "text-ink" },
            ].map((stat) => (
              <div className="rounded-xl bg-paper-muted/70 px-3 py-2" key={stat.label}>
                <p className="text-[0.64rem] font-semibold uppercase tracking-[0.08em] text-muted">{stat.label}</p>
                <p className={`mt-0.5 font-mono text-[0.95rem] font-semibold ${stat.tone}`}>{stat.value}</p>
              </div>
            ))}
          </div>
          <Curve result={state.result} />
          <p className="text-[0.7rem] leading-snug text-muted">
            $1,000 tested on {state.candles} closed {frame === "1d" ? "daily" : "4-hour"} {symbol} candles,{" "}
            {new Date(state.from * 1000).toLocaleDateString()} – {new Date(state.to * 1000).toLocaleDateString()}. Solid line: the rule. Dashed:
            buy and hold. Signals are read on each candle&apos;s close and filled at the next open, paying the pool fee, slippage and
            gas every time. This tests the rule, not your agent&apos;s Brain, and past results do not predict future ones.
          </p>
        </>
      ) : null}
    </div>
  );
}
