"use client";

import Link from "next/link";
import { useQuery } from "convex/react";

import { StatePanel } from "@/components/state-panel";
import { categoryStatsApi } from "@/convex/api";
import { statsCategoryFor } from "@/hooks/use-category-stats";
import { convexClient } from "@/providers/convex-provider";
import type { Agent } from "@/types/agent";

/**
 * THE CHART, GIVEN A REAL SOURCE.
 *
 * ===========================================================================
 * WHAT WAS WRONG (2026-09-08)
 * ===========================================================================
 * This component read `agent.performanceSeries`. convex/lib/publicAgent.ts sets
 * that field to `[] as never[]` on every agent it returns, and this panel needs
 * two points to draw one. So every agent page on this site rendered
 *
 *     "No performance series yet"
 *
 * permanently, for all of them, and the SVG path builder below was code that
 * had never once executed. project-scope.md SS4 made this chart the centrepiece
 * of the product page - "screenshot carousel -> live performance charts" - and
 * what shipped was a titled section containing a standing apology.
 *
 * The honest options were to source it or to delete the section. It is sourced:
 * `agentStatsHistory` has been accumulating real observations since 2026-09-06.
 * Each point is ONE protocol read at the timestamp it was taken, carrying the
 * same source label the metric carried. Nothing is interpolated, nothing is
 * backfilled, and there is no synthetic origin point.
 *
 * ===========================================================================
 * AN EMPTY CHART IS STILL POSSIBLE, AND NOW IT MEANS SOMETHING
 * ===========================================================================
 * Two different empty states, because they are two different facts:
 *
 *   NO WIRED METRIC   The category has no single number worth charting over
 *                     time. grid-trading, trading and monitoring are all
 *                     unavailable at source, so a chart of them would be a
 *                     chart of nothing. These get no chart and say why.
 *
 *   NOT YET OBSERVED  The category HAS a chartable metric and this agent has
 *                     been read fewer than twice. That is a genuinely empty
 *                     chart and the sentence describing it is now true, which
 *                     it was not before.
 */

type PerformancePoint = {
  timestamp: string;
  value: number;
  source: { id: string; label: string; url?: string };
};

function buildSvgPath(points: PerformancePoint[], width: number, height: number) {
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padding = 16;

  return points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * (width - padding * 2) + padding;
      const y =
        height - padding - ((point.value - min) / range) * (height - padding * 2);
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

export function PerformancePanel({ agent }: { agent: Agent }) {
  const statsCategory = statsCategoryFor(agent.category);

  if (!statsCategory) {
    return (
      <StatePanel
        body="No protocol reader is wired for this category, so Dolphin takes no timed measurement of this agent and has nothing to plot. A chart of an unmeasured value would be a chart of nothing."
        compact
        state="unavailable"
        title="No charted metric for this category"
      />
    );
  }

  if (!convexClient) {
    return (
      <StatePanel
        body="The observation history lives in the shared backend, which is not configured for this deployment."
        compact
        state="unavailable"
        title="History unavailable"
      />
    );
  }

  return <BackendPerformancePanel agent={agent} />;
}

function BackendPerformancePanel({ agent }: { agent: Agent }) {
  /*
   * Narrowed again inside the component. `statsCategoryFor` was already called
   * by the parent, but calling it here keeps this component independently
   * correct rather than relying on a caller's guard - and the parent's early
   * returns mean the hook order below is stable regardless.
   */
  const statsCategory = statsCategoryFor(agent.category);
  const history = useQuery(
    categoryStatsApi.categoryStats.getAgentStatsHistory,
    statsCategory ? { agentKey: agent.agentKey, category: statsCategory } : "skip",
  );

  if (history === undefined) {
    return <div className="skeleton h-60 w-full rounded-xl" />;
  }

  const dataPoints = history.points;

  if (dataPoints.length < 2) {
    return (
      <StatePanel
        body={
          dataPoints.length === 1
            ? "Dolphin has taken one measurement of this agent. A second one draws the first line — each point is a real protocol read, so this fills in as the agent is observed rather than all at once."
            : "Dolphin has not measured this agent yet. Points are recorded when its record is opened, at most once an hour, and every one of them is a real on-chain read."
        }
        compact
        state="empty"
        title={
          dataPoints.length === 1
            ? "One observation so far"
            : "No observations yet"
        }
      />
    );
  }

  const width = 800;
  const height = 200;
  const path = buildSvgPath(dataPoints, width, height);
  const values = dataPoints.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const sources = Array.from(
    new Map(dataPoints.map((point) => [point.source.id, point.source])).values(),
  );

  return (
    <figure className="border-y border-line py-6">
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-medium">
        <span className="text-ink">{history.metricLabel ?? "Observed value"}</span>
        <span className="text-muted">
          {dataPoints.length} observations · {min.toFixed(2)} to {max.toFixed(2)}
        </span>
      </div>

      <div className="relative mt-6 bg-paper">
        <svg
          aria-label={`${history.metricLabel ?? "Observed value"} across ${dataPoints.length} readings, ranging from ${min.toFixed(2)} to ${max.toFixed(2)}`}
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
          {formatDate(dataPoints[0].timestamp)} –{" "}
          {formatDate(dataPoints[dataPoints.length - 1].timestamp)}
        </span>
        <span>
          Read from:{" "}
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
