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
  const horizontalScrollRef = useRef<ScrollView>(null);
  const { data: agents, isLoading, isError, refetch, isRefetching } = useAgents();

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

  const [isTabsSticky, setIsTabsSticky] = useState(false);
  const [heroBottom, setHeroBottom] = useState(320);

  const categoryTabsElement = (
    <View
      className="pt-3 pb-3"
      style={{
        backgroundColor: colors.canvas,
      }}
    >
      <ScrollView 
        horizontal 
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
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
                paddingVertical: 6,
                paddingHorizontal: 16,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 9999,
                backgroundColor: isActive ? "rgba(1, 135, 95, 0.1)" : "#FFFFFF",
                borderWidth: 1,
                borderColor: isActive ? "transparent" : "rgba(17,18,20,0.1)",
              }}
            >
              <Text
                className="text-[13px]"
                style={{
                  color: isActive ? "#01875F" : colors.ink,
                  fontWeight: isActive ? "600" : "500",
                }}
              >
                {cat.label}
              </Text>
            </PressableScale>
          );
        })}
      </ScrollView>
    </View>
  );

  return (
    <SafeAreaView
      className="flex-1"
      edges={["top", "left", "right"]}
      style={{ backgroundColor: colors.canvas }}
    >

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 120 }}
        onScroll={(e) => {
          const scrollY = e.nativeEvent.contentOffset.y;
          const shouldStick = scrollY >= heroBottom - 50;
          if (shouldStick !== isTabsSticky) {
            setIsTabsSticky(shouldStick);
          }
        }}
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
        stickyHeaderIndices={[1]}
      >
        {/* Child 0: Top Dolphin Writeup Header (Scrolls up out of view) */}
        <View>
          <AppHeader />
        </View>

        {/* Child 1: Sticky Header Container (Discover title + docked Category Tabs) */}
        <View
          style={{
            backgroundColor: colors.canvas,
            zIndex: 20,
          }}
        >
          {/* Discover Title Bar */}
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

          {/* Docked Category Tabs when scrolled past Hero */}
          {isTabsSticky ? categoryTabsElement : null}
        </View>

        {/* Child 2: Advert Carousel */}
        <View
          onLayout={(e) => {
            setHeroBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height);
          }}
        >
          <AdvertCarousel agents={agents ?? []} onAgentPress={handleAgentPress} />
        </View>

        {/* Child 3: Category Filter Tabs Bar (In-flow position) */}
        {isTabsSticky ? (
          <View style={{ height: 48 }} />
        ) : (
          categoryTabsElement
        )}

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
