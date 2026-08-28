import { useMemo, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useVideoPlayer, VideoView } from "expo-video";
import { SafeAreaView } from "react-native-safe-area-context";

import { AgentCard } from "@/components/agent-card";
import { AppHeader } from "@/components/app-header";
import { CategoryGlyph } from "@/components/category-glyph";
import { ConstellationBg } from "@/components/constellation-bg";
import { PressableScale } from "@/components/pressable-scale";
import { StatePanel } from "@/components/state-panel";
import { AGENT_CATEGORIES } from "@/constants/agents";
import { colors, radii, shadows } from "@/constants/theme";
import { useAgents } from "@/hooks/use-agents";
import type { Agent, AgentCategory } from "@/types/agent";

const coinVideoSource = require("../../../assets/videos/Coin.mp4");

export default function DiscoverScreen() {
  const router = useRouter();
  const [activeCategory, setActiveCategory] = useState<AgentCategory>("monitoring");
  const { data: agents, isLoading, isError, refetch, isRefetching } = useAgents();

  const coinPlayer = useVideoPlayer(coinVideoSource, (player) => {
    player.loop = true;
    player.muted = true;
    player.play();
  });

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
        {/* Child 0: Top Dolphin Writeup Header */}
        <View>
          <AppHeader />
        </View>

        {/* Child 1: Sticky Discover Title Bar with Categories Icon */}
        <View
          className="flex-row items-center justify-between px-6 pb-3 pt-1"
          style={{
            backgroundColor: colors.canvas,
            zIndex: 10,
          }}
        >
          <Text
            className="text-[32px] font-black tracking-[-1px]"
            style={{ color: colors.ink }}
          >
            Discover
          </Text>

          <PressableScale
            accessibilityLabel="View categories"
            accessibilityRole="button"
            onPress={() => router.push("/(tabs)/search")}
            containerStyle={{
              alignItems: "center",
              backgroundColor: "#FFFFFF",
              borderColor: colors.line,
              borderRadius: 9999,
              borderWidth: 1,
              height: 38,
              justifyContent: "center",
              width: 38,
              ...shadows.subtle,
            }}
          >
            <CategoryGlyph color={colors.ink} name="layers" size={18} />
          </PressableScale>
        </View>

        {/* Featured Hero Card */}
        <View className="px-6 pb-2 pt-1">
          <PressableScale
            accessibilityLabel="Explore Monitoring Agents collection"
            accessibilityRole="button"
            onPress={() => setActiveCategory("monitoring")}
            containerStyle={{
              backgroundColor: "#0E0F12",
              borderColor: "rgba(255,255,255,0.08)",
              borderRadius: 28,
              borderWidth: 1,
              overflow: "hidden",
              padding: 20,
              ...shadows.floating,
            }}
          >
            {/* Absolute Background Video */}
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                right: -25,
                top: -10,
                bottom: -10,
                width: 220,
                opacity: 0.95,
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <VideoView
                allowsFullscreen={false}
                allowsPictureInPicture={false}
                contentFit="contain"
                nativeControls={false}
                player={coinPlayer}
                style={{ height: "100%", width: "100%" }}
              />
            </View>

            {/* Foreground Content */}
            <View style={{ zIndex: 10 }}>
              {/* Category Tag */}
              <View
                className="self-start rounded-full px-3 py-1 mb-3 border"
                style={{
                  backgroundColor: "#2A2415",
                  borderColor: "rgba(245, 179, 0, 0.35)",
                }}
              >
                <Text className="text-[10px] font-bold uppercase tracking-[1.5px] text-[#F5B300]">
                  MONITORING
                </Text>
              </View>

              {/* Text Column */}
              <View style={{ maxWidth: "60%" }}>
                <Text className="text-[26px] font-black text-white leading-[30px] tracking-tight">
                  Agents that{"\n"}watch while{"\n"}you sleep
                </Text>

                <Text className="mt-2.5 text-[12px] leading-[18px] text-zinc-400">
                  Autonomous agents that track markets and safeguard your positions 24/7.
                </Text>

                <View className="mt-4 flex-row items-center gap-1.5">
                  <Text className="text-[13px] font-bold text-[#F5B300]">
                    Explore collection
                  </Text>
                  <CategoryGlyph
                    color="#F5B300"
                    name="arrow-right"
                    size={14}
                    strokeWidth={2.5}
                  />
                </View>
              </View>
            </View>

            {/* Carousel Pagination Dots */}
            <View className="mt-4 flex-row items-center justify-center gap-1.5" style={{ zIndex: 10 }}>
              <View className="h-1 w-6 rounded-full bg-[#F5B300]" />
              <View className="h-1 w-4 rounded-full bg-zinc-700" />
              <View className="h-1 w-4 rounded-full bg-zinc-700" />
            </View>
          </PressableScale>
        </View>

        {/* Category Filter Tabs Bar */}
        <View className="px-6 pt-5 pb-3">
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

        {/* Agent Cards Listing for Category */}
        <View className="px-6 pt-2">
          {isLoading ? (
            <View className="py-8">
              <StatePanel
                body="Fetching 8004scan-indexed BSC agent records..."
                state="syncing"
                title="Loading Agents"
              />
            </View>
          ) : isError ? (
            <View className="py-8">
              <StatePanel
                body="Unable to connect to registry API. Please check your network connection."
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
