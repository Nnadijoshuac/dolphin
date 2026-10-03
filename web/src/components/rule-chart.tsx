"use client";

import { useEffect, useRef, useState } from "react";

import type { ChartCandle } from "@/convex/api";

/**
 * THE RULE'S CHART (owner, 2026-10-03: "a visual trading view... buys, sells, stop-loss and
 * take-profit"). Candles, every trade the rule made as a marker on the candle it judged, the
 * line from each entry to its exit, and the open position's entry, stop and target as levels.
 * Drag to pan, scroll (or the buttons) to zoom; it follows the newest candle until panned away.
 */

export type ChartMarker = {
  /** Open time of the candle the decision judged, ms. */
  time: number;
  kind: "enter" | "exit";
  side: "long" | "short";
  price: number;
  /** What the engine said at the time. */
  title: string;
  pnlPct?: number | null;
};

export type ChartLevel = { price: number; kind: "entry" | "stop" | "target"; label: string };

const PAD = { top: 14, right: 70, bottom: 24, left: 6 };
const MIN_SPAN = 20;

function fmt(value: number): string {
  return value >= 1 ? value.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : value.toPrecision(4);
}

function timeLabel(t: number, timeframe: string): string {
  const date = new Date(t);
  const day = date.toLocaleDateString("en", { month: "short", day: "numeric" });
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (timeframe === "1d") return day;
  if (timeframe === "1h" || timeframe === "4h") return `${day} ${time}`;
  return time;
}

/** The index of the candle that contains `time`: the last one opening at or before it. */
function candleIndex(candles: readonly ChartCandle[], time: number): number {
  let low = 0;
  let high = candles.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (candles[middle].t <= time) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
}

export function RuleChart({
  candles,
  markers = [],
  levels = [],
  timeframe,
  height = 320,
  initialSpan = 120,
}: {
  candles: readonly ChartCandle[];
  markers?: readonly ChartMarker[];
  levels?: readonly ChartLevel[];
  timeframe: string;
  height?: number;
  initialSpan?: number;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(640);
  const [span, setSpan] = useState(initialSpan);
  const [offset, setOffset] = useState(0);
  const [hover, setHover] = useState<{ index: number; y: number } | null>(null);
  const drag = useRef<{ x: number; offset: number } | null>(null);

  useEffect(() => {
    const element = wrap.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(260, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Wheel zoom needs a non-passive listener (React's onWheel cannot preventDefault). Re-bound each
  // render, so it always sees the current candle count.
  const available = candles.length;
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
      event.preventDefault();
      setSpan((current) => Math.round(Math.min(Math.max(current * (event.deltaY > 0 ? 1.15 : 1 / 1.15), MIN_SPAN), Math.max(MIN_SPAN, available))));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  });

  const total = candles.length;
  if (total === 0) return <div className="rule-chart grid place-items-center text-[0.72rem] text-muted" style={{ height }}>No candles yet.</div>;

  const shown = Math.min(Math.max(span, MIN_SPAN), total);
  const lag = Math.min(Math.max(offset, 0), total - shown);
  const end = total - lag;
  const start = end - shown;
  const visible = candles.slice(start, end);

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const step = plotW / shown;
  const bodyW = Math.max(1, Math.min(14, step * 0.66));
  let low = Math.min(...visible.map((candle) => candle.l));
  let high = Math.max(...visible.map((candle) => candle.h));
  // Levels widen the range when near, so a stop just off-screen still shows; far ones are pinned to the edge.
  for (const level of levels) {
    if (level.price > low * 0.8 && level.price < high * 1.2) {
      low = Math.min(low, level.price);
      high = Math.max(high, level.price);
    }
  }
  const margin = (high - low) * 0.08 || high * 0.01 || 1;
  low -= margin;
  high += margin;
  const y = (value: number) => PAD.top + ((high - value) / (high - low)) * plotH;
  const valueAt = (py: number) => high - ((py - PAD.top) / plotH) * (high - low);
  const xAt = (index: number) => PAD.left + index * step + step / 2;
  const clampY = (py: number) => Math.min(Math.max(py, PAD.top), PAD.top + plotH);

  const placed = markers
    .map((marker) => ({ marker, index: candleIndex(candles, marker.time) - start }))
    .filter((entry) => entry.index >= 0 && entry.index < shown);
  // Each entry joined to the exit after it, coloured by how it ended.
  const legs: { from: (typeof placed)[number]; to: (typeof placed)[number] }[] = [];
  for (let i = 0; i < placed.length - 1; i++) {
    if (placed[i].marker.kind === "enter" && placed[i + 1].marker.kind === "exit") legs.push({ from: placed[i], to: placed[i + 1] });
  }

  const hv = hover && hover.index < shown ? hover : null;
  const hoveredCandle = hv ? visible[hv.index] : visible[visible.length - 1];
  const hoveredMarkers = hv ? placed.filter((entry) => entry.index === hv.index) : [];
  const last = visible[visible.length - 1];
  // Fewer time labels on a narrow chart, so they never run together.
  const ticks = width < 560 ? 3 : 5;

  const pointerIndex = (clientX: number, rect: DOMRect) => Math.floor((((clientX - rect.left) / rect.width) * width - PAD.left) / step);

  return (
    <div className="rule-chart" ref={wrap}>
      <div className="rule-chart__head">
        <span>{timeLabel(hoveredCandle.t, timeframe)}</span>
        <span>O <b>{fmt(hoveredCandle.o)}</b></span>
        <span>H <b>{fmt(hoveredCandle.h)}</b></span>
        <span>L <b>{fmt(hoveredCandle.l)}</b></span>
        <span>C <b className={hoveredCandle.c >= hoveredCandle.o ? "rule-chart__up" : "rule-chart__down"}>{fmt(hoveredCandle.c)}</b></span>
        <span className="rule-chart__zoom">
          <button aria-label="Zoom out" onClick={() => setSpan((current) => Math.min(Math.round(current * 1.4), total))} type="button">−</button>
          <button aria-label="Zoom in" onClick={() => setSpan((current) => Math.max(Math.round(current / 1.4), MIN_SPAN))} type="button">+</button>
          {lag > 0 ? (
            <button onClick={() => setOffset(0)} type="button">
              Latest →
            </button>
          ) : null}
        </span>
      </div>
      <svg
        aria-label="Price chart with the rule's trades"
        className="rule-chart__svg"
        height={height}
        onDoubleClick={() => {
          setOffset(0);
          setSpan(initialSpan);
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, offset: lag };
        }}
        onPointerLeave={() => setHover(null)}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          if (drag.current) {
            const moved = ((event.clientX - drag.current.x) / rect.width) * width;
            setOffset(Math.round(drag.current.offset + moved / step));
            return;
          }
          const index = pointerIndex(event.clientX, rect);
          setHover(index >= 0 && index < shown ? { index, y: ((event.clientY - rect.top) / rect.height) * height } : null);
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        role="img"
        viewBox={`0 0 ${width} ${height}`}
        width={width}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
          const value = low + margin + (high - low - 2 * margin) * fraction;
          // A grid price under a tag (last price, entry, stop, target) would show through it.
          const tags = [...(last && lag === 0 ? [last.c] : []), ...levels.map((level) => level.price)];
          const covered = tags.some((tag) => Math.abs(clampY(y(tag)) - y(value)) < 13);
          return (
            <g key={fraction}>
              <line className="rule-chart__grid" x1={PAD.left} x2={width - PAD.right} y1={y(value)} y2={y(value)} />
              {covered ? null : (
                <text className="rule-chart__axis" x={width - PAD.right + 6} y={y(value) + 3}>
                  {fmt(value)}
                </text>
              )}
            </g>
          );
        })}

        {visible.map((candle, index) => {
          const up = candle.c >= candle.o;
          const top = y(Math.max(candle.o, candle.c));
          const bottom = y(Math.min(candle.o, candle.c));
          return (
            <g className={up ? "rule-chart__up" : "rule-chart__down"} key={candle.t} opacity={hv === null || hv.index === index ? 1 : 0.55}>
              <line stroke="currentColor" strokeWidth={1} x1={xAt(index)} x2={xAt(index)} y1={y(candle.h)} y2={y(candle.l)} />
              <rect fill="currentColor" height={Math.max(1, bottom - top)} rx={0.8} width={bodyW} x={xAt(index) - bodyW / 2} y={top} />
            </g>
          );
        })}

        {legs.map(({ from, to }) => (
          <line
            className={(to.marker.pnlPct ?? 0) >= 0 ? "rule-chart__leg rule-chart__up" : "rule-chart__leg rule-chart__down"}
            key={`${from.marker.time}-${to.marker.time}`}
            x1={xAt(from.index)}
            x2={xAt(to.index)}
            y1={y(from.marker.price)}
            y2={y(to.marker.price)}
          />
        ))}

        {levels.map((level) => {
          const py = clampY(y(level.price));
          return (
            <g className={`rule-chart__level rule-chart__level--${level.kind}`} key={level.kind}>
              <line x1={PAD.left} x2={width - PAD.right} y1={py} y2={py} />
              <rect height={16} rx={4} width={PAD.right - 4} x={width - PAD.right + 2} y={py - 8} />
              <text x={width - PAD.right + 6} y={py + 3.5}>
                {level.label} {fmt(level.price)}
              </text>
            </g>
          );
        })}

        {placed.map(({ marker, index }) => {
          const candle = visible[index];
          const x = xAt(index);
          const size = Math.max(5, Math.min(8, step * 0.9));
          if (marker.kind === "exit") {
            const py = y(marker.price);
            return (
              <g className="rule-chart__exit" key={`x${marker.time}-${marker.price}`}>
                <title>{marker.title}</title>
                <path d={`M${x} ${py - size}L${x + size} ${py}L${x} ${py + size}L${x - size} ${py}Z`} />
              </g>
            );
          }
          const long = marker.side === "long";
          const tip = long ? y(candle.l) + 4 : y(candle.h) - 4;
          const base = long ? tip + size * 1.6 : tip - size * 1.6;
          return (
            <g className={long ? "rule-chart__enter rule-chart__up" : "rule-chart__enter rule-chart__down"} key={`e${marker.time}-${marker.price}`}>
              <title>{marker.title}</title>
              <path d={`M${x} ${tip}L${x + size} ${base}L${x - size} ${base}Z`} />
            </g>
          );
        })}

        {last && lag === 0 ? (
          <g className="rule-chart__last">
            <line x1={PAD.left} x2={width - PAD.right} y1={y(last.c)} y2={y(last.c)} />
            <rect height={16} rx={4} width={PAD.right - 4} x={width - PAD.right + 2} y={y(last.c) - 8} />
            <text x={width - PAD.right + 6} y={y(last.c) + 3.5}>
              {fmt(last.c)}
            </text>
          </g>
        ) : null}

        {hv && hv.y >= PAD.top && hv.y <= PAD.top + plotH ? (
          <g className="rule-chart__cross">
            <line x1={xAt(hv.index)} x2={xAt(hv.index)} y1={PAD.top} y2={PAD.top + plotH} />
            <line x1={PAD.left} x2={width - PAD.right} y1={hv.y} y2={hv.y} />
            <rect height={16} rx={4} width={PAD.right - 4} x={width - PAD.right + 2} y={hv.y - 8} />
            <text x={width - PAD.right + 6} y={hv.y + 3.5}>
              {fmt(valueAt(hv.y))}
            </text>
          </g>
        ) : null}

        {Array.from({ length: ticks }, (_, tick) => {
          const index = Math.min(shown - 1, Math.round((tick / (ticks - 1)) * (shown - 1)));
          const edge = tick === 0 ? "start" : tick === ticks - 1 ? "end" : "middle";
          return (
            <text className="rule-chart__axis" key={tick} textAnchor={edge} x={edge === "start" ? PAD.left : edge === "end" ? width - PAD.right : xAt(index)} y={height - 7}>
              {timeLabel(visible[index].t, timeframe)}
            </text>
          );
        })}
      </svg>
      {hoveredMarkers.length > 0 ? (
        <div className="rule-chart__why">
          {hoveredMarkers.map(({ marker }) => (
            <p key={`${marker.kind}${marker.time}`}>
              <b>{marker.kind === "enter" ? (marker.side === "short" ? "Short" : "Buy") : "Close"}</b> at {fmt(marker.price)}
              {marker.pnlPct !== undefined && marker.pnlPct !== null ? ` (${marker.pnlPct > 0 ? "+" : ""}${marker.pnlPct.toFixed(2)}%)` : ""} - {marker.title}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The backtest's running result, closed trades plus the open one marked to market. */
export function EquityCurve({ points, height = 90 }: { points: readonly { time: number; usd: number }[]; height?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const element = wrap.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(200, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  if (points.length < 2) return null;
  const values = points.map((point) => point.usd);
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  const range = high - low || 1;
  const x = (index: number) => (index / (points.length - 1)) * width;
  const y = (value: number) => 6 + ((high - value) / range) * (height - 12);
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)} ${y(point.usd).toFixed(1)}`).join("");
  const final = values[values.length - 1];
  return (
    <div className="rule-equity" ref={wrap}>
      <svg aria-label="Result over time" height={height} role="img" viewBox={`0 0 ${width} ${height}`} width={width}>
        <line className="rule-equity__zero" x1={0} x2={width} y1={y(0)} y2={y(0)} />
        <path className={final >= 0 ? "rule-equity__area rule-chart__up" : "rule-equity__area rule-chart__down"} d={`${line}L${width} ${y(0)}L0 ${y(0)}Z`} />
        <path className={final >= 0 ? "rule-equity__line rule-chart__up" : "rule-equity__line rule-chart__down"} d={line} />
      </svg>
    </div>
  );
}
