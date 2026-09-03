"use client";

import Link from "next/link";

import { AgentIcon } from "@/components/agent-icon";
import { CategoryGlyph } from "@/components/category-glyph";
import { AGENT_CATEGORIES } from "@/constants/agents";
import type { Agent, LiveMetric, LiveMetricStatus } from "@/types/agent";

type AgentCardProps = {
  agent: Agent;
  className?: string;
};

type MetricPreview = {
  label: string;
  value: string | null;
  status: LiveMetricStatus;
  source: string;
  asOf: string | null;
};

function metricPreview<T>(
  label: string,
  metric: LiveMetric<T>,
  format: (value: T) => string,
): MetricPreview {
  const hasValue = metric.status === "live" || metric.status === "stale";

  return {
    label,
    value: hasValue ? format(metric.value) : null,
    status: metric.status,
    source: metric.source.label,
    asOf: metric.asOf,
  };
}

function getMetricPreview(agent: Agent): MetricPreview {
  switch (agent.liveStats.category) {
    case "rebalancing":
    case "grid-trading":
      return metricPreview(
        "Current P&L",
        agent.liveStats.currentPnl,
        (value) => value,
      );
    case "health-factor":
      return metricPreview(
        "Health factor",
        agent.liveStats.averageHealthFactor,
        (value) => value.toFixed(2),
      );
    case "yield":
      return metricPreview(
        "Current APY",
        agent.liveStats.currentApy,
        (value) => `${value.toFixed(2)}%`,
      );
    case "monitoring":
      return metricPreview(
        "Alert frequency",
        agent.liveStats.alertFrequency,
        (value) => value,
      );
    case "trading":
      return metricPreview(
        "Realized P&L",
        agent.liveStats.realizedPnl,
        (value) => value,
      );
  }
}

function formatCheckedAt(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

const statusLabels: Record<LiveMetricStatus, string> = {
  live: "Live",
  stale: "Stale",
  syncing: "Syncing",
  unavailable: "Not available",
};

export function AgentCard({ agent, className = "" }: AgentCardProps) {
  const categoryLabel =
    AGENT_CATEGORIES.find((category) => category.slug === agent.category)?.label ??
    "Monitoring";
  const preview = getMetricPreview(agent);
  const checkedAt = formatCheckedAt(preview.asOf);
  const displayPublisher = agent.publisher?.startsWith("0x")
    ? `${agent.publisher.slice(0, 6)}…${agent.publisher.slice(-4)}`
    : agent.publisher || "Publisher not listed";

  return (
    <Link
      className={`interactive group block border-t border-line py-5 no-underline first:border-t-0 sm:py-6 ${className}`}
      href={`/agent/${agent.tokenId}`}
    >
      <article className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)_170px_auto] sm:items-center sm:gap-5">
        <div className="flex items-start gap-4 sm:contents">
          <AgentIcon category={agent.category} size={56} uri={agent.iconUrl} />

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.69rem] font-semibold uppercase tracking-[0.09em] text-faint">
              <span>{categoryLabel}</span>
              <span aria-hidden="true">·</span>
              <span>ERC-8004 #{agent.tokenId}</span>
            </div>
            <h3 className="mt-1 text-lg font-semibold tracking-[-0.03em] text-ink transition-colors group-hover:text-accent-ink sm:text-xl">
              {agent.name}
            </h3>
            <p className="mt-1 line-clamp-2 max-w-2xl text-sm leading-6 text-muted">
              {agent.tagline}
            </p>
            <p className="mt-2 truncate text-xs text-faint">By {displayPublisher}</p>
          </div>
        </div>

        <div className="border-t border-line pt-4 sm:border-l sm:border-t-0 sm:py-1 sm:pl-5">
          <div className="flex items-center justify-between gap-3 sm:block">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-faint">
              {preview.label}
            </p>
            <p className="mt-1 text-base font-semibold tracking-[-0.02em] text-ink">
              {preview.value ?? statusLabels[preview.status]}
            </p>
          </div>
          <p className="mt-1 truncate text-[0.69rem] text-faint" title={preview.source}>
            {preview.source}
            {checkedAt ? ` · ${checkedAt}` : ""}
          </p>
        </div>

        <span
          aria-hidden="true"
          className="hidden text-muted transition-transform group-hover:translate-x-0.5 sm:block"
        >
          <CategoryGlyph color="currentColor" name="arrow-right" size={18} strokeWidth={2} />
        </span>
      </article>
    </Link>
  );
}
