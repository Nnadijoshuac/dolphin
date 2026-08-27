import { useState } from "react";
import {
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";

import { AgentIcon } from "@/components/agent-icon";
import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { StatePanel } from "@/components/state-panel";
import { StatusBadge } from "@/components/status-badge";
import { AGENT_CATEGORIES } from "@/constants/agents";
import { colors, radii, shadows } from "@/constants/theme";
import { useAgents } from "@/hooks/use-agents";
import type { Agent, AgentCategory } from "@/types/agent";

function renderCompactStat(agent: Agent) {
  const stats = agent.liveStats;
  switch (stats.category) {
    case "monitoring":
      return stats.alertFrequency.status === "live"
        ? `Alerts: ${stats.alertFrequency.value}`
        : stats.alertFrequency.status === "syncing"
          ? "Stats syncing"
          : "Stats not reported";
    case "grid-trading":
      return stats.winRate.status === "live"
        ? `Win rate ${stats.winRate.value.toFixed(1)}%`
        : stats.winRate.status === "syncing"
          ? "Stats syncing"
          : "Stats not reported";
    case "health-factor":
      return stats.averageHealthFactor.status === "live"
        ? `Avg Health ${stats.averageHealthFactor.value.toFixed(2)}`
        : stats.averageHealthFactor.status === "syncing"
          ? "Stats syncing"
          : "Stats not reported";
    case "yield":
      return stats.currentApy.status === "live"
        ? `${stats.currentApy.value.toFixed(1)}% APY`
        : stats.currentApy.status === "syncing"
          ? "Stats syncing"
          : "Stats not reported";
  }
}

export default function CategoriesScreen() {
  const router = useRouter();
  const [selectedCategory, setSelectedCategory] = useState<AgentCategory | "all">("all");
  const { data: agents, isLoading, isError, refetch, isRefetching } = useAgents();

  const handleSelectCategory = (cat: AgentCategory | "all") => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedCategory(cat);
  };

  const handleAgentPress = (agent: Agent) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: "/agent/[id]",
      params: { id: agent.tokenId },
    });
  };

  const handleSeeAll = (slug: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: "/category/[slug]",
      params: { slug },
    });
  };

  const visibleCategories =
    selectedCategory === "all"
      ? AGENT_CATEGORIES
      : AGENT_CATEGORIES.filter((c) => c.slug === selectedCategory);

  return (
    <SafeAreaView
      className="flex-1"
      edges={["top", "left", "right"]}
      style={{ backgroundColor: colors.canvas }}
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 110 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              void refetch();
            }}
            tintColor={colors.ink}
          />
        }
      >
        {/* Title Header */}
        <View className="px-6 pt-3 pb-2">
          <Text
            className="text-[34px] font-extrabold tracking-[-1px]"
            style={{ color: colors.ink }}
          >
            Categories
          </Text>
          <Text
            className="mt-1 text-[15px]"
            style={{ color: colors.muted }}
          >
            Curated specializations on BNB Smart Chain
          </Text>
        </View>

        {/* Top Category Filter Chips (Equal Visual Weight) */}
        <View className="mt-4">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 24, gap: 8 }}
          >
            <PressableScale
              accessibilityLabel="Show all categories"
              accessibilityRole="button"
              onPress={() => handleSelectCategory("all")}
              containerStyle={{
                paddingHorizontal: 16,
                paddingVertical: 10,
                borderRadius: 20,
                backgroundColor:
                  selectedCategory === "all" ? colors.ink : colors.surface,
                borderWidth: 1,
                borderColor:
                  selectedCategory === "all" ? colors.ink : colors.line,
                ...shadows.card,
              }}
            >
              <Text
                className="text-[13px] font-bold"
                style={{
                  color: selectedCategory === "all" ? "#FFFFFF" : colors.ink,
                }}
              >
                All
              </Text>
            </PressableScale>

            {AGENT_CATEGORIES.map((cat) => {
              const isSelected = selectedCategory === cat.slug;
              return (
                <PressableScale
                  key={cat.slug}
                  accessibilityLabel={cat.label}
                  accessibilityRole="button"
                  onPress={() => handleSelectCategory(cat.slug)}
                  containerStyle={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                    borderRadius: 20,
                    backgroundColor: isSelected ? colors.ink : colors.surface,
                    borderWidth: 1,
                    borderColor: isSelected ? colors.ink : colors.line,
                    ...shadows.card,
                  }}
                >
                  <CategoryGlyph
                    color={isSelected ? "#FFFFFF" : colors.ink}
                    name={cat.slug}
                    size={14}
                  />
                  <Text
                    className="text-[13px] font-bold"
                    style={{
                      color: isSelected ? "#FFFFFF" : colors.ink,
                    }}
                  >
                    {cat.label}
                  </Text>
                </PressableScale>
              );
            })}
          </ScrollView>
        </View>

        {isLoading ? (
          <View className="px-6 py-12">
            <StatePanel
              body="Fetching indexed registry records and their available source labels..."
              state="syncing"
              title="Loading Categories"
            />
          </View>
        ) : isError ? (
          <View className="px-6 py-12">
            <StatePanel
              body="Unable to connect to registry API. Please check your network connection."
              state="unavailable"
              title="Sync Failed"
            />
          </View>
        ) : (
          <View className="mt-6 px-6 gap-8">
            {visibleCategories.map((cat) => {
              const categoryAgents = agents?.filter((a) => a.category === cat.slug) ?? [];

              return (
                <View key={cat.slug} className="gap-3">
                  {/* Category Header */}
                  <View className="flex-row items-center justify-between border-b pb-3" style={{ borderColor: colors.line }}>
                    <View className="flex-row items-center gap-2.5">
                      <View className="h-8 w-8 items-center justify-center rounded-xl bg-slate-100">
                        <CategoryGlyph color={colors.ink} name={cat.slug} size={18} />
                      </View>
                      <View>
                        <Text className="text-[19px] font-bold tracking-tight" style={{ color: colors.ink }}>
                          {cat.label}
                        </Text>
                        <Text className="text-[12px]" style={{ color: colors.muted }}>
                          {cat.description}
                        </Text>
                      </View>
                    </View>

                    <PressableScale
                      accessibilityLabel={`See all ${cat.label} agents`}
                      accessibilityRole="button"
                      onPress={() => handleSeeAll(cat.slug)}
                    >
                      <Text className="text-[13px] font-bold text-blue-600">
                        See All
                      </Text>
                    </PressableScale>
                  </View>

                  {/* Category Agents (App Store "Apps" listing row style) */}
                  <View className="gap-2.5">
                    {categoryAgents.length > 0 ? (
                      categoryAgents.map((agent) => (
                        <PressableScale
                          key={agent.id}
                          accessibilityLabel={agent.name}
                          accessibilityRole="button"
                          onPress={() => handleAgentPress(agent)}
                          containerStyle={{
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: 14,
                            borderRadius: radii.large,
                            backgroundColor: colors.surface,
                            borderWidth: 1,
                            borderColor: colors.line,
                            ...shadows.card,
                          }}
                        >
                          <View className="flex-1 flex-row items-center gap-3.5 mr-3">
                            <AgentIcon
                              category={agent.category}
                              size={48}
                              uri={agent.iconUrl}
                            />
                            <View className="flex-1">
                              <Text
                                className="text-[16px] font-bold"
                                numberOfLines={1}
                                style={{ color: colors.ink }}
                              >
                                {agent.name}
                              </Text>
                              <Text
                                className="text-[12px] leading-4"
                                numberOfLines={1}
                                style={{ color: colors.muted }}
                              >
                                {agent.tagline}
                              </Text>
                              <Text
                                className="mt-1 text-[11px] font-semibold text-slate-700"
                                numberOfLines={1}
                              >
                                {renderCompactStat(agent)}
                              </Text>
                            </View>
                          </View>

                          <View className="rounded-full bg-slate-100 px-3.5 py-1.5">
                            <Text className="text-[12px] font-bold text-slate-900">
                              VIEW
                            </Text>
                          </View>
                        </PressableScale>
                      ))
                    ) : (
                      <View className="py-4">
                        <StatusBadge label="No agents in this category yet" tone="neutral" />
                      </View>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
