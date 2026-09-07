import { useDeferredValue, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";

import { AgentRow } from "@/components/agent-row";
import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { StatePanel } from "@/components/state-panel";
import { categoryLabel, categoryVisual } from "@/constants/agents";
import { colors, shadows } from "@/constants/theme";
import {
  useAgentList,
  useAgentSignals,
  useCategoryFacets,
} from "@/hooks/use-agents";
import { sortHireableFirst } from "@/services/hireability";
import { useAppStore } from "@/store/use-app-store";
import type { Agent } from "@/types/agent";

/**
 * SEARCH.
 *
 * ---------------------------------------------------------------------------
 * SEARCH MOVED TO THE SERVER (2026-09-07)
 * ---------------------------------------------------------------------------
 * This screen used to call `useAgents()` for the ENTIRE catalog and run
 * `searchAgentsLocally` over it on every keystroke - a substring scan across
 * every agent's name, publisher, category, tagline, description and skills, on
 * the device, in a `useMemo`.
 *
 * It worked because the catalog was 25 agents. It is now a Convex search index
 * (`agents.search`), which is paginated and relevance-ordered, and it is what
 * makes a catalog of thousands searchable at all rather than only loadable.
 *
 * The "Explore Categories" grid is likewise read from `useCategoryFacets` and
 * carries real counts, rather than iterating a hardcoded list of five and
 * counting a client-side array.
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS DELIBERATELY DROPPED
 * ---------------------------------------------------------------------------
 * "Suggested for you" is gone. Both of its bases depended on holding the whole
 * catalog in memory: the history basis re-ran the local search over every agent
 * once per remembered term, and the fallback sorted every agent in every
 * category by feedback count to take the top one. Neither survives pagination,
 * and reimplementing them would mean new backend queries that nothing has asked
 * for. Recent searches - which is the genuinely personal half - is unchanged.
 */
export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  /*
   * Deferred so a fast typist does not open a Convex subscription per keystroke.
   * React keeps rendering the typed value in the input while the query lags a
   * frame behind it, which is exactly the tradeoff a search box wants.
   */
  const deferredQuery = useDeferredValue(query.trim());

  const { categories } = useCategoryFacets();

  const { agents, status, isLoading, loadMore, isEmpty } = useAgentList({
    search: deferredQuery,
    enabled: deferredQuery.length > 0,
  });

  // Relevance decides the order, then hireability breaks it: two equally
  // relevant agents are not equally useful if only one can be hired.
  const results = sortHireableFirst(agents);
  const signals = useAgentSignals(agents);

  const recentSearches = useAppStore((state) => state.recentSearches);
  const addRecentSearch = useAppStore((state) => state.addRecentSearch);
  const removeRecentSearch = useAppStore((state) => state.removeRecentSearch);
  const clearRecentSearches = useAppStore((state) => state.clearRecentSearches);

  const handleAgentPress = (agent: Agent) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (query.trim()) addRecentSearch(query.trim());
    router.push({ pathname: "/agent/[id]", params: { id: agent.tokenId } });
  };

  const handleTagPress = (tag: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setQuery(tag);
    addRecentSearch(tag);
  };

  const isSearching = query.trim().length > 0;

  return (
    <SafeAreaView
      className="flex-1"
      edges={["top", "left", "right"]}
      style={{ backgroundColor: colors.canvas }}
    >
      <View
        className="px-4 pt-1.5 pb-2.5"
        style={{ backgroundColor: colors.canvas, zIndex: 20 }}
      >
        <View
          className="flex-row items-center rounded-full bg-white px-3.5 h-[42px]"
          style={{
            borderColor: isFocused ? colors.gold : colors.line,
            borderWidth: 1.5,
            ...shadows.subtle,
          }}
        >
          {isFocused && query.length > 0 ? (
            <PressableScale
              accessibilityLabel="Dismiss search focus"
              accessibilityRole="button"
              onPress={() => {
                Keyboard.dismiss();
                setIsFocused(false);
              }}
              containerStyle={{ marginRight: 6, padding: 2 }}
            >
              <CategoryGlyph color={colors.ink} name="arrow-right" size={16} strokeWidth={2.2} />
            </PressableScale>
          ) : (
            <CategoryGlyph color={isFocused ? colors.ink : "#8C8E88"} name="search" size={16} />
          )}

          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            className="ml-2.5 flex-1 text-[14px] font-medium h-full"
            onBlur={() => setIsFocused(false)}
            onChangeText={setQuery}
            onFocus={() => setIsFocused(true)}
            onSubmitEditing={() => {
              if (query.trim()) addRecentSearch(query.trim());
            }}
            placeholder="Search agents, skills, publishers"
            placeholderTextColor="#8C8E88"
            returnKeyType="search"
            style={{ color: colors.ink }}
            value={query}
          />

          {query.length > 0 ? (
            <PressableScale
              accessibilityLabel="Clear search text"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setQuery("")}
              containerStyle={{ padding: 4 }}
            >
              <CategoryGlyph color="#8C8E88" name="close" size={14} />
            </PressableScale>
          ) : null}
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 110 }}
        keyboardShouldPersistTaps="handled"
        onScroll={({ nativeEvent }) => {
          const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
          const nearBottom =
            layoutMeasurement.height + contentOffset.y >= contentSize.height - 600;
          if (nearBottom && status === "CanLoadMore") loadMore();
        }}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        {isSearching ? (
          <View className="px-4 pt-1">
            <View className="pb-2.5">
              <Text className="text-[12px] font-bold uppercase tracking-wider text-zinc-500">
                {isLoading
                  ? "Searching"
                  : `${results.length}${status === "CanLoadMore" ? "+" : ""} ${
                      results.length === 1 ? "agent found" : "agents found"
                    }`}
              </Text>
            </View>

            {isLoading ? (
              <View className="items-center py-10">
                <ActivityIndicator color={colors.goldDark} />
              </View>
            ) : isEmpty ? (
              <View className="pt-8">
                <StatePanel
                  body={`No verified agent matches "${query}". Try a capability, a protocol, or a publisher name.`}
                  state="unavailable"
                  title="No results found"
                />
              </View>
            ) : (
              <View className="gap-2">
                {results.map((agent) => (
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
              </View>
            )}
          </View>
        ) : (
          <View className="px-4 pt-1 gap-5">
            {recentSearches.length > 0 ? (
              <View>
                <View className="flex-row items-center justify-between pb-2">
                  <Text className="text-[14px] font-bold" style={{ color: colors.ink }}>
                    Recent searches
                  </Text>
                  {clearRecentSearches ? (
                    <PressableScale
                      accessibilityLabel="Clear search history"
                      accessibilityRole="button"
                      hitSlop={8}
                      onPress={() => clearRecentSearches()}
                    >
                      <Text className="text-[11px] font-bold text-zinc-400">Clear all</Text>
                    </PressableScale>
                  ) : null}
                </View>

                <View className="gap-1">
                  {recentSearches.slice(0, 4).map((item) => (
                    <View key={item} className="flex-row items-center justify-between py-2">
                      <PressableScale
                        accessibilityLabel={`Search ${item}`}
                        accessibilityRole="button"
                        style={{ flex: 1 }}
                        containerStyle={{ flexDirection: "row", alignItems: "center", gap: 10 }}
                        onPress={() => handleTagPress(item)}
                      >
                        <CategoryGlyph color="#8C8E88" name="clock" size={15} />
                        <Text
                          className="text-[13.5px] font-medium flex-1"
                          numberOfLines={1}
                          style={{ color: colors.ink }}
                        >
                          {item}
                        </Text>
                      </PressableScale>

                      <PressableScale
                        accessibilityLabel={`Remove ${item}`}
                        accessibilityRole="button"
                        hitSlop={8}
                        onPress={() => removeRecentSearch(item)}
                        containerStyle={{ padding: 4 }}
                      >
                        <CategoryGlyph color="#A0A0A0" name="close" size={14} />
                      </PressableScale>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {/* Every category the catalog actually holds, with real counts. */}
            <View>
              <Text className="text-[14px] font-bold pb-2.5" style={{ color: colors.ink }}>
                Explore categories
              </Text>
              {categories.length === 0 ? (
                <StatePanel
                  body="No agent has passed verification yet. Discovery runs every half hour."
                  state="syncing"
                  title="Building the catalog"
                />
              ) : (
                <View className="flex-row flex-wrap gap-2.5">
                  {categories.map((facet) => {
                    const visual = categoryVisual(facet.slug);
                    return (
                      <PressableScale
                        key={facet.slug}
                        accessibilityLabel={`${facet.label}, ${facet.count} agents`}
                        accessibilityRole="button"
                        onPress={() =>
                          router.push({
                            pathname: "/category/[slug]",
                            params: { slug: facet.slug },
                          })
                        }
                        style={{ flexBasis: "47%", flexGrow: 1 }}
                        containerStyle={{
                          alignItems: "center",
                          backgroundColor: visual.background,
                          borderRadius: 16,
                          flexDirection: "row",
                          gap: 12,
                          paddingHorizontal: 16,
                          paddingVertical: 16,
                        }}
                      >
                        <View className="h-10 w-10 items-center justify-center">
                          <CategoryGlyph
                            color={colors.ink}
                            name={facet.slug}
                            size={24}
                            strokeWidth={2}
                          />
                        </View>
                        <View className="flex-1">
                          <Text
                            className="text-[14px] font-bold"
                            numberOfLines={1}
                            style={{ color: colors.ink }}
                          >
                            {facet.label}
                          </Text>
                          <Text
                            className="text-[12px] text-zinc-600 mt-0.5 font-medium"
                            numberOfLines={1}
                          >
                            {facet.count} {facet.count === 1 ? "agent" : "agents"}
                          </Text>
                        </View>
                      </PressableScale>
                    );
                  })}
                </View>
              )}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
