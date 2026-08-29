"use client";

import Link from "next/link";

import { AgentIcon } from "@/components/agent-icon";
import { MetricCell } from "@/components/metric-cell";
import { PerformancePanel } from "@/components/performance-panel";
import { StatePanel } from "@/components/state-panel";
import { StatusBadge } from "@/components/status-badge";
import { useAgentCategoryStats } from "@/hooks/use-category-stats";
import { convexClient } from "@/providers/convex-provider";
import type {
  Agent,
  AgentCategory,
  AgentLiveStats,
  LiveMetric,
} from "@/types/agent";

const categoryLabels: Record<AgentCategory, string> = {
  monitoring: "Monitoring",
  rebalancing: "Rebalancing",
  "grid-trading": "Grid trading",
  "health-factor": "Health factor",
  yield: "Yield",
};

function shortAddress(value: string | null) {
  if (!value) return "Not reported";
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function formatList(values: string[]) {
  return values.length > 0 ? values.join(", ") : "None";
}

function formatDate(value: string | null) {
  if (!value) return "Not reported";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function DetailSection({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-7 border-t border-[var(--line)] py-12 lg:grid-cols-[180px_minmax(0,1fr)] lg:gap-12">
      <header>
        <h2 className="text-base font-bold tracking-[-0.025em] text-[var(--ink)]">
          {title}
        </h2>
        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{summary}</p>
      </header>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/**
 * Every metric of a category starts as syncing while the Convex read is in
 * flight. Unavailable is reserved for a completed read that found no source.
 */
function syncingLiveStats(stats: AgentLiveStats): AgentLiveStats {
  return Object.fromEntries(
    Object.entries(stats).map(([key, field]) =>
      key === "category"
        ? [key, field]
        : [
            key,
            {
              status: "syncing",
              value: null,
              asOf: null,
              source: (field as LiveMetric<unknown>).source,
            },
          ],
    ),
  ) as AgentLiveStats;
}

/**
 * Live signals use the same Convex categoryStats rows and refresh action as
 * mobile. The catalog's unavailable stub is used only when Convex itself is
 * not configured.
 */
function LiveStats({ agent }: { agent: Agent }) {
  if (!convexClient) {
    return <LiveStatsView stats={agent.liveStats} />;
  }

  return <BackendLiveStats agent={agent} />;
}

function BackendLiveStats({ agent }: { agent: Agent }) {
  const cached = useAgentCategoryStats(
    agent.tokenId,
    agent.category,
    agent.agentWallet,
  );
  const stats = cached?.stats ?? syncingLiveStats(agent.liveStats);

  return <LiveStatsView stats={stats} />;
}

function LiveStatsView({ stats }: { stats: AgentLiveStats }) {
  return (
    <div className="grid border-b border-[var(--line)] sm:grid-cols-2 sm:[&>*:nth-child(odd)]:border-r">
      {stats.category === "monitoring" && (
        <>
          <MetricCell
            format={(value) => value}
            label="Alert frequency"
            metric={stats.alertFrequency}
          />
          <MetricCell
            format={formatList}
            label="Assets watched"
            metric={stats.assetsWatched}
          />
          <MetricCell
            format={(value) => value}
            label="Last alert"
            metric={stats.lastAlertAt}
          />
          <MetricCell
            format={(value) => `${value.toFixed(1)}%`}
            label="False positives"
            metric={stats.falsePositiveRate}
          />
        </>
      )}

      {stats.category === "rebalancing" && (
        <>
          <MetricCell
            format={(value) => `${value.toFixed(1)}%`}
            label="Win rate"
            metric={stats.winRate}
          />
          <MetricCell
            format={(value) => value}
            label="Active LP range"
            metric={stats.activeRange}
          />
          <MetricCell
            format={(value) => value}
            label="Current P&L"
            metric={stats.currentPnl}
          />
          <MetricCell
            format={(value) => value.toLocaleString()}
            label="LP positions"
            metric={stats.positionCount}
          />
          <MetricCell
            format={(value) => value}
            label="Track-record period"
            metric={stats.trackRecordPeriod}
          />
        </>
      )}

      {stats.category === "grid-trading" && (
        <>
          <MetricCell
            format={(value) => `${value.toFixed(1)}%`}
            label="Win rate"
            metric={stats.winRate}
          />
          <MetricCell
            format={(value) => value}
            label="Price range"
            metric={stats.activeRange}
          />
          <MetricCell
            format={(value) => value}
            label="Current P&L"
            metric={stats.currentPnl}
          />
          <MetricCell
            format={(value) => value.toLocaleString()}
            label="Grid levels"
            metric={stats.positionCount}
          />
          <MetricCell
            format={(value) => value}
            label="Track-record period"
            metric={stats.trackRecordPeriod}
          />
        </>
      )}

      {stats.category === "health-factor" && (
        <>
          <MetricCell
            format={(value) => value.toLocaleString()}
            label="Positions watched"
            metric={stats.positionsMonitored}
          />
          <MetricCell
            format={(value) => value.toFixed(2)}
            label="Average health factor"
            metric={stats.averageHealthFactor}
          />
          <MetricCell
            format={(value) => value.toLocaleString()}
            label="Liquidations prevented"
            metric={stats.liquidationsPrevented}
          />
          <MetricCell
            format={(value) => `${value} ms`}
            label="Response latency"
            metric={stats.responseLatencyMs}
          />
        </>
      )}

      {stats.category === "yield" && (
        <>
          <MetricCell
            format={(value) => `${value.toFixed(2)}%`}
            label="Current APY"
            metric={stats.currentApy}
          />
          <MetricCell
            format={(value) => `$${value.toLocaleString()}`}
            label="TVL managed"
            metric={stats.tvlManagedUsd}
          />
          <MetricCell
            format={formatList}
            label="Protocols"
            metric={stats.protocolsUsed}
          />
          <MetricCell
            format={(value) => value}
            label="Vault rebalance cadence"
            metric={stats.rebalanceFrequency}
          />
        </>
      )}
    </div>
  );
}

export function AgentDetail({ agent }: { agent: Agent }) {
  const registeredMetric = agent.registryVerification.registered;
  const isRegistryVerified =
    registeredMetric.status === "live" && registeredMetric.value;

  return (
    <article className="min-w-0">
      <header className="pb-12 sm:pb-16">
        <div className="flex flex-wrap items-start justify-between gap-7">
          <AgentIcon category={agent.category} size={84} uri={agent.iconUrl} />
          <div className="flex flex-wrap gap-2">
            <StatusBadge label={categoryLabels[agent.category]} tone="neutral" />
            <StatusBadge
              label={
                isRegistryVerified
                  ? "Registry verified"
                  : registeredMetric.status === "live"
                    ? "Not registered"
                    : `Registry ${registeredMetric.status}`
              }
              tone={isRegistryVerified ? "live" : registeredMetric.status}
            />
          </div>
        </div>

        <h1 className="text-balance mt-9 max-w-4xl text-5xl font-black leading-[0.92] tracking-[-0.065em] text-[var(--ink)] sm:text-7xl">
          {agent.name}
        </h1>
        <p className="mt-5 text-sm font-semibold text-[var(--muted)]">
          Published by {agent.publisher}
        </p>
        <p className="text-pretty mt-7 max-w-3xl text-lg leading-8 text-[var(--ink-secondary)] sm:text-xl sm:leading-9">
          {agent.tagline}
        </p>

        <div className="mt-10 grid border-y border-[var(--line)] sm:grid-cols-3">
          {[
            ["Registry token", `#${agent.tokenId}`],
            ["Network", "BNB Smart Chain / 56"],
            ["Catalog status", agent.recordStatus.replaceAll("-", " ")],
          ].map(([label, value]) => (
            <div
              className="border-b border-[var(--line)] py-5 last:border-b-0 sm:border-b-0 sm:border-r sm:px-5 sm:first:pl-0 sm:last:border-r-0 sm:last:pr-0"
              key={label}
            >
              <p className="text-[10px] font-bold tracking-[0.1em] text-[var(--faint)]">
                {label.toUpperCase()}
              </p>
              <p className="mt-2 truncate text-sm font-bold capitalize text-[var(--ink)]">
                {value}
              </p>
            </div>
          ))}
        </div>
      </header>

      <DetailSection
        summary="Status, source, freshness, methodology, and missing-data reasons stay attached."
        title="Live signals"
      >
        <LiveStats agent={agent} />
      </DetailSection>

      <DetailSection
        summary="Only auditable points supplied by the current data sources can draw this chart."
        title="Track record"
      >
        <PerformancePanel points={agent.performanceSeries} />
      </DetailSection>

      <DetailSection
        summary="Publisher description, declared skills, and service endpoints."
        title="Agent method"
      >
        <p className="text-pretty text-base leading-8 text-[var(--ink-secondary)]">
          {agent.description}
        </p>

        <div className="mt-8 border-b border-[var(--line)]">
          <div className="grid gap-3 border-t border-[var(--line)] py-5 sm:grid-cols-[150px_1fr]">
            <h3 className="text-xs font-bold text-[var(--muted)]">Skills</h3>
            <div className="flex flex-wrap gap-2">
              {agent.skills.length > 0 ? (
                agent.skills.map((skill) => (
                  <StatusBadge
                    key={`${skill.name}-${skill.evidence}`}
                    label={`${skill.name} / ${skill.evidence.replaceAll("-", " ")}`}
                    tone={skill.evidence === "verified" ? "live" : "neutral"}
                  />
                ))
              ) : (
                <span className="text-sm text-[var(--faint)]">
                  No skills published
                </span>
              )}
            </div>
          </div>

          <div className="grid gap-3 border-t border-[var(--line)] py-5 sm:grid-cols-[150px_1fr]">
            <h3 className="text-xs font-bold text-[var(--muted)]">
              Service endpoints
            </h3>
            {agent.services.length > 0 ? (
              <div className="space-y-4">
                {agent.services.map((service) => (
                  <div className="min-w-0" key={`${service.name}-${service.endpoint}`}>
                    <p className="text-sm font-bold text-[var(--ink)]">
                      {service.name}
                      {service.version ? ` / ${service.version}` : ""}
                    </p>
                    <p className="mt-1 break-all font-mono text-[11px] leading-5 text-[var(--muted)]">
                      {service.endpoint}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <span className="text-sm text-[var(--faint)]">
                No service endpoints published
              </span>
            )}
          </div>
        </div>
      </DetailSection>

      <DetailSection
        summary="A direct BSC registry read is shown separately from indexed catalog metadata."
        title="Registry verification"
      >
        <div className="grid border-b border-[var(--line)] sm:grid-cols-2 sm:[&>*:nth-child(odd)]:border-r">
          <MetricCell
            format={(value) => (value ? "Registered" : "Not registered")}
            label="Registration"
            metric={agent.registryVerification.registered}
          />
          <MetricCell
            format={shortAddress}
            label="Registry owner"
            metric={agent.registryVerification.owner}
          />
          <MetricCell
            format={(value) => value}
            label="Token URI"
            metric={agent.registryVerification.tokenUri}
          />
          <MetricCell
            format={shortAddress}
            label="Agent wallet"
            metric={agent.registryVerification.agentWallet}
          />
        </div>

        <dl className="mt-8 border-b border-[var(--line)]">
          {[
            ["Identity registry", shortAddress(agent.registryAddress)],
            ["Indexed publisher", shortAddress(agent.publisherAddress)],
            ["Indexed agent wallet", shortAddress(agent.agentWallet)],
            ["Indexed registration", formatDate(agent.registeredAt)],
            ["Classification", agent.classificationSource.replaceAll("-", " ")],
            ["Classification confidence", agent.classificationConfidence ?? "Not applicable"],
          ].map(([label, value]) => (
            <div
              className="grid gap-2 border-t border-[var(--line)] py-4 sm:grid-cols-[180px_1fr]"
              key={label}
            >
              <dt className="text-xs text-[var(--muted)]">{label}</dt>
              <dd className="min-w-0 break-words text-sm font-semibold capitalize text-[var(--ink)] sm:text-right">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </DetailSection>

      <DetailSection
        summary="Execution claims require a returned event and keep their originating source."
        title="Recent activity"
      >
        {agent.recentActivity.length > 0 ? (
          <div className="border-b border-[var(--line)]">
            {agent.recentActivity.map((activity) => (
              <article
                className="grid gap-3 border-t border-[var(--line)] py-5 sm:grid-cols-[1fr_auto]"
                key={`${activity.timestamp}-${activity.action}`}
              >
                <div>
                  <h3 className="text-sm font-bold text-[var(--ink)]">
                    {activity.action}
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                    {formatDate(activity.timestamp)} / {activity.source.label}
                  </p>
                </div>
                {activity.txHash && (
                  <Link
                    className="text-xs font-bold text-[var(--accent-ink)]"
                    href={`https://bscscan.com/tx/${activity.txHash}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    View transaction
                  </Link>
                )}
              </article>
            ))}
          </div>
        ) : (
          <StatePanel
            body="No auditable execution events were returned by the current data sources."
            compact
            state="unavailable"
            title="Activity not published"
          />
        )}
      </DetailSection>

      <DetailSection
        summary="The profile names every upstream registry, index, publisher, and Dolphin policy source it uses."
        title="Source ledger"
      >
        <div className="border-b border-[var(--line)]">
          {agent.sourceLabels.map((source) => (
            <div
              className="grid gap-2 border-t border-[var(--line)] py-4 sm:grid-cols-[1fr_auto] sm:items-center"
              key={source.id}
            >
              <div>
                <p className="text-sm font-bold text-[var(--ink)]">
                  {source.label}
                </p>
                <p className="mt-1 font-mono text-[10px] text-[var(--faint)]">
                  {source.id}
                </p>
              </div>
              {source.url ? (
                <Link
                  className="text-xs font-bold text-[var(--accent-ink)]"
                  href={source.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open source
                </Link>
              ) : (
                <span className="text-xs text-[var(--faint)]">No public URL</span>
              )}
            </div>
          ))}
        </div>
      </DetailSection>
    </article>
  );
}
