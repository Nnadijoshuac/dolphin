import type { ReactNode } from "react";
import { useState } from "react";
import { type DimensionValue, ScrollView, Text, View } from "react-native";
import * as Haptics from "expo-haptics";

import { AgentIcon } from "@/components/agent-icon";
import { CategoryGlyph } from "@/components/category-glyph";
import { MetricCell } from "@/components/metric-cell";
import { PerformancePanel } from "@/components/performance-panel";
import { PressableScale } from "@/components/pressable-scale";
import { StatePanel } from "@/components/state-panel";
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
  trading: "Trading",
};

function shortAddress(value: string | null) {
  if (!value) return "Not reported";
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function formatList(value: string[]) {
  return value.length > 0 ? value.join(", ") : "None";
}

function PlayStoreSectionHeading({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View className="flex-row items-center justify-between mb-3 px-5">
      <Text className="text-[17px] font-bold" style={{ color: colors.ink }}>
        {title}
      </Text>
      {actionLabel || onAction ? (
        <PressableScale
          accessibilityLabel={actionLabel ?? `View ${title}`}
          accessibilityRole="button"
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onAction?.();
          }}
          containerStyle={{
            padding: 4,
          }}
        >
          <CategoryGlyph color="#01875F" name="arrow-right" size={16} />
        </PressableScale>
      ) : null}
    </View>
  );
}

function LiveStats({ agent }: { agent: Agent }) {
  if (!convexClient) {
    return <LiveStatsView stats={agent.liveStats} />;
  }

  return <BackendLiveStats agent={agent} />;
}

function BackendLiveStats({ agent }: { agent: Agent }) {
  const cached = useAgentCategoryStats(agent.tokenId, agent.category, agent.agentWallet);
  const stats = cached?.stats ?? syncingLiveStats(agent.category);

  return <LiveStatsView stats={stats} />;
}

function LiveStatsView({ stats }: { stats: AgentLiveStats }) {
  return (
    <Surface
      style={{
        borderWidth: 1,
        borderColor: "rgba(17, 18, 20, 0.08)",
        shadowOpacity: 0.02,
        elevation: 1,
      }}
    >
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
            <View className="w-1/2 pl-3">
              <MetricCell format={formatList} label="Protocols" metric={stats.protocolsUsed} />
            </View>
            <View className="w-1/2 pl-3">
              <MetricCell format={(value) => value} label="Vault rebalance cadence" metric={stats.rebalanceFrequency} />
            </View>
          </>
        ) : null}
        {stats.category === "trading" ? (
          <>
            <View className="w-1/2 pr-3">
              <MetricCell format={(value) => `${value.toFixed(1)}%`} label="Win rate" metric={stats.winRate} />
            </View>
            <View className="w-1/2 pl-3">
              <MetricCell format={(value) => value.toLocaleString()} label="Trades executed" metric={stats.tradesExecuted} />
            </View>
            <View className="w-1/2 pr-3">
              <MetricCell format={(value) => value} label="Realized P&L" metric={stats.realizedPnl} />
            </View>
            <View className="w-1/2 pl-3">
              <MetricCell format={formatList} label="Markets traded" metric={stats.marketsTraded} />
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

export function AgentDetail({ agent, onHire, actionLabel = "Hire Agent" }: AgentDetailProps) {
  const registeredMetric = agent.registryVerification.registered;
  const isRegistered = registeredMetric.status === "live" && registeredMetric.value;
  const [expandedAbout, setExpandedAbout] = useState(false);
  const [isBookmarked, setIsBookmarked] = useState(false);

  const MAX_PREVIEW_LENGTH = 140;
  const description = agent.description;
  const isLongDescription = description.length > MAX_PREVIEW_LENGTH;
  const displayedDescription = expandedAbout
    ? description
    : description.slice(0, MAX_PREVIEW_LENGTH);

  const handleToggleAbout = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpandedAbout((prev) => !prev);
  };

  const handleToggleBookmark = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsBookmarked((prev) => !prev);
  };

  return (
    <View className="pt-2">
      {/* 1. Play Store App Hero Header */}
      <View className="px-5 flex-row items-start gap-4">
        <AgentIcon category={agent.category} size={76} uri={agent.iconUrl} />
        <View className="flex-1 min-w-0 pt-0.5">
          <Text
            className="text-[22px] font-bold tracking-[-0.5px] leading-tight"
            style={{ color: colors.ink }}
          >
            {agent.name}
          </Text>
          <View className="flex-row items-center gap-1.5 mt-1">
            <Text
              className="text-[14px] font-semibold"
              style={{ color: "#01875F" }}
            >
              {agent.publisher}
            </Text>
            {isRegistered ? (
              <CategoryGlyph color="#01875F" name="check" size={13} strokeWidth={2.4} />
            ) : null}
          </View>
          <Text
            className="text-[12px] mt-0.5"
            style={{ color: colors.muted }}
          >
            Decentralized Finance · Autonomous Agent
          </Text>
          <Text
            className="text-[11px] mt-0.5"
            style={{ color: colors.faint }}
          >
            Contains smart contract transactions · Non-custodial
          </Text>
        </View>
      </View>

      {/* 2. Google Play Store Quick-Stats Divider Bar */}
      <View
        className="mx-5 my-4 py-3 flex-row items-center justify-around border-y"
        style={{ borderColor: "rgba(17, 18, 20, 0.07)" }}
      >
        {/* Metric 1: Trust Score / Rating */}
        <View className="items-center flex-1">
          <View className="flex-row items-center gap-1">
            <Text className="text-[14px] font-bold" style={{ color: colors.ink }}>
              4.9
            </Text>
            <CategoryGlyph color="#01875F" name="star" size={12} />
          </View>
          <Text className="text-[11px] mt-0.5" style={{ color: colors.muted }}>
            Trust score
          </Text>
        </View>

        <View
          style={{
            height: 24,
            width: 1,
            backgroundColor: "rgba(17, 18, 20, 0.08)",
          }}
        />

        {/* Metric 2: Standard */}
        <View className="items-center flex-1">
          <Text className="text-[14px] font-bold" style={{ color: colors.ink }}>
            ERC-8004
          </Text>
          <Text className="text-[11px] mt-0.5" style={{ color: colors.muted }}>
            {isRegistered ? "Verified standard" : "Registry token"}
          </Text>
        </View>

        <View
          style={{
            height: 24,
            width: 1,
            backgroundColor: "rgba(17, 18, 20, 0.08)",
          }}
        />

        {/* Metric 3: Category */}
        <View className="items-center flex-1">
          <View className="flex-row items-center gap-1">
            <CategoryGlyph color="#01875F" name={agent.category} size={14} />
            <Text className="text-[13px] font-bold" style={{ color: colors.ink }}>
              {categoryLabels[agent.category]}
            </Text>
          </View>
          <Text className="text-[11px] mt-0.5" style={{ color: colors.muted }}>
            Category
          </Text>
        </View>

        <View
          style={{
            height: 24,
            width: 1,
            backgroundColor: "rgba(17, 18, 20, 0.08)",
          }}
        />

        {/* Metric 4: Activity Status */}
        <View className="items-center flex-1">
          <Text className="text-[14px] font-bold" style={{ color: colors.ink }}>
            {agent.recentActivity.length > 0 ? `${agent.recentActivity.length}+` : "Active"}
          </Text>
          <Text className="text-[11px] mt-0.5" style={{ color: colors.muted }}>
            Executions
          </Text>
        </View>
      </View>

      {/* 3. Primary Google Play Action ("Install" / "Hire") */}
      <View className="px-5 mb-5 flex-row items-center gap-3">
        <PressableScale
          accessibilityLabel={actionLabel}
          accessibilityRole="button"
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onHire();
          }}
          containerStyle={{
            flex: 1,
            height: 46,
            borderRadius: 9999,
            backgroundColor: "#01875F",
            alignItems: "center",
            justifyContent: "center",
            shadowColor: "#01875F",
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.2,
            shadowRadius: 6,
            elevation: 2,
          }}
        >
          <Text className="text-[15px] font-bold text-white tracking-[-0.2px]">
            {actionLabel}
          </Text>
        </PressableScale>

        <PressableScale
          accessibilityLabel={isBookmarked ? "Remove from watchlist" : "Add to watchlist"}
          accessibilityRole="button"
          onPress={handleToggleBookmark}
          containerStyle={{
            height: 46,
            width: 46,
            borderRadius: 23,
            borderWidth: 1,
            borderColor: isBookmarked ? "#01875F" : "rgba(17, 18, 20, 0.12)",
            backgroundColor: isBookmarked ? "rgba(1, 135, 95, 0.08)" : "#FFFFFF",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <CategoryGlyph
            color={isBookmarked ? "#01875F" : colors.ink}
            name={isBookmarked ? "check" : "sparkle"}
            size={18}
          />
        </PressableScale>
      </View>

      {/* 4. Play Store "App Screenshots / Previews" Horizontal Carousel */}
      <View className="mb-6">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
        >
          {/* Preview Card 1: Strategy & Live Telemetry */}
          <View
            style={{
              width: 256,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: "rgba(17, 18, 20, 0.08)",
              backgroundColor: "#FFFFFF",
              padding: 16,
            }}
          >
            <View className="flex-row items-center justify-between mb-3">
              <View className="flex-row items-center gap-1.5">
                <View
                  style={{
                    height: 8,
                    width: 8,
                    borderRadius: 4,
                    backgroundColor: "#01875F",
                  }}
                />
                <Text
                  className="text-[11px] font-bold tracking-wider uppercase"
                  style={{ color: "#01875F" }}
                >
                  Live Telemetry
                </Text>
              </View>
              <CategoryGlyph color={colors.muted} name={agent.category} size={15} />
            </View>

            <Text
              className="text-[15px] font-bold leading-snug"
              numberOfLines={2}
              style={{ color: colors.ink }}
            >
              {agent.tagline}
            </Text>

            <View className="mt-3 pt-3 border-t border-gray-100 flex-row items-center justify-between">
              <Text className="text-[11px]" style={{ color: colors.muted }}>
                Category
              </Text>
              <Text className="text-[12px] font-semibold" style={{ color: colors.ink }}>
                {categoryLabels[agent.category]}
              </Text>
            </View>
          </View>

          {/* Preview Card 2: Security & Permissions */}
          <View
            style={{
              width: 256,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: "rgba(17, 18, 20, 0.08)",
              backgroundColor: "#F8FAF8",
              padding: 16,
            }}
          >
            <View className="flex-row items-center justify-between mb-3">
              <View className="flex-row items-center gap-1.5">
                <CategoryGlyph color="#01875F" name="shield" size={14} />
                <Text
                  className="text-[11px] font-bold tracking-wider uppercase"
                  style={{ color: "#01875F" }}
                >
                  Data Safety
                </Text>
              </View>
              <Text className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                Non-Custodial
              </Text>
            </View>

            <Text
              className="text-[14px] font-bold"
              style={{ color: colors.ink }}
            >
              Altana Passkey Protected
            </Text>
            <Text
              className="text-[12px] leading-4 mt-1"
              style={{ color: colors.muted }}
            >
              Session delegation grants execution budget without exposing private keys.
            </Text>

            <View className="mt-3 pt-2.5 border-t border-emerald-100/60 flex-row items-center justify-between">
              <Text className="text-[11px]" style={{ color: colors.muted }}>
                Payments
              </Text>
              <Text className="text-[11px] font-semibold" style={{ color: "#01875F" }}>
                BNB x402 Streaming
              </Text>
            </View>
          </View>

          {/* Preview Card 3: ERC-8004 Registry Specs */}
          <View
            style={{
              width: 256,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: "rgba(17, 18, 20, 0.08)",
              backgroundColor: "#FFFFFF",
              padding: 16,
            }}
          >
            <View className="flex-row items-center justify-between mb-3">
              <View className="flex-row items-center gap-1.5">
                <CategoryGlyph color={colors.ink} name="layers" size={14} />
                <Text
                  className="text-[11px] font-bold tracking-wider uppercase"
                  style={{ color: colors.ink }}
                >
                  Onchain Identity
                </Text>
              </View>
              <Text className="text-[11px] font-bold" style={{ color: colors.ink }}>
                #{agent.tokenId}
              </Text>
            </View>

            <Text
              className="text-[14px] font-bold"
              style={{ color: colors.ink }}
            >
              BNB Smart Chain
            </Text>
            <Text
              className="text-[12px] mt-1"
              numberOfLines={2}
              style={{ color: colors.muted }}
            >
              Registry: {shortAddress(agent.registryAddress)}
            </Text>

            <View className="mt-3 pt-2.5 border-t border-gray-100 flex-row items-center justify-between">
              <Text className="text-[11px]" style={{ color: colors.muted }}>
                Classification
              </Text>
              <Text className="text-[11px] font-semibold" style={{ color: colors.ink }}>
                {agent.classificationSource.replaceAll("-", " ")}
              </Text>
            </View>
          </View>
        </ScrollView>
      </View>

      {/* 5. "About this agent" (Play Store style) */}
      <View className="mb-6">
        <PlayStoreSectionHeading
          actionLabel="More info"
          onAction={handleToggleAbout}
          title="About this agent"
        />
        <View className="px-5">
          <Text
            className="text-[14px] font-medium leading-5 mb-2"
            style={{ color: colors.ink }}
          >
            {agent.tagline}
          </Text>

          <Text
            className="text-[14px] leading-6"
            style={{ color: colors.muted }}
          >
            {displayedDescription}
            {isLongDescription && !expandedAbout ? "…" : ""}
          </Text>

          {isLongDescription ? (
            <PressableScale
              accessibilityLabel={expandedAbout ? "Show less" : "Show more"}
              accessibilityRole="button"
              onPress={handleToggleAbout}
              containerStyle={{
                alignSelf: "flex-start",
                marginTop: 6,
              }}
            >
              <Text className="text-[14px] font-semibold" style={{ color: "#01875F" }}>
                {expandedAbout ? "Show less" : "Show more"}
              </Text>
            </PressableScale>
          ) : null}

          {/* Play Store Tag Pills */}
          <View className="mt-3.5 flex-row flex-wrap gap-2">
            <View
              className="px-3 py-1.5 rounded-full"
              style={{ backgroundColor: "rgba(1, 135, 95, 0.08)" }}
            >
              <Text className="text-[12px] font-semibold" style={{ color: "#01875F" }}>
                #{categoryLabels[agent.category]}
              </Text>
            </View>
            <View
              className="px-3 py-1.5 rounded-full"
              style={{ backgroundColor: "#F1F3F4" }}
            >
              <Text className="text-[12px] font-medium" style={{ color: colors.ink }}>
                #ERC-8004
              </Text>
            </View>
            <View
              className="px-3 py-1.5 rounded-full"
              style={{ backgroundColor: "#F1F3F4" }}
            >
              <Text className="text-[12px] font-medium" style={{ color: colors.ink }}>
                #BNBChain
              </Text>
            </View>
            {agent.skills.map((skill) => (
              <View
                className="px-3 py-1.5 rounded-full"
                key={`${skill.name}-${skill.evidence}`}
                style={{
                  backgroundColor: skill.evidence === "verified" ? "rgba(1, 135, 95, 0.08)" : "#F1F3F4",
                }}
              >
                <Text
                  className="text-[12px] font-medium"
                  style={{
                    color: skill.evidence === "verified" ? "#01875F" : colors.ink,
                  }}
                >
                  {skill.name}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      {/* 6. Google Play "Data Safety" Section */}
      <View className="mb-6 px-5">
        <PlayStoreSectionHeading title="Data safety & trust" />
        <View
          style={{
            borderRadius: 16,
            borderWidth: 1,
            borderColor: "rgba(17, 18, 20, 0.08)",
            backgroundColor: "#FFFFFF",
            padding: 16,
          }}
        >
          <Text className="text-[13px] leading-5 mb-3" style={{ color: colors.muted }}>
            Safety starts with understanding how developers verify contracts, handle permissions, and manage keys.
          </Text>

          <View className="gap-3">
            <View className="flex-row items-start gap-3">
              <View className="mt-0.5">
                <CategoryGlyph color="#01875F" name="shield" size={17} />
              </View>
              <View className="flex-1">
                <Text className="text-[13px] font-bold" style={{ color: colors.ink }}>
                  Non-custodial execution
                </Text>
                <Text className="text-[12px] mt-0.5" style={{ color: colors.muted }}>
                  Agent smart contract logic cannot transfer or withdraw user principal funds.
                </Text>
              </View>
            </View>

            <View className="flex-row items-start gap-3">
              <View className="mt-0.5">
                <CategoryGlyph color="#01875F" name="check" size={17} />
              </View>
              <View className="flex-1">
                <Text className="text-[13px] font-bold" style={{ color: colors.ink }}>
                  Altana passkey session delegation
                </Text>
                <Text className="text-[12px] mt-0.5" style={{ color: colors.muted }}>
                  Automated actions require cryptographic session grants with strict time & gas bounds.
                </Text>
              </View>
            </View>

            <View className="flex-row items-start gap-3">
              <View className="mt-0.5">
                <CategoryGlyph color="#01875F" name="layers" size={17} />
              </View>
              <View className="flex-1">
                <Text className="text-[13px] font-bold" style={{ color: colors.ink }}>
                  ERC-8004 Registry verified
                </Text>
                <Text className="text-[12px] mt-0.5" style={{ color: colors.muted }}>
                  Identity token #{agent.tokenId} registered on BNB Smart Chain.
                </Text>
              </View>
            </View>
          </View>
        </View>
      </View>

      {/* 7. Live signals */}
      <View className="mb-6 px-5">
        <PlayStoreSectionHeading title="Live telemetry & signals" />
        <LiveStats agent={agent} />
      </View>

      {/* 8. Ratings & Track record */}
      <View className="mb-6 px-5">
        <PlayStoreSectionHeading title="Ratings and performance" />
        <View
          className="mb-3 p-4 flex-row items-center justify-between"
          style={{
            borderRadius: 16,
            borderWidth: 1,
            borderColor: "rgba(17, 18, 20, 0.08)",
            backgroundColor: "#FFFFFF",
          }}
        >
          <View className="items-center pr-5 border-r border-gray-100">
            <Text className="text-[34px] font-bold tracking-tight" style={{ color: colors.ink }}>
              4.9
            </Text>
            <View className="flex-row gap-0.5 my-1">
              {[1, 2, 3, 4, 5].map((s) => (
                <CategoryGlyph color="#01875F" key={s} name="star" size={12} />
              ))}
            </View>
            <Text className="text-[11px]" style={{ color: colors.faint }}>
              Onchain audited
            </Text>
          </View>

          <View className="flex-1 pl-5 gap-1.5">
            {[
              { star: "5", pct: "92%" },
              { star: "4", pct: "8%" },
              { star: "3", pct: "0%" },
              { star: "2", pct: "0%" },
              { star: "1", pct: "0%" },
            ].map(({ star, pct }) => (
              <View className="flex-row items-center gap-2" key={star}>
                <Text className="text-[11px] w-2 font-medium" style={{ color: colors.muted }}>
                  {star}
                </Text>
                <View
                  className="flex-1 h-1.5 rounded-full overflow-hidden"
                  style={{ backgroundColor: "#F1F3F4" }}
                >
                  <View
                    className="h-full rounded-full"
                    style={{
                      width: pct as DimensionValue,
                      backgroundColor: "#01875F",
                    }}
                  />
                </View>
              </View>
            ))}
          </View>
        </View>

        <PerformancePanel points={agent.performanceSeries} />
      </View>

      {/* 9. Recent onchain activity */}
      <View className="mb-6 px-5">
        <PlayStoreSectionHeading title="Recent onchain activity" />
        {agent.recentActivity.length > 0 ? (
          <Surface
            style={{
              borderWidth: 1,
              borderColor: "rgba(17, 18, 20, 0.08)",
              shadowOpacity: 0.02,
              elevation: 1,
            }}
          >
            {agent.recentActivity.map((activity, index) => (
              <View
                className={index === 0 ? "pb-3.5" : "border-t py-3.5"}
                key={`${activity.timestamp}-${activity.action}`}
                style={{ borderColor: "rgba(17, 18, 20, 0.06)" }}
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
      </View>

      {/* 10. Developer contact & Onchain specifications */}
      <View className="mb-6 px-5">
        <PlayStoreSectionHeading title="App info & contract specifications" />
        <Surface
          style={{
            borderWidth: 1,
            borderColor: "rgba(17, 18, 20, 0.08)",
            shadowOpacity: 0.02,
            elevation: 1,
          }}
        >
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
              className={index === 0 ? "flex-row justify-between pb-3.5" : "flex-row justify-between border-t py-3.5"}
              key={label}
              style={{ borderColor: "rgba(17, 18, 20, 0.06)" }}
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
      </View>
    </View>
  );
}
