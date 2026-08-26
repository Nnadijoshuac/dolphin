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

import { AgentIcon } from "@/components/agent-icon";
import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { SectionHeading } from "@/components/section-heading";
import { StatePanel } from "@/components/state-panel";
import { StatusBadge } from "@/components/status-badge";
import { colors, radii, shadows } from "@/constants/theme";
import { useAgents } from "@/hooks/use-agents";
import { searchAgentsLocally } from "@/services/agents-api";
import { useAppStore } from "@/store/use-app-store";
import type { Agent } from "@/types/agent";

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
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
  };

  return (
    <SafeAreaView
      className="flex-1"
      edges={["top", "left", "right"]}
      style={{ backgroundColor: colors.canvas }}
    >
      <View className="flex-1 px-6">
        {/* Title */}
        <View className="pt-3 pb-3">
          <Text
            className="text-[34px] font-extrabold tracking-[-1px]"
            style={{ color: colors.ink }}
          >
            Search
          </Text>
        </View>

        {/* App Store Style Search Bar */}
        <View
          className="flex-row items-center rounded-xl bg-slate-200/70 px-3.5 py-2.5"
          style={{ borderColor: colors.line }}
        >
          <CategoryGlyph color={colors.muted} name="search" size={18} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Agents, skills, categories, or protocols"
            placeholderTextColor={colors.muted}
            className="ml-2.5 flex-1 text-[15px] font-medium"
            style={{ color: colors.ink }}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => {
              if (query.trim()) addRecentSearch(query.trim());
            }}
          />
          {query.length > 0 ? (
            <PressableScale
              accessibilityLabel="Clear search text"
              accessibilityRole="button"
              onPress={() => setQuery("")}
              containerStyle={{
                height: 20,
                width: 20,
                borderRadius: 10,
                backgroundColor: colors.muted,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text className="text-[11px] font-bold text-white leading-none">✕</Text>
            </PressableScale>
          ) : null}
        </View>

        <ScrollView
          className="flex-1 mt-4"
          contentContainerStyle={{ paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {query.trim().length > 0 ? (
            /* Search Results */
            <View>
              <Text className="text-[13px] font-bold text-slate-500 mb-3 uppercase tracking-wider">
                {searchResults.length} {searchResults.length === 1 ? "Result" : "Results"}
              </Text>

              {searchResults.length > 0 ? (
                <View className="gap-2.5">
                  {searchResults.map((agent) => (
                    <PressableScale
                      key={agent.id}
                      accessibilityLabel={agent.name}
                      accessibilityRole="button"
                      onPress={() => handleAgentPress(agent)}
                      containerStyle={{
                        flexDirection: "row",
                        alignItems: "center",
                        padding: 14,
                        borderRadius: radii.large,
                        backgroundColor: colors.surface,
                        borderWidth: 1,
                        borderColor: colors.line,
                        ...shadows.card,
                      }}
                    >
                      <AgentIcon
                        category={agent.category}
                        size={48}
                        uri={agent.iconUrl}
                      />
                      <View className="ml-3.5 flex-1 mr-2">
                        <Text
                          className="text-[16px] font-bold"
                          numberOfLines={1}
                          style={{ color: colors.ink }}
                        >
                          {agent.name}
                        </Text>
                        <Text
                          className="text-[12px] leading-4"
                          numberOfLines={1}
                          style={{ color: colors.muted }}
                        >
                          {agent.tagline}
                        </Text>
                        <View className="mt-1.5 flex-row items-center gap-1.5">
                          <StatusBadge
                            label={agent.category.replace("-", " ")}
                            tone="neutral"
                          />
                          <StatusBadge
                            label={agent.recordStatus === "indexed" ? "Indexed" : "Editorial"}
                            tone={agent.recordStatus === "indexed" ? "indexed" : "neutral"}
                          />
                        </View>
                      </View>

                      <View className="rounded-full bg-slate-100 px-3.5 py-1.5">
                        <Text className="text-[12px] font-bold text-slate-900">
                          VIEW
                        </Text>
                      </View>
                    </PressableScale>
                  ))}
                </View>
              ) : (
                <StatePanel
                  body={`No agents found matching "${query}". Try searching by category like "yield" or protocol like "Venus".`}
                  compact
                  state="unavailable"
                  title="No Results"
                />
              )}
            </View>
          ) : (
            /* Empty State: Recent & Suggested Searches */
            <View className="gap-6">
              {recentSearches.length > 0 ? (
                <View>
                  <View className="flex-row items-center justify-between mb-3">
                    <SectionHeading title="Recent Searches" />
                    <PressableScale
                      accessibilityLabel="Clear recent searches"
                      accessibilityRole="button"
                      onPress={clearRecentSearches}
                    >
                      <Text className="text-[13px] font-semibold text-slate-500">
                        Clear
                      </Text>
                    </PressableScale>
                  </View>
                  <View className="flex-row flex-wrap gap-2">
                    {recentSearches.map((item) => (
                      <PressableScale
                        key={item}
                        accessibilityLabel={`Search for ${item}`}
                        accessibilityRole="button"
                        onPress={() => handleTagPress(item)}
                        containerStyle={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                          paddingHorizontal: 14,
                          paddingVertical: 8,
                          borderRadius: 16,
                          backgroundColor: colors.surface,
                          borderWidth: 1,
                          borderColor: colors.line,
                          ...shadows.card,
                        }}
                      >
                        <CategoryGlyph color={colors.muted} name="search" size={12} />
                        <Text
                          className="text-[13px] font-medium"
                          style={{ color: colors.ink }}
                        >
                          {item}
                        </Text>
                      </PressableScale>
                    ))}
                  </View>
                </View>
              ) : null}

              {/* Trending Discovery Tags */}
              <View>
                <SectionHeading title="Suggested Specializations" />
                <View className="flex-row flex-wrap gap-2">
                  {["Monitoring", "Grid Trading", "Health Factor", "Yield Farming", "Venus Protocol", "PancakeSwap", "Liquidation Guard"].map(
                    (tag) => (
                      <PressableScale
                        key={tag}
                        accessibilityLabel={`Search tag: ${tag}`}
                        accessibilityRole="button"
                        onPress={() => handleTagPress(tag)}
                        containerStyle={{
                          paddingHorizontal: 14,
                          paddingVertical: 8,
                          borderRadius: 16,
                          backgroundColor: "#F0F2F5",
                        }}
                      >
                        <Text className="text-[13px] font-semibold text-slate-700">
                          {tag}
                        </Text>
                      </PressableScale>
                    )
                  )}
                </View>
              </View>
            </View>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
