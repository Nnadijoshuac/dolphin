import { useDeferredValue, useMemo, useState } from "react";
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
import { categoryLabel } from "@/constants/agents";
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
 * WHAT WAS DROPPED, AND ONE THING THAT SHOULD NOT HAVE BEEN
 * ---------------------------------------------------------------------------
 * "Suggested for you" is gone, correctly. Both of its bases depended on holding
 * the whole catalog in memory: the history basis re-ran the local search over
 * every agent once per remembered term, and the fallback sorted every agent in
 * every category by feedback count to take the top one. Neither survives
 * pagination.
 *
 * "All agents" went with it, and that was WRONG - it was cut in the same pass
 * for the same stated reason, but it never depended on holding the catalog at
 * all. It is a plain browse, and a browse is exactly what pagination made cheap.
 * Removing it left the search screen showing nothing but chips until the user
 * typed, which is an empty shop floor.
 *
 * It is back below, and the list query is no longer gated on there being a
 * query: `useAgentList` routes an empty `search` to `agents.list` (a browse) and
 * a non-empty one to `agents.search`, so one hook serves both states and the
 * screen never has a mode where it asks the backend for nothing.
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

  /**
   * Distribute categories across at most 2 lines, each scrolling independently.
   * When items fill line 1 (2 items across the viewport), they flow to line 2.
   * Any additional items extend line 1 and line 2 as horizontally scrollable overflow.
   */
  const categoryRows = useMemo(() => {
    if (categories.length === 0) return [];
    if (categories.length === 1) return [categories];
    const mid = Math.ceil(categories.length / 2);
    return [categories.slice(0, mid), categories.slice(mid)];
  }, [categories]);

  /*
   * NOT gated on there being a query. An empty `search` routes to `agents.list`
   * (browse) and a non-empty one to `agents.search`, so the same hook feeds both
   * the "All agents" list below and the results list above, and switching
   * between them is one subscription swapping rather than a mount/unmount.
   */
  const { agents, status, isLoading, loadMore, isEmpty } = useAgentList({
    search: deferredQuery,
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
        className="px-4 pt-1.5 pb-2.5 flex-row items-center gap-2.5"
        style={{ backgroundColor: colors.canvas, zIndex: 20 }}
      >
        <View
          className="flex-1 flex-row items-center rounded-full bg-white px-3.5 h-[42px]"
          style={{
            borderColor: isFocused ? colors.gold : colors.line,
            borderWidth: 1.5,
            ...shadows.subtle,
          }}
        >
          <CategoryGlyph color={isFocused ? colors.ink : "#8C8E88"} name="search" size={16} />

          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            className="ml-2.5 flex-1 text-[14px] font-medium h-full"
            onBlur={() => {
              setTimeout(() => {
                setIsFocused(false);
              }, 150);
            }}
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

        {isFocused || isSearching ? (
          <PressableScale
            accessibilityLabel="Cancel search"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              Keyboard.dismiss();
              setQuery("");
              setIsFocused(false);
            }}
          >
            <Text className="text-[14px] font-semibold" style={{ color: colors.ink }}>
              Cancel
            </Text>
          </PressableScale>
        ) : null}
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
        ) : isFocused ? (
          <View className="px-4 pt-1">
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
                  {recentSearches.slice(0, 6).map((item) => (
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
            ) : (
              <View className="items-center justify-center pt-14 px-6">
                <CategoryGlyph color="#8C8E88" name="search" size={24} />
                <Text className="text-[13.5px] font-medium text-zinc-400 text-center mt-2.5">
                  Search by agent name, capability, or protocol
                </Text>
              </View>
            )}
          </View>
        ) : (
          <View className="px-4 pt-1 gap-5">

            {/* Category pills - at most 3 lines, horizontally scrollable */}
            <View>
              <Text className="text-[14px] font-bold pb-3" style={{ color: colors.ink }}>
                Explore categories
              </Text>
              {categories.length === 0 ? (
                <StatePanel
                  body="No agent has passed verification yet. Discovery runs every half hour."
                  state="syncing"
                  title="Building the catalog"
                />
              ) : (
                <View style={{ gap: 8 }}>
                  {categoryRows.map((rowItems, rowIndex) =>
                    rowItems.length > 0 ? (
                      <ScrollView
                        key={rowIndex}
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        className="-mx-4"
                        contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
                      >
                        {rowItems.map((facet) => (
                          <PressableScale
                            key={facet.slug}
                            accessibilityLabel={facet.label}
                            accessibilityRole="button"
                            onPress={() => {
                              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                              router.push({
                                pathname: "/category/[slug]",
                                params: { slug: facet.slug },
                              });
                            }}
                            containerStyle={{
                              alignItems: "center",
                              justifyContent: "center",
                              backgroundColor: colors.surface,
                              borderRadius: 9999,
                              borderWidth: 1,
                              borderColor: colors.line,
                              paddingVertical: 8,
                              paddingHorizontal: 16,
                              ...shadows.subtle,
                            }}
                          >
                            <Text
                              className="text-[13px] font-semibold tracking-tight"
                              style={{ color: colors.ink }}
                            >
                              {facet.label}
                            </Text>
                          </PressableScale>
                        ))}
                      </ScrollView>
                    ) : null
                  )}
                </View>
              )}
            </View>

            {/*
              * ALL AGENTS. Restored 2026-09-07 after being cut alongside
              * "Suggested for you" - see this file's header. Without it the
              * screen showed nothing but chips until the user typed.
              *
              * Paginated, so this is a page of agents and a button, not the
              * whole catalog the old version rendered at once.
              */}
            <View className="pb-4">
              <Text className="text-[14px] font-bold" style={{ color: colors.ink }}>
                All agents
              </Text>
              <Text className="text-[11.5px] font-medium text-zinc-500 pt-0.5 pb-2.5">
                Verified live on BNB Chain
              </Text>

              {isLoading ? (
                <View className="items-center py-8">
                  <ActivityIndicator color={colors.goldDark} />
                </View>
              ) : isEmpty ? (
                <StatePanel
                  body="No agent has passed verification yet. An agent is listed once its own endpoint answers, and discovery runs every half hour."
                  state="unavailable"
                  title="Catalog is empty"
                />
              ) : (
                <View className="gap-2.5">
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
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
