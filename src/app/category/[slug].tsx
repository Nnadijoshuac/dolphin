import { useState } from "react";
import {
  ScrollView,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";

import { AgentCard } from "@/components/agent-card";
import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { SectionHeading } from "@/components/section-heading";
import { StatePanel } from "@/components/state-panel";
import { AGENT_CATEGORIES } from "@/constants/agents";
import { colors, radii, shadows } from "@/constants/theme";
import { useAgentsByCategory } from "@/hooks/use-agents";
import type { AgentCategory } from "@/types/agent";

export default function CategoryDetailRoute() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const categorySlug = (slug as AgentCategory) || "monitoring";
  
  const categoryInfo =
    AGENT_CATEGORIES.find((c) => c.slug === categorySlug) ??
    AGENT_CATEGORIES[0];

  const { data: agents, isLoading, isError } = useAgentsByCategory(categorySlug);

  const [sortBy, setSortBy] = useState<"featured" | "reputation">("featured");

  const sortedAgents = [...(agents ?? [])].sort((a, b) => {
    if (sortBy === "reputation") {
      const aRep = a.reputationScore.status === "live" ? a.reputationScore.value : 0;
      const bRep = b.reputationScore.status === "live" ? b.reputationScore.value : 0;
      return bRep - aRep;
    }
    return 0;
  });

  return (
    <SafeAreaView
      className="flex-1"
      edges={["top", "left", "right"]}
      style={{ backgroundColor: colors.canvas }}
    >
      {/* Navigation Header */}
      <View
        className="flex-row items-center justify-between px-6 pt-2 pb-3 border-b"
        style={{ borderColor: colors.line }}
      >
        <PressableScale
          accessibilityLabel="Go back"
          accessibilityRole="button"
          onPress={() => router.back()}
          containerStyle={{
            height: 38,
            width: 38,
            borderRadius: 19,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.line,
            alignItems: "center",
            justifyContent: "center",
            ...shadows.card,
          }}
        >
          <Text className="text-[17px] font-bold" style={{ color: colors.ink }}>
            ‹
          </Text>
        </PressableScale>

        <Text
          className="text-[16px] font-bold"
          numberOfLines={1}
          style={{ color: colors.ink }}
        >
          {categoryInfo.label}
        </Text>

        <View className="h-9 w-9" />
      </View>

      <ScrollView
        className="flex-1 px-6"
        contentContainerStyle={{ paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Category Header Banner */}
        <View className="mt-5 p-5 rounded-2xl bg-slate-900" style={{ ...shadows.card }}>
          <View className="flex-row items-center gap-3">
            <View className="h-12 w-12 items-center justify-center rounded-2xl bg-white/10">
              <CategoryGlyph color="#FFFFFF" name={categorySlug} size={24} />
            </View>
            <View className="flex-1">
              <Text className="text-[22px] font-extrabold text-white">
                {categoryInfo.label}
              </Text>
              <Text className="mt-1 text-[13px] text-slate-300">
                {categoryInfo.description}
              </Text>
            </View>
          </View>
        </View>

        {/* Filter / Sort bar */}
        <View className="mt-6 flex-row items-center justify-between">
          <SectionHeading title={`All ${categoryInfo.label} Agents`} />

          <View className="flex-row items-center gap-2">
            <PressableScale
              accessibilityLabel="Sort by featured"
              accessibilityRole="button"
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setSortBy("featured");
              }}
              containerStyle={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 14,
                backgroundColor: sortBy === "featured" ? colors.ink : colors.surface,
                borderWidth: 1,
                borderColor: sortBy === "featured" ? colors.ink : colors.line,
              }}
            >
              <Text
                className="text-[12px] font-bold"
                style={{ color: sortBy === "featured" ? "#FFFFFF" : colors.muted }}
              >
                Featured
              </Text>
            </PressableScale>

            <PressableScale
              accessibilityLabel="Sort by reputation"
              accessibilityRole="button"
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setSortBy("reputation");
              }}
              containerStyle={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 14,
                backgroundColor: sortBy === "reputation" ? colors.ink : colors.surface,
                borderWidth: 1,
                borderColor: sortBy === "reputation" ? colors.ink : colors.line,
              }}
            >
              <Text
                className="text-[12px] font-bold"
                style={{ color: sortBy === "reputation" ? "#FFFFFF" : colors.muted }}
              >
                Reputation
              </Text>
            </PressableScale>
          </View>
        </View>

        {/* Agent List */}
        {isLoading ? (
          <View className="py-12">
            <StatePanel
              body="Loading category listings from BSC..."
              state="syncing"
              title="Loading"
            />
          </View>
        ) : isError ? (
          <View className="py-12">
            <StatePanel
              body="Failed to fetch agents for this category."
              state="unavailable"
              title="Error"
            />
          </View>
        ) : sortedAgents.length > 0 ? (
          <View className="mt-3 gap-4">
            {sortedAgents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push({
                    pathname: "/agent/[id]",
                    params: { id: agent.tokenId },
                  });
                }}
              />
            ))}
          </View>
        ) : (
          <View className="py-12">
            <StatePanel
              body="No registered agents found in this category yet."
              state="unavailable"
              title="No Agents"
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
