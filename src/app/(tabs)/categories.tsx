import { useMemo, useState } from "react";
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
import { AppHeader } from "@/components/app-header";
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

  const filteredAgents = useMemo(() => {
    if (!agents) return [];
    return agents.filter((agent) => agent.category === activeCategory);
  }, [agents, activeCategory]);

  const handleAgentPress = (agent: Agent) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: "/agent/[id]",
      params: { id: agent.tokenId },
    });
  };

  const handleSelectCategory = (slug: AgentCategory) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveCategory(slug);
  };

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
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[1]}
      >
        {/* Child 0: Top Dolphin Write-up Header */}
        <View>
          <AppHeader />
        </View>

        {/* Child 1: Sticky Title & Category Filter Tabs */}
        <View
          style={{
            backgroundColor: colors.canvas,
            zIndex: 10,
          }}
        >
          {/* Categories Title */}
          <View className="px-6 pb-2 pt-1">
            <Text
              className="text-[34px] font-black tracking-[-1px]"
              style={{ color: colors.ink }}
            >
              Categories
            </Text>
          </View>

          {/* Category Filter Tabs */}
          <View className="px-6 pt-1 pb-3">
            <View className="border-b" style={{ borderColor: "rgba(17,18,20,0.06)" }}>
              <ScrollView
                contentContainerStyle={{ gap: 24, paddingRight: 16 }}
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
                        paddingBottom: 8,
                        paddingTop: 4,
                        alignItems: "center",
                        position: "relative",
                      }}
                    >
                      <Text
                        className="text-[14px]"
                        style={{
                          color: isActive ? colors.ink : "#7A7B7E",
                          fontWeight: isActive ? "800" : "500",
                        }}
                      >
                        {cat.label}
                      </Text>

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

        {/* Agent Cards Listing */}
        <View className="px-6 pt-2">
          {isLoading ? (
            <View className="py-8">
              <StatePanel
                body="Fetching 8004scan-indexed BSC agent records..."
                state="syncing"
                title="Loading Categories"
              />
            </View>
          ) : isError ? (
            <View className="py-8">
              <StatePanel
                body="Unable to connect to registry API. Please check your connection."
                state="unavailable"
                title="Sync Failed"
              />
            </View>
          ) : filteredAgents.length === 0 ? (
            <View className="py-8">
              <StatePanel
                body="No agents found in this category. Check back soon."
                state="unavailable"
                title="No Agents Found"
              />
            </View>
          ) : (
            <View className="gap-3.5">
              {filteredAgents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  onPress={() => handleAgentPress(agent)}
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
