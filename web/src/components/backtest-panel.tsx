"use client";

import { useAction } from "convex/react";
import { useState } from "react";

import { binancePair, findPool, loadCandles, type Frame } from "@/components/trading-chart";
import { strategyApi } from "@/convex/api";
import { runBacktest, type BacktestResult, type Candle, type Rule } from "@/lib/backtest";

/**
 * THE BACKTEST VIEW, in the expanded chart (mentor review, 2026-09-29).
 * Tests a simple RULE on this token's real history - never the Brain - with
 * fees, slippage and gas on every fill, signals on closed candles filled at
 * the next open, and buy-and-hold beside it. Runs in the browser: no database
 * reads.
 *
 * PRICED BY BINANCE (owner, 2026-10-03: "a more recent and more reliable pricing"). A token
 * Binance lists is tested on Binance's own closed candles - read through Dolphin
 * (strategy.marketCandles, the trading rules' source), so it works on networks that block
 * Binance - up to 1,000 of them, at Binance's 0.1% fee and no gas. Anything else keeps its
 * BNB Chain pool (GeckoTerminal), the pool's 0.25% fee and gas.
 */

const FRAME_SECONDS: Record<"1h" | "4h" | "1d", number> = { "1h": 3_600, "4h": 14_400, "1d": 86_400 };
const FRAME_WORDS: Record<"1h" | "4h" | "1d", string> = { "1h": "hourly", "4h": "4-hour", "1d": "daily" };

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
  const [frame, setFrame] = useState<"1h" | "4h" | "1d">("1d");
  const marketCandles = useAction(strategyApi.strategy.marketCandles);
  const pair = binancePair(symbol);
  const [fast, setFast] = useState("20");
  const [slow, setSlow] = useState("50");
  const [buyBelow, setBuyBelow] = useState("30");
  const [sellAbove, setSellAbove] = useState("70");
  const [every, setEvery] = useState("7");
  const [dcaUsd, setDcaUsd] = useState("50");
  const [slippage, setSlippage] = useState("0.5");
  const [gas, setGas] = useState("0.05");
  const [state, setState] = useState<
    { status: "idle" } | { status: "running" } | { status: "error"; message: string } | { status: "done"; result: BacktestResult; candles: number; from: number; to: number; venue: "binance" | "pool" }
  >({ status: "idle" });

  const rule = (): Rule =>
    kind === "trend"
      ? { kind, fast: Math.max(1, Number(fast) || 20), slow: Math.max(2, Number(slow) || 50) }
      : kind === "rsi"
        ? { kind, period: 14, buyBelow: Number(buyBelow) || 30, sellAbove: Number(sellAbove) || 70 }
        : { kind, everyCandles: Math.max(1, Number(every) || 7), amountUsd: Math.max(1, Number(dcaUsd) || 50) };

  /** Binance's closed candles for the pair, or null when Binance has no such market. */
  const binanceCandles = async (): Promise<Candle[] | null> => {
    if (!pair) return null;
    const answer = await marketCandles({ venue: "binance-spot", market: pair, timeframe: frame, limit: 1000 }).catch(() => null);
    if (!Array.isArray(answer) || answer.length < 30) return null;
    return answer.map((candle) => ({ t: candle.t / 1000, o: candle.o, h: candle.h, l: candle.l, c: candle.c, v: 0 }));
  };

  const run = async () => {
    setState({ status: "running" });
    try {
      const slippageBps = Math.round((Number(slippage) || 0) * 100);
      const fromBinance = await binanceCandles();
      let candles: Candle[];
      if (fromBinance) candles = fromBinance;
      else {
        const pool = poolAddress ?? (await findPool(tokenAddress));
        if (!pool) throw new Error(`No market with trading for ${symbol}: Binance does not list it and it has no BNB Chain pool.`);
        // Closed candles only: the one still forming is left out.
        candles = (await loadCandles(pool, tokenAddress, frame as Frame, 1000)).filter((c) => c.t + FRAME_SECONDS[frame] <= Date.now() / 1000);
      }
      if (candles.length < 30) throw new Error(`Only ${candles.length} candles of ${symbol} history - too few to test on.`);
      const result = runBacktest(candles, rule(), fromBinance ? { feeBps: 10, slippageBps, gasUsd: 0 } : { feeBps: 25, slippageBps, gasUsd: Number(gas) || 0 });
      setState({ status: "done", result, candles: candles.length, from: candles[0].t, to: candles[candles.length - 1].t, venue: fromBinance ? "binance" : "pool" });
    } catch (cause) {
      setState({ status: "error", message: cause instanceof Error ? cause.message : "The backtest could not run." });
    }
  };

  // Which market the costs are for: the one the last run used, else Binance when it could list the token.
  const onBinance = state.status === "done" ? state.venue === "binance" : pair !== null;

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
          {(["1d", "4h", "1h"] as const).map((option) => (
            <button
              aria-checked={frame === option}
              className={`rounded-full px-2.5 py-1 !text-[11px] font-semibold ${frame === option ? "bg-paper-strong text-ink shadow-sm" : "text-muted hover:text-ink"}`}
              key={option}
              onClick={() => setFrame(option)}
              role="radio"
              type="button"
            >
              {option === "1d" ? "Daily" : option === "4h" ? "4-hour" : "Hourly"}
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
        <span className="text-[0.74rem] text-ink-soft">{onBinance ? "Binance fee 0.1%" : "Pool fee 0.25%"}</span>
        {input("Slippage %", slippage, setSlippage, "w-12")}
        {onBinance ? null : input("Gas $", gas, setGas, "w-14")}
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
            $1,000 tested on {state.candles.toLocaleString("en")} closed {FRAME_WORDS[frame]} {state.venue === "binance" ? pair : symbol} candles,{" "}
            {new Date(state.from * 1000).toLocaleDateString()} – {new Date(state.to * 1000).toLocaleDateString()}. Solid line: the rule. Dashed:
            buy and hold. Signals are read on each candle&apos;s close and filled at the next open, paying{" "}
            {state.venue === "binance" ? "Binance's 0.1% fee and slippage" : "the pool fee, slippage and gas"} every time. This tests the rule, not your
            agent&apos;s Brain, and past results do not predict future ones.
          </p>
        </>
      ) : null}
    </div>
  );
}
