import { useDeferredValue, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
import { CatalogFilterRail } from "@/components/catalog-filter-rail";
import { SmartFilterModal } from "@/components/smart-filter-modal";
import { PressableScale } from "@/components/pressable-scale";
import { StatePanel } from "@/components/state-panel";
import { categoryLabel } from "@/constants/agents";
import { colors, radii, shadows } from "@/constants/theme";
import {
  useAgentList,
  useAgentSignals,
  useCategoryFacets,
  type AgentProtocol,
} from "@/hooks/use-agents";
import { useAppStore } from "@/store/use-app-store";
import type { Agent } from "@/types/agent";

/**
 * SEARCH.
 *
 * ---------------------------------------------------------------------------
 * SEARCH & FILTER ARCHITECTURE (2026-09-08 REVAMP)
 * ---------------------------------------------------------------------------
 * The filter and search experience has been unified into a calm, predictable,
 * tactile flow:
 *
 * 1. PERSISTENT CONTROLS: The search input and filter trigger are always
 *    visible and stable. Focusing the search input no longer causes controls
 *    to jump, disappear, or displace other UI elements.
 *
 * 2. UNIFIED DIMENSIONS: Filters support both Kind (`protocol`: a2a / mcp)
 *    and Category simultaneously. Category selection filters the live catalog
 *    in-place via Convex rather than ejecting the user to a different route.
 *
 * 3. DUAL-TIER FILTERING:
 *    - `CatalogFilterRail`: A single-row silky horizontal rail right under the
 *      search bar for instant 1-tap switching.
 *    - `FilterSheet`: A serene bottom sheet with active counters, full
 *      descriptions, and reset capability for deep multi-dimensional tuning.
 *
 * 4. DISMISSABLE ACTIVE CHIPS: When filters are active, calm dismissable pills
 *    appear above the results for effortless 1-tap removal.
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

  // Filter state
  const [kind, setKind] = useState<AgentProtocol | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (kind !== null) count += 1;
    if (selectedCategory !== null) count += 1;
    return count;
  }, [kind, selectedCategory]);

  /*
   * Server-side paginated list. Handles both browse and text search, with both
   * category and protocol filters applied server-side.
   */
  const { agents, status, isLoading, loadMore, isEmpty } = useAgentList({
    search: deferredQuery,
    protocol: kind ?? undefined,
    category: selectedCategory ?? undefined,
  });

  const results = agents;
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

  const handleResetAllFilters = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setKind(null);
    setSelectedCategory(null);
  };

  const isSearching = query.trim().length > 0;

  return (
    <SafeAreaView
      className="flex-1"
      edges={["top", "left", "right"]}
      style={{ backgroundColor: colors.canvas }}
    >
      {/* Search Header */}
      <View
        className="px-4 pt-1.5 pb-2 flex-row items-center gap-2.5"
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

        {/* Stable Filter Button */}
        <PressableScale
          accessibilityHint="Filter agents by kind or category"
          accessibilityLabel={
            activeFilterCount > 0
              ? `Filters, ${activeFilterCount} active`
              : "Open filters"
          }
          accessibilityRole="button"
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setFilterSheetOpen(true);
          }}
          containerStyle={{
            alignItems: "center",
            justifyContent: "center",
            height: 42,
            width: 42,
            borderRadius: 9999,
            backgroundColor: activeFilterCount > 0 ? colors.gold : colors.surface,
            borderColor: activeFilterCount > 0 ? colors.goldBorder : colors.line,
            borderWidth: 1.5,
            ...shadows.subtle,
          }}
        >
          <CategoryGlyph
            color={activeFilterCount > 0 ? colors.ink : "#7A7C75"}
            name="filter"
            size={17}
          />
          {activeFilterCount > 0 ? (
            <View
              className="absolute -top-1 -right-1 h-5 w-5 rounded-full items-center justify-center"
              style={{
                backgroundColor: colors.ink,
                borderWidth: 1.5,
                borderColor: colors.canvas,
              }}
            >
              <Text className="text-[10px] font-bold text-white leading-none">
                {activeFilterCount}
              </Text>
            </View>
          ) : null}
        </PressableScale>
      </View>

      {/* Silky Filter Rail */}
      <View className="px-4 pb-2.5" style={{ backgroundColor: colors.canvas, zIndex: 19 }}>
        <CatalogFilterRail
          activeFilterCount={activeFilterCount}
          categories={categories}
          category={selectedCategory}
          onOpenFilterSheet={() => setFilterSheetOpen(true)}
          onSelectCategory={(cat) => setSelectedCategory(cat)}
          onSelectProtocol={(proto) => setKind(proto)}
          protocol={kind}
        />
      </View>

      {/* Active Filter Dismissable Pills */}
      {activeFilterCount > 0 ? (
        <View className="flex-row items-center flex-wrap gap-1.5 px-4 pb-2.5">
          <Text className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider mr-1">
            Active:
          </Text>

          {kind !== null ? (
            <PressableScale
              accessibilityLabel={`Remove ${kind === "a2a" ? "Hire" : "Tools"} filter`}
              accessibilityRole="button"
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setKind(null);
              }}
              containerStyle={{
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                paddingVertical: 3.5,
                paddingHorizontal: 9,
                borderRadius: radii.pill,
                backgroundColor: colors.goldSoft,
                borderColor: colors.goldBorder,
                borderWidth: 1,
              }}
            >
              <Text className="text-[11.5px] font-semibold" style={{ color: colors.ink }}>
                {kind === "a2a" ? "Hire · A2A" : "Tools · MCP"}
              </Text>
              <CategoryGlyph color={colors.ink} name="close" size={10} strokeWidth={2.5} />
            </PressableScale>
          ) : null}

          {selectedCategory !== null ? (
            <PressableScale
              accessibilityLabel={`Remove ${selectedCategory} category filter`}
              accessibilityRole="button"
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setSelectedCategory(null);
              }}
              containerStyle={{
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                paddingVertical: 3.5,
                paddingHorizontal: 9,
                borderRadius: radii.pill,
                backgroundColor: colors.surfaceSubtle,
                borderColor: colors.line,
                borderWidth: 1,
              }}
            >
              <Text className="text-[11.5px] font-semibold" style={{ color: colors.ink }}>
                {categoryLabel(selectedCategory)}
              </Text>
              <CategoryGlyph color={colors.ink} name="close" size={10} strokeWidth={2.5} />
            </PressableScale>
          ) : null}

          <PressableScale
            accessibilityLabel="Clear all filters"
            accessibilityRole="button"
            hitSlop={6}
            onPress={handleResetAllFilters}
            containerStyle={{ paddingVertical: 3.5, paddingHorizontal: 6 }}
          >
            <Text className="text-[11px] font-bold text-zinc-400">
              Clear all
            </Text>
          </PressableScale>
        </View>
      ) : null}

      {/* Main Content Area */}
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
            <View className="pb-2.5 flex-row items-center justify-between">
              <Text className="text-[12px] font-bold uppercase tracking-wider text-zinc-500">
                {isLoading
                  ? "Searching"
                  : `${results.length}${status === "CanLoadMore" ? "+" : ""} ${
                      results.length === 1 ? "agent found" : "agents found"
                    }`}
              </Text>

              {selectedCategory ? (
                <Text className="text-[11px] font-medium text-zinc-400">
                  in {categoryLabel(selectedCategory)}
                </Text>
              ) : null}
            </View>

            {isLoading ? (
              <View className="items-center py-10">
                <ActivityIndicator color={colors.goldDark} />
              </View>
            ) : isEmpty ? (
              <View className="pt-8">
                <StatePanel
                  body={`No verified agent matches "${query}"${
                    selectedCategory ? ` in ${categoryLabel(selectedCategory)}` : ""
                  }${kind ? ` under ${kind === "a2a" ? "Hire" : "Tools"}` : ""}. Try a broader term or clearing active filters.`}
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
        ) : isFocused && query.length === 0 ? (
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
          /* Catalog Browse Mode */
          <View className="px-4 pt-1 gap-4">
            <View className="pb-4">
              <View className="flex-row items-center justify-between pb-2.5">
                <View>
                  <Text className="text-[15px] font-bold" style={{ color: colors.ink }}>
                    {selectedCategory ? categoryLabel(selectedCategory) : "All agents"}
                  </Text>
                  <Text className="text-[11.5px] font-medium text-zinc-500 pt-0.5">
                    {kind === "a2a"
                      ? "Hireable tasks · Escrow backed"
                      : kind === "mcp"
                        ? "Free direct tools · MCP endpoints"
                        : "Verified live on BNB Chain"}
                  </Text>
                </View>

                {selectedCategory ? (
                  <PressableScale
                    accessibilityLabel={`View full ${categoryLabel(selectedCategory)} category page`}
                    accessibilityRole="button"
                    onPress={() => {
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      router.push({
                        pathname: "/category/[slug]",
                        params: { slug: selectedCategory },
                      });
                    }}
                    containerStyle={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 4,
                      paddingVertical: 4,
                      paddingHorizontal: 8,
                      borderRadius: radii.small,
                      backgroundColor: colors.surfaceSubtle,
                      borderWidth: 1,
                      borderColor: colors.line,
                    }}
                  >
                    <Text className="text-[11.5px] font-semibold" style={{ color: colors.ink }}>
                      Page
                    </Text>
                    <CategoryGlyph color={colors.ink} name="arrow-right" size={11} />
                  </PressableScale>
                ) : null}
              </View>

              {isLoading ? (
                <View className="items-center py-8">
                  <ActivityIndicator color={colors.goldDark} />
                </View>
              ) : isEmpty ? (
                <StatePanel
                  body={
                    activeFilterCount > 0
                      ? "No verified agent matches the selected filters. Try broadening your selection or resetting filters."
                      : "No agent has passed verification yet. An agent is listed once its own endpoint answers, and discovery runs every half hour."
                  }
                  state="unavailable"
                  title={activeFilterCount > 0 ? "No matching agents" : "Catalog is empty"}
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

      {/* Smart Filter Modal */}
      <SmartFilterModal
        categories={categories}
        category={selectedCategory}
        onClose={() => setFilterSheetOpen(false)}
        onResetAll={handleResetAllFilters}
        onSelectCategory={(cat) => setSelectedCategory(cat)}
        onSelectProtocol={(proto) => setKind(proto)}
        protocol={kind}
        visible={filterSheetOpen}
      />
    </SafeAreaView>
  );
}
