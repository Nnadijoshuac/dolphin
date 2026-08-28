import { useMemo, useState } from "react";
import {
  Keyboard,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";

import { BnbLogo } from "@/components/brand-mark";
import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { StatePanel } from "@/components/state-panel";
import { AGENT_CATEGORIES } from "@/constants/agents";
import { colors, radii, shadows } from "@/constants/theme";
import { useAgents } from "@/hooks/use-agents";
import { searchAgentsLocally } from "@/services/agents-api";
import { useAppStore } from "@/store/use-app-store";
import type { Agent, AgentCategory } from "@/types/agent";

const categoryBgColors: Record<AgentCategory, string> = {
  monitoring: "#F5F3EC",
  "grid-trading": "#F5F3EC",
  "health-factor": "#F5F3EC",
  yield: "#F5F3EC",
};

const categoryLabels: Record<AgentCategory, string> = {
  monitoring: "Monitoring",
  "grid-trading": "Grid trading",
  "health-factor": "Health factor",
  yield: "Yield",
};

const POPULAR_SEARCHES = [
  "PancakeSwap Grid",
  "Venus Liquidation",
  "Wallet Watch",
  "Yield Farming",
  "Auto-compounding",
  "Risk Management",
];

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const { data: allAgents, isLoading } = useAgents();

  const recentSearches = useAppStore((state) => state.recentSearches);
  const addRecentSearch = useAppStore((state) => state.addRecentSearch);
  const removeRecentSearch = useAppStore((state) => state.removeRecentSearch);
  const clearRecentSearches = useAppStore((state) => state.clearRecentSearches);

  const searchResults = useMemo(() => {
    if (!allAgents || !query.trim()) return [];
    return searchAgentsLocally(allAgents, query);
  }, [allAgents, query]);

  const handleAgentPress = (agent: Agent) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (query.trim()) {
      addRecentSearch(query.trim());
    }
    router.push({
      pathname: "/agent/[id]",
      params: { id: agent.tokenId },
    });
  };

  const handleTagPress = (tag: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setQuery(tag);
    addRecentSearch(tag);
  };

  return (
    <SafeAreaView
      className="flex-1"
      edges={["top", "left", "right"]}
      style={{ backgroundColor: colors.canvas }}
    >
      {/* Sticky Google Play Store Search Bar */}
      <View
        className="px-5 pt-2 pb-3"
        style={{
          backgroundColor: colors.canvas,
          zIndex: 20,
        }}
      >
        <View
          className="flex-row items-center rounded-full bg-white px-4 py-2.5"
          style={{
            borderColor: isFocused ? colors.goldDark : "rgba(17,18,20,0.08)",
            borderWidth: 1.5,
            ...shadows.subtle,
          }}
        >
          {isFocused && query.length > 0 ? (
            <PressableScale
              accessibilityLabel="Back"
              accessibilityRole="button"
              onPress={() => {
                Keyboard.dismiss();
                setIsFocused(false);
              }}
              containerStyle={{ marginRight: 8, padding: 2 }}
            >
              <CategoryGlyph color={colors.ink} name="arrow-right" size={18} strokeWidth={2.2} />
            </PressableScale>
          ) : (
            <CategoryGlyph color={isFocused ? colors.ink : "#71727A"} name="search" size={18} />
          )}

          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            className="ml-3 flex-1 text-[15px] font-medium"
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
              onPress={() => setQuery("")}
              containerStyle={{ padding: 4 }}
            >
              <CategoryGlyph color="#8C8E88" name="revoke" size={16} />
            </PressableScale>
          ) : null}
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 110 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {query.trim().length > 0 ? (
          /* Search Results (Google Play Store Style App Rows) */
          <View className="px-5 pt-2">
            <View className="flex-row items-center justify-between pb-3">
              <Text className="text-[13px] font-bold uppercase tracking-wider text-zinc-500">
                {searchResults.length} {searchResults.length === 1 ? "Agent found" : "Agents found"}
              </Text>
            </View>

            {searchResults.length > 0 ? (
              <View className="gap-2.5">
                {searchResults.map((agent) => (
                  <PressableScale
                    key={agent.id}
                    accessibilityLabel={agent.name}
                    accessibilityRole="button"
                    onPress={() => handleAgentPress(agent)}
                    containerStyle={{
                      backgroundColor: "#FFFFFF",
                      borderColor: "rgba(17,18,20,0.06)",
                      borderRadius: 20,
                      borderWidth: 1,
                      padding: 14,
                      ...shadows.subtle,
                    }}
                  >
                    <View className="flex-row items-center gap-3.5">
                      {/* Play Store App Icon */}
                      <View
                        className="h-16 w-16 items-center justify-center rounded-2xl"
                        style={{
                          backgroundColor: categoryBgColors[agent.category] ?? "#F5F3EC",
                          borderColor: "rgba(17,18,20,0.04)",
                          borderWidth: 1,
                        }}
                      >
                        <CategoryGlyph
                          color={colors.ink}
                          name={agent.category}
                          size={32}
                          strokeWidth={2}
                        />
                      </View>

                      {/* App Title & Details */}
                      <View className="flex-1 pr-2">
                        <Text
                          className="text-[16px] font-bold tracking-tight"
                          numberOfLines={1}
                          style={{ color: colors.ink }}
                        >
                          {agent.name}
                        </Text>
                        <Text
                          className="mt-0.5 text-[12px] text-zinc-500"
                          numberOfLines={1}
                        >
                          {categoryLabels[agent.category]} · ERC-8004
                        </Text>
                        <View className="mt-1.5 flex-row items-center gap-1.5">
                          <BnbLogo size={13} />
                          <Text className="text-[11px] font-semibold text-amber-800">
                            BNB Smart Chain
                          </Text>
                        </View>
                      </View>

                      {/* Play Store 'View' / 'Get' CTA Button */}
                      <View
                        className="items-center justify-center rounded-xl px-4 py-1.5"
                        style={{
                          backgroundColor: colors.gold,
                          minWidth: 62,
                          ...shadows.subtle,
                        }}
                      >
                        <Text className="text-[13px] font-bold text-black">
                          View
                        </Text>
                      </View>
                    </View>
                  </PressableScale>
                ))}
              </View>
            ) : (
              <View className="pt-8">
                <StatePanel
                  body={`No agents found matching "${query}". Try searching by category, protocol (Venus, PancakeSwap), or skill.`}
                  state="unavailable"
                  title="No results found"
                />
              </View>
            )}
          </View>
        ) : (
          /* Play Store Default Search Home (Discovery & History) */
          <View className="px-5 pt-1 gap-6">
            {/* Recent Searches (History rows) */}
            {recentSearches.length > 0 ? (
              <View>
                <View className="flex-row items-center justify-between pb-2">
                  <Text className="text-[15px] font-bold" style={{ color: colors.ink }}>
                    Recent searches
                  </Text>
                  {clearRecentSearches ? (
                    <PressableScale
                      accessibilityLabel="Clear search history"
                      accessibilityRole="button"
                      onPress={() => clearRecentSearches()}
                    >
                      <Text className="text-[12px] font-bold text-zinc-400">
                        Clear all
                      </Text>
                    </PressableScale>
                  ) : null}
                </View>

                <View className="rounded-2xl bg-white border border-black/5 overflow-hidden divide-y divide-black/5">
                  {recentSearches.slice(0, 5).map((item) => (
                    <View
                      key={item}
                      className="flex-row items-center justify-between px-4 py-3"
                    >
                      <PressableScale
                        accessibilityLabel={`Search ${item}`}
                        accessibilityRole="button"
                        className="flex-1 flex-row items-center gap-3"
                        onPress={() => handleTagPress(item)}
                      >
                        <CategoryGlyph color="#8C8E88" name="clock" size={16} />
                        <Text className="text-[14px] font-medium text-zinc-800">
                          {item}
                        </Text>
                      </PressableScale>

                      <PressableScale
                        accessibilityLabel={`Remove ${item}`}
                        accessibilityRole="button"
                        onPress={() => removeRecentSearch(item)}
                        containerStyle={{ padding: 4 }}
                      >
                        <CategoryGlyph color="#A0A0A0" name="revoke" size={14} />
                      </PressableScale>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {/* Trending / Popular Searches */}
            <View>
              <Text className="text-[15px] font-bold pb-2.5" style={{ color: colors.ink }}>
                Trending on BNB Chain
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {POPULAR_SEARCHES.map((term, index) => (
                  <PressableScale
                    key={term}
                    accessibilityLabel={`Search ${term}`}
                    accessibilityRole="button"
                    onPress={() => handleTagPress(term)}
                    containerStyle={{
                      alignItems: "center",
                      backgroundColor: "#FFFFFF",
                      borderColor: "rgba(17,18,20,0.06)",
                      borderRadius: 9999,
                      borderWidth: 1,
                      flexDirection: "row",
                      gap: 6,
                      paddingHorizontal: 14,
                      paddingVertical: 7,
                      ...shadows.subtle,
                    }}
                  >
                    <Text className="text-[12px] font-bold text-amber-700">
                      #{index + 1}
                    </Text>
                    <Text className="text-[13px] font-medium text-zinc-800">
                      {term}
                    </Text>
                  </PressableScale>
                ))}
              </View>
            </View>

            {/* Explore Categories (Play Store Style Category Cards) */}
            <View>
              <Text className="text-[15px] font-bold pb-2.5" style={{ color: colors.ink }}>
                Explore Categories
              </Text>
              <View className="flex-row flex-wrap gap-2.5">
                {AGENT_CATEGORIES.map((cat) => (
                  <PressableScale
                    key={cat.slug}
                    accessibilityLabel={cat.label}
                    accessibilityRole="button"
                    onPress={() => handleTagPress(cat.label)}
                    containerStyle={{
                      alignItems: "center",
                      backgroundColor: "#FFFFFF",
                      borderColor: "rgba(17,18,20,0.06)",
                      borderRadius: 16,
                      borderWidth: 1,
                      flexDirection: "row",
                      gap: 10,
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                      width: "48%",
                      ...shadows.subtle,
                    }}
                  >
                    <View
                      className="h-10 w-10 items-center justify-center rounded-xl"
                      style={{ backgroundColor: categoryBgColors[cat.slug] ?? "#F5F3EC" }}
                    >
                      <CategoryGlyph
                        color={colors.ink}
                        name={cat.slug}
                        size={20}
                        strokeWidth={2}
                      />
                    </View>
                    <View className="flex-1">
                      <Text
                        className="text-[13px] font-bold"
                        numberOfLines={1}
                        style={{ color: colors.ink }}
                      >
                        {cat.label}
                      </Text>
                    </View>
                  </PressableScale>
                ))}
              </View>
            </View>

            {/* Recommended Agents (Play Store Style "Suggested for you") */}
            {allAgents && allAgents.length > 0 ? (
              <View className="pb-4">
                <Text className="text-[15px] font-bold pb-3" style={{ color: colors.ink }}>
                  Suggested for you
                </Text>
                <View className="gap-2.5">
                  {allAgents.slice(0, 4).map((agent) => (
                    <PressableScale
                      key={agent.id}
                      accessibilityLabel={agent.name}
                      accessibilityRole="button"
                      onPress={() => handleAgentPress(agent)}
                      containerStyle={{
                        backgroundColor: "#FFFFFF",
                        borderColor: "rgba(17,18,20,0.06)",
                        borderRadius: 18,
                        borderWidth: 1,
                        padding: 13,
                        ...shadows.subtle,
                      }}
                    >
                      <View className="flex-row items-center gap-3.5">
                        {/* Rounded App Icon */}
                        <View
                          className="h-14 w-14 items-center justify-center rounded-2xl"
                          style={{
                            backgroundColor: categoryBgColors[agent.category] ?? "#F5F3EC",
                            borderColor: "rgba(17,18,20,0.04)",
                            borderWidth: 1,
                          }}
                        >
                          <CategoryGlyph
                            color={colors.ink}
                            name={agent.category}
                            size={28}
                            strokeWidth={2}
                          />
                        </View>

                        {/* Title & Category info */}
                        <View className="flex-1 pr-2">
                          <Text
                            className="text-[15px] font-bold tracking-tight"
                            numberOfLines={1}
                            style={{ color: colors.ink }}
                          >
                            {agent.name}
                          </Text>
                          <Text
                            className="mt-0.5 text-[12px] text-zinc-500"
                            numberOfLines={1}
                          >
                            {categoryLabels[agent.category]} · {agent.tagline}
                          </Text>
                        </View>

                        {/* View CTA */}
                        <View
                          className="items-center justify-center rounded-xl px-3.5 py-1.5"
                          style={{
                            backgroundColor: colors.gold,
                            minWidth: 56,
                            ...shadows.subtle,
                          }}
                        >
                          <Text className="text-[12.5px] font-bold text-black">
                            View
                          </Text>
                        </View>
                      </View>
                    </PressableScale>
                  ))}
                </View>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
