"use client";

import { ByDolphin } from "@/components/by-dolphin";
import Link from "next/link";

import { AgentIcon } from "@/components/agent-icon";
import { priceLabel } from "@/components/agent-shelf";
import { FavoriteButton } from "@/components/favorite-button";
import { SignalStrip } from "@/components/signal-strip";
import { categoryLabel } from "@/constants/agents";
import type { AgentSignals } from "@/hooks/use-agents";
import { useImpression } from "@/hooks/use-impression";
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
 * WHAT YOU GET AND WHAT IT COSTS - the line a catalog card leads with.
 *
 * Owner, 2026-09-29: the old rows "don't really say anything". A card now
 * answers the two questions someone browsing has: can I hire it or call it,
 * and at what price. Nothing here is invented: the price is the agent's own
 * signed quote (priceLabel), and a hire agent with no published quote says the
 * price comes at checkout - which is what the hire flow actually does.
 */
function getOffer(agent: Agent): { kind: string; price: string | null; unit: string } {
  if (agent.protocol === "mcp") return { kind: "Tools", price: null, unit: "Call its tools directly" };
  const price = priceLabel(agent);
  if (price === "Free") return { kind: "Hire", price: "Free", unit: "per job" };
  return price ? { kind: "Hire", price, unit: "per job" } : { kind: "Hire", price: null, unit: "Price quoted at checkout" };
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
  // The agent's own price (owner, 2026-10-04): network fees are shown at the hire step, not folded in here.
  const offer = getOffer(agent);
  const displayPublisher = agent.publisher?.startsWith("0x")
    ? `${agent.publisher.slice(0, 6)}…${agent.publisher.slice(-4)}`
    : agent.publisher || null;
  const impressionRef = useImpression<HTMLAnchorElement>(agent.agentKey);

  return (
    <div className={`catalog-card ${className}`}>
      <Link
        className="catalog-card__link"
        href={`/agent/${agent.tokenId}`}
        ref={impressionRef}
        onClick={() =>
          track("agent_card_opened", {
            agentKey: agent.agentKey,
            category: agent.category,
            surface,
          })
        }
      >
        <article className="flex h-full flex-col">
          <div className="flex items-start gap-3 pr-10">
            <AgentIcon category={agent.category} seed={agent.iconSeed} size={44} uri={agent.iconUrl} />
            <div className="min-w-0 flex-1">
              <h3 className="flex min-w-0 items-center text-[0.98rem] font-semibold tracking-[-0.02em] text-ink">
                <span className="truncate">{agent.name}</span>
                {agent.firstParty ? <ByDolphin /> : null}
              </h3>
              <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[0.74rem] text-muted">
                <span className="catalog-card__kind" data-kind={agent.protocol}>
                  {offer.kind}
                </span>
                <span className="truncate">{label}</span>
              </p>
            </div>
          </div>

          <p className="mt-3.5 line-clamp-2 min-h-10 text-[0.84rem] leading-5 text-ink-soft">{agent.tagline}</p>
          <SignalStrip className="catalog-card__signals mt-2.5" signals={signals} verifiedAt={agent.verifiedAt} />

          <div className="mt-auto flex items-end justify-between gap-3 pt-4">
            <div className="min-w-0">
              {preview && preview.value !== null ? (
                <p className="text-[0.72rem] text-muted">{preview.label}</p>
              ) : null}
              <p className="flex items-baseline gap-1.5">
                {preview && preview.value !== null ? (
                  <span className="text-[1.02rem] font-semibold tracking-[-0.02em] text-ink">{preview.value}</span>
                ) : offer.price ? (
                  <>
                    <span className="text-[1.02rem] font-semibold tracking-[-0.02em] text-ink">{offer.price}</span>
                    <span className="text-[0.74rem] text-muted">{offer.unit}</span>
                  </>
                ) : (
                  <span className="text-[0.8rem] font-medium text-ink">{offer.unit}</span>
                )}
              </p>
            </div>
            {displayPublisher ? (
              <span className="shrink-0 truncate text-[0.7rem] text-faint">by {displayPublisher}</span>
            ) : null}
          </div>
        </article>
      </Link>
      <FavoriteButton agentKey={agent.agentKey} agentName={agent.name} className="catalog-card__fav" />
    </div>
  );
}
