"use client";

import Link from "next/link";

import { StatePanel } from "@/components/state-panel";
import type { AgentCategory, AgentPerformancePoint } from "@/types/agent";

type PerformancePanelProps = {
  points?: AgentPerformancePoint[];
  series?: AgentPerformancePoint[];
  category?: AgentCategory;
};

function buildSvgPath(
  points: AgentPerformancePoint[],
  width: number,
  height: number,
) {
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padding = 16;

  return points
    .map((point, index) => {
      const x =
        (index / (points.length - 1)) * (width - padding * 2) + padding;
      const y =
        height -
        padding -
        ((point.value - min) / range) * (height - padding * 2);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function PerformancePanel({ points, series }: PerformancePanelProps) {
  const dataPoints = points ?? series ?? [];

  if (dataPoints.length < 2) {
    return (
      <StatePanel
        body="This agent does not have enough on-chain data points yet to plot a historical performance series."
        compact
        state="unavailable"
        title="No Track Record Points Yet"
      />
    );
  }

  const width = 800;
  const height = 200;
  const path = buildSvgPath(dataPoints, width, height);
  const sources = Array.from(
    new Map(dataPoints.map((point) => [point.source.id, point.source])).values(),
  );

  return (
    <figure className="rounded-2xl border border-[#ECE8DE] bg-[#FBF9F4] p-6 shadow-sm">
      <div className="flex items-center justify-between border-b border-[#ECE8DE] pb-3 text-xs font-bold">
        <span className="text-[#111214]">Historical Trajectory</span>
        <span className="text-[#946B00]">{dataPoints.length} Auditable Samples</span>
      </div>

      <div className="relative mt-4">
        <svg
          aria-label={`Performance series with ${dataPoints.length} auditable data points`}
          className="h-48 w-full overflow-visible"
          preserveAspectRatio="none"
          role="img"
          viewBox={`0 0 ${width} ${height}`}
        >
          <line
            stroke="#ECE8DE"
            strokeWidth="1"
            x1="0"
            x2={width}
            y1={height - 1}
            y2={height - 1}
          />
          <path
            d={path}
            fill="none"
            stroke="#F5B300"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="4"
          />
        </svg>
      </div>

      <figcaption className="mt-4 flex flex-col justify-between gap-2 border-t border-[#ECE8DE] pt-3 text-[11px] text-[#6E706B] sm:flex-row">
        <span>
          Range: {formatDate(dataPoints[0].timestamp)} – {formatDate(dataPoints[dataPoints.length - 1].timestamp)}
        </span>
        <span>
          Data Source:{" "}
          {sources.map((source, index) => (
            <span key={source.id}>
              {index > 0 && ", "}
              {source.url ? (
                <Link
                  className="font-bold text-[#946B00] hover:underline"
                  href={source.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  {source.label}
                </Link>
              ) : (
                <span className="font-semibold text-[#111214]">{source.label}</span>
              )}
            </span>
          ))}
        </span>
      </figcaption>
    </figure>
  );
}
