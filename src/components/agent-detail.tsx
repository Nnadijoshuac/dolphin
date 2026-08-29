import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { AgentIcon } from "@/components/agent-icon";
import { Button } from "@/components/buttons";
import { MetricCell } from "@/components/metric-cell";
import { PerformancePanel } from "@/components/performance-panel";
import { SectionHeading } from "@/components/section-heading";
import { StatePanel } from "@/components/state-panel";
import { StatusBadge } from "@/components/status-badge";
import { Surface } from "@/components/surface";
import { colors } from "@/constants/theme";
import { syncingLiveStats } from "@/data/editorial-agents";
import { useAgentCategoryStats } from "@/hooks/use-category-stats";
import { convexClient } from "@/providers/convex-provider";
import type { Agent, AgentCategory, AgentLiveStats } from "@/types/agent";

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

/**
 * A live read that returned an empty list is a real answer - "we checked the
 * chain and this wallet uses none" - but value.join(", ") renders it as a
 * blank cell that reads as a broken UI. "None" keeps it honest while staying
 * visibly distinct from MetricCell's "Not reported", which means no feed was
 * available to check in the first place.
 */
function formatList(value: string[]) {
  return value.length > 0 ? value.join(", ") : "None";
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="mt-9">
      <SectionHeading title={title} />
      {children}
    </View>
  );
}

/**
 * Chooses where "Live signals" reads from.
 *
 * agent.liveStats is a static unavailable stub on every agent from every
 * source (see unavailableLiveStats in src/data/editorial-agents.ts) - it is
 * never populated with real values. The real per-category numbers come from
 * the Convex backend's on-chain reads (convex/protocols/{venus,pancakeswap,
 * aave}.ts), reached through useAgentCategoryStats. Until 2026-08-29 nothing
 * called that hook, so all of that backend work was invisible in the UI.
 *
 * Split across two components on purpose: useAgentCategoryStats calls
 * convex/react hooks, which throw when no ConvexProvider is mounted, and
 * ConvexClientProvider mounts none when EXPO_PUBLIC_CONVEX_URL is unset.
 * convexClient is a module-level constant, so this branch is fixed for the
 * life of the process and can never reorder hooks between renders.
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
  const cached = useAgentCategoryStats(agent.tokenId, agent.category, agent.agentWallet);

  // `undefined` = the Convex client has not answered yet; `null` = no row is
  // cached and the refresh action is still running. Both mean "not known
  // yet", which is syncing - not unavailable. Once a row exists we render
  // exactly what the backend stored, including its own honest per-field
  // "unavailable" entries (e.g. rebalancing winRate, for which no cost-basis
  // feed exists) - those are correct and must not be papered over.
  const stats = cached?.stats ?? syncingLiveStats(agent.category);

  return <LiveStatsView stats={stats} />;
}

function LiveStatsView({ stats }: { stats: AgentLiveStats }) {
  return (
    <Surface>
      <View className="flex-row flex-wrap gap-y-6">
        {stats.category === "monitoring" ? (
          <>
            <View className="w-1/2 pr-3">
              <MetricCell format={(value) => value} label="Alert frequency" metric={stats.alertFrequency} />
            </View>
            <View className="w-1/2 pl-3">
              <MetricCell format={formatList} label="Assets watched" metric={stats.assetsWatched} />
            </View>
            <View className="w-1/2 pr-3">
              <MetricCell format={(value) => value} label="Last alert" metric={stats.lastAlertAt} />
            </View>
            <View className="w-1/2 pl-3">
              <MetricCell format={(value) => `${value.toFixed(1)}%`} label="False positives" metric={stats.falsePositiveRate} />
            </View>
          </>
        ) : null}
        {stats.category === "rebalancing" ? (
          <>
            <View className="w-1/2 pr-3">
              <MetricCell format={(value) => `${value.toFixed(1)}%`} label="Rebalance efficiency" metric={stats.winRate} />
            </View>
            <View className="w-1/2 pl-3">
              <MetricCell format={(value) => value} label="Active range" metric={stats.activeRange} />
            </View>
            <View className="w-1/2 pr-3">
              <MetricCell format={(value) => value} label="Current P&L" metric={stats.currentPnl} />
            </View>
            <View className="w-1/2 pl-3">
              <MetricCell format={(value) => value.toLocaleString()} label="LP positions" metric={stats.positionCount} />
            </View>
          </>
        ) : null}
        {stats.category === "grid-trading" ? (
          <>
            <View className="w-1/2 pr-3">
              <MetricCell format={(value) => `${value.toFixed(1)}%`} label="Win rate" metric={stats.winRate} />
            </View>
            <View className="w-1/2 pl-3">
              <MetricCell format={(value) => value} label="Active range" metric={stats.activeRange} />
            </View>
            <View className="w-1/2 pr-3">
              <MetricCell format={(value) => value} label="Current P&L" metric={stats.currentPnl} />
            </View>
            <View className="w-1/2 pl-3">
              <MetricCell format={(value) => value.toLocaleString()} label="Grid levels" metric={stats.positionCount} />
            </View>
          </>
        ) : null}
        {stats.category === "health-factor" ? (
          <>
            <View className="w-1/2 pr-3">
              <MetricCell format={(value) => value.toLocaleString()} label="Positions watched" metric={stats.positionsMonitored} />
            </View>
            <View className="w-1/2 pl-3">
              <MetricCell format={(value) => value.toFixed(2)} label="Average health" metric={stats.averageHealthFactor} />
            </View>
            <View className="w-1/2 pr-3">
              <MetricCell format={(value) => value.toLocaleString()} label="Liquidations prevented" metric={stats.liquidationsPrevented} />
            </View>
            <View className="w-1/2 pl-3">
              <MetricCell format={(value) => `${value} ms`} label="Response latency" metric={stats.responseLatencyMs} />
            </View>
          </>
        ) : null}
        {stats.category === "yield" ? (
          <>
            <View className="w-1/2 pr-3">
              <MetricCell format={(value) => `${value.toFixed(2)}%`} label="Current APY" metric={stats.currentApy} />
            </View>
            <View className="w-1/2 pl-3">
              <MetricCell format={(value) => `$${value.toLocaleString()}`} label="TVL managed" metric={stats.tvlManagedUsd} />
            </View>
            <View className="w-1/2 pr-3">
              <MetricCell format={formatList} label="Protocols" metric={stats.protocolsUsed} />
            </View>
            <View className="w-1/2 pl-3">
              <MetricCell format={(value) => value} label="Vault rebalance cadence" metric={stats.rebalanceFrequency} />
            </View>
          </>
        ) : null}
      </View>
    </Surface>
  );
}

type AgentDetailProps = {
  agent: Agent;
  onHire: () => void;
  actionLabel?: string;
};

export function AgentDetail({ agent, onHire, actionLabel = "Review" }: AgentDetailProps) {
  const registeredMetric = agent.registryVerification.registered;

  return (
    <>
      <View className="mt-7 flex-row items-start gap-4">
        <AgentIcon category={agent.category} size={92} uri={agent.iconUrl} />
        <View className="min-w-0 flex-1 pt-1">
          <Text
            className="text-[27px] font-bold tracking-[-1px]"
            style={{ color: colors.ink }}
          >
            {agent.name}
          </Text>
          <Text className="mt-1 text-[13px]" style={{ color: colors.muted }}>
            {agent.publisher}
          </Text>
          <View className="mt-3 flex-row flex-wrap gap-2">
            <StatusBadge label={categoryLabels[agent.category]} tone="neutral" />
            <StatusBadge
              label={registeredMetric.status === "live" && registeredMetric.value ? "Registry verified" : registeredMetric.status}
              tone={registeredMetric.status === "live" && registeredMetric.value ? "live" : registeredMetric.status}
            />
          </View>
        </View>
      </View>

      <Text className="mt-6 text-[16px] leading-6" style={{ color: colors.muted }}>
        {agent.tagline}
      </Text>
      <Button label={actionLabel} onPress={onHire} style={{ marginTop: 22 }} />

      <DetailSection title="Live signals">
        <LiveStats agent={agent} />
      </DetailSection>

      <DetailSection title="Track record">
        <PerformancePanel points={agent.performanceSeries} />
      </DetailSection>

      <DetailSection title="How it works">
        <Surface>
          <Text className="text-[15px] leading-6" style={{ color: colors.ink }}>
            {agent.description}
          </Text>
          <View className="mt-5 flex-row flex-wrap gap-2">
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
          </View>
        </Surface>
      </DetailSection>

      <DetailSection title="Recent onchain activity">
        {agent.recentActivity.length > 0 ? (
          <Surface>
            {agent.recentActivity.map((activity, index) => (
              <View
                className={index === 0 ? "pb-4" : "border-t py-4"}
                key={`${activity.timestamp}-${activity.action}`}
                style={{ borderColor: colors.line }}
              >
                <Text className="text-[14px] font-bold" style={{ color: colors.ink }}>
                  {activity.action}
                </Text>
                <Text className="mt-1 text-[11px]" style={{ color: colors.muted }}>
                  {activity.timestamp} · {activity.source.label}
                </Text>
              </View>
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
            <View
              className={index === 0 ? "flex-row justify-between pb-4" : "flex-row justify-between border-t py-4"}
              key={label}
              style={{ borderColor: colors.line }}
            >
              <Text className="text-[12px]" style={{ color: colors.muted }}>
                {label}
              </Text>
              <Text
                className="ml-5 flex-1 text-right text-[12px] font-semibold"
                numberOfLines={2}
                style={{ color: colors.ink }}
              >
                {value}
              </Text>
            </View>
          ))}
        </Surface>
      </DetailSection>
    </>
  );
}

