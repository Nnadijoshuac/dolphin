"use client";

import { useEffect, useRef, useState } from "react";

import type { ChartCandle } from "@/convex/api";

/**
 * THE RULE'S CHART (owner, 2026-10-03: "a visual trading view... buys, sells, stop-loss and
 * take-profit"). Candles, every trade the rule made as a marker on the candle it judged, the
 * line from each entry to its exit, and the open position's entry, stop and target as levels.
 * Drag to pan, scroll (or the buttons) to zoom; it follows the newest candle until panned away.
 *
 * The canvas's token chart draws with it too (components/trading-chart.tsx): with volume bars,
 * compact in the small card, and asking for older history when panned to its first candle.
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
  // Short candles: the time alone today, with the day once the chart is dragged back past it.
  return date.toDateString() === new Date().toDateString() ? time : `${day} ${time}`;
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
  volume = false,
  compact = false,
  pegDollar = false,
  onNeedOlder,
}: {
  candles: readonly ChartCandle[];
  markers?: readonly ChartMarker[];
  levels?: readonly ChartLevel[];
  timeframe: string;
  height?: number;
  initialSpan?: number;
  /** Volume bars along the bottom (candles' `v`). */
  volume?: boolean;
  /** No OHLC line or zoom buttons - for a small card that shows the price itself. */
  compact?: boolean;
  /** A dollar token near its peg: a scale of at least $0.98-$1.02, so a 0.3% wobble looks like one. */
  pegDollar?: boolean;
  /** Called when the view reaches the first candle: load older history. */
  onNeedOlder?: () => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(640);
  const [span, setSpan] = useState(initialSpan);
  const [offset, setOffset] = useState(0);
  const [hover, setHover] = useState<{ index: number; y: number } | null>(null);
  const drag = useRef<{ x: number; offset: number } | null>(null);
  // Fingers on the chart (touch pinch), and the pinch as it started.
  const touches = useRef(new Map<number, number>());
  const pinch = useRef<{ distance: number; span: number; lag: number; anchor: number } | null>(null);

  useEffect(() => {
    const element = wrap.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(260, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const total = candles.length;
  const shown = Math.min(Math.max(span, MIN_SPAN), total);
  const lag = Math.min(Math.max(offset, 0), total - shown);
  const end = total - lag;
  const start = end - shown;
  const plotWidth = width - PAD.left - PAD.right;

  /*
   * MOVE LIKE A TRADING CHART (owner, 2026-10-04: "pinch... the candles shrink... you can't go
   * backward, you can't go forward"). Drag, or swipe sideways on a trackpad, to move through time;
   * scroll or pinch (trackpad or touch) to zoom around the point under the fingers; arrow keys and
   * + / - when the chart has focus; double-click returns to the latest candles. `anchor` is how far
   * from the right edge the zoom centres, 0 to 1.
   */
  const panBy = (candlesBack: number, fromLag = lag) => setOffset(Math.round(Math.min(Math.max(fromLag + candlesBack, 0), Math.max(0, total - shown))));
  const zoomTo = (nextShown: number, anchor: number, fromShown = shown, fromLag = lag) => {
    const bounded = Math.round(Math.min(Math.max(nextShown, MIN_SPAN), Math.max(MIN_SPAN, total)));
    const pivot = fromLag + anchor * fromShown;
    setSpan(bounded);
    setOffset(Math.round(Math.min(Math.max(pivot - anchor * bounded, 0), Math.max(0, total - bounded))));
  };
  const anchorAt = (clientX: number, rect: DOMRect) => Math.min(Math.max(1 - (((clientX - rect.left) / rect.width) * width - PAD.left) / plotWidth, 0), 1);

  // The wheel needs a non-passive listener (React's onWheel cannot preventDefault). Re-bound each
  // render, so it always sees the current view.
  useEffect(() => {
    const element = svg.current;
    // In a compact card the wheel stays with the page (the canvas zooms with it).
    if (!element || compact) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      if (!event.ctrlKey && Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        // A sideways swipe: right moves to newer candles, left to older ones.
        panBy(-event.deltaX / (plotWidth / shown));
        return;
      }
      // A trackpad pinch arrives as a wheel with ctrlKey and small deltas; a mouse wheel as big ones.
      const factor = Math.exp(Math.max(-0.5, Math.min(0.5, event.deltaY * (event.ctrlKey ? 0.01 : 0.0015))));
      zoomTo(shown * factor, anchorAt(event.clientX, rect));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  });

  // Panned to the first candle: ask for older history (once per history length).
  const askedAt = useRef(-1);
  const nearStart = total > 0 && start <= 3;
  useEffect(() => {
    if (!onNeedOlder || !nearStart || askedAt.current === total) return;
    askedAt.current = total;
    onNeedOlder();
  }, [nearStart, onNeedOlder, total]);

  if (total === 0) return <div className="rule-chart grid place-items-center text-[0.72rem] text-muted" style={{ height }}>No candles yet.</div>;

  const visible = candles.slice(start, end);

  const plotW = plotWidth;
  const fullH = height - PAD.top - PAD.bottom;
  // With volume, the bottom fifth holds its bars.
  const plotH = volume ? fullH * 0.8 : fullH;
  const volumeTop = PAD.top + plotH + 6;
  const volumeH = fullH - plotH - 6;
  const maxVolume = Math.max(...visible.map((candle) => candle.v ?? 0), 0);
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
  if (pegDollar && high < 1.1 && low > 0.9 && high - low < 0.04) {
    const middle = (high + low) / 2;
    low = middle - 0.02;
    high = middle + 0.02;
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
      <div className="rule-chart__head" hidden={compact}>
        <span>{timeLabel(hoveredCandle.t, timeframe)}</span>
        <span>O <b>{fmt(hoveredCandle.o)}</b></span>
        <span>H <b>{fmt(hoveredCandle.h)}</b></span>
        <span>L <b>{fmt(hoveredCandle.l)}</b></span>
        <span>C <b className={hoveredCandle.c >= hoveredCandle.o ? "rule-chart__up" : "rule-chart__down"}>{fmt(hoveredCandle.c)}</b></span>
        <span className="rule-chart__zoom">
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
        ref={svg}
        height={height}
        data-compact={compact || undefined}
        onDoubleClick={() => {
          setOffset(0);
          setSpan(initialSpan);
        }}
        onKeyDown={(event) => {
          const nudge = Math.max(1, Math.round(shown * 0.1));
          if (event.key === "ArrowLeft") panBy(nudge);
          else if (event.key === "ArrowRight") panBy(-nudge);
          else if (event.key === "+" || event.key === "=") zoomTo(shown / 1.25, 0.5);
          else if (event.key === "-" || event.key === "_") zoomTo(shown * 1.25, 0.5);
          else if (event.key === "End") setOffset(0);
          else return;
          event.preventDefault();
        }}
        onPointerCancel={(event) => {
          touches.current.delete(event.pointerId);
          pinch.current = null;
          drag.current = null;
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          if (event.pointerType === "touch") touches.current.set(event.pointerId, event.clientX);
          if (touches.current.size === 2) {
            // A second finger: a pinch begins, centred between the two.
            const [a, b] = [...touches.current.values()];
            const rect = event.currentTarget.getBoundingClientRect();
            pinch.current = { distance: Math.max(8, Math.abs(a - b)), span: shown, lag, anchor: anchorAt((a + b) / 2, rect) };
            drag.current = null;
            return;
          }
          drag.current = { x: event.clientX, offset: lag };
        }}
        onPointerLeave={() => setHover(null)}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          if (touches.current.has(event.pointerId)) touches.current.set(event.pointerId, event.clientX);
          if (pinch.current && touches.current.size === 2) {
            const [a, b] = [...touches.current.values()];
            const begun = pinch.current;
            zoomTo((begun.span * begun.distance) / Math.max(8, Math.abs(a - b)), begun.anchor, begun.span, begun.lag);
            return;
          }
          if (drag.current) {
            const moved = ((event.clientX - drag.current.x) / rect.width) * width;
            panBy(moved / step, drag.current.offset);
            return;
          }
          const index = pointerIndex(event.clientX, rect);
          setHover(index >= 0 && index < shown ? { index, y: ((event.clientY - rect.top) / rect.height) * height } : null);
        }}
        onPointerUp={(event) => {
          touches.current.delete(event.pointerId);
          if (touches.current.size < 2) pinch.current = null;
          drag.current = null;
        }}
        tabIndex={0}
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

        {volume && maxVolume > 0
          ? visible.map((candle, index) => {
              const barH = ((candle.v ?? 0) / maxVolume) * volumeH;
              return (
                <rect
                  className={candle.c >= candle.o ? "rule-chart__up" : "rule-chart__down"}
                  fill="currentColor"
                  height={Math.max(0.5, barH)}
                  key={`v${candle.t}`}
                  opacity={0.28}
                  width={Math.max(1, step * 0.7)}
                  x={xAt(index) - Math.max(1, step * 0.7) / 2}
                  y={volumeTop + volumeH - barH}
                />
              );
            })
          : null}

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
          /*
           * AT THE PRICE PAID (owner, 2026-10-04: the arrows sat under the candle and did not meet the
           * entry line). The arrow's tip touches the fill price, with a short tick across the candle at
           * that price - so an arrow and its entry line meet, as on any trading chart.
           */
          const long = marker.side === "long";
          const at = y(marker.price);
          const tip = long ? at + 2 : at - 2;
          const base = long ? tip + size * 1.6 : tip - size * 1.6;
          return (
            <g className={long ? "rule-chart__enter rule-chart__up" : "rule-chart__enter rule-chart__down"} key={`e${marker.time}-${marker.price}`}>
              <title>{marker.title}</title>
              <line className="rule-chart__fill" x1={x - size * 1.3} x2={x + size * 1.3} y1={at} y2={at} />
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
