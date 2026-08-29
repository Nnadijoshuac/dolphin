"use client";

import Link from "next/link";

import { StatePanel } from "@/components/state-panel";
import type { AgentPerformancePoint } from "@/types/agent";

type PerformancePanelProps = {
  points: AgentPerformancePoint[];
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
  const padding = 6;

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

export function PerformancePanel({ points }: PerformancePanelProps) {
  if (points.length < 2) {
    return (
      <StatePanel
        body="The current sources did not return enough auditable points to draw a performance series."
        compact
        state="unavailable"
        title="No chartable track record"
      />
    );
  }

  const width = 800;
  const height = 220;
  const path = buildSvgPath(points, width, height);
  const sources = Array.from(
    new Map(points.map((point) => [point.source.id, point.source])).values(),
  );

  return (
    <figure className="border-y border-[var(--line)] py-6">
      <svg
        aria-label={`Performance series with ${points.length} auditable data points`}
        className="h-56 w-full overflow-visible"
        preserveAspectRatio="none"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <line
          stroke="var(--line)"
          strokeWidth="1"
          x1="0"
          x2={width}
          y1={height - 1}
          y2={height - 1}
        />
        <path
          d={path}
          fill="none"
          stroke="var(--accent)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="4"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <figcaption className="mt-5 grid gap-3 text-xs leading-5 text-[var(--muted)] sm:grid-cols-[1fr_auto]">
        <span>
          {formatDate(points[0].timestamp)} to {formatDate(points.at(-1)!.timestamp)} / {points.length} points
        </span>
        <span className="sm:text-right">
          Source: {sources.map((source, index) => (
            <span key={source.id}>
              {index > 0 && ", "}
              {source.url ? (
                <Link
                  className="font-semibold text-[var(--ink-secondary)] underline decoration-[var(--line)] underline-offset-4"
                  href={source.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  {source.label}
                </Link>
              ) : (
                source.label
              )}
            </span>
          ))}
        </span>
      </figcaption>
    </figure>
  );
}
