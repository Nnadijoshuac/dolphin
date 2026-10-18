"use client";

import { Area, AreaChart, Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/*
 * The three small charts under a live run (owner, 2026-10-18: the sparklines looked bad). shadcn-style
 * Recharts: soft gradient areas, rounded bars, a tooltip on hover, Dolphin gold for neutral, green and
 * red only for up and down. Each shows something real:
 *   ValueArea   - the wallet's value since the start, with the start as a dashed line
 *   ResultBars  - every closed trade's result, green or red
 *   PriceArea   - the market's recent closes, the thing the agent is judging
 */

const UP = "#3ddc84";
const DOWN = "#ff5c5c";
const GOLD = "#f3c13a";

const tooltipStyle = {
  background: "#20211b",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 10,
  fontSize: 12,
  color: "#f2f3ee",
  padding: "6px 10px",
};

export function ValueArea({ points, start }: { points: { t: number; usd: number }[]; start: number }) {
  const data = points.length > 1 ? points : [{ t: 0, usd: start }, ...points];
  const up = (data[data.length - 1]?.usd ?? start) >= start;
  const color = up ? UP : DOWN;
  const values = data.map((p) => p.usd);
  const pad = Math.max(0.05, (Math.max(...values, start) - Math.min(...values, start)) * 0.25);
  return (
    <ResponsiveContainer height={72} width="100%">
      <AreaChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id="valueFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis domain={[Math.min(...values, start) - pad, Math.max(...values, start) + pad]} hide />
        <XAxis dataKey="t" hide />
        <ReferenceLine stroke="rgba(255,255,255,0.25)" strokeDasharray="3 4" y={start} />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ stroke: "rgba(255,255,255,0.2)" }}
          formatter={(value) => [`$${Number(value).toFixed(2)}`, "Wallet"]}
          labelFormatter={(t) => (Number(t) > 0 ? new Date(Number(t)).toLocaleString() : "Start")}
        />
        <Area activeDot={{ r: 4, fill: color, stroke: "#191a15", strokeWidth: 2 }} dataKey="usd" fill="url(#valueFill)" isAnimationActive stroke={color} strokeWidth={2} type="monotone" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ResultBars({ results }: { results: number[] }) {
  // Nothing closed yet: quiet placeholder bars, so the card keeps its shape without inventing results.
  if (results.length === 0) {
    const ghost = [3, 5, 2, 6, 4, 7, 3, 5, 4, 6].map((h, i) => ({ i, h }));
    return (
      <ResponsiveContainer height={72} width="100%">
        <BarChart data={ghost} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
          <Bar dataKey="h" fill="rgba(255,255,255,0.06)" isAnimationActive={false} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  }
  const data = results.map((pnl, i) => ({ i: i + 1, pnl }));
  return (
    <ResponsiveContainer height={72} width="100%">
      <BarChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
        <ReferenceLine stroke="rgba(255,255,255,0.15)" y={0} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.04)" }} formatter={(value) => [`${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(2)}%`, "Result"]} labelFormatter={(i) => `Trade ${i}`} />
        <Bar dataKey="pnl" maxBarSize={14} radius={[3, 3, 3, 3]}>
          {data.map((d) => (
            <Cell fill={d.pnl >= 0 ? UP : DOWN} key={d.i} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function PriceArea({ closes }: { closes: { t: number; c: number }[] }) {
  if (closes.length < 2) return <div className="h-[72px] animate-pulse rounded-lg bg-white/[0.03]" />;
  const values = closes.map((p) => p.c);
  const pad = (Math.max(...values) - Math.min(...values)) * 0.2 || values[0]! * 0.002;
  return (
    <ResponsiveContainer height={72} width="100%">
      <AreaChart data={closes} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id="priceFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={GOLD} stopOpacity={0.3} />
            <stop offset="100%" stopColor={GOLD} stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis domain={[Math.min(...values) - pad, Math.max(...values) + pad]} hide />
        <XAxis dataKey="t" hide />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ stroke: "rgba(255,255,255,0.2)" }}
          formatter={(value) => [Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 }), "Close"]}
          labelFormatter={(t) => new Date(Number(t)).toLocaleString()}
        />
        <Area activeDot={{ r: 4, fill: GOLD, stroke: "#191a15", strokeWidth: 2 }} dataKey="c" fill="url(#priceFill)" stroke={GOLD} strokeWidth={2} type="monotone" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
