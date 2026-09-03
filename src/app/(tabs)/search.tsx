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

import { AgentRow } from "@/components/agent-row";
import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { StatePanel } from "@/components/state-panel";
import { AGENT_CATEGORIES } from "@/constants/agents";
import { colors, shadows } from "@/constants/theme";
import { useAgents } from "@/hooks/use-agents";
import { searchAgentsLocally } from "@/services/agents-api";
import { useAppStore } from "@/store/use-app-store";
import type { Agent, AgentCategory } from "@/types/agent";

const categoryBgColors: Record<AgentCategory, string> = {
  monitoring: "#F5F3EC",
  rebalancing: "#EAF1FB",
  "grid-trading": "#FAF5E6",
  "health-factor": "#F9F3F0",
  yield: "#F0F7F2",
};

const categorySubtitles: Record<AgentCategory, string> = {
  monitoring: "Watch wallets",
  rebalancing: "LP ranges",
  "grid-trading": "Price ladders",
  "health-factor": "Borrow risk",
  yield: "Find yield",
};

const categoryLabels: Record<AgentCategory, string> = {
  monitoring: "Monitoring",
  rebalancing: "Rebalancing",
  "grid-trading": "Grid trading",
  "health-factor": "Health factor",
  yield: "Yield",
};

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const { data: allAgents } = useAgents();

  const recentSearches = useAppStore((state) => state.recentSearches);
  const addRecentSearch = useAppStore((state) => state.addRecentSearch);
  const removeRecentSearch = useAppStore((state) => state.removeRecentSearch);
  const clearRecentSearches = useAppStore((state) => state.clearRecentSearches);

  const searchResults = useMemo(() => {
    if (!allAgents || !query.trim()) return [];
    return searchAgentsLocally(allAgents, query);
  }, [allAgents, query]);

  /**
   * "Suggested for you" is derived from real signals, never a hand-picked list.
   * It used to be `allAgents.slice(0, 4)` - the first four rows the backend
   * happened to return, presented as a recommendation.
   *
   * With search history it is genuinely personal: agents matching what was
   * actually searched, most recent term first.
   *
   * With no history there is nothing personal to go on, so it falls back to the
   * most-reviewed agent in each category. feedbackCount is the only honest
   * ranking signal this catalog currently carries - it is live for all 25
   * agents - whereas reputationScore is unavailable for 9 of them and exactly
   * 0 for every one of the rest, so ordering by it would be ordering by noise.
   * The heading says which of the two bases produced the list, so the screen
   * never implies a personalisation it did not do.
   */
  const suggested = useMemo(() => {
    if (!allAgents || allAgents.length === 0) {
      return { agents: [] as Agent[], basis: "category" as const };
    }

    if (recentSearches.length > 0) {
      const seen = new Set<string>();
      const matches: Agent[] = [];

      for (const term of recentSearches) {
        for (const agent of searchAgentsLocally(allAgents, term)) {
          if (!seen.has(agent.id)) {
            seen.add(agent.id);
            matches.push(agent);
          }
        }
      }

      if (matches.length > 0) {
        return { agents: matches.slice(0, 6), basis: "history" as const };
      }
    }

    // Only "live" and "stale" carry a value; the other statuses are null.
    const feedbackOf = (agent: Agent) =>
      agent.feedbackCount.status === "live" ||
      agent.feedbackCount.status === "stale"
        ? agent.feedbackCount.value
        : 0;

    const topPerCategory = AGENT_CATEGORIES.flatMap((cat) => {
      const inCategory = allAgents
        .filter((agent) => agent.category === cat.slug)
        .sort((a, b) => feedbackOf(b) - feedbackOf(a));

      return inCategory.length > 0 ? [inCategory[0]] : [];
    });

    return { agents: topPerCategory, basis: "category" as const };
  }, [allAgents, recentSearches]);

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
      {/* Sleek Compact Search Bar */}
      <View
        className="px-4 pt-1.5 pb-2.5"
        style={{
          backgroundColor: colors.canvas,
          zIndex: 20,
        }}
      >
        <View
          className="flex-row items-center rounded-full bg-white px-3.5 h-[42px]"
          style={{
            borderColor: isFocused ? colors.goldDark : "rgba(17,18,20,0.08)",
            borderWidth: 1.2,
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
              onPress={() => setQuery("")}
              containerStyle={{ padding: 4 }}
            >
              <CategoryGlyph color="#8C8E88" name="revoke" size={14} />
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
          /* Live Results */
          <View className="px-4 pt-1">
            <View className="pb-2.5">
              <Text className="text-[12px] font-bold uppercase tracking-wider text-zinc-500">
                {searchResults.length} {searchResults.length === 1 ? "Agent found" : "Agents found"}
              </Text>
            </View>

            {searchResults.length > 0 ? (
              <View className="gap-2">
                {searchResults.map((agent) => (
                  <AgentRow
                    key={agent.id}
                    agent={agent}
                    onPress={() => handleAgentPress(agent)}
                    subtitle={`${categoryLabels[agent.category]} · ${agent.tagline}`}
                  />
                ))}
              </View>
            ) : (
              <View className="pt-8">
                <StatePanel
                  body={`No agents found matching "${query}". Try searching by category, protocol, or skill.`}
                  state="unavailable"
                  title="No results found"
                />
              </View>
            )}
          </View>
        ) : (
          /* Seamless Discovery Home */
          <View className="px-4 pt-1 gap-5">
            {/* Recent Searches */}
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
                      onPress={() => clearRecentSearches()}
                    >
                      <Text className="text-[11px] font-bold text-zinc-400">
                        Clear all
                      </Text>
                    </PressableScale>
                  ) : null}
                </View>

                <View className="rounded-xl bg-white border border-black/5 overflow-hidden divide-y divide-black/5">
                  {recentSearches.slice(0, 4).map((item) => (
                    <View
                      key={item}
                      className="flex-row items-center justify-between px-3.5 py-2.5"
                    >
                      <PressableScale
                        accessibilityLabel={`Search ${item}`}
                        accessibilityRole="button"
                        className="flex-1 flex-row items-center gap-2.5"
                        onPress={() => handleTagPress(item)}
                      >
                        <CategoryGlyph color="#8C8E88" name="clock" size={14} />
                        <Text className="text-[13.5px] font-medium text-zinc-800">
                          {item}
                        </Text>
                      </PressableScale>

                      <PressableScale
                        accessibilityLabel={`Remove ${item}`}
                        accessibilityRole="button"
                        onPress={() => removeRecentSearch(item)}
                        containerStyle={{ padding: 4 }}
                      >
                        <CategoryGlyph color="#A0A0A0" name="revoke" size={13} />
                      </PressableScale>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {/* Explore Categories - every category, not a hardcoded four */}
            <View>
              <Text className="text-[14px] font-bold pb-2.5" style={{ color: colors.ink }}>
                Explore Categories
              </Text>
              <View className="flex-row flex-wrap gap-2.5">
                {AGENT_CATEGORIES.map((cat) => {
                  const count =
                    allAgents?.filter((agent) => agent.category === cat.slug)
                      .length ?? 0;

                  return (
                    <PressableScale
                      key={cat.slug}
                      accessibilityLabel={cat.label}
                      accessibilityRole="button"
                      onPress={() => handleTagPress(cat.label)}
                      style={{ flexBasis: "47%", flexGrow: 1 }}
                      containerStyle={{
                        alignItems: "center",
                        backgroundColor: "#FFFFFF",
                        borderColor: "rgba(17,18,20,0.06)",
                        borderRadius: 18,
                        borderWidth: 1,
                        flexDirection: "row",
                        gap: 10,
                        paddingHorizontal: 12,
                        paddingVertical: 12,
                        ...shadows.subtle,
                      }}
                    >
                      <View
                        className="h-10 w-10 items-center justify-center rounded-xl overflow-hidden"
                        style={{
                          backgroundColor: categoryBgColors[cat.slug] ?? "#F5F3EC",
                          borderColor: "rgba(17,18,20,0.04)",
                          borderWidth: 1,
                        }}
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
                          className="text-[13.5px] font-bold"
                          numberOfLines={1}
                          style={{ color: colors.ink }}
                        >
                          {cat.label}
                        </Text>
                        <Text
                          className="text-[11px] text-zinc-500 mt-0.5 font-medium"
                          numberOfLines={1}
                        >
                          {allAgents
                            ? `${count} ${count === 1 ? "agent" : "agents"}`
                            : categorySubtitles[cat.slug]}
                        </Text>
                      </View>
                    </PressableScale>
                  );
                })}
              </View>
            </View>

            {/* Suggested for you - derived, and it says which signal it used */}
            {suggested.agents.length > 0 ? (
              <View>
                <Text className="text-[14px] font-bold" style={{ color: colors.ink }}>
                  Suggested for you
                </Text>
                <Text className="text-[11.5px] font-medium text-zinc-500 pt-0.5 pb-2.5">
                  {suggested.basis === "history"
                    ? "Based on what you have searched for"
                    : "Most-reviewed agent in each category"}
                </Text>
                <View className="gap-2.5">
                  {suggested.agents.map((agent) => (
                    <AgentRow
                      key={agent.id}
                      agent={agent}
                      onPress={() => handleAgentPress(agent)}
                      subtitle={`${categoryLabels[agent.category]} · ${agent.tagline}`}
                    />
                  ))}
                </View>
              </View>
            ) : null}

            {/* The whole catalog, not a slice of it */}
            {allAgents === undefined ? (
              <View className="pb-4">
                <StatePanel
                  body="Fetching 8004scan-indexed BSC agent records..."
                  state="syncing"
                  title="Loading agents"
                />
              </View>
            ) : allAgents.length > 0 ? (
              <View className="pb-4">
                <Text className="text-[14px] font-bold" style={{ color: colors.ink }}>
                  All agents
                </Text>
                <Text className="text-[11.5px] font-medium text-zinc-500 pt-0.5 pb-2.5">
                  {allAgents.length} on BNB Chain
                </Text>
                <View className="gap-2.5">
                  {allAgents.map((agent) => (
                    <AgentRow
                      key={agent.id}
                      agent={agent}
                      onPress={() => handleAgentPress(agent)}
                      subtitle={`${categoryLabels[agent.category]} · ${agent.tagline}`}
                    />
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