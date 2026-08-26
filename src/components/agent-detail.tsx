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
import type { Agent, AgentCategory } from "@/types/agent";

const categoryLabels: Record<AgentCategory, string> = {
  monitoring: "Monitoring",
  "grid-trading": "Grid trading",
  "health-factor": "Health factor",
  yield: "Yield",
};

function shortAddress(value: string | null) {
  if (!value) return "Not reported";
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="mt-9">
      <SectionHeading title={title} />
      {children}
    </View>
  );
}

function LiveStats({ agent }: { agent: Agent }) {
  const stats = agent.liveStats;

  return (
    <Surface>
      <View className="flex-row flex-wrap gap-y-6">
        {stats.category === "monitoring" ? (
          <>
            <View className="w-1/2 pr-3">
              <MetricCell format={(value) => value} label="Alert frequency" metric={stats.alertFrequency} />
            </View>
            <View className="w-1/2 pl-3">
              <MetricCell format={(value) => value.join(", ")} label="Assets watched" metric={stats.assetsWatched} />
            </View>
            <View className="w-1/2 pr-3">
              <MetricCell format={(value) => value} label="Last alert" metric={stats.lastAlertAt} />
            </View>
            <View className="w-1/2 pl-3">
              <MetricCell format={(value) => `${value.toFixed(1)}%`} label="False positives" metric={stats.falsePositiveRate} />
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
              <MetricCell format={(value) => value.toLocaleString()} label="Grid count" metric={stats.gridCount} />
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
              <MetricCell format={(value) => value.join(", ")} label="Protocols" metric={stats.protocolsUsed} />
            </View>
            <View className="w-1/2 pl-3">
              <MetricCell format={(value) => value} label="Rebalances" metric={stats.rebalanceFrequency} />
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

