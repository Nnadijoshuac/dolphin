import { ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";

import { AgentIcon } from "@/components/agent-icon";
import { Button } from "@/components/buttons";
import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { StatusBadge } from "@/components/status-badge";
import { Surface } from "@/components/surface";
import { colors, radii, shadows } from "@/constants/theme";
import { EDITORIAL_AGENTS } from "@/data/editorial-agents";
import { useAgents } from "@/hooks/use-agents";
import { useAppStore, type PreviewHire } from "@/store/use-app-store";

export default function MyAgentsScreen() {
  const router = useRouter();
  const { data: indexedAgents } = useAgents();
  const previewHires = useAppStore((state) => state.previewHires);

  const handleManage = (preview: PreviewHire) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: "/manage/[id]",
      params: { id: preview.agentId },
    });
  };

  return (
    <SafeAreaView
      className="flex-1"
      edges={["top", "left", "right"]}
      style={{ backgroundColor: colors.canvas }}
    >
      {/* Sticky Pinned Top Header */}
      <View
        className="px-6 pb-3 pt-2"
        style={{ backgroundColor: colors.canvas, zIndex: 10 }}
      >
        <Text
          className="text-[32px] font-bold tracking-[-0.6px]"
          style={{ color: colors.ink }}
        >
          My Agents
        </Text>
        <Text className="mt-1 text-[14px]" style={{ color: colors.muted }}>
          Saved setup previews on this device
        </Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 110, paddingTop: 4 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="px-6">
          {previewHires.length > 0 ? (
            <View className="gap-4">
              <View className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <Text className="text-[12px] font-bold text-amber-900">
                  No active sessions inferred
                </Text>
                <Text className="mt-1 text-[12px] leading-4 text-amber-800">
                  These entries are local previews. Dolphin has not submitted payment,
                  wallet authorization, or agent execution transactions.
                </Text>
              </View>

              {previewHires.map((preview) => {
                const agent =
                  indexedAgents?.find(
                    (candidate) =>
                      candidate.tokenId === preview.agentId ||
                      candidate.id === preview.agentId,
                  ) ??
                  EDITORIAL_AGENTS.find(
                    (candidate) =>
                      candidate.tokenId === preview.agentId ||
                      candidate.id === preview.agentId,
                  );
                const category = agent?.category ?? "monitoring";

                return (
                  <PressableScale
                    accessibilityLabel={`Manage preview for ${agent?.name ?? preview.agentId}`}
                    accessibilityRole="button"
                    containerStyle={{
                      borderRadius: radii.large,
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.line,
                      padding: 16,
                      ...shadows.card,
                    }}
                    key={preview.agentId}
                    onPress={() => handleManage(preview)}
                  >
                    <View className="flex-row items-start gap-3.5">
                      <AgentIcon category={category} size={52} uri={agent?.iconUrl} />
                      <View className="min-w-0 flex-1">
                        <Text
                          className="text-[17px] font-bold"
                          numberOfLines={1}
                          style={{ color: colors.ink }}
                        >
                          {agent?.name ?? `Agent #${preview.agentId}`}
                        </Text>
                        <Text className="mt-1 text-[12px] capitalize" style={{ color: colors.muted }}>
                          {category.replace("-", " ")}
                        </Text>
                        <View className="mt-3">
                          <StatusBadge label="Device preview" tone="preview" />
                        </View>
                      </View>
                    </View>

                    <View
                      className="mt-4 flex-row items-center justify-between border-t pt-4"
                      style={{ borderColor: colors.line }}
                    >
                      <View>
                        <Text className="text-[10px] font-bold uppercase tracking-[1px]" style={{ color: colors.faint }}>
                          Saved
                        </Text>
                        <Text className="mt-1 text-[12px] font-bold" style={{ color: colors.ink }}>
                          {new Date(preview.savedAt).toLocaleDateString()}
                        </Text>
                      </View>
                      <Text className="text-[12px] font-bold" style={{ color: colors.ink }}>
                        Review setup →
                      </Text>
                    </View>
                  </PressableScale>
                );
              })}
            </View>
          ) : (
            <View className="gap-6 py-8">
              <Surface>
                <View className="items-center px-4 py-6">
                  <View className="mb-4 h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
                    <CategoryGlyph color={colors.ink} name="agents" size={28} />
                  </View>
                  <Text className="text-center text-[20px] font-bold" style={{ color: colors.ink }}>
                    No saved previews
                  </Text>
                  <Text className="mt-2 text-center text-[14px] leading-5" style={{ color: colors.muted }}>
                    Review an agent’s identity, data availability, authorization model,
                    and payment readiness before saving a setup preview.
                  </Text>
                  <View className="mt-6 w-full">
                    <Button
                      label="Browse agent catalog"
                      onPress={() => router.push("/(tabs)/search")}
                    />
                  </View>
                </View>
              </Surface>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
