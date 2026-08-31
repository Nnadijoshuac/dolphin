"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { AgentIcon } from "@/components/agent-icon";
import { CategoryGlyph } from "@/components/category-glyph";
import { HireAction } from "@/components/hire-action";
import { MetricCell } from "@/components/metric-cell";
import { PerformancePanel } from "@/components/performance-panel";
import { StatePanel } from "@/components/state-panel";
import { useAgentCategoryStats } from "@/hooks/use-category-stats";
import { convexClient } from "@/providers/convex-provider";
import { assessAuthorizationCapability } from "@/services/authorization";
import type {
  Agent,
  AgentCategory,
  AgentLiveStats,
  LiveMetric,
} from "@/types/agent";
import { sessionPolicyFor } from "@/wallet/altana-policy";

const categoryLabels: Record<AgentCategory, string> = {
  monitoring: "Monitoring",
  rebalancing: "Rebalancing",
  "grid-trading": "Grid trading",
  "health-factor": "Health factor",
  yield: "Yield",
};

function shortAddress(value: string | null) {
  if (!value) return "Not published";
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function formatList(values: string[]) {
  return values.length > 0 ? values.join(", ") : "None";
}

function formatDate(value: string | null) {
  if (!value) return "Not published";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

function metricValue<T>(metric: LiveMetric<T>, format: (value: T) => string) {
  if (metric.status === "live" || metric.status === "stale") {
    return format(metric.value);
  }

  return metric.status === "syncing" ? "Syncing" : "Not available";
}

function DetailSection({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-line py-9 sm:py-12">
      <div className="grid gap-6 lg:grid-cols-[190px_minmax(0,1fr)] lg:gap-10">
        <header>
          <h2 className="text-lg font-semibold tracking-[-0.03em] text-ink">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-muted">{summary}</p>
        </header>
        <div className="min-w-0">{children}</div>
      </div>
    </section>
  );
}

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
    <div className="grid border-l border-t border-line sm:grid-cols-2">
      {stats.category === "monitoring" ? (
        <>
          <MetricCell
            format={(value) => value}
            label="Alert frequency"
            metric={stats.alertFrequency}
          />
          <MetricCell format={formatList} label="Assets watched" metric={stats.assetsWatched} />
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
      ) : null}

      {stats.category === "rebalancing" ? (
        <>
          <MetricCell
            format={(value) => `${value.toFixed(1)}%`}
            label="Historical win rate"
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
            format={(value) => String(value)}
            label="LP positions monitored"
            metric={stats.positionCount}
          />
        </>
      ) : null}

      {stats.category === "grid-trading" ? (
        <>
          <MetricCell
            format={(value) => `${value.toFixed(1)}%`}
            label="Historical win rate"
            metric={stats.winRate}
          />
          <MetricCell
            format={(value) => value}
            label="Active grid range"
            metric={stats.activeRange}
          />
          <MetricCell
            format={(value) => value}
            label="Current P&L"
            metric={stats.currentPnl}
          />
          <MetricCell
            format={(value) => String(value)}
            label="Positions monitored"
            metric={stats.positionCount}
          />
        </>
      ) : null}

      {stats.category === "health-factor" ? (
        <>
          <MetricCell
            format={(value) => value.toFixed(2)}
            label="Venus health factor"
            metric={stats.averageHealthFactor}
          />
          <MetricCell
            format={(value) => String(value)}
            label="Loan positions monitored"
            metric={stats.positionsMonitored}
          />
          <MetricCell
            format={(value) => String(value)}
            label="Liquidations prevented"
            metric={stats.liquidationsPrevented}
          />
          <MetricCell
            format={(value) => `${value}ms`}
            label="Response latency"
            metric={stats.responseLatencyMs}
          />
        </>
      ) : null}

      {stats.category === "yield" ? (
        <>
          <MetricCell
            format={(value) => `${value.toFixed(2)}%`}
            label="Current APY"
            metric={stats.currentApy}
          />
          <MetricCell
            format={(value) => `$${(value / 1e6).toFixed(2)}M`}
            label="Total value managed"
            metric={stats.tvlManagedUsd}
          />
          <MetricCell
            format={formatList}
            label="Protocols used"
            metric={stats.protocolsUsed}
          />
          <MetricCell
            format={(value) => value}
            label="Rebalance cadence"
            metric={stats.rebalanceFrequency}
          />
        </>
      ) : null}
    </div>
  );
}

export function AgentDetail({ agent }: { agent: Agent }) {
  const registryStatus = agent.registryVerification.registered;
  const isRegistryVerified =
    (registryStatus.status === "live" || registryStatus.status === "stale") &&
    registryStatus.value;
  const access = assessAuthorizationCapability(agent.category, "read_only_hire");
  const sessionPolicy = sessionPolicyFor(agent.category);

  return (
    <div className="site-frame pb-16 pt-7 sm:pb-24 sm:pt-10">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <Link className="interactive hover:text-ink" href="/">
          Discover
        </Link>
        <span aria-hidden="true">/</span>
        <Link
          className="interactive hover:text-ink"
          href={`/search?category=${agent.category}`}
        >
          {categoryLabels[agent.category]}
        </Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page" className="text-ink">
          {agent.name}
        </span>
      </nav>

      <header className="border-b border-line pb-10 pt-8 sm:pb-14 sm:pt-12">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.45fr)] lg:items-end">
          <div>
            <div className="flex items-center gap-4 sm:gap-5">
              <AgentIcon category={agent.category} size={76} uri={agent.iconUrl} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-faint">
                  <span>{categoryLabels[agent.category]}</span>
                  <span aria-hidden="true">·</span>
                  <span>ERC-8004 #{agent.tokenId}</span>
                </div>
                <h1 className="mt-2 text-balance text-4xl font-semibold tracking-[-0.055em] text-ink sm:text-6xl">
                  {agent.name}
                </h1>
              </div>
            </div>
            <p className="body-copy mt-7 max-w-[64ch]">{agent.tagline}</p>
            <p className="mt-5 break-all text-xs leading-5 text-faint">
              Publisher <span className="font-mono text-muted">{agent.publisher}</span>
            </p>
          </div>

          <dl className="grid grid-cols-2 border-l border-t border-line text-sm">
            <div className="border-b border-r border-line p-4">
              <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-faint">
                Registry
              </dt>
              <dd className="mt-2 flex items-center gap-2 font-medium text-ink">
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 rounded-full ${
                    isRegistryVerified ? "bg-success" : "bg-faint"
                  }`}
                />
                {isRegistryVerified
                  ? "Verified on-chain"
                  : registryStatus.status === "syncing"
                    ? "Checking"
                    : "Not verified in this request"}
              </dd>
            </div>
            <div className="border-b border-r border-line p-4">
              <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-faint">
                Reputation
              </dt>
              <dd className="mt-2 font-medium text-ink">
                {metricValue(agent.reputationScore, (value) => String(value))}
              </dd>
            </div>
            <div className="border-b border-r border-line p-4">
              <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-faint">
                Feedback
              </dt>
              <dd className="mt-2 font-medium text-ink">
                {metricValue(agent.feedbackCount, (value) => String(value))}
              </dd>
            </div>
            <div className="border-b border-r border-line p-4">
              <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-faint">
                Record
              </dt>
              <dd className="mt-2 font-medium text-ink">
                {agent.recordStatus === "indexed" ? "Indexed" : "Editorial fallback"}
              </dd>
            </div>
          </dl>
        </div>
      </header>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-14">
        <div>
          <DetailSection
            summary="Category-specific values with their source, status, and last check."
            title="Live evidence"
          >
            <LiveStats agent={agent} />
          </DetailSection>

          <DetailSection
            summary="A chart appears only when the record includes enough sourced points."
            title="Performance"
          >
            <PerformancePanel category={agent.category} series={agent.performanceSeries} />
          </DetailSection>

          <DetailSection
            summary="What the publisher says this agent does and how its capabilities are classified."
            title="About"
          >
            <p className="max-w-3xl text-sm leading-7 text-ink-soft">{agent.description}</p>

            <div className="mt-8">
              <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-faint">
                Published capabilities
              </h3>
              {agent.skills.length > 0 ? (
                <ul className="mt-3 border-t border-line">
                  {agent.skills.map((skill) => (
                    <li
                      className="grid gap-1 border-b border-line py-3 text-sm sm:grid-cols-[minmax(0,1fr)_180px] sm:items-center"
                      key={`${skill.name}-${skill.evidence}`}
                    >
                      <span className="font-medium text-ink">{skill.name}</span>
                      <span className="text-xs capitalize text-muted">
                        {skill.evidence.replaceAll("-", " ")}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-4">
                  <StatePanel
                    body="No capabilities are published for this catalog record."
                    compact
                    state="empty"
                    title="No capabilities listed"
                  />
                </div>
              )}
            </div>
          </DetailSection>

          <DetailSection
            summary="Hiring and execution authority are deliberately separate decisions."
            title="Permission model"
          >
            <div className="border-t border-line">
              {[
                {
                  icon: "shield" as const,
                  title: "Read-only hire",
                  body: access.reason,
                },
                {
                  icon: "clock" as const,
                  title:
                    sessionPolicy.kind === "read-only"
                      ? "No spending session required"
                      : "Execution permission is optional",
                  body:
                    sessionPolicy.kind === "read-only"
                      ? sessionPolicy.reason
                      : `${sessionPolicy.reason} The allowlist, spend cap, and expiry are shown before a passkey confirmation.`,
                },
                {
                  icon: "revoke" as const,
                  title: "Revocation stays visible",
                  body: "Any active Dolphin Wallet session can be reviewed and revoked from the Wallet page.",
                },
              ].map((item) => (
                <article
                  className="grid gap-3 border-b border-line py-5 sm:grid-cols-[40px_minmax(0,1fr)]"
                  key={item.title}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-paper-muted text-accent-ink">
                    <CategoryGlyph
                      color="currentColor"
                      name={item.icon}
                      size={18}
                      strokeWidth={2}
                    />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-ink">{item.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-muted">{item.body}</p>
                  </div>
                </article>
              ))}
            </div>
          </DetailSection>

          <DetailSection
            summary="Raw identifiers and source labels for independent inspection."
            title="Technical record"
          >
            <dl className="border-t border-line text-sm">
              {[
                ["ERC-8004 token", `#${agent.tokenId}`],
                ["Chain", "BNB Smart Chain · 56"],
                ["Registry", shortAddress(agent.registryAddress)],
                ["Agent wallet", shortAddress(agent.agentWallet)],
                ["Registered", `${formatDate(agent.registeredAt)}${agent.registeredAt ? " UTC" : ""}`],
                [
                  "Classification",
                  agent.classificationSource.replaceAll("-", " "),
                ],
              ].map(([label, value]) => (
                <div
                  className="grid gap-1 border-b border-line py-3 sm:grid-cols-[180px_minmax(0,1fr)]"
                  key={label}
                >
                  <dt className="text-muted">{label}</dt>
                  <dd className="break-all font-mono text-xs font-medium text-ink">{value}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-7">
              <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-faint">
                Sources attached to this record
              </h3>
              <ul className="mt-3 border-t border-line">
                {agent.sourceLabels.map((source) => (
                  <li
                    className="flex items-center justify-between gap-4 border-b border-line py-3 text-sm"
                    key={source.id}
                  >
                    <span className="text-muted">{source.label}</span>
                    {source.url ? (
                      <a
                        className="interactive shrink-0 font-medium text-ink underline-offset-4 hover:text-accent-ink hover:underline"
                        href={source.url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Open ↗
                      </a>
                    ) : (
                      <span className="text-xs text-faint">No public URL</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </DetailSection>
        </div>

        <aside className="order-first py-9 lg:order-none lg:sticky lg:top-24 lg:self-start lg:py-12">
          <HireAction agent={agent} />
        </aside>
      </div>
    </div>
  );
}
