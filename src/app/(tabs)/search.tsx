import { useState, useMemo } from "react";
import {
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
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
import { searchAgentsLocally } from "@/services/agents-api";
import { useAppStore } from "@/store/use-app-store";
import type { Agent } from "@/types/agent";

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const { data: allAgents } = useAgents();

  const recentSearches = useAppStore((state) => state.recentSearches);
  const addRecentSearch = useAppStore((state) => state.addRecentSearch);
  const removeRecentSearch = useAppStore((state) => state.removeRecentSearch);

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

  const handleCategoryPress = (slug: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: "/category/[slug]",
      params: { slug },
    });
  };

  const handleTagPress = (tag: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setQuery(tag);
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
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* App Header */}
        <AppHeader />

        {/* Search Page Title */}
        <View className="px-6 pt-1 pb-3">
          <Text
            className="text-[34px] font-extrabold tracking-[-1px]"
            style={{ color: colors.ink }}
          >
            Search
          </Text>
        </View>

        {/* Clean Rounded Search Bar with Filter */}
        <View className="px-6 pb-2">
          <View
            className="flex-row items-center rounded-2xl border bg-white px-4 py-3"
            style={{
              borderColor: colors.line,
              ...shadows.subtle,
            }}
          >
            <CategoryGlyph color={colors.muted} name="search" size={18} />
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              className="ml-3 flex-1 text-[15px] font-medium"
              onChangeText={setQuery}
              onSubmitEditing={() => {
                if (query.trim()) addRecentSearch(query.trim());
              }}
              placeholder="Agents, skills, or publishers"
              placeholderTextColor={colors.muted}
              returnKeyType="search"
              style={{ color: colors.ink }}
              value={query}
            />

            {query.length > 0 ? (
              <PressableScale
                accessibilityLabel="Clear search"
                accessibilityRole="button"
                onPress={() => setQuery("")}
                containerStyle={{ padding: 4 }}
              >
                <Text className="text-[13px] font-bold text-slate-400">✕</Text>
              </PressableScale>
            ) : null}
          </View>
        </View>

        {/* Results or Category Browsing */}
        <View className="px-6 pt-4">
          {query.trim().length > 0 ? (
            <View>
              <Text
                className="mb-3 text-[12px] font-bold uppercase tracking-wider"
                style={{ color: colors.muted }}
              >
                {searchResults.length}{" "}
                {searchResults.length === 1 ? "Result" : "Results"}
              </Text>

              {searchResults.length > 0 ? (
                <View className="gap-3">
                  {searchResults.map((agent) => (
                    <AgentCard
                      key={agent.id}
                      agent={agent}
                      onPress={() => handleAgentPress(agent)}
                    />
                  ))}
                </View>
              ) : (
                <StatePanel
                  body={`No agents found matching "${query}". Try searching by category or name.`}
                  state="unavailable"
                  title="No Results"
                />
              )}
            </View>
          ) : (
            <View className="gap-7">
              {/* Browse by Category Section */}
              <View>
                <Text
                  className="mb-3 text-[17px] font-bold tracking-tight"
                  style={{ color: colors.ink }}
                >
                  Browse by category
                </Text>

                <View className="gap-2.5">
                  {AGENT_CATEGORIES.map((cat) => (
                    <PressableScale
                      key={cat.slug}
                      accessibilityLabel={`Browse ${cat.label}`}
                      accessibilityRole="button"
                      onPress={() => handleCategoryPress(cat.slug)}
                      containerStyle={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: 14,
                        borderRadius: radii.large,
                        backgroundColor: colors.surface,
                        borderWidth: 1,
                        borderColor: colors.line,
                        ...shadows.subtle,
                      }}
                    >
                      <View className="flex-row items-center gap-3.5">
                        <View className="h-9 w-9 items-center justify-center rounded-xl bg-[#F5F3EB]">
                          <CategoryGlyph name={cat.slug} size={18} />
                        </View>
                        <Text
                          className="text-[15px] font-bold"
                          style={{ color: colors.ink }}
                        >
                          {cat.label}
                        </Text>
                      </View>

                      <CategoryGlyph
                        color={colors.muted}
                        name="chevron-right"
                        size={16}
                      />
                    </PressableScale>
                  ))}
                </View>
              </View>

              {/* Recent Searches */}
              <View>
                <Text
                  className="mb-3 text-[17px] font-bold tracking-tight"
                  style={{ color: colors.ink }}
                >
                  Recent searches
                </Text>

                <View className="gap-2">
                  {(recentSearches.length > 0
                    ? recentSearches
                    : ["wallet alerts", "liquidation protection"]
                  ).map((item) => (
                    <PressableScale
                      key={item}
                      accessibilityLabel={`Search ${item}`}
                      accessibilityRole="button"
                      onPress={() => handleTagPress(item)}
                      containerStyle={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        paddingHorizontal: 16,
                        paddingVertical: 12,
                        borderRadius: radii.large,
                        backgroundColor: colors.surface,
                        borderWidth: 1,
                        borderColor: colors.line,
                        ...shadows.subtle,
                      }}
                    >
                      <View className="flex-row items-center gap-3">
                        <CategoryGlyph color={colors.muted} name="clock" size={16} />
                        <Text
                          className="text-[14px] font-medium"
                          style={{ color: colors.inkSecondary }}
                        >
                          {item}
                        </Text>
                      </View>

                      <PressableScale
                        accessibilityLabel="Remove search"
                        accessibilityRole="button"
                        onPress={() => removeRecentSearch(item)}
                        containerStyle={{ padding: 4 }}
                      >
                        <Text className="text-[13px] font-bold text-slate-400">✕</Text>
                      </PressableScale>
                    </PressableScale>
                  ))}
                </View>
              </View>

              {/* Live registry search ready status card */}
              <View
                className="flex-row items-center justify-between rounded-2xl border p-4"
                style={{
                  backgroundColor: colors.goldMuted,
                  borderColor: colors.goldBorder,
                  ...shadows.subtle,
                }}
              >
                <View className="flex-row items-center gap-3">
                  <CategoryGlyph color={colors.goldDark} name="sparkle" size={18} />
                  <Text
                    className="text-[14px] font-bold"
                    style={{ color: colors.ink }}
                  >
                    Live registry search ready
                  </Text>
                </View>

                <CategoryGlyph name="check" size={18} />
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
