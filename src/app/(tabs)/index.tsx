import {
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";

import { AgentCard } from "@/components/agent-card";
import { AgentIcon } from "@/components/agent-icon";
import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { SectionHeading } from "@/components/section-heading";
import { StatePanel } from "@/components/state-panel";
import { StatusBadge } from "@/components/status-badge";
import { AGENT_CATEGORIES } from "@/constants/agents";
import { colors, radii, shadows } from "@/constants/theme";
import { useAgents } from "@/hooks/use-agents";
import type { Agent } from "@/types/agent";

export default function DiscoverScreen() {
  const router = useRouter();
  const { data: agents, isLoading, isError, refetch, isRefetching } = useAgents();

  const featuredAgent = agents?.[0];
  const spotlightAgents = agents?.slice(1) ?? [];

  const handleAgentPress = (agent: Agent) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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

  const todayDate = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).toUpperCase();

  return (
    <SafeAreaView
      className="flex-1"
      edges={["top", "left", "right"]}
      style={{ backgroundColor: colors.canvas }}
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 110 }}
        showsVerticalScrollIndicator={false}
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
      >
        {/* App Store Today-style Top Header */}
        <View className="px-6 pt-3 pb-4">
          <Text
            className="text-[12px] font-bold tracking-wider"
            style={{ color: colors.muted }}
          >
            {todayDate}
          </Text>
          <View className="mt-1 flex-row items-center justify-between">
            <Text
              className="text-[34px] font-extrabold tracking-[-1px]"
              style={{ color: colors.ink }}
            >
              Discover
            </Text>
            <PressableScale
              accessibilityLabel="Open wallet profile"
              accessibilityRole="button"
              onPress={() => router.push("/(tabs)/profile")}
              containerStyle={{
                height: 38,
                width: 38,
                borderRadius: 19,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.line,
                alignItems: "center",
                justifyContent: "center",
                ...shadows.card,
              }}
            >
              <CategoryGlyph color={colors.ink} name="wallet" size={18} />
            </PressableScale>
          </View>
        </View>

        {isLoading ? (
          <View className="px-6 py-12">
            <StatePanel
              body="Querying ERC-8004 identity registry on BNB Smart Chain..."
              state="syncing"
              title="Loading Agent Registry"
            />
          </View>
        ) : isError ? (
          <View className="px-6 py-12">
            <StatePanel
              body="Unable to connect to registry API. Please check your network connection."
              state="unavailable"
              title="Sync Failed"
            />
          </View>
        ) : (
          <>
            {/* Hero Feature Card (App Store "Today" Card Style) */}
            {featuredAgent ? (
              <View className="px-6 pt-2">
                <PressableScale
                  accessibilityLabel={`Featured agent: ${featuredAgent.name}`}
                  accessibilityRole="button"
                  onPress={() => handleAgentPress(featuredAgent)}
                  containerStyle={{
                    borderRadius: 24,
                    overflow: "hidden",
                    ...shadows.card,
                  }}
                >
                  <LinearGradient
                    colors={["#1C1D24", "#0D0E12"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    className="p-6"
                    style={{ minHeight: 330, justifyContent: "space-between" }}
                  >
                    {/* Top Tagline / Category */}
                    <View>
                      <View className="flex-row items-center justify-between">
                        <View className="rounded-full bg-white/15 px-3 py-1">
                          <Text className="text-[11px] font-bold uppercase tracking-wider text-amber-400">
                            AGENT OF THE DAY
                          </Text>
                        </View>
                        <StatusBadge
                          label={featuredAgent.recordStatus === "indexed" ? "Live Registry" : "Editorial"}
                          tone={featuredAgent.recordStatus === "indexed" ? "indexed" : "neutral"}
                        />
                      </View>

                      <Text className="mt-4 text-[28px] font-extrabold text-white tracking-[-0.8px] leading-8">
                        {featuredAgent.name}
                      </Text>
                      <Text className="mt-2 text-[14px] text-slate-300 leading-5" numberOfLines={2}>
                        {featuredAgent.tagline}
                      </Text>
                    </View>

                    {/* Bottom Card Footer */}
                    <View className="mt-6 flex-row items-center justify-between rounded-2xl bg-white/10 p-3.5 backdrop-blur-md">
                      <View className="flex-row items-center gap-3">
                        <AgentIcon
                          category={featuredAgent.category}
                          size={46}
                          uri={featuredAgent.iconUrl}
                        />
                        <View>
                          <Text className="text-[14px] font-bold text-white" numberOfLines={1}>
                            {featuredAgent.publisher}
                          </Text>
                          <Text className="text-[11px] font-medium text-slate-400 capitalize">
                            {featuredAgent.category.replace("-", " ")}
                          </Text>
                        </View>
                      </View>
                      <View className="rounded-full bg-white px-4 py-2">
                        <Text className="text-[12px] font-bold text-slate-950">
                          Inspect
                        </Text>
                      </View>
                    </View>
                  </LinearGradient>
                </PressableScale>
              </View>
            ) : null}

            {/* Quick Category Chips Grid */}
            <View className="mt-8 px-6">
              <SectionHeading title="Explore by Specialization" />
              <View className="flex-row flex-wrap gap-2.5">
                {AGENT_CATEGORIES.map((cat) => (
                  <PressableScale
                    key={cat.slug}
                    accessibilityLabel={cat.label}
                    accessibilityRole="button"
                    onPress={() => handleCategoryPress(cat.slug)}
                    containerStyle={{
                      flex: 1,
                      minWidth: "46%",
                      borderRadius: radii.medium,
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.line,
                      padding: 14,
                      ...shadows.card,
                    }}
                  >
                    <View className="flex-row items-center gap-2.5">
                      <View className="h-8 w-8 items-center justify-center rounded-xl bg-slate-100">
                        <CategoryGlyph color={colors.ink} name={cat.slug} size={18} />
                      </View>
                      <View className="flex-1">
                        <Text
                          className="text-[14px] font-bold"
                          style={{ color: colors.ink }}
                          numberOfLines={1}
                        >
                          {cat.label}
                        </Text>
                      </View>
                    </View>
                  </PressableScale>
                ))}
              </View>
            </View>

            {/* Curated Spotlight Agents */}
            <View className="mt-9 px-6">
              <SectionHeading title="Curated BSC Agents" />
              <View className="gap-4">
                {spotlightAgents.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    onPress={() => handleAgentPress(agent)}
                  />
                ))}
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
