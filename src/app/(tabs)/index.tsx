import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { useMemo, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AgentCard } from "@/components/agent-card";
import { AppHeader } from "@/components/app-header";
import { CategoryGlyph } from "@/components/category-glyph";
import { ConstellationBg } from "@/components/constellation-bg";
import { PressableScale } from "@/components/pressable-scale";
import { StatePanel } from "@/components/state-panel";
import { AGENT_CATEGORIES } from "@/constants/agents";
import { colors, shadows } from "@/constants/theme";
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
    player.playbackRate = 0.55;
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
          className="flex-row items-center justify-between px-4 pb-3 pt-1"
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

        {/* Compact Featured Hero Card - Wider Layout */}
        <View className="px-2 pb-1 pt-1">
          <PressableScale
            accessibilityLabel="Explore Monitoring Agents collection"
            accessibilityRole="button"
            onPress={() => setActiveCategory("monitoring")}
            containerStyle={{
              backgroundColor: "#000000",
              borderColor: "rgba(255,255,255,0.08)",
              borderRadius: 24,
              borderWidth: 1,
              overflow: "hidden",
              padding: 16,
              ...shadows.floating,
            }}
          >
            {/* Absolute Background Video */}
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                right: -60,
                top: -10,
                bottom: -10,
                width: 230,
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
                className="self-start rounded-full px-2.5 py-0.5 mb-2 border"
                style={{
                  backgroundColor: "#2A2415",
                  borderColor: "rgba(245, 179, 0, 0.35)",
                }}
              >
                <Text className="text-[9.5px] font-bold uppercase tracking-[1.5px] text-[#F5B300]">
                  MONITORING
                </Text>
              </View>

              {/* Text Column */}
              <View style={{ maxWidth: "68%" }}>
                <Text className="text-[22px] font-black text-white leading-[26px] tracking-tight">
                  Agents that watch{"\n"}while you sleep
                </Text>

                <Text className="mt-1.5 text-[11.5px] leading-[16px] text-zinc-400">
                  Autonomous agents that track markets and safeguard your positions 24/7.
                </Text>

                <View className="mt-3 flex-row items-center gap-1.5">
                  <Text className="text-[12.5px] font-bold text-[#F5B300]">
                    Explore collection
                  </Text>
                  <CategoryGlyph
                    color="#F5B300"
                    name="arrow-right"
                    size={13}
                    strokeWidth={2.5}
                  />
                </View>
              </View>
            </View>
          </PressableScale>
        </View>

        {/* Category Filter Tabs Bar */}
        <View className="px-4 pt-5 pb-3">
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
        <View className="px-4 pt-2">
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
