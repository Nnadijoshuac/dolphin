"use client";

import { colors } from "@/constants/theme";
import type { AgentPerformancePoint } from "@/types/agent";

type PerformancePanelProps = {
  points: AgentPerformancePoint[];
};

function buildSvgPath(points: AgentPerformancePoint[], width: number, height: number): string {
  if (points.length === 0) return "";

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padding = 4;

  return points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * (width - padding * 2) + padding;
      const y = height - padding - ((point.value - min) / range) * (height - padding * 2);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function PerformancePanel({ points }: PerformancePanelProps) {
  if (points.length < 2) {
    return (
      <div
        className="rounded-2xl border px-6 py-8 text-center"
        style={{ backgroundColor: colors.surfaceSubtle, borderColor: colors.line }}
      >
        <p className="text-[15px] font-bold" style={{ color: colors.ink }}>
          No track record
        </p>
        <p className="mt-2 text-[13px] leading-5" style={{ color: colors.muted }}>
          Not enough data points to render a performance chart.
        </p>
      </div>
    );
  }

  const width = 320;
  const height = 100;
  const path = buildSvgPath(points, width, height);

  return (
    <div
      className="overflow-hidden rounded-2xl border p-4"
      style={{ backgroundColor: colors.surface, borderColor: colors.line }}
    >
      <svg
        className="w-full"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ height: 100 }}
      >
        <path
          d={path}
          fill="none"
          stroke={colors.gold}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <p className="mt-2 text-[11px]" style={{ color: colors.muted }}>
        {points.length} data points · Source: {points[0]?.source.label ?? "Unknown"}
      </p>
    </div>
  );
}
