import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AdvertCarousel } from "@/components/advert-carousel";
import { AgentRow } from "@/components/agent-row";
import { AppHeader } from "@/components/app-header";
import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { StatePanel } from "@/components/state-panel";
import { AGENT_CATEGORIES } from "@/constants/agents";
import { colors, shadows } from "@/constants/theme";
import { useAgents } from "@/hooks/use-agents";
import { sortHireableFirst } from "@/services/hireability";
import type { Agent, AgentCategory } from "@/types/agent";

const categoryLabels: Record<AgentCategory, string> = {
  monitoring: "Monitoring",
  rebalancing: "Rebalancing",
  "grid-trading": "Grid trading",
  "health-factor": "Health factor",
  yield: "Yield",
  trading: "Trading",
};

export default function DiscoverScreen() {
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const [activeCategory, setActiveCategory] = useState<AgentCategory>("rebalancing");
  const mainScrollRef = useRef<ScrollView>(null);
  const tabsScrollRef = useRef<ScrollView>(null);
  const horizontalScrollRef = useRef<ScrollView>(null);
  const tabLayouts = useRef<Record<string, { x: number; width: number }>>({});
  const { data: agents, isLoading, isError, refetch, isRefetching } = useAgents();
  const [heroBottom, setHeroBottom] = useState(320);

  const scrollTabIntoView = (slug: AgentCategory) => {
    const layout = tabLayouts.current[slug];
    if (layout && tabsScrollRef.current) {
      const targetX = Math.max(0, layout.x - screenWidth / 2 + layout.width / 2);
      tabsScrollRef.current.scrollTo({
        x: targetX,
        animated: true,
      });
    }
  };

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

    scrollTabIntoView(slug);
  };

  return (
    <SafeAreaView
      className="flex-1"
      edges={["top", "left", "right"]}
      style={{ backgroundColor: colors.canvas }}
    >
      <ScrollView
        ref={mainScrollRef}
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              void refetch();
            }}
            tintColor={colors.goldDark}
          />
        }
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[3]}
      >
        {/* Child 0: Top Dolphin Header */}
        <View>
          <AppHeader />
        </View>

        {/* Child 1: Discover Title Bar */}
        <View
          className="flex-row items-center justify-between px-4 pb-2.5 pt-1"
          style={{
            backgroundColor: colors.canvas,
          }}
        >
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
              backgroundColor: colors.surface,
              borderColor: colors.line,
              borderRadius: 9999,
              borderWidth: 1,
              height: 38,
              justifyContent: "center",
              width: 38,
              ...shadows.subtle,
            }}
          >
            <CategoryGlyph color={colors.goldDark} name="layers" size={18} />
          </PressableScale>
        </View>

        {/* Child 2: Advert Carousel Hero */}
        <View
          onLayout={(e) => {
            setHeroBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height);
          }}
        >
          <AdvertCarousel agents={agents ?? []} onAgentPress={handleAgentPress} />
        </View>

        {/* Child 3: Sticky Luxury Gold Category Navigation Tabs */}
        <View
          className="py-2.5"
          style={{
            backgroundColor: colors.canvas,
            zIndex: 30,
          }}
        >
          <ScrollView
            ref={tabsScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
          >
            {AGENT_CATEGORIES.map((cat) => {
              const isActive = activeCategory === cat.slug;
              return (
                <View
                  key={cat.slug}
                  onLayout={(e) => {
                    tabLayouts.current[cat.slug] = {
                      x: e.nativeEvent.layout.x,
                      width: e.nativeEvent.layout.width,
                    };
                  }}
                >
                  <PressableScale
                    accessibilityLabel={cat.label}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: isActive }}
                    onPress={() => handleSelectCategory(cat.slug)}
                    containerStyle={{
                      paddingVertical: 7,
                      paddingHorizontal: 16,
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 9999,
                      backgroundColor: isActive ? colors.gold : colors.surface,
                      borderWidth: 1,
                      borderColor: isActive ? colors.goldBorder : colors.line,
                      ...(isActive ? shadows.goldGlow : shadows.subtle),
                    }}
                  >
                    <View className="flex-row items-center gap-1.5">
                      {isActive ? (
                        <CategoryGlyph color={colors.ink} name={cat.slug} size={13} />
                      ) : null}
                      <Text
                        className="text-[13px]"
                        style={{
                          color: isActive ? colors.ink : colors.muted,
                          fontWeight: isActive ? "700" : "500",
                        }}
                      >
                        {cat.label}
                      </Text>
                    </View>
                  </PressableScale>
                </View>
              );
            })}
          </ScrollView>
        </View>

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
                scrollTabIntoView(nextCategory);
              }
            }
          }}
          scrollEventThrottle={16}
        >
          {AGENT_CATEGORIES.map((cat) => {
            // Hireable first. A user browsing a category should meet the agents
            // they can actually buy from before the ones they cannot.
            const categoryAgents = sortHireableFirst(
              agents?.filter((agent) => agent.category === cat.slug) ?? [],
            );
            return (
              <View key={cat.slug} style={{ width: screenWidth }} className="px-4 pt-3">
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
                  <View className="gap-3">
                    {categoryAgents.map((agent) => (
                      <AgentRow
                        key={agent.id}
                        agent={agent}
                        onPress={() => handleAgentPress(agent)}
                        subtitle={`${categoryLabels[agent.category]} · ${agent.tagline}`}
                      />
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      </ScrollView>
    </SafeAreaView>
  );
}
