import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { useMemo, useRef, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
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

const DISCOVER_HEADER_HEIGHT = 48;
const CATEGORY_DOCK_HEIGHT = 44;

export default function DiscoverScreen() {
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const [activeCategory, setActiveCategory] = useState<AgentCategory>("monitoring");
  const horizontalScrollRef = useRef<ScrollView>(null);
  const { data: agents, isLoading, isError, refetch, isRefetching } = useAgents();

  const [appHeaderHeight, setAppHeaderHeight] = useState(64);
  const [heroHeight, setHeroHeight] = useState(210);

  const scrollY = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });

  const coinPlayer = useVideoPlayer(coinVideoSource, (player) => {
    player.loop = true;
    player.muted = true;
    player.playbackRate = 1.0;
    player.play();
  });

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
    const index = AGENT_CATEGORIES.findIndex((c) => c.slug === slug);
    if (index !== -1) {
      horizontalScrollRef.current?.scrollTo({
        x: index * screenWidth,
        animated: true,
      });
    }
  };

  // Discover header translates from its position below AppHeader up to y=0, then sticks at y=0
  const discoverAnimatedStyle = useAnimatedStyle(() => {
    const translateY = Math.max(0, appHeaderHeight - scrollY.value);
    return {
      transform: [{ translateY }],
    };
  });

  // Category dock translates from below Hero Card up to y=48 (under Discover), then sticks at y=48
  const dockAnimatedStyle = useAnimatedStyle(() => {
    const dockInitialY = appHeaderHeight + DISCOVER_HEADER_HEIGHT + heroHeight;
    const translateY = Math.max(DISCOVER_HEADER_HEIGHT, dockInitialY - scrollY.value);
    return {
      transform: [{ translateY }],
    };
  });

  return (
    <SafeAreaView
      className="flex-1"
      edges={["top", "left", "right"]}
      style={{ backgroundColor: colors.canvas, position: "relative" }}
    >
      <ConstellationBg opacity={0.3} />

      {/* Floating Animated Tier 1: Discover Header (Hits top first and sticks at y=0) */}
      <Animated.View
        style={[
          discoverAnimatedStyle,
          {
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: DISCOVER_HEADER_HEIGHT,
            backgroundColor: colors.canvas,
            zIndex: 30,
          },
        ]}
      >
        <View className="flex-row items-center justify-between px-4 pb-2 pt-1">
          <Text
            className="text-[30px] font-black tracking-[-1px]"
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
      </Animated.View>

      {/* Floating Animated Tier 2: Category Tabs Dock (Hits under Discover and sticks at y=48) */}
      <Animated.View
        style={[
          dockAnimatedStyle,
          {
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: CATEGORY_DOCK_HEIGHT,
            backgroundColor: colors.canvas,
            zIndex: 29,
          },
        ]}
      >
        <View className="px-4 pb-1 pt-1">
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
      </Animated.View>

      {/* Main Scroll Content */}
      <Animated.ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 120 }}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
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
      >
        {/* Child 0: Top Dolphin Writeup Header (Measures height for smooth scroll-off) */}
        <View
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            if (h > 0 && h !== appHeaderHeight) setAppHeaderHeight(h);
          }}
        >
          <AppHeader />
        </View>

        {/* Child 1: Spacer for Discover Title Bar */}
        <View style={{ height: DISCOVER_HEADER_HEIGHT }} />

        {/* Child 2: Compact Featured Hero Card */}
        <View
          className="px-2 pb-1 pt-1"
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            if (h > 0 && h !== heroHeight) setHeroHeight(h);
          }}
        >
          <PressableScale
            accessibilityLabel="Explore Monitoring Agents collection"
            accessibilityRole="button"
            onPress={() => handleSelectCategory("monitoring")}
            containerStyle={{
              backgroundColor: "#000000",
              borderColor: "rgba(255,255,255,0.08)",
              borderRadius: 26,
              borderWidth: 1,
              overflow: "hidden",
              paddingHorizontal: 20,
              paddingVertical: 24,
              ...shadows.floating,
            }}
          >
            {/* Absolute Background Video */}
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                right: -60,
                top: -15,
                bottom: -15,
                width: 250,
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
                className="self-start rounded-full px-2.5 py-1 mb-2.5 border"
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

        {/* Child 3: Spacer for Category Tabs Dock */}
        <View style={{ height: CATEGORY_DOCK_HEIGHT }} />

        {/* Child 4: Horizontal Swipeable Category Lists Carousel */}
        <ScrollView
          ref={horizontalScrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => {
            const nextIndex = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
            if (nextIndex >= 0 && nextIndex < AGENT_CATEGORIES.length) {
              const nextCategory = AGENT_CATEGORIES[nextIndex].slug;
              if (nextCategory !== activeCategory) {
                setActiveCategory(nextCategory);
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }
            }
          }}
          scrollEventThrottle={16}
        >
          {AGENT_CATEGORIES.map((cat) => {
            const categoryAgents = agents?.filter((agent) => agent.category === cat.slug) ?? [];
            return (
              <View key={cat.slug} style={{ width: screenWidth }} className="px-4 pt-2">
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
                ) : categoryAgents.length === 0 ? (
                  <View className="py-8">
                    <StatePanel
                      body="No agents found in this category. Check back soon."
                      state="unavailable"
                      title="No Agents Found"
                    />
                  </View>
                ) : (
                  <View className="gap-3.5">
                    {categoryAgents.map((agent) => (
                      <AgentCard
                        key={agent.id}
                        agent={agent}
                        onPress={() => handleAgentPress(agent)}
                      />
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      </Animated.ScrollView>
    </SafeAreaView>
  );
}
