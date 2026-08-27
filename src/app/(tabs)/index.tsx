import {
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";

import { AgentCard } from "@/components/agent-card";

import { CategoryGlyph } from "@/components/category-glyph";
import { ConstellationBg } from "@/components/constellation-bg";
import { PressableScale } from "@/components/pressable-scale";
import { StatePanel } from "@/components/state-panel";
import { colors, radii, shadows } from "@/constants/theme";
import { useAgents } from "@/hooks/use-agents";
import type { Agent } from "@/types/agent";

const categoriesOverview = [
  {
    slug: "monitoring",
    title: "Monitoring",
    desc: "Review published scope and available alert evidence.",
    bg: "#F5F3EB",
  },
  {
    slug: "grid-trading",
    title: "Grid trading",
    desc: "Compare range claims with available track records.",
    bg: "#FAF5E6",
  },
  {
    slug: "health-factor",
    title: "Health factor",
    desc: "Inspect lending-risk claims and position evidence.",
    bg: "#F9F3F0",
  },
  {
    slug: "yield",
    title: "Yield",
    desc: "Review protocol scope, price, and performance evidence.",
    bg: "#F0F7F2",
  },
] as const;

export default function DiscoverScreen() {
  const router = useRouter();
  const { data: agents, isLoading, isError, refetch, isRefetching } = useAgents();

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
        {/* Discover Header */}
        <View className="flex-row items-start justify-between px-6 pb-4 pt-3">
          <View>
            <Text
              className="text-[32px] font-bold tracking-[-0.6px]"
              style={{ color: colors.ink }}
            >
              Discover
            </Text>
            <Text className="mt-1 text-[14px]" style={{ color: colors.muted }}>
              Registered ERC-8004 AI agents on BNB Chain
            </Text>
          </View>

          <PressableScale
            accessibilityLabel="View categories"
            accessibilityRole="button"
            onPress={() => router.push("/(tabs)/categories")}
            containerStyle={{
              alignItems: "center",
              backgroundColor: colors.surface,
              borderColor: colors.line,
              borderRadius: 18,
              borderWidth: 1,
              height: 36,
              justifyContent: "center",
              marginTop: 4,
              width: 36,
              ...shadows.subtle,
            }}
          >
            <CategoryGlyph color={colors.ink} name="layers" size={17} />
          </PressableScale>
        </View>

        {/* Monitoring collection hero */}
        <View className="px-6 pt-1">
          <PressableScale
            accessibilityLabel="Explore Monitoring Agents collection"
            accessibilityRole="button"
            onPress={() => handleCategoryPress("monitoring")}
            containerStyle={{
              borderRadius: radii.large,
              backgroundColor: "#111215",
              overflow: "hidden",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.08)",
              ...shadows.floating,
            }}
          >
            <View className="p-6">
              {/* Category Tag */}
              <View className="mb-3 self-start rounded-full bg-[#27282F] px-3 py-1">
                <Text className="text-[10px] font-bold uppercase tracking-[1.5px] text-[#F5B300]">
                  MONITORING
                </Text>
              </View>

              <View className="flex-row items-center justify-between">
                <View className="flex-1 pr-3">
                  <Text className="text-[24px] font-extrabold leading-7 text-white tracking-tight">
                    Monitoring agents,{"\n"}with evidence{"\n"}in view
                  </Text>

                  <View className="my-2.5 h-0.5 w-7 bg-[#F5B300]" />

                  <Text className="text-[13px] leading-5 text-slate-300">
                    Browse identities that publish monitoring capabilities. Live service
                    evidence stays labeled when available.
                  </Text>

                  <View className="mt-4 flex-row items-center gap-1.5">
                    <Text className="text-[13px] font-bold text-[#F5B300]">
                      Explore collection
                    </Text>
                    <CategoryGlyph
                      color="#F5B300"
                      name="arrow-right"
                      size={14}
                      strokeWidth={2.2}
                    />
                  </View>
                </View>

                {/* 3D Gold Orbit Graphic */}
                <View className="h-36 w-36 items-center justify-center">
                  <Image
                    contentFit="contain"
                    source={require("../../../assets/images/hero-bnb-orbit.png")}
                    style={{ height: "100%", width: "100%", borderRadius: 18 }}
                  />
                </View>
              </View>

              <View className="mt-5 flex-row items-center justify-center gap-1.5">
                <CategoryGlyph color="#F5B300" name="info" size={13} />
                <Text className="text-[11px] font-medium text-slate-300">
                  Registry identity is not service proof
                </Text>
              </View>
            </View>
          </PressableScale>
        </View>

        {/* Section: Built for every move */}
        <View className="mt-8 px-6">
          <Text
            className="text-[20px] font-bold tracking-tight"
            style={{ color: colors.ink }}
          >
            Built for every move
          </Text>
          <Text
            className="mt-0.5 text-[13px]"
            style={{ color: colors.muted }}
          >
            Four categories. Different claims. Evidence shown separately.
          </Text>

          {/* 4 Cards Grid / Carousel */}
          <View className="mt-4 flex-row flex-wrap gap-3">
            {categoriesOverview.map((item) => (
              <PressableScale
                key={item.slug}
                accessibilityLabel={`Category: ${item.title}`}
                accessibilityRole="button"
                onPress={() => handleCategoryPress(item.slug)}
                containerStyle={{
                  width: "48%",
                  borderRadius: radii.large,
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.line,
                  padding: 14,
                  ...shadows.subtle,
                }}
              >
                <View
                  className="h-11 w-11 items-center justify-center rounded-2xl"
                  style={{ backgroundColor: item.bg }}
                >
                  <CategoryGlyph name={item.slug} size={22} />
                </View>

                <Text
                  className="mt-3 text-[15px] font-bold"
                  style={{ color: colors.ink }}
                >
                  {item.title}
                </Text>
                <Text
                  className="mt-1 text-[12px] leading-4"
                  style={{ color: colors.muted }}
                >
                  {item.desc}
                </Text>
              </PressableScale>
            ))}
          </View>
        </View>

        {/* Section: Curated BSC Agents */}
        <View className="mt-9 px-6">
          <View className="flex-row items-center justify-between pb-3">
            <Text
              className="text-[20px] font-bold tracking-tight"
              style={{ color: colors.ink }}
            >
              Curated BSC Agents
            </Text>
            <PressableScale
              accessibilityLabel="View all agents"
              accessibilityRole="button"
              onPress={() => router.push("/(tabs)/categories")}
            >
              <Text
                className="text-[13px] font-bold"
                style={{ color: colors.goldDark }}
              >
                View all
              </Text>
            </PressableScale>
          </View>

          {isLoading ? (
            <View className="py-8">
              <StatePanel
                body="Fetching 8004scan-indexed BSC agent records..."
                state="syncing"
                title="Loading Agent Registry"
              />
            </View>
          ) : isError ? (
            <View className="py-8">
              <StatePanel
                body="Unable to connect to registry API. Please check your network connection."
                state="unavailable"
                title="Sync Failed"
              />
            </View>
          ) : (
            <View className="gap-3.5">
              {agents?.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  onPress={() => handleAgentPress(agent)}
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
