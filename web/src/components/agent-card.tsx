"use client";

import Link from "next/link";

import { AgentIcon } from "@/components/agent-icon";
import { CategoryGlyph } from "@/components/category-glyph";
import { SignalStrip } from "@/components/signal-strip";
import { categoryLabel } from "@/constants/agents";
import type { AgentSignals } from "@/hooks/use-agents";
import { track, type AnalyticsSurface } from "@/lib/analytics";
import type { Agent, LiveMetric, LiveMetricStatus } from "@/types/agent";

type AgentCardProps = {
  agent: Agent;
  className?: string;
  /** Where this card is rendered, for the click event. */
  surface?: AnalyticsSurface;
  /**
   * Hire and review signals, from the batched `useAgentSignals` query. Optional
   * because a caller that has not loaded them yet should render the card rather
   * than wait, and undefined renders nothing at all.
   */
  signals?: AgentSignals;
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

/**
 * The one headline metric a card shows, or null when the category has none.
 *
 * Switches on `liveStats.category` - the CLOSED discriminant of the stats union
 * - rather than on `agent.category`, which is an open string as of 2026-09-07.
 * The two are different questions: an agent's drawer can be anything, while a
 * live metric only exists where a protocol reader was written for it.
 *
 * Null is now a real, common answer. A `research` or `security` agent has no
 * protocol holding a number about it, so the card shows no metric strip rather
 * than an empty one implying a feed that has gone quiet.
 */
function getMetricPreview(agent: Agent): MetricPreview | null {
  const stats = agent.liveStats;
  if (!stats) return null;

  switch (stats.category) {
    case "rebalancing":
    case "grid-trading":
      return metricPreview("Current P&L", stats.currentPnl, (value) => value);
    case "health-factor":
      return metricPreview("Health factor", stats.averageHealthFactor, (value) =>
        value.toFixed(2),
      );
    case "yield":
      return metricPreview("Current APY", stats.currentApy, (value) => `${value.toFixed(2)}%`);
    case "monitoring":
      return metricPreview("Alert frequency", stats.alertFrequency, (value) => value);
    case "trading":
      return metricPreview("Realized P&L", stats.realizedPnl, (value) => value);
    default:
      return null;
  }
}


/**
 * WHAT THE RIGHT-HAND COLUMN SAYS WHEN THERE IS NO LIVE METRIC.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS REPLACED THE METRIC AS THE DEFAULT (2026-09-12)
 * ---------------------------------------------------------------------------
 * The column led with the category's headline metric, and that metric is
 * `unavailable` for very nearly every agent in the catalog - no protocol
 * publishes a live APY or P&L per agent. So a browse list rendered a column of
 * "Not available / Publisher-reported metadata", forty-three times. Each cell
 * was honest and the column as a whole read as broken.
 *
 * §5 says never invent a number. It does not say a screen must lead with the
 * one field that is always missing. What Dolphin actually knows about every
 * agent - how it is used, what it costs, whether it can act - was sitting
 * unshown while the one unknowable thing had the prime slot.
 *
 * So: price and protocol lead, a real metric takes over when there IS one, and
 * nothing here is fabricated - the price comes from the agent's own signed
 * quote, and the capability from its own published tool list.
 */
function getHireSummary(agent: Agent): { label: string; value: string; detail: string } {
  return agent.protocol === "mcp"
    ? {
        label: "Type",
        value: "MCP server",
        detail: "Connect it to your AI client and call its tools",
      }
    : {
        label: "Type",
        value: "A2A agent",
        detail: "Commissioned and paid over ERC-8183 escrow",
      };
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


export function AgentCard({
  agent,
  className = "",
  surface = "search",
  signals,
}: AgentCardProps) {
  /*
   * `categoryLabel()` is TOTAL. This looked the slug up in a hardcoded list of
   * five and fell back to the literal string "Monitoring" - so every research,
   * security, payments, content, automation and `general` agent in the catalog
   * was labelled "Monitoring" on its card. A wrong label is worse than a
   * derived one: it is a claim about what the agent does.
   */
  const label = categoryLabel(agent.category);
  const preview = getMetricPreview(agent);
  const hire = getHireSummary(agent);
  const checkedAt = preview ? formatCheckedAt(preview.asOf) : null;
  const displayPublisher = agent.publisher?.startsWith("0x")
    ? `${agent.publisher.slice(0, 6)}…${agent.publisher.slice(-4)}`
    : agent.publisher || "Publisher not listed";

  return (
    <Link
      className={`interactive group block border-t border-line py-5 no-underline first:border-t-0 sm:py-6 ${className}`}
      href={`/agent/${agent.tokenId}`}
      onClick={() =>
        track("agent_card_opened", {
          agentKey: agent.agentKey,
          category: agent.category,
          surface,
        })
      }
    >
      <article className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)_170px_auto] sm:items-center sm:gap-5">
        <div className="flex items-start gap-4 sm:contents">
          <AgentIcon category={agent.category} seed={agent.iconSeed} size={56} uri={agent.iconUrl} />

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.69rem] font-semibold uppercase tracking-[0.09em] text-faint">
              <span>{label}</span>
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
            {/*
             * The comparison signal, on the surface where comparison happens.
             * Renders nothing for an agent with no history - see signal-strip.
             */}
            <SignalStrip className="mt-2" signals={signals} />
          </div>
        </div>

        <div className="border-t border-line pt-4 sm:border-l sm:border-t-0 sm:py-1 sm:pl-5">
          {/*
            A live metric wins when one exists, because a real number about
            THIS agent beats a fact about its protocol. Otherwise the column
            says what is actually known - see getHireSummary.
          */}
          {preview && preview.value !== null ? (
            <>
              <div className="flex items-center justify-between gap-3 sm:block">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-faint">
                  {preview.label}
                </p>
                <p className="mt-1 text-base font-semibold tracking-[-0.02em] text-ink">
                  {preview.value}
                </p>
              </div>
              <p className="mt-1 truncate text-[0.69rem] text-faint" title={preview.source}>
                {preview.source}
                {checkedAt ? ` · ${checkedAt}` : ""}
              </p>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 sm:block">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-faint">
                  {hire.label}
                </p>
                <p className="mt-1 text-base font-semibold tracking-[-0.02em] text-ink">
                  {hire.value}
                </p>
              </div>
              <p className="mt-1 truncate text-[0.69rem] text-faint" title={hire.detail}>
                {hire.detail}
              </p>
            </>
          )}
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
