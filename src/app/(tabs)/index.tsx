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
import { AppHeader } from "@/components/app-header";
import { CategoryGlyph } from "@/components/category-glyph";
import { ConstellationBg } from "@/components/constellation-bg";
import { PressableScale } from "@/components/pressable-scale";
import { StatePanel } from "@/components/state-panel";
import { colors, radii, shadows } from "@/constants/theme";
import { useAgents } from "@/hooks/use-agents";
import type { Agent, AgentCategory } from "@/types/agent";

const categoriesOverview: Array<{
  slug: AgentCategory;
  title: string;
  desc: string;
}> = [
  {
    slug: "monitoring",
    title: "Monitoring",
    desc: "Watch markets and positions in real time.",
  },
  {
    slug: "grid-trading",
    title: "Grid trading",
    desc: "Automate grids. Capture every swing.",
  },
  {
    slug: "health-factor",
    title: "Health factor",
    desc: "Stay protected. Agents that guard your risk.",
  },
  {
    slug: "yield",
    title: "Yield",
    desc: "Maximize returns across DeFi opportunities.",
  },
];

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

      {/* Sticky Pinned Top Header */}
      <View style={{ backgroundColor: colors.canvas, zIndex: 10 }}>
        <AppHeader />
        <View className="flex-row items-center justify-between px-6 pb-3 pt-0.5">
          <Text
            className="text-[32px] font-black tracking-[-1px]"
            style={{ color: colors.ink }}
          >
            Discover
          </Text>

          <PressableScale
            accessibilityLabel="View categories"
            accessibilityRole="button"
            onPress={() => router.push("/(tabs)/categories")}
            containerStyle={{
              alignItems: "center",
              backgroundColor: "#FFFFFF",
              borderColor: colors.line,
              borderRadius: 9999,
              borderWidth: 1,
              height: 38,
              justifyContent: "center",
              width: 38,
              ...shadows.subtle,
            }}
          >
            <CategoryGlyph color={colors.ink} name="layers" size={18} />
          </PressableScale>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 120, paddingTop: 4 }}
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
        {/* Featured Hero Card */}
        <View className="px-6 pb-2">
          <PressableScale
            accessibilityLabel="Explore Monitoring Agents collection"
            accessibilityRole="button"
            onPress={() => handleCategoryPress("monitoring")}
            containerStyle={{
              backgroundColor: "#0E0F12",
              borderColor: "rgba(255,255,255,0.08)",
              borderRadius: 28,
              borderWidth: 1,
              overflow: "hidden",
              padding: 20,
              ...shadows.floating,
            }}
          >
            {/* Category Tag */}
            <View
              className="self-start rounded-full px-3 py-1 mb-3 border"
              style={{
                backgroundColor: "#2A2415",
                borderColor: "rgba(245, 179, 0, 0.35)",
              }}
            >
              <Text className="text-[10px] font-bold uppercase tracking-[1.5px] text-[#F5B300]">
                MONITORING
              </Text>
            </View>

            <View className="flex-row items-center justify-between">
              {/* Left Column */}
              <View className="flex-1 pr-2">
                <Text className="text-[26px] font-black text-white leading-[30px] tracking-tight">
                  Agents that{"\n"}watch while{"\n"}you sleep
                </Text>

                <Text className="mt-2.5 text-[12px] leading-[18px] text-zinc-400">
                  Autonomous agents that track markets and safeguard your positions 24/7.
                </Text>

                <View className="mt-4 flex-row items-center gap-1.5">
                  <Text className="text-[13px] font-bold text-[#F5B300]">
                    Explore collection
                  </Text>
                  <CategoryGlyph
                    color="#F5B300"
                    name="arrow-right"
                    size={14}
                    strokeWidth={2.5}
                  />
                </View>
              </View>

              {/* Right Graphic */}
              <View className="h-44 w-40 items-center justify-center -mr-2">
                <Image
                  contentFit="contain"
                  priority="high"
                  source={require("../../../assets/images/hero-bnb-orbit.png")}
                  style={{ height: "100%", width: "100%" }}
                />
              </View>
            </View>

            {/* Carousel Pagination Dots */}
            <View className="mt-4 flex-row items-center justify-center gap-1.5">
              <View className="h-1 w-6 rounded-full bg-[#F5B300]" />
              <View className="h-1 w-4 rounded-full bg-zinc-700" />
              <View className="h-1 w-4 rounded-full bg-zinc-700" />
            </View>
          </PressableScale>
        </View>

        {/* Section: Built for every move */}
        <View className="mt-7 px-6">
          <Text
            className="text-[19px] font-bold tracking-tight"
            style={{ color: colors.ink }}
          >
            Built for every move
          </Text>
          <Text
            className="mt-0.5 text-[12px]"
            style={{ color: colors.muted }}
          >
            Four agent types. One marketplace. Endless possibilities.
          </Text>
        </View>

        {/* 4 Category Cards Horizontal Carousel */}
        <View className="mt-3.5">
          <ScrollView
            contentContainerStyle={{
              gap: 10,
              paddingHorizontal: 24,
            }}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {categoriesOverview.map((item) => (
              <PressableScale
                key={item.slug}
                accessibilityLabel={`Category: ${item.title}`}
                accessibilityRole="button"
                onPress={() => handleCategoryPress(item.slug)}
                containerStyle={{
                  alignItems: "center",
                  backgroundColor: "#FFFFFF",
                  borderColor: colors.line,
                  borderRadius: 18,
                  borderWidth: 1,
                  justifyContent: "space-between",
                  minHeight: 165,
                  paddingHorizontal: 10,
                  paddingVertical: 14,
                  width: 114,
                  ...shadows.subtle,
                }}
              >
                {/* Centered Circular Icon */}
                <View
                  className="h-12 w-12 items-center justify-center rounded-full border"
                  style={{
                    backgroundColor: "#FAFAFA",
                    borderColor: colors.lineLight,
                  }}
                >
                  <CategoryGlyph name={item.slug} size={22} />
                </View>

                {/* Title and Description */}
                <View className="items-center">
                  <Text
                    className="text-[13px] font-bold text-center"
                    style={{ color: colors.ink }}
                  >
                    {item.title}
                  </Text>
                  <Text
                    className="mt-1 text-[10px] text-center leading-3.5"
                    style={{ color: colors.muted }}
                  >
                    {item.desc}
                  </Text>
                </View>
              </PressableScale>
            ))}
          </ScrollView>
        </View>

        {/* Section: Curated BSC Agents */}
        <View className="mt-8 px-6">
          <View className="flex-row items-center justify-between pb-3">
            <Text
              className="text-[19px] font-bold tracking-tight"
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
