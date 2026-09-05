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
import { colors, radii, shadows } from "@/constants/theme";
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
      <Text
        className="text-[17px] font-bold tracking-[-0.3px]"
        style={{ color: colors.ink }}
      >
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
          <CategoryGlyph color={colors.goldDark} name="arrow-right" size={16} />
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
        borderColor: colors.line,
        shadowOpacity: 0.02,
        elevation: 1,
      }}
    >
      <View className="flex-row flex-wrap gap-y-5">
        {stats.category === "monitoring" ? (
          <>
            <View className="w-1/2 pr-2.5">
              <MetricCell format={(value) => value} label="Alert frequency" metric={stats.alertFrequency} />
            </View>
            <View className="w-1/2 pl-2.5">
              <MetricCell format={formatList} label="Assets watched" metric={stats.assetsWatched} />
            </View>
            <View className="w-1/2 pr-2.5">
              <MetricCell format={(value) => value} label="Last alert" metric={stats.lastAlertAt} />
            </View>
            <View className="w-1/2 pl-2.5">
              <MetricCell format={(value) => `${value.toFixed(1)}%`} label="False positives" metric={stats.falsePositiveRate} />
            </View>
          </>
        ) : null}
        {stats.category === "rebalancing" ? (
          <>
            <View className="w-1/2 pr-2.5">
              <MetricCell format={(value) => `${value.toFixed(1)}%`} label="Rebalance efficiency" metric={stats.winRate} />
            </View>
            <View className="w-1/2 pl-2.5">
              <MetricCell format={(value) => value} label="Active range" metric={stats.activeRange} />
            </View>
            <View className="w-1/2 pr-2.5">
              <MetricCell format={(value) => value} label="Current P&L" metric={stats.currentPnl} />
            </View>
            <View className="w-1/2 pl-2.5">
              <MetricCell format={(value) => value.toLocaleString()} label="LP positions" metric={stats.positionCount} />
            </View>
          </>
        ) : null}
        {stats.category === "grid-trading" ? (
          <>
            <View className="w-1/2 pr-2.5">
              <MetricCell format={(value) => `${value.toFixed(1)}%`} label="Win rate" metric={stats.winRate} />
            </View>
            <View className="w-1/2 pl-2.5">
              <MetricCell format={(value) => value} label="Active range" metric={stats.activeRange} />
            </View>
            <View className="w-1/2 pr-2.5">
              <MetricCell format={(value) => value} label="Current P&L" metric={stats.currentPnl} />
            </View>
            <View className="w-1/2 pl-2.5">
              <MetricCell format={(value) => value.toLocaleString()} label="Grid levels" metric={stats.positionCount} />
            </View>
          </>
        ) : null}
        {stats.category === "health-factor" ? (
          <>
            <View className="w-1/2 pr-2.5">
              <MetricCell format={(value) => value.toLocaleString()} label="Positions watched" metric={stats.positionsMonitored} />
            </View>
            <View className="w-1/2 pl-2.5">
              <MetricCell format={(value) => value.toFixed(2)} label="Average health" metric={stats.averageHealthFactor} />
            </View>
            <View className="w-1/2 pr-2.5">
              <MetricCell format={(value) => value.toLocaleString()} label="Liquidations prevented" metric={stats.liquidationsPrevented} />
            </View>
            <View className="w-1/2 pl-2.5">
              <MetricCell format={(value) => `${value} ms`} label="Response latency" metric={stats.responseLatencyMs} />
            </View>
          </>
        ) : null}
        {stats.category === "yield" ? (
          <>
            <View className="w-1/2 pr-2.5">
              <MetricCell format={(value) => `${value.toFixed(2)}%`} label="Current APY" metric={stats.currentApy} />
            </View>
            <View className="w-1/2 pl-2.5">
              <MetricCell format={(value) => `$${value.toLocaleString()}`} label="TVL managed" metric={stats.tvlManagedUsd} />
            </View>
            <View className="w-1/2 pr-2.5">
              <MetricCell format={formatList} label="Protocols" metric={stats.protocolsUsed} />
            </View>
            <View className="w-1/2 pl-2.5">
              <MetricCell format={(value) => value} label="Vault rebalance cadence" metric={stats.rebalanceFrequency} />
            </View>
          </>
        ) : null}
        {stats.category === "trading" ? (
          <>
            <View className="w-1/2 pr-2.5">
              <MetricCell format={(value) => `${value.toFixed(1)}%`} label="Win rate" metric={stats.winRate} />
            </View>
            <View className="w-1/2 pl-2.5">
              <MetricCell format={(value) => value.toLocaleString()} label="Trades executed" metric={stats.tradesExecuted} />
            </View>
            <View className="w-1/2 pr-2.5">
              <MetricCell format={(value) => value} label="Realized P&L" metric={stats.realizedPnl} />
            </View>
            <View className="w-1/2 pl-2.5">
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
    <View className="pt-3">
      {/* 1. App Hero Identity Block */}
      <View className="px-5 flex-row items-start gap-4">
        <View style={{ borderRadius: 18, borderWidth: 1, borderColor: colors.line, overflow: "hidden" }}>
          <AgentIcon category={agent.category} size={76} uri={agent.iconUrl} />
        </View>

        <View className="flex-1 min-w-0 pt-0.5">
          <Text
            className="text-[21px] font-bold tracking-[-0.4px] leading-tight"
            ellipsizeMode="tail"
            numberOfLines={2}
            style={{ color: colors.ink }}
          >
            {agent.name}
          </Text>

          <View className="flex-row items-center gap-1.5 mt-1.5 flex-wrap">
            <Text
              className="text-[13px] font-bold"
              ellipsizeMode="tail"
              numberOfLines={1}
              style={{ color: colors.goldDark }}
            >
              {agent.publisher}
            </Text>
            {isRegistered ? (
              <CategoryGlyph color={colors.goldDark} name="check" size={13} strokeWidth={2.4} />
            ) : null}
          </View>

          <Text
            className="text-[12px] mt-1"
            ellipsizeMode="tail"
            numberOfLines={1}
            style={{ color: colors.muted }}
          >
            Decentralized Finance · Autonomous Agent
          </Text>

          <Text
            className="text-[11px] mt-0.5"
            ellipsizeMode="tail"
            numberOfLines={1}
            style={{ color: colors.faint }}
          >
            Contains smart contract transactions · Non-custodial
          </Text>
        </View>
      </View>

      {/* 2. Responsive Horizontally-Scrollable Quick-Stats Strip */}
      <View className="my-4">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: 20,
            gap: 8,
            alignItems: "center",
          }}
        >
          {/* Stat 1: Trust Rating */}
          <View
            style={{
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: 14,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.line,
              alignItems: "center",
              minWidth: 84,
            }}
          >
            <View className="flex-row items-center gap-1">
              <Text className="text-[14px] font-bold" style={{ color: colors.ink }}>
                4.9
              </Text>
              <CategoryGlyph color={colors.gold} name="star" size={12} />
            </View>
            <Text className="text-[10px] mt-0.5 font-medium" style={{ color: colors.muted }}>
              Trust rating
            </Text>
          </View>

          {/* Stat 2: Standard */}
          <View
            style={{
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: 14,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.line,
              alignItems: "center",
              minWidth: 84,
            }}
          >
            <Text className="text-[14px] font-bold" style={{ color: colors.ink }}>
              ERC-8004
            </Text>
            <Text className="text-[10px] mt-0.5 font-medium" style={{ color: colors.muted }}>
              Standard
            </Text>
          </View>

          {/* Stat 3: Category */}
          <View
            style={{
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: 14,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.line,
              alignItems: "center",
              minWidth: 84,
            }}
          >
            <View className="flex-row items-center gap-1">
              <CategoryGlyph color={colors.goldDark} name={agent.category} size={13} />
              <Text className="text-[13px] font-bold" style={{ color: colors.ink }}>
                {categoryLabels[agent.category]}
              </Text>
            </View>
            <Text className="text-[10px] mt-0.5 font-medium" style={{ color: colors.muted }}>
              Category
            </Text>
          </View>

          {/* Stat 4: Verification */}
          <View
            style={{
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: 14,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.line,
              alignItems: "center",
              minWidth: 84,
            }}
          >
            <Text className="text-[14px] font-bold" style={{ color: isRegistered ? colors.goldDark : colors.ink }}>
              {isRegistered ? "Verified" : "Audited"}
            </Text>
            <Text className="text-[10px] mt-0.5 font-medium" style={{ color: colors.muted }}>
              Onchain audit
            </Text>
          </View>

          {/* Stat 5: Executions */}
          <View
            style={{
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: 14,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.line,
              alignItems: "center",
              minWidth: 84,
            }}
          >
            <Text className="text-[14px] font-bold" style={{ color: colors.ink }}>
              {agent.recentActivity.length > 0 ? `${agent.recentActivity.length}+` : "Active"}
            </Text>
            <Text className="text-[10px] mt-0.5 font-medium" style={{ color: colors.muted }}>
              Executions
            </Text>
          </View>
        </ScrollView>
      </View>

      {/* 3. Primary Luxury Gold Action ("Hire Agent") */}
      <View className="px-5 mb-6 flex-row items-center gap-3">
        <PressableScale
          accessibilityLabel={actionLabel}
          accessibilityRole="button"
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onHire();
          }}
          containerStyle={{
            flex: 1,
            height: 48,
            borderRadius: radii.pill,
            backgroundColor: colors.gold,
            alignItems: "center",
            justifyContent: "center",
            ...shadows.goldGlow,
          }}
        >
          <Text className="text-[15px] font-bold tracking-[-0.2px]" style={{ color: colors.ink }}>
            {actionLabel}
          </Text>
        </PressableScale>

        <PressableScale
          accessibilityLabel={isBookmarked ? "Remove from watchlist" : "Add to watchlist"}
          accessibilityRole="button"
          onPress={handleToggleBookmark}
          containerStyle={{
            height: 48,
            width: 48,
            borderRadius: 24,
            borderWidth: 1,
            borderColor: isBookmarked ? colors.goldBorder : colors.line,
            backgroundColor: isBookmarked ? colors.goldSoft : colors.surface,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <CategoryGlyph
            color={isBookmarked ? colors.goldDark : colors.ink}
            name={isBookmarked ? "check" : "sparkle"}
            size={18}
          />
        </PressableScale>
      </View>

      {/* 4. App Telemetry Previews Horizontal Carousel */}
      <View className="mb-7">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
        >
          {/* Preview Card 1: Strategy & Live Telemetry */}
          <View
            style={{
              width: 256,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: colors.line,
              backgroundColor: colors.surface,
              padding: 16,
              justifyContent: "space-between",
            }}
          >
            <View>
              <View className="flex-row items-center justify-between mb-3">
                <View className="flex-row items-center gap-1.5">
                  <View
                    style={{
                      height: 8,
                      width: 8,
                      borderRadius: 4,
                      backgroundColor: colors.gold,
                    }}
                  />
                  <Text
                    className="text-[11px] font-bold tracking-wider uppercase"
                    style={{ color: colors.goldDark }}
                  >
                    Live Telemetry
                  </Text>
                </View>
                <CategoryGlyph color={colors.goldDark} name={agent.category} size={15} />
              </View>

              <Text
                className="text-[14px] font-bold leading-5"
                ellipsizeMode="tail"
                numberOfLines={3}
                style={{ color: colors.ink }}
              >
                {agent.tagline}
              </Text>
            </View>

            <View className="mt-3 pt-3 border-t flex-row items-center justify-between" style={{ borderColor: colors.lineLight }}>
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
              borderRadius: 18,
              borderWidth: 1,
              borderColor: colors.line,
              backgroundColor: colors.surface,
              padding: 16,
              justifyContent: "space-between",
            }}
          >
            <View>
              <View className="flex-row items-center justify-between mb-3">
                <View className="flex-row items-center gap-1.5">
                  <CategoryGlyph color={colors.goldDark} name="shield" size={14} />
                  <Text
                    className="text-[11px] font-bold tracking-wider uppercase"
                    style={{ color: colors.goldDark }}
                  >
                    Data Safety
                  </Text>
                </View>
                <View
                  className="px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: colors.goldSoft }}
                >
                  <Text className="text-[10px] font-bold" style={{ color: colors.goldDark }}>
                    Non-Custodial
                  </Text>
                </View>
              </View>

              <Text
                className="text-[14px] font-bold"
                style={{ color: colors.ink }}
              >
                Altana Passkey Protected
              </Text>
              <Text
                className="text-[12px] leading-4 mt-1"
                ellipsizeMode="tail"
                numberOfLines={2}
                style={{ color: colors.muted }}
              >
                Session delegation grants execution budget without exposing private keys.
              </Text>
            </View>

            <View className="mt-3 pt-3 border-t flex-row items-center justify-between" style={{ borderColor: colors.lineLight }}>
              <Text className="text-[11px]" style={{ color: colors.muted }}>
                Payments
              </Text>
              <Text className="text-[11px] font-semibold" style={{ color: colors.goldDark }}>
                BNB x402 Streaming
              </Text>
            </View>
          </View>

          {/* Preview Card 3: ERC-8004 Registry Specs */}
          <View
            style={{
              width: 256,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: colors.line,
              backgroundColor: colors.surface,
              padding: 16,
              justifyContent: "space-between",
            }}
          >
            <View>
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
                <Text className="text-[11px] font-bold" style={{ color: colors.goldDark }}>
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
                ellipsizeMode="middle"
                numberOfLines={1}
                style={{ color: colors.muted }}
              >
                Registry: {shortAddress(agent.registryAddress)}
              </Text>
            </View>

            <View className="mt-3 pt-3 border-t flex-row items-center justify-between" style={{ borderColor: colors.lineLight }}>
              <Text className="text-[11px]" style={{ color: colors.muted }}>
                Classification
              </Text>
              <Text className="text-[11px] font-semibold capitalize" style={{ color: colors.ink }}>
                {agent.classificationSource.replaceAll("-", " ")}
              </Text>
            </View>
          </View>
        </ScrollView>
      </View>

      {/* 5. "About this agent" */}
      <View className="mb-7">
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
              <Text className="text-[14px] font-semibold" style={{ color: colors.goldDark }}>
                {expandedAbout ? "Show less" : "Show more"}
              </Text>
            </PressableScale>
          ) : null}

          {/* Luxury Gold Tag Pills */}
          <View className="mt-4 flex-row flex-wrap gap-2">
            <View
              className="px-3 py-1.5 rounded-full"
              style={{
                backgroundColor: colors.goldSoft,
                borderWidth: 1,
                borderColor: colors.goldBorder,
              }}
            >
              <Text className="text-[12px] font-semibold" style={{ color: colors.goldDark }}>
                #{categoryLabels[agent.category]}
              </Text>
            </View>
            <View
              className="px-3 py-1.5 rounded-full"
              style={{
                backgroundColor: colors.surfaceSubtle,
                borderWidth: 1,
                borderColor: colors.line,
              }}
            >
              <Text className="text-[12px] font-medium" style={{ color: colors.ink }}>
                #ERC-8004
              </Text>
            </View>
            <View
              className="px-3 py-1.5 rounded-full"
              style={{
                backgroundColor: colors.surfaceSubtle,
                borderWidth: 1,
                borderColor: colors.line,
              }}
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
                  backgroundColor: skill.evidence === "verified" ? colors.goldSoft : colors.surfaceSubtle,
                  borderWidth: 1,
                  borderColor: skill.evidence === "verified" ? colors.goldBorder : colors.line,
                }}
              >
                <Text
                  className="text-[12px] font-medium"
                  style={{
                    color: skill.evidence === "verified" ? colors.goldDark : colors.ink,
                  }}
                >
                  {skill.name}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      {/* 6. "Data safety & trust" Card */}
      <View className="mb-7 px-5">
        <PlayStoreSectionHeading title="Data safety & trust" />
        <View
          style={{
            borderRadius: 18,
            borderWidth: 1,
            borderColor: colors.line,
            backgroundColor: colors.surface,
            padding: 18,
          }}
        >
          <Text className="text-[13px] leading-5 mb-4" style={{ color: colors.muted }}>
            Safety starts with understanding how developers verify contracts, handle permissions, and manage keys.
          </Text>

          <View className="gap-3.5">
            <View className="flex-row items-start gap-3">
              <View className="mt-0.5">
                <CategoryGlyph color={colors.goldDark} name="shield" size={17} />
              </View>
              <View className="flex-1 min-w-0">
                <Text className="text-[13px] font-bold" style={{ color: colors.ink }}>
                  Non-custodial execution
                </Text>
                <Text className="text-[12px] mt-0.5 leading-4" style={{ color: colors.muted }}>
                  Agent smart contract logic cannot transfer or withdraw user principal funds.
                </Text>
              </View>
            </View>

            <View className="flex-row items-start gap-3">
              <View className="mt-0.5">
                <CategoryGlyph color={colors.goldDark} name="check" size={17} />
              </View>
              <View className="flex-1 min-w-0">
                <Text className="text-[13px] font-bold" style={{ color: colors.ink }}>
                  Altana passkey session delegation
                </Text>
                <Text className="text-[12px] mt-0.5 leading-4" style={{ color: colors.muted }}>
                  Automated actions require cryptographic session grants with strict time & gas bounds.
                </Text>
              </View>
            </View>

            <View className="flex-row items-start gap-3">
              <View className="mt-0.5">
                <CategoryGlyph color={colors.goldDark} name="layers" size={17} />
              </View>
              <View className="flex-1 min-w-0">
                <Text className="text-[13px] font-bold" style={{ color: colors.ink }}>
                  ERC-8004 Registry verified
                </Text>
                <Text className="text-[12px] mt-0.5 leading-4" style={{ color: colors.muted }}>
                  Identity token #{agent.tokenId} registered on BNB Smart Chain.
                </Text>
              </View>
            </View>
          </View>
        </View>
      </View>

      {/* 7. Live Telemetry & Signals */}
      <View className="mb-7 px-5">
        <PlayStoreSectionHeading title="Live telemetry & signals" />
        <LiveStats agent={agent} />
      </View>

      {/* 8. Ratings & Track record */}
      <View className="mb-7 px-5">
        <PlayStoreSectionHeading title="Ratings and performance" />
        <View
          className="mb-3 p-4 flex-row items-center justify-between"
          style={{
            borderRadius: 18,
            borderWidth: 1,
            borderColor: colors.line,
            backgroundColor: colors.surface,
          }}
        >
          {/* Left score block */}
          <View className="items-center pr-4 border-r" style={{ borderColor: colors.lineLight }}>
            <Text className="text-[30px] font-bold tracking-tight" style={{ color: colors.ink }}>
              4.9
            </Text>
            <View className="flex-row gap-0.5 my-1">
              {[1, 2, 3, 4, 5].map((s) => (
                <CategoryGlyph color={colors.gold} key={s} name="star" size={12} />
              ))}
            </View>
            <Text className="text-[10px] font-medium" style={{ color: colors.muted }}>
              Onchain audited
            </Text>
          </View>

          {/* Right horizontal progress bars */}
          <View className="flex-1 pl-4 gap-1.5 min-w-0">
            {[
              { star: "5", pct: "92%" },
              { star: "4", pct: "8%" },
              { star: "3", pct: "0%" },
              { star: "2", pct: "0%" },
              { star: "1", pct: "0%" },
            ].map(({ star, pct }) => (
              <View className="flex-row items-center gap-2" key={star}>
                <Text className="text-[10px] w-2.5 font-medium" style={{ color: colors.muted }}>
                  {star}
                </Text>
                <View
                  className="flex-1 h-1.5 rounded-full overflow-hidden"
                  style={{ backgroundColor: colors.surfaceSubtle }}
                >
                  <View
                    className="h-full rounded-full"
                    style={{
                      width: pct as DimensionValue,
                      backgroundColor: colors.gold,
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
      <View className="mb-7 px-5">
        <PlayStoreSectionHeading title="Recent onchain activity" />
        {agent.recentActivity.length > 0 ? (
          <Surface
            style={{
              borderWidth: 1,
              borderColor: colors.line,
              shadowOpacity: 0.02,
              elevation: 1,
            }}
          >
            {agent.recentActivity.map((activity, index) => (
              <View
                className={index === 0 ? "pb-3.5" : "border-t py-3.5"}
                key={`${activity.timestamp}-${activity.action}`}
                style={{ borderColor: colors.lineLight }}
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
      <View className="mb-7 px-5">
        <PlayStoreSectionHeading title="App info & contract specifications" />
        <Surface
          style={{
            borderWidth: 1,
            borderColor: colors.line,
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
              className={index === 0 ? "flex-row items-center justify-between pb-3.5" : "flex-row items-center justify-between border-t py-3.5"}
              key={label}
              style={{ borderColor: colors.lineLight }}
            >
              <Text className="text-[12px] flex-shrink-0 mr-3" style={{ color: colors.muted }}>
                {label}
              </Text>
              <Text
                className="flex-1 text-right text-[12px] font-semibold capitalize"
                ellipsizeMode="middle"
                numberOfLines={1}
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
