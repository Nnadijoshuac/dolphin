import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { categoryLabel } from "@/constants/agents";
import { colors, shadows } from "@/constants/theme";
import {
  useAgentList,
  useAgentSignals,
  useCategoryFacets,
} from "@/hooks/use-agents";
import { sortHireableFirst } from "@/services/hireability";
import type { Agent } from "@/types/agent";

/**
 * DISCOVER.
 *
 * ---------------------------------------------------------------------------
 * WHAT CHANGED HERE, AND WHY IT HAD TO (2026-09-07)
 * ---------------------------------------------------------------------------
 * This screen used to call `useAgents()`, receive THE ENTIRE CATALOG, and then
 * filter it into five hardcoded category columns in JavaScript. It rendered one
 * horizontally-paged ScrollView per category, each holding every matching agent,
 * all mounted at once.
 *
 * Two things made that untenable and both are now fixed:
 *
 *   The list was unpaginated. Every agent had to load before one row could
 *   draw, and the backend query behind it did a file-storage lookup per agent
 *   inside a 1-second budget. It had already failed once in production.
 *
 *   The categories were a hardcoded list of five. The backend now stores an
 *   open category slug, so the chips are read from `useCategoryFacets` - a
 *   category with agents in it appears, one without does not. That also ends
 *   the failure where `trading` was a visible chip leading to an empty list for
 *   two days.
 *
 * The horizontal pager is gone with it. Paging five independent paginated lists
 * side by side would hold five live subscriptions and five cursors for four
 * columns nobody is looking at. The chip row now SELECTS, and one list is
 * mounted - which is also what makes "load more" mean something.
 */
export default function DiscoverScreen() {
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const tabsScrollRef = useRef<ScrollView>(null);
  const tabLayouts = useRef<Record<string, { x: number; width: number }>>({});

  const { categories, isLoading: facetsLoading } = useCategoryFacets();
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  // The first chip is selected once the facets arrive. Deliberately not a
  // hardcoded default: "rebalancing" used to be selected on mount whether or
  // not any rebalancing agent existed.
  useEffect(() => {
    if (activeCategory === null && categories.length > 0) {
      setActiveCategory(categories[0].slug);
    }
  }, [activeCategory, categories]);

  const { agents, status, isLoading, loadMore, isEmpty } = useAgentList({
    category: activeCategory ?? undefined,
    enabled: activeCategory !== null || (!facetsLoading && categories.length === 0),
  });

  // One query for the whole page, keyed to the rows actually on it.
  const signals = useAgentSignals(agents);

  // Hireable first. A user browsing should meet the agents they can actually
  // buy from before the ones they cannot. A stable partition, so the backend's
  // own ranking survives inside each half.
  const rows = sortHireableFirst(agents);

  const handleAgentPress = (agent: Agent) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: "/agent/[id]", params: { id: agent.tokenId } });
  };

  const scrollTabIntoView = (slug: string) => {
    const layout = tabLayouts.current[slug];
    if (layout && tabsScrollRef.current) {
      tabsScrollRef.current.scrollTo({
        x: Math.max(0, layout.x - screenWidth / 2 + layout.width / 2),
        animated: true,
      });
    }
  };

  const handleSelectCategory = (slug: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveCategory(slug);
    scrollTabIntoView(slug);
  };

  return (
    <SafeAreaView
      className="flex-1"
      edges={["top", "left", "right"]}
      style={{ backgroundColor: colors.canvas }}
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={() => {
              // Convex queries are live subscriptions, so there is nothing to
              // refetch - the list is already current. The control stays for
              // the gesture, which users expect, and gives haptic feedback.
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
            tintColor={colors.goldDark}
          />
        }
        onScroll={({ nativeEvent }) => {
          const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
          const nearBottom =
            layoutMeasurement.height + contentOffset.y >= contentSize.height - 600;
          if (nearBottom && status === "CanLoadMore") loadMore();
        }}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[3]}
      >
        <View>
          <AppHeader />
        </View>

        <View
          className="flex-row items-center justify-between px-4 pb-2.5 pt-1"
          style={{ backgroundColor: colors.canvas }}
        >
          <Text
            className="text-[30px] font-black tracking-[-1px]"
            style={{ color: colors.ink }}
          >
            Discover
          </Text>

          <PressableScale
            accessibilityLabel="Search agents"
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

        <View>
          <AdvertCarousel agents={rows} onAgentPress={handleAgentPress} />
        </View>

        {/* Sticky category chips, read from the catalog rather than hardcoded. */}
        <View
          className="py-2.5"
          style={{ backgroundColor: colors.canvas, zIndex: 30 }}
        >
          <ScrollView
            ref={tabsScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
          >
            {categories.map((facet) => {
              const isActive = activeCategory === facet.slug;
              return (
                <View
                  key={facet.slug}
                  onLayout={(e) => {
                    tabLayouts.current[facet.slug] = {
                      x: e.nativeEvent.layout.x,
                      width: e.nativeEvent.layout.width,
                    };
                  }}
                >
                  <PressableScale
                    accessibilityLabel={`${facet.label}, ${facet.count} agents`}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: isActive }}
                    onPress={() => handleSelectCategory(facet.slug)}
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
                        <CategoryGlyph color={colors.ink} name={facet.slug} size={13} />
                      ) : null}
                      <Text
                        className="text-[13px]"
                        style={{
                          color: isActive ? colors.ink : colors.muted,
                          fontWeight: isActive ? "700" : "500",
                        }}
                      >
                        {facet.label}
                      </Text>
                    </View>
                  </PressableScale>
                </View>
              );
            })}
          </ScrollView>
        </View>

        <View className="px-4 pt-3">
          {isLoading || (facetsLoading && categories.length === 0) ? (
            <View className="py-8">
              <StatePanel
                body="Reading the agents Dolphin has verified on BNB Chain."
                state="syncing"
                title="Loading agents"
              />
            </View>
          ) : categories.length === 0 ? (
            <View className="py-8">
              <StatePanel
                body="No agent has passed verification yet. Discovery runs every half hour and an agent is listed once its own endpoint answers."
                state="unavailable"
                title="Catalog is empty"
              />
            </View>
          ) : isEmpty ? (
            <View className="py-8">
              <StatePanel
                body={`No agent in ${categoryLabel(activeCategory ?? "")} is answering right now. Try another category.`}
                state="unavailable"
                title="Nothing here yet"
              />
            </View>
          ) : (
            <View className="gap-3">
              {rows.map((agent) => (
                <AgentRow
                  key={agent.id}
                  agent={agent}
                  onPress={() => handleAgentPress(agent)}
                  signals={signals.get(agent.id)}
                  subtitle={`${categoryLabel(agent.category)} · ${agent.tagline}`}
                />
              ))}

              {status === "LoadingMore" ? (
                <View className="items-center py-6">
                  <ActivityIndicator color={colors.goldDark} />
                </View>
              ) : null}

              {status === "CanLoadMore" ? (
                <PressableScale
                  accessibilityLabel="Load more agents"
                  accessibilityRole="button"
                  onPress={() => loadMore()}
                  containerStyle={{
                    alignItems: "center",
                    backgroundColor: colors.surface,
                    borderColor: colors.line,
                    borderRadius: 14,
                    borderWidth: 1,
                    marginTop: 4,
                    paddingVertical: 14,
                  }}
                >
                  <Text
                    className="text-[14px] font-semibold"
                    style={{ color: colors.ink }}
                  >
                    Show more
                  </Text>
                </PressableScale>
              ) : null}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
