"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * The live chart for the token a trading agent works on. (owner, 2026-09-28:
 * "you should be able to see what that currency is actually doing IRL")
 *
 * Candles come straight from GeckoTerminal in the browser - keyless, live-
 * checked for BNB Chain pools (Agent/RESEARCH-2026-09-28-trading-agents.md) -
 * so the chart costs Dolphin's database nothing. Every number drawn is from
 * the latest response; while nothing has loaded it says so, and a failed load
 * says that, never a placeholder series (AGENTS.md §5).
 */

type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };
type Frame = "15m" | "1h" | "4h" | "1d";

const FRAMES: Record<Frame, string> = {
  "15m": "minute?aggregate=15",
  "1h": "hour?aggregate=1",
  "4h": "hour?aggregate=4",
  "1d": "day?aggregate=1",
};
const REFRESH_MS = 60_000;
const W = 560;
const H = 200;
const PAD = { top: 10, right: 52, bottom: 18, left: 6 };

async function findPool(tokenAddress: string): Promise<string | null> {
  const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
  if (!response.ok) return null;
  const data = (await response.json()) as { pairs?: Array<{ chainId: string; pairAddress: string; liquidity?: { usd?: number } }> };
  const pairs = (data.pairs ?? []).filter((pair) => pair.chainId === "bsc");
  pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  return pairs[0]?.pairAddress ?? null;
}

async function loadCandles(pool: string, tokenAddress: string, frame: Frame): Promise<Candle[]> {
  const joiner = FRAMES[frame].includes("?") ? "&" : "?";
  const response = await fetch(
    `https://api.geckoterminal.com/api/v2/networks/bsc/pools/${pool}/ohlcv/${FRAMES[frame]}${joiner}limit=64&currency=usd&token=${tokenAddress}`,
    { headers: { accept: "application/json" } },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = (await response.json()) as { data?: { attributes?: { ohlcv_list?: number[][] } } };
  return (data.data?.attributes?.ohlcv_list ?? [])
    .map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
    .sort((a, b) => a.t - b.t);
}

function price(value: number): string {
  if (value >= 1000) return value.toLocaleString("en", { maximumFractionDigits: 0 });
  if (value >= 1) return value.toLocaleString("en", { maximumFractionDigits: 3 });
  return value.toPrecision(4);
}

function timeLabel(t: number, frame: Frame): string {
  const date = new Date(t * 1000);
  return frame === "1d"
    ? date.toLocaleDateString([], { month: "short", day: "numeric" })
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function TradingChart({
  tokenAddress,
  symbol,
  poolAddress,
}: {
  tokenAddress: string;
  symbol: string;
  poolAddress: string | null;
}) {
  const [frame, setFrame] = useState<Frame>("1h");
  const [state, setState] = useState<
    { status: "loading" } | { status: "error" } | { status: "ready"; candles: Candle[]; at: number }
  >({ status: "loading" });
  const [hover, setHover] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const load = async () => {
      try {
        const pool = poolAddress ?? (await findPool(tokenAddress));
        if (!pool) throw new Error("no pool");
        const candles = await loadCandles(pool, tokenAddress, frame);
        if (!cancelled) setState(candles.length ? { status: "ready", candles, at: Date.now() } : { status: "error" });
      } catch {
        if (!cancelled) setState((current) => (current.status === "ready" ? current : { status: "error" }));
      }
      if (!cancelled) timer = window.setTimeout(load, REFRESH_MS);
    };
    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [frame, poolAddress, tokenAddress]);

  const geometry = useMemo(() => {
    if (state.status !== "ready") return null;
    const { candles } = state;
    const low = Math.min(...candles.map((candle) => candle.l));
    const high = Math.max(...candles.map((candle) => candle.h));
    const span = high - low || high * 0.01 || 1;
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const step = innerW / candles.length;
    const y = (value: number) => PAD.top + innerH - ((value - low) / span) * innerH;
    return { candles, low, high, step, y, bodyW: Math.max(1.5, step * 0.62) };
  }, [state]);

  const last = geometry?.candles[geometry.candles.length - 1];
  const first = geometry?.candles[0];
  const change = last && first ? ((last.c - first.o) / first.o) * 100 : null;
  const shown = geometry && hover !== null ? geometry.candles[hover] : last;

  return (
    <div className="trading-chart" data-collapsed={collapsed || undefined}>
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <button
          aria-expanded={!collapsed}
          className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
          onClick={() => setCollapsed((value) => !value)}
          type="button"
        >
          <span className="!text-[13px] font-semibold text-ink">{symbol}</span>
          {shown ? <span className="font-mono !text-[13px] text-ink">${price(shown.c)}</span> : null}
          {change !== null && hover === null ? (
            <span className={`font-mono !text-[11px] ${change >= 0 ? "trading-chart__up" : "trading-chart__down"}`}>
              {change >= 0 ? "+" : ""}
              {change.toFixed(2)}%
            </span>
          ) : null}
        </button>
        {!collapsed ? (
          <div className="flex rounded-full bg-paper-muted p-[2px]" role="radiogroup">
            {(Object.keys(FRAMES) as Frame[]).map((option) => (
              <button
                aria-checked={frame === option}
                className={`rounded-full px-2 py-0.5 !text-[10.5px] font-semibold transition-colors ${
                  frame === option ? "bg-paper-strong text-ink shadow-sm" : "text-muted hover:text-ink"
                }`}
                key={option}
                onClick={() => {
                  setFrame(option);
                  setState({ status: "loading" });
                  setHover(null);
                }}
                role="radio"
                type="button"
              >
                {option}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {collapsed ? null : state.status === "loading" ? (
        <div className="trading-chart__body grid place-items-center text-[0.72rem] text-muted">Loading the market…</div>
      ) : state.status === "error" || !geometry ? (
        <div className="trading-chart__body grid place-items-center px-6 text-center text-[0.72rem] text-muted">
          No live chart for {symbol} right now. It needs a BNB Chain pool with trading.
        </div>
      ) : (
        <svg
          aria-label={`${symbol} price chart`}
          className="trading-chart__body block w-full"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            const x = ((event.clientX - box.left) / box.width) * W - PAD.left;
            const index = Math.floor(x / geometry.step);
            setHover(index >= 0 && index < geometry.candles.length ? index : null);
          }}
          preserveAspectRatio="none"
          role="img"
          viewBox={`0 0 ${W} ${H}`}
        >
          {[0, 0.5, 1].map((fraction) => {
            const value = geometry.low + (geometry.high - geometry.low) * fraction;
            const y = geometry.y(value);
            return (
              <g key={fraction}>
                <line className="trading-chart__grid" x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} />
                <text className="trading-chart__axis" x={W - PAD.right + 6} y={y + 3}>
                  {price(value)}
                </text>
              </g>
            );
          })}
          {geometry.candles.map((candle, index) => {
            const x = PAD.left + index * geometry.step + geometry.step / 2;
            const up = candle.c >= candle.o;
            const top = geometry.y(Math.max(candle.o, candle.c));
            const bottom = geometry.y(Math.min(candle.o, candle.c));
            return (
              <g className={up ? "trading-chart__up" : "trading-chart__down"} key={candle.t} opacity={hover === null || hover === index ? 1 : 0.45}>
                <line stroke="currentColor" strokeWidth={1} x1={x} x2={x} y1={geometry.y(candle.h)} y2={geometry.y(candle.l)} />
                <rect fill="currentColor" height={Math.max(1, bottom - top)} rx={1} width={geometry.bodyW} x={x - geometry.bodyW / 2} y={top} />
              </g>
            );
          })}
          {last ? (
            <line className="trading-chart__last" x1={PAD.left} x2={W - PAD.right} y1={geometry.y(last.c)} y2={geometry.y(last.c)} />
          ) : null}
          {hover !== null ? (
            <text className="trading-chart__axis" x={PAD.left + 2} y={H - 4}>
              {timeLabel(geometry.candles[hover].t, frame)} · O {price(geometry.candles[hover].o)} H {price(geometry.candles[hover].h)} L{" "}
              {price(geometry.candles[hover].l)} C {price(geometry.candles[hover].c)}
            </text>
          ) : (
            <text className="trading-chart__axis" x={PAD.left + 2} y={H - 4}>
              {timeLabel(geometry.candles[0].t, frame)} – {timeLabel(geometry.candles[geometry.candles.length - 1].t, frame)}
            </text>
          )}
        </svg>
      )}
    </div>
  );
}
