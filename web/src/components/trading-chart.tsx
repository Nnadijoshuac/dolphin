"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * The live chart for the token a trading agent works on. (owner, 2026-09-28:
 * "you should be able to see what that currency is actually doing IRL")
 *
 * Candles come straight from GeckoTerminal in the browser - keyless, live-
 * checked for BNB Chain pools (Agent/RESEARCH-2026-09-28-trading-agents.md) -
 * so the chart costs Dolphin's database nothing. Every number drawn is from
 * the latest response; while nothing has loaded it says so, and a failed load
 * says that, never a placeholder series (AGENTS.md §5).
 *
 * EXPANDED (owner, 2026-09-29: "expand... fill the canvas... see more detail").
 * The canvas grows this card to fill itself (agent-canvas.tsx animates the
 * box); here it shows the full series, volume, a crosshair and the range's
 * high, low and volume. The drawing is sized to its box in real pixels, so
 * nothing stretches as it grows.
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
/** Fetched once for both sizes; the small card draws the latest of them. */
const FETCH_LIMIT = 160;
const SMALL_COUNT = 64;
const PAD_SMALL = { top: 10, right: 52, bottom: 18, left: 6 };
const PAD_LARGE = { top: 16, right: 68, bottom: 26, left: 10 };

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
    `https://api.geckoterminal.com/api/v2/networks/bsc/pools/${pool}/ohlcv/${FRAMES[frame]}${joiner}limit=${FETCH_LIMIT}&currency=usd&token=${tokenAddress}`,
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

function usdCompact(value: number): string {
  return `$${value.toLocaleString("en", { notation: "compact", maximumFractionDigits: 2 })}`;
}

function timeLabel(t: number, frame: Frame): string {
  const date = new Date(t * 1000);
  return frame === "1d"
    ? date.toLocaleDateString([], { month: "short", day: "numeric" })
    : frame === "4h"
      ? date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit" })
      : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function ExpandIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg aria-hidden fill="none" height="14" viewBox="0 0 16 16" width="14">
      {expanded ? (
        <path d="M6.5 2.5v4h-4M9.5 13.5v-4h4M6.5 6.5 2 2M9.5 9.5 14 14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
      ) : (
        <path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
      )}
    </svg>
  );
}

export function TradingChart({
  tokenAddress,
  symbol,
  poolAddress,
  expanded = false,
  onToggleExpand,
}: {
  tokenAddress: string;
  symbol: string;
  poolAddress: string | null;
  expanded?: boolean;
  onToggleExpand?: () => void;
}) {
  const [frame, setFrame] = useState<Frame>("1h");
  const [state, setState] = useState<
    { status: "loading" } | { status: "error" } | { status: "ready"; candles: Candle[]; at: number }
  >({ status: "loading" });
  const [hover, setHover] = useState<{ index: number; y: number } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  // The drawing's real size, so the SVG is never stretched.
  const [box, setBox] = useState({ w: 560, h: 170 });
  const measure = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const w = Math.max(120, Math.round(entry.contentRect.width));
      const h = Math.max(80, Math.round(entry.contentRect.height));
      setBox((current) => (current.w === w && current.h === h ? current : { w, h }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

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

  const pad = expanded ? PAD_LARGE : PAD_SMALL;
  const geometry = useMemo(() => {
    if (state.status !== "ready") return null;
    const candles = expanded ? state.candles : state.candles.slice(-SMALL_COUNT);
    const low = Math.min(...candles.map((candle) => candle.l));
    const high = Math.max(...candles.map((candle) => candle.h));
    const span = high - low || high * 0.01 || 1;
    const innerW = box.w - pad.left - pad.right;
    const innerH = box.h - pad.top - pad.bottom;
    // Expanded: the bottom fifth holds volume.
    const priceH = expanded ? innerH * 0.8 : innerH;
    const step = innerW / candles.length;
    const y = (value: number) => pad.top + priceH - ((value - low) / span) * priceH;
    const maxVolume = Math.max(...candles.map((candle) => candle.v), 1);
    const volumeTop = pad.top + priceH + 6;
    const volumeH = innerH - priceH - 6;
    const valueAt = (py: number) => low + ((pad.top + priceH - py) / priceH) * span;
    return { candles, low, high, step, y, valueAt, bodyW: Math.max(1.5, step * 0.62), maxVolume, volumeTop, volumeH, priceH };
  }, [state, expanded, pad, box.w, box.h]);

  // A hover from the other size can point past the candles drawn now.
  const hv = geometry && hover && hover.index < geometry.candles.length ? hover : null;
  const last = geometry?.candles[geometry.candles.length - 1];
  const first = geometry?.candles[0];
  const change = last && first ? ((last.c - first.o) / first.o) * 100 : null;
  const hovered = geometry && hv !== null ? geometry.candles[hv.index] : null;
  const shown = hovered ?? last;
  const volumeUsd = geometry ? geometry.candles.reduce((sum, candle) => sum + candle.v, 0) : null;
  const showBody = expanded || !collapsed;

  return (
    <div className="trading-chart" data-collapsed={!showBody || undefined} data-expanded={expanded || undefined}>
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <button
          aria-expanded={showBody}
          className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
          disabled={expanded}
          onClick={() => setCollapsed((value) => !value)}
          type="button"
        >
          <span className={`${expanded ? "!text-[16px]" : "!text-[13px]"} font-semibold text-ink`}>{symbol}</span>
          {shown ? <span className={`font-mono ${expanded ? "!text-[16px]" : "!text-[13px]"} text-ink`}>${price(shown.c)}</span> : null}
          {change !== null && hovered === null ? (
            <span className={`font-mono !text-[11px] ${change >= 0 ? "trading-chart__up" : "trading-chart__down"}`}>
              {change >= 0 ? "+" : ""}
              {change.toFixed(2)}%
            </span>
          ) : null}
        </button>
        {showBody ? (
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
        {onToggleExpand ? (
          <button
            aria-label={expanded ? "Shrink the chart" : "Expand the chart"}
            className="trading-chart__expand"
            onClick={onToggleExpand}
            title={expanded ? "Shrink (Esc)" : "Expand"}
            type="button"
          >
            <ExpandIcon expanded={expanded} />
          </button>
        ) : null}
      </div>

      {expanded && geometry ? (
        <div className="trading-chart__stats">
          {hovered ? (
            <>
              <span>{timeLabel(hovered.t, frame)}</span>
              <span>O <b>{price(hovered.o)}</b></span>
              <span>H <b>{price(hovered.h)}</b></span>
              <span>L <b>{price(hovered.l)}</b></span>
              <span>C <b>{price(hovered.c)}</b></span>
              <span>Vol <b>{usdCompact(hovered.v)}</b></span>
            </>
          ) : (
            <>
              <span>High <b>{price(geometry.high)}</b></span>
              <span>Low <b>{price(geometry.low)}</b></span>
              {volumeUsd !== null ? <span>Volume <b>{usdCompact(volumeUsd)}</b></span> : null}
              <span>{geometry.candles.length} candles · {frame}</span>
            </>
          )}
        </div>
      ) : null}

      {showBody ? (
        <div className="trading-chart__body" ref={measure}>
          {state.status === "loading" ? (
            <div className="grid h-full place-items-center text-[0.72rem] text-muted">Loading the market…</div>
          ) : state.status === "error" || !geometry ? (
            <div className="grid h-full place-items-center px-6 text-center text-[0.72rem] text-muted">
              No live chart for {symbol} right now. It needs a BNB Chain pool with trading.
            </div>
          ) : (
            <svg
              aria-label={`${symbol} price chart`}
              className="block h-full w-full"
              onMouseLeave={() => setHover(null)}
              onMouseMove={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                const x = ((event.clientX - rect.left) / rect.width) * box.w - pad.left;
                const y = ((event.clientY - rect.top) / rect.height) * box.h;
                const index = Math.floor(x / geometry.step);
                setHover(index >= 0 && index < geometry.candles.length ? { index, y } : null);
              }}
              role="img"
              viewBox={`0 0 ${box.w} ${box.h}`}
            >
              {(expanded ? [0, 0.25, 0.5, 0.75, 1] : [0, 0.5, 1]).map((fraction) => {
                const value = geometry.low + (geometry.high - geometry.low) * fraction;
                const y = geometry.y(value);
                return (
                  <g key={fraction}>
                    <line className="trading-chart__grid" x1={pad.left} x2={box.w - pad.right} y1={y} y2={y} />
                    <text className="trading-chart__axis" x={box.w - pad.right + 6} y={y + 3}>
                      {price(value)}
                    </text>
                  </g>
                );
              })}
              {expanded
                ? geometry.candles.map((candle, index) => {
                    const x = pad.left + index * geometry.step;
                    const height = (candle.v / geometry.maxVolume) * geometry.volumeH;
                    return (
                      <rect
                        className={candle.c >= candle.o ? "trading-chart__up" : "trading-chart__down"}
                        fill="currentColor"
                        height={Math.max(0.5, height)}
                        key={`v${candle.t}`}
                        opacity={0.28}
                        width={Math.max(1, geometry.step * 0.7)}
                        x={x + geometry.step * 0.15}
                        y={geometry.volumeTop + geometry.volumeH - height}
                      />
                    );
                  })
                : null}
              {geometry.candles.map((candle, index) => {
                const x = pad.left + index * geometry.step + geometry.step / 2;
                const up = candle.c >= candle.o;
                const top = geometry.y(Math.max(candle.o, candle.c));
                const bottom = geometry.y(Math.min(candle.o, candle.c));
                return (
                  <g
                    className={up ? "trading-chart__up" : "trading-chart__down"}
                    key={candle.t}
                    opacity={hv === null || hv.index === index ? 1 : 0.45}
                  >
                    <line stroke="currentColor" strokeWidth={1} x1={x} x2={x} y1={geometry.y(candle.h)} y2={geometry.y(candle.l)} />
                    <rect fill="currentColor" height={Math.max(1, bottom - top)} rx={1} width={geometry.bodyW} x={x - geometry.bodyW / 2} y={top} />
                  </g>
                );
              })}
              {last ? (
                <>
                  <line className="trading-chart__last" x1={pad.left} x2={box.w - pad.right} y1={geometry.y(last.c)} y2={geometry.y(last.c)} />
                  {expanded ? (
                    <g>
                      <rect className="trading-chart__tag" height={16} rx={4} width={pad.right - 6} x={box.w - pad.right + 3} y={geometry.y(last.c) - 8} />
                      <text className="trading-chart__tag-text" x={box.w - pad.right + 7} y={geometry.y(last.c) + 3.5}>
                        {price(last.c)}
                      </text>
                    </g>
                  ) : null}
                </>
              ) : null}
              {expanded && hv !== null && hv.y >= pad.top && hv.y <= pad.top + geometry.priceH ? (
                <g>
                  <line className="trading-chart__cross" x1={pad.left + hv.index * geometry.step + geometry.step / 2} x2={pad.left + hv.index * geometry.step + geometry.step / 2} y1={pad.top} y2={box.h - pad.bottom} />
                  <line className="trading-chart__cross" x1={pad.left} x2={box.w - pad.right} y1={hv.y} y2={hv.y} />
                  <rect className="trading-chart__tag trading-chart__tag--cross" height={16} rx={4} width={pad.right - 6} x={box.w - pad.right + 3} y={hv.y - 8} />
                  <text className="trading-chart__tag-text" x={box.w - pad.right + 7} y={hv.y + 3.5}>
                    {price(geometry.valueAt(hv.y))}
                  </text>
                </g>
              ) : null}
              {expanded
                ? Array.from({ length: 6 }, (_, tick) => {
                    const index = Math.min(geometry.candles.length - 1, Math.round((tick / 5) * (geometry.candles.length - 1)));
                    const x = pad.left + index * geometry.step + geometry.step / 2;
                    return (
                      <text className="trading-chart__axis" key={tick} textAnchor={tick === 0 ? "start" : tick === 5 ? "end" : "middle"} x={x} y={box.h - 8}>
                        {timeLabel(geometry.candles[index].t, frame)}
                      </text>
                    );
                  })
                : hv !== null
                  ? (
                      <text className="trading-chart__axis" x={pad.left + 2} y={box.h - 4}>
                        {timeLabel(geometry.candles[hv.index].t, frame)} · O {price(geometry.candles[hv.index].o)} H {price(geometry.candles[hv.index].h)} L{" "}
                        {price(geometry.candles[hv.index].l)} C {price(geometry.candles[hv.index].c)}
                      </text>
                    )
                  : (
                      <text className="trading-chart__axis" x={pad.left + 2} y={box.h - 4}>
                        {timeLabel(geometry.candles[0].t, frame)} – {timeLabel(geometry.candles[geometry.candles.length - 1].t, frame)}
                      </text>
                    )}
            </svg>
          )}
        </div>
      ) : null}
    </div>
  );
}
