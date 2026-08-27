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

import { AgentCard } from "@/components/agent-card";

import { CategoryGlyph } from "@/components/category-glyph";
import { ConstellationBg } from "@/components/constellation-bg";
import { PressableScale } from "@/components/pressable-scale";
import { StatePanel } from "@/components/state-panel";
import { AGENT_CATEGORIES } from "@/constants/agents";
import { colors } from "@/constants/theme";
import { useAgents } from "@/hooks/use-agents";
import type { Agent, AgentCategory } from "@/types/agent";

export default function CategoriesScreen() {
  const router = useRouter();
  const [activeCategory, setActiveCategory] = useState<AgentCategory>("monitoring");
  const { data: agents, isLoading, isError, refetch, isRefetching } = useAgents();

  const handleSelectCategory = (cat: AgentCategory) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveCategory(cat);
  };

  const handleAgentPress = (agent: Agent) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: "/agent/[id]",
      params: { id: agent.tokenId },
    });
  };

  const filteredAgents =
    agents?.filter((a) => a.category === activeCategory) ?? [];

  return (
    <SafeAreaView
      className="flex-1"
      edges={["top", "left", "right"]}
      style={{ backgroundColor: colors.canvas }}
    >
      <ConstellationBg opacity={0.3} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      {/* Sticky Pinned Top Header with Category Filter Tabs */}
      <View style={{ backgroundColor: colors.canvas, zIndex: 10 }}>
        {/* Categories Page Header */}
        <View className="px-6 pb-2 pt-3">
          <Text
            className="text-[32px] font-bold tracking-[-0.6px]"
            style={{ color: colors.ink }}
          >
            Categories
          </Text>
          <Text className="mt-1 text-[14px]" style={{ color: colors.muted }}>
            Browse agents by operational domain
          </Text>
        </View>

        {/* Top Category Filter Tabs with Gold Indicator */}
        <View className="px-6 pb-2 pt-1">
          <View className="border-b" style={{ borderColor: colors.lineLight }}>
            <ScrollView
              contentContainerStyle={{ gap: 18, paddingRight: 8 }}
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              {AGENT_CATEGORIES.map((cat) => {
                const isActive = activeCategory === cat.slug;
                return (
                  <PressableScale
                    key={cat.slug}
                    accessibilityLabel={cat.label}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: isActive }}
                    onPress={() => handleSelectCategory(cat.slug)}
                    containerStyle={{
                      paddingVertical: 10,
                      paddingHorizontal: 4,
                      alignItems: "center",
                      position: "relative",
                    }}
                  >
                    <View className="flex-row items-center gap-1.5 pb-1">
                      <CategoryGlyph
                        color={isActive ? colors.ink : colors.muted}
                        name={cat.slug}
                        size={16}
                      />
                      <Text
                        className="text-[13px]"
                        style={{
                          color: isActive ? colors.ink : colors.muted,
                          fontWeight: isActive ? "800" : "500",
                        }}
                      >
                        {cat.label}
                      </Text>
                    </View>

                    {isActive ? (
                      <View
                        className="absolute bottom-0 h-1 w-full rounded-full"
                        style={{ backgroundColor: colors.gold }}
                      />
                    ) : null}
                  </PressableScale>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 120, paddingTop: 4 }}
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
        {/* Agent Cards Listing */}
        <View className="px-6 pt-2">
          {isLoading ? (
            <View className="py-12">
              <StatePanel
                body="Fetching indexed registry records for this specialization..."
                state="syncing"
                title="Loading Categories"
              />
            </View>
          ) : isError ? (
            <View className="py-12">
              <StatePanel
                body="Unable to connect to registry API. Please check your network connection."
                state="unavailable"
                title="Sync Failed"
              />
            </View>
          ) : filteredAgents.length > 0 ? (
            <View className="gap-3.5">
              {filteredAgents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  onPress={() => handleAgentPress(agent)}
                />
              ))}
            </View>
          ) : (
            <View className="py-12">
              <StatePanel
                body="No published agents are currently indexed under this category."
                state="unavailable"
                title="No Agents Found"
              />
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
