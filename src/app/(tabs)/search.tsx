import { useMemo, useState } from "react";
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
import { colors, radii, shadows } from "@/constants/theme";
import { useAgents } from "@/hooks/use-agents";
import { searchAgentsLocally } from "@/services/agents-api";
import { useAppStore } from "@/store/use-app-store";
import type { Agent } from "@/types/agent";

const QUICK_TAGS = [
  "Venus",
  "PancakeSwap",
  "Monitoring",
  "Grid trading",
  "Liquidation",
  "Yield",
  "Auto-compounding",
  "Risk",
];

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const { data: allAgents, isLoading } = useAgents();

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
        stickyHeaderIndices={[1]}
      >
        {/* Child 0: Top Dolphin Writeup Header */}
        <View>
          <AppHeader />
        </View>

        {/* Child 1: Sticky Pinned Search Bar & Title */}
        <View style={{ backgroundColor: colors.canvas, zIndex: 10 }}>
          <View className="px-6 pb-2 pt-1">
            <Text
              className="text-[34px] font-black tracking-[-1px]"
              style={{ color: colors.ink }}
            >
              Search
            </Text>
          </View>

          {/* Clean Rounded Search Bar */}
          <View className="px-6 pb-3 pt-1">
            <View
              className="flex-row items-center rounded-2xl border bg-white px-4 py-3"
              style={{
                borderColor: "rgba(17,18,20,0.06)",
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
                placeholder="Search agents, skills, or publishers"
                placeholderTextColor={colors.muted}
                returnKeyType="search"
                style={{ color: colors.ink }}
                value={query}
              />

              {query.length > 0 ? (
                <PressableScale
                  accessibilityLabel="Clear search input"
                  accessibilityRole="button"
                  onPress={() => setQuery("")}
                  containerStyle={{ padding: 4 }}
                >
                  <CategoryGlyph color={colors.muted} name="revoke" size={16} />
                </PressableScale>
              ) : null}
            </View>
          </View>
        </View>

        {/* Results or Quick Suggestions */}
        <View className="px-6 pt-3">
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
                <View className="gap-3.5">
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
                  body={`No agents found matching "${query}". Try another search term.`}
                  state="unavailable"
                  title="No Results"
                />
              )}
            </View>
          ) : (
            <View className="gap-6">
              {/* Recent Searches */}
              {recentSearches.length > 0 ? (
                <View>
                  <Text
                    className="mb-2.5 text-[14px] font-bold"
                    style={{ color: colors.ink }}
                  >
                    Recent Searches
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    {recentSearches.map((item) => (
                      <View
                        key={item}
                        className="flex-row items-center gap-1.5 rounded-full border bg-white px-3 py-1.5"
                        style={{ borderColor: "rgba(17,18,20,0.06)", ...shadows.subtle }}
                      >
                        <PressableScale
                          accessibilityLabel={`Search for ${item}`}
                          accessibilityRole="button"
                          onPress={() => handleTagPress(item)}
                        >
                          <Text
                            className="text-[13px] font-medium"
                            style={{ color: colors.ink }}
                          >
                            {item}
                          </Text>
                        </PressableScale>
                        <PressableScale
                          accessibilityLabel={`Remove ${item} from recent`}
                          accessibilityRole="button"
                          onPress={() => removeRecentSearch(item)}
                          containerStyle={{ padding: 2 }}
                        >
                          <CategoryGlyph color={colors.muted} name="revoke" size={12} />
                        </PressableScale>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              {/* Popular Search Keywords */}
              <View>
                <Text
                  className="mb-2.5 text-[14px] font-bold"
                  style={{ color: colors.ink }}
                >
                  Suggested Keywords
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {QUICK_TAGS.map((tag) => (
                    <PressableScale
                      key={tag}
                      accessibilityLabel={`Search keyword ${tag}`}
                      accessibilityRole="button"
                      onPress={() => handleTagPress(tag)}
                      containerStyle={{
                        backgroundColor: "#FFFFFF",
                        borderColor: "rgba(17,18,20,0.06)",
                        borderRadius: 9999,
                        borderWidth: 1,
                        paddingHorizontal: 14,
                        paddingVertical: 7,
                        ...shadows.subtle,
                      }}
                    >
                      <Text
                        className="text-[13px] font-medium"
                        style={{ color: colors.ink }}
                      >
                        {tag}
                      </Text>
                    </PressableScale>
                  ))}
                </View>
              </View>

              {/* All Curated Agents */}
              {allAgents && allAgents.length > 0 ? (
                <View className="mt-2">
                  <Text
                    className="mb-3 text-[14px] font-bold"
                    style={{ color: colors.ink }}
                  >
                    All Available Agents
                  </Text>
                  <View className="gap-3.5">
                    {allAgents.map((agent) => (
                      <AgentCard
                        key={agent.id}
                        agent={agent}
                        onPress={() => handleAgentPress(agent)}
                      />
                    ))}
                  </View>
                </View>
              ) : null}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
