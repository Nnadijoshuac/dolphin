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
    timeZone: "UTC",
  }).format(date);
}

export function PerformancePanel({ points, series }: PerformancePanelProps) {
  const dataPoints = points ?? series ?? [];

  if (dataPoints.length < 2) {
    return (
      <StatePanel
        body="This record does not contain enough sourced data points to plot a historical series."
        compact
        state="unavailable"
        title="No performance series yet"
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
    <figure className="border-y border-line py-6">
      <div className="flex items-center justify-between gap-4 text-xs font-medium">
        <span className="text-ink">Historical trajectory</span>
        <span className="text-muted">{dataPoints.length} sourced data points</span>
      </div>

      <div className="relative mt-6 bg-paper">
        <svg
          aria-label={`Performance series with ${dataPoints.length} sourced data points`}
          className="h-52 w-full overflow-visible"
          preserveAspectRatio="none"
          role="img"
          viewBox={`0 0 ${width} ${height}`}
        >
          {[0.25, 0.5, 0.75].map((position) => (
            <line
              key={position}
              stroke="#deddd4"
              strokeDasharray="3 5"
              strokeWidth="1"
              x1="0"
              x2={width}
              y1={height * position}
              y2={height * position}
            />
          ))}
          <line
            stroke="#c9c8bd"
            strokeWidth="1"
            x1="0"
            x2={width}
            y1={height - 1}
            y2={height - 1}
          />
          <path
            d={path}
            fill="none"
            stroke="#dba807"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="3"
          />
        </svg>
      </div>

      <figcaption className="mt-5 flex flex-col justify-between gap-2 border-t border-line pt-4 text-[0.7rem] leading-5 text-muted sm:flex-row">
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
                  className="font-medium text-accent-ink underline-offset-4 hover:underline"
                  href={source.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  {source.label}
                </Link>
              ) : (
                <span className="font-medium text-ink">{source.label}</span>
              )}
            </span>
          ))}
        </span>
      </figcaption>
    </figure>
  );
}
