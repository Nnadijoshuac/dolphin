"use client";

import { AgentIcon } from "@/components/agent-icon";
import { Button } from "@/components/buttons";
import { MetricCell } from "@/components/metric-cell";
import { PerformancePanel } from "@/components/performance-panel";
import { SectionHeading } from "@/components/section-heading";
import { StatePanel } from "@/components/state-panel";
import { StatusBadge } from "@/components/status-badge";
import { Surface } from "@/components/surface";
import { colors } from "@/constants/theme";
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
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-9">
      <SectionHeading title={title} />
      {children}
    </div>
  );
}

/**
 * Every metric of a category marked "syncing" rather than "unavailable" - the
 * honest state while the Convex read is still in flight. "unavailable" asserts
 * a feed was checked and does not exist, which is a stronger claim than we can
 * make before the answer arrives (project-scope.md SS5). Mirrors
 * syncingLiveStats in the mobile app's src/data/editorial-agents.ts.
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
 * Live signals come from convex/categoryStats.ts - the real Venus /
 * PancakeSwap V3 / Aave reads in convex/protocols/ - not from the static stub
 * carried on the agent record. Until 2026-08-29 this site rendered
 * `agent.liveStats` directly, which is always the "unavailable" placeholder, so
 * every agent's Live signals read "Unavailable" here while the mobile app
 * showed real on-chain values for the same agent.
 *
 * Split in two on purpose: useAgentCategoryStats calls convex/react hooks,
 * which throw when no ConvexProvider is mounted, and ConvexClientProvider
 * mounts none when NEXT_PUBLIC_CONVEX_URL is unset. `convexClient` is a
 * module-level constant, so this branch is fixed for the life of the process
 * and can never reorder hooks between renders.
 */
function LiveStats({ agent }: { agent: Agent }) {
  if (!convexClient) {
    // No backend configured, so there is genuinely nothing to read - the
    // static unavailable stub is the honest answer, not a placeholder.
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

  // `undefined` = the Convex client has not answered yet; `null` = no row is
  // cached and the refresh action is still running. Both mean "not known yet",
  // which is syncing, not unavailable. Once a row exists we render exactly what
  // the backend stored, including its own honest per-field "unavailable"
  // entries - those are correct and must not be papered over.
  const stats = cached?.stats ?? syncingLiveStats(agent.liveStats);

  return <LiveStatsView stats={stats} />;
}

function LiveStatsView({ stats }: { stats: AgentLiveStats }) {
  return (
    <Surface>
      <div className="grid grid-cols-2 gap-y-6 gap-x-6">
        {stats.category === "monitoring" && (
          <>
            <MetricCell format={(v) => v} label="Alert frequency" metric={stats.alertFrequency} />
            <MetricCell format={(v) => v.join(", ")} label="Assets watched" metric={stats.assetsWatched} />
            <MetricCell format={(v) => v} label="Last alert" metric={stats.lastAlertAt} />
            <MetricCell format={(v) => `${v.toFixed(1)}%`} label="False positives" metric={stats.falsePositiveRate} />
          </>
        )}
        {/*
          Rebalancing and grid-trading carry the same metric field set but are
          different categories (LP-range management vs a true price ladder) -
          see the taxonomy split in src/types/agent.ts. They are listed
          separately rather than merged so the labels can diverge later without
          re-untangling them.
        */}
        {stats.category === "rebalancing" && (
          <>
            <MetricCell format={(v) => `${v.toFixed(1)}%`} label="Rebalance efficiency" metric={stats.winRate} />
            <MetricCell format={(v) => v} label="Active range" metric={stats.activeRange} />
            <MetricCell format={(v) => v} label="Current P&L" metric={stats.currentPnl} />
            <MetricCell format={(v) => v.toLocaleString()} label="LP positions" metric={stats.positionCount} />
          </>
        )}
        {stats.category === "grid-trading" && (
          <>
            <MetricCell format={(v) => `${v.toFixed(1)}%`} label="Win rate" metric={stats.winRate} />
            <MetricCell format={(v) => v} label="Active range" metric={stats.activeRange} />
            <MetricCell format={(v) => v} label="Current P&L" metric={stats.currentPnl} />
            <MetricCell format={(v) => v.toLocaleString()} label="Grid levels" metric={stats.positionCount} />
          </>
        )}
        {stats.category === "health-factor" && (
          <>
            <MetricCell format={(v) => v.toLocaleString()} label="Positions watched" metric={stats.positionsMonitored} />
            <MetricCell format={(v) => v.toFixed(2)} label="Average health" metric={stats.averageHealthFactor} />
            <MetricCell format={(v) => v.toLocaleString()} label="Liquidations prevented" metric={stats.liquidationsPrevented} />
            <MetricCell format={(v) => `${v} ms`} label="Response latency" metric={stats.responseLatencyMs} />
          </>
        )}
        {stats.category === "yield" && (
          <>
            <MetricCell format={(v) => `${v.toFixed(2)}%`} label="Current APY" metric={stats.currentApy} />
            <MetricCell format={(v) => `$${v.toLocaleString()}`} label="TVL managed" metric={stats.tvlManagedUsd} />
            <MetricCell format={(v) => v.join(", ")} label="Protocols" metric={stats.protocolsUsed} />
            <MetricCell format={(v) => v} label="Rebalances" metric={stats.rebalanceFrequency} />
          </>
        )}
      </div>
    </Surface>
  );
}

type AgentDetailProps = {
  agent: Agent;
  /**
   * Omit when there is no hire flow to send the user into. The action button
   * is then not rendered at all, rather than shown as a control that does
   * nothing - a dead button reads as a broken feature, not an absent one.
   */
  onHire?: () => void;
  actionLabel?: string;
};

export function AgentDetail({ agent, onHire, actionLabel = "Review" }: AgentDetailProps) {
  const registeredMetric = agent.registryVerification.registered;

  return (
    <>
      <div className="mt-7 flex items-start gap-4">
        <AgentIcon category={agent.category} size={92} uri={agent.iconUrl} />
        <div className="min-w-0 flex-1 pt-1">
          <h1
            className="text-[27px] font-bold tracking-tight"
            style={{ color: colors.ink }}
          >
            {agent.name}
          </h1>
          <p className="mt-1 text-[13px]" style={{ color: colors.muted }}>
            {agent.publisher}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <StatusBadge label={categoryLabels[agent.category]} tone="neutral" />
            <StatusBadge
              label={registeredMetric.status === "live" && registeredMetric.value ? "Registry verified" : registeredMetric.status}
              tone={registeredMetric.status === "live" && registeredMetric.value ? "live" : registeredMetric.status}
            />
          </div>
        </div>
      </div>

      <p className="mt-6 text-[16px] leading-6" style={{ color: colors.muted }}>
        {agent.tagline}
      </p>
      {onHire !== undefined && (
        <Button label={actionLabel} onPress={onHire} style={{ marginTop: 22 }} />
      )}

      <DetailSection title="Live signals">
        <LiveStats agent={agent} />
      </DetailSection>

      <DetailSection title="Track record">
        <PerformancePanel points={agent.performanceSeries} />
      </DetailSection>

      <DetailSection title="How it works">
        <Surface>
          <p className="text-[15px] leading-6" style={{ color: colors.ink }}>
            {agent.description}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {agent.skills.length > 0 ? (
              agent.skills.map((skill) => (
                <StatusBadge
                  key={`${skill.name}-${skill.evidence}`}
                  label={`${skill.name} · ${skill.evidence.replace("-", " ")}`}
                  tone={skill.evidence === "verified" ? "live" : "neutral"}
                />
              ))
            ) : (
              <StatusBadge label="No skills published" tone="unavailable" />
            )}
          </div>
        </Surface>
      </DetailSection>

      <DetailSection title="Recent onchain activity">
        {agent.recentActivity.length > 0 ? (
          <Surface>
            {agent.recentActivity.map((activity, index) => (
              <div
                className={index === 0 ? "pb-4" : "border-t py-4"}
                key={`${activity.timestamp}-${activity.action}`}
                style={{ borderColor: colors.line }}
              >
                <p className="text-[14px] font-bold" style={{ color: colors.ink }}>
                  {activity.action}
                </p>
                <p className="mt-1 text-[11px]" style={{ color: colors.muted }}>
                  {activity.timestamp} · {activity.source.label}
                </p>
              </div>
            ))}
          </Surface>
        ) : (
          <StatePanel
            body="No auditable execution events were returned by the current data sources."
            compact
            state="unavailable"
            title="Activity not published"
          />
        )}
      </DetailSection>

      <DetailSection title="Onchain information">
        <Surface>
          {[
            ["ERC-8004 token", `#${agent.tokenId}`],
            ["Identity registry", shortAddress(agent.registryAddress)],
            ["Publisher", shortAddress(agent.publisherAddress)],
            ["Agent wallet", shortAddress(agent.agentWallet)],
            ["Chain", "BNB Smart Chain · 56"],
            ["Registered", agent.registeredAt ?? "Not reported"],
            ["Classification", agent.classificationSource.replaceAll("-", " ")],
          ].map(([label, value], index) => (
            <div
              className={index === 0 ? "flex justify-between pb-4" : "flex justify-between border-t py-4"}
              key={label}
              style={{ borderColor: colors.line }}
            >
              <span className="text-[12px]" style={{ color: colors.muted }}>
                {label}
              </span>
              <span
                className="ml-5 flex-1 text-right text-[12px] font-semibold truncate"
                style={{ color: colors.ink }}
              >
                {value}
              </span>
            </div>
          ))}
        </Surface>
      </DetailSection>
    </>
  );
}
