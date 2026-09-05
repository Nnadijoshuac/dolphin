import {
  ScrollView,
  Share,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";

import { AgentDetail } from "@/components/agent-detail";
import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { StatePanel } from "@/components/state-panel";
import { colors } from "@/constants/theme";
import { useAgentDetail } from "@/hooks/use-agents";
import { useAppStore } from "@/store/use-app-store";

export default function AgentDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: agent, isLoading, isError } = useAgentDetail(id);

  const previewHires = useAppStore((state) => state.previewHires);
  const isPreviewSaved = previewHires.some(
    (preview) =>
      preview.agentId === id || (agent && preview.agentId === agent.tokenId),
  );

  const handleAction = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (isPreviewSaved) {
      router.push({
        pathname: "/manage/[id]",
        params: { id: id! },
      });
    } else {
      router.push({
        pathname: "/hire/[id]",
        params: { id: id! },
      });
    }
  };

  const handleShare = async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!agent) return;
    try {
      await Share.share({
        title: agent.name,
        message: `Check out ${agent.name} on Dolphin — ${agent.tagline}`,
      });
    } catch {
      // User cancelled or share unavailable
    }
  };

  return (
    <SafeAreaView
      className="flex-1"
      edges={["top", "left", "right"]}
      style={{ backgroundColor: "#FFFFFF" }}
    >
      {/* Google Play Store App Bar */}
      <View
        className="flex-row items-center justify-between px-4 py-2 border-b"
        style={{ borderColor: "rgba(17, 18, 20, 0.06)", backgroundColor: "#FFFFFF" }}
      >
        <PressableScale
          accessibilityLabel="Go back"
          accessibilityRole="button"
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.back();
          }}
          containerStyle={{
            height: 40,
            width: 40,
            borderRadius: 20,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <CategoryGlyph
            color={colors.ink}
            name="chevron-left"
            size={20}
            strokeWidth={2}
          />
        </PressableScale>

        <Text
          className="text-[15px] font-semibold flex-1 mx-3"
          numberOfLines={1}
          style={{ color: colors.ink }}
        >
          {agent?.name ?? "Agent Details"}
        </Text>

        <View className="flex-row items-center gap-1">
          <PressableScale
            accessibilityLabel="Search agents"
            accessibilityRole="button"
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push("/(tabs)/search");
            }}
            containerStyle={{
              height: 40,
              width: 40,
              borderRadius: 20,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <CategoryGlyph
              color={colors.ink}
              name="search"
              size={20}
            />
          </PressableScale>

          <PressableScale
            accessibilityLabel="Share agent"
            accessibilityRole="button"
            onPress={handleShare}
            containerStyle={{
              height: 40,
              width: 40,
              borderRadius: 20,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <CategoryGlyph
              color={colors.ink}
              name="share"
              size={19}
            />
          </PressableScale>

          <PressableScale
            accessibilityLabel="Category badge"
            accessibilityRole="button"
            onPress={() => {
              if (agent) {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push({
                  pathname: "/category/[slug]",
                  params: { slug: agent.category },
                });
              }
            }}
            containerStyle={{
              height: 40,
              width: 40,
              borderRadius: 20,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <CategoryGlyph
              color={colors.ink}
              name={agent ? agent.category : "more"}
              size={19}
            />
          </PressableScale>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 80 }}
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          <View className="px-6 py-20">
            <StatePanel
              body="Resolving ERC-8004 token identity and verifying contract parameters on BNB Smart Chain..."
              state="syncing"
              title="Loading Agent Specifications"
            />
          </View>
        ) : isError || !agent ? (
          <View className="px-6 py-20">
            <StatePanel
              body="Agent specifications could not be loaded from the registry."
              state="unavailable"
              title="Agent Not Found"
            />
          </View>
        ) : (
          <AgentDetail
            actionLabel={isPreviewSaved ? "Manage preview" : "Review setup"}
            agent={agent}
            onHire={handleAction}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
