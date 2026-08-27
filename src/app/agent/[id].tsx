import {
  ScrollView,
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
import { colors, shadows } from "@/constants/theme";
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

  return (
    <SafeAreaView
      className="flex-1"
      edges={["top", "left", "right"]}
      style={{ backgroundColor: colors.canvas }}
    >
      {/* App Store Product Page Navigation Bar */}
      <View className="flex-row items-center justify-between px-6 pt-2 pb-3 border-b" style={{ borderColor: colors.line }}>
        <PressableScale
          accessibilityLabel="Go back"
          accessibilityRole="button"
          onPress={() => router.back()}
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
          <Text className="text-[17px] font-bold" style={{ color: colors.ink }}>
            ‹
          </Text>
        </PressableScale>

        <Text
          className="text-[16px] font-bold"
          numberOfLines={1}
          style={{ color: colors.ink, maxWidth: "60%" }}
        >
          {agent?.name ?? "Agent Details"}
        </Text>

        <PressableScale
          accessibilityLabel="Category badge"
          accessibilityRole="button"
          onPress={() => {
            if (agent) {
              router.push({
                pathname: "/category/[slug]",
                params: { slug: agent.category },
              });
            }
          }}
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
          <CategoryGlyph
            color={colors.ink}
            name={agent ? agent.category : "discover"}
            size={18}
          />
        </PressableScale>
      </View>

      <ScrollView
        className="flex-1 px-6"
        contentContainerStyle={{ paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          <View className="py-20">
            <StatePanel
              body="Resolving ERC-8004 token identity and verifying contract parameters on BNB Smart Chain..."
              state="syncing"
              title="Loading Agent Specifications"
            />
          </View>
        ) : isError || !agent ? (
          <View className="py-20">
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
