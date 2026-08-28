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
import { useHiredAgents } from "@/hooks/use-hire-read-only-agent";
import { useAppStore } from "@/store/use-app-store";
import type { Agent } from "@/types/agent";
import { useWallet } from "@/wallet/wallet-provider";

export default function MyAgentsScreen() {
  const router = useRouter();
  const wallet = useWallet();
  const { data: indexedAgents } = useAgents();
  const previewHires = useAppStore((state) => state.previewHires);
  const hiredAgents = useHiredAgents(wallet.address);
  const hasHires = Boolean(hiredAgents && hiredAgents.length > 0);
  const hasPreviews = previewHires.length > 0;

  const findAgent = (tokenId: string) =>
    indexedAgents?.find(
      (candidate) => candidate.tokenId === tokenId || candidate.id === tokenId,
    ) ?? EDITORIAL_AGENTS.find(
      (candidate) => candidate.tokenId === tokenId || candidate.id === tokenId,
    );

  const handleManage = (agentId: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: "/manage/[id]",
      params: { id: agentId },
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
          Hired agents and saved setup previews
        </Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 110, paddingTop: 4 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="px-6">
          {hasHires || hasPreviews ? (
            <View className="gap-8">
              {hasHires ? (
                <View className="gap-4">
                  <View className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                    <Text className="text-[12px] font-bold text-emerald-900">
                      Hired — backend record
                    </Text>
                    <Text className="mt-1 text-[12px] leading-4 text-emerald-800">
                      Saved to Dolphin&apos;s backend for this wallet. Not an onchain
                      transaction, and not yet wired to live activity.
                    </Text>
                  </View>

                  {hiredAgents?.map((hire) => (
                    <AgentListCard
                      agent={findAgent(hire.tokenId)}
                      badgeLabel="Hired"
                      badgeTone="live"
                      dateLabel="Hired"
                      dateValue={hire.hiredAt}
                      fallbackAgentId={hire.tokenId}
                      key={hire._id}
                      onPress={() => handleManage(hire.tokenId)}
                    />
                  ))}
                </View>
              ) : null}

              {hasPreviews ? (
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

                  {previewHires.map((preview) => (
                    <AgentListCard
                      agent={findAgent(preview.agentId)}
                      badgeLabel="Device preview"
                      badgeTone="preview"
                      dateLabel="Saved"
                      dateValue={preview.savedAt}
                      fallbackAgentId={preview.agentId}
                      key={preview.agentId}
                      onPress={() => handleManage(preview.agentId)}
                    />
                  ))}
                </View>
              ) : null}
            </View>
          ) : (
            <View className="gap-6 py-8">
              <Surface>
                <View className="items-center px-4 py-6">
                  <View className="mb-4 h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
                    <CategoryGlyph color={colors.ink} name="agents" size={28} />
                  </View>
                  <Text className="text-center text-[20px] font-bold" style={{ color: colors.ink }}>
                    No agents yet
                  </Text>
                  <Text className="mt-2 text-center text-[14px] leading-5" style={{ color: colors.muted }}>
                    Review an agent’s identity, data availability, authorization model,
                    and payment readiness before hiring or saving a setup preview.
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

function AgentListCard({
  agent,
  fallbackAgentId,
  badgeLabel,
  badgeTone,
  dateLabel,
  dateValue,
  onPress,
}: {
  agent: Agent | undefined;
  fallbackAgentId: string;
  badgeLabel: string;
  badgeTone: "live" | "preview";
  dateLabel: string;
  dateValue: string;
  onPress: () => void;
}) {
  const category = agent?.category ?? "monitoring";

  return (
    <PressableScale
      accessibilityLabel={`Manage ${agent?.name ?? fallbackAgentId}`}
      accessibilityRole="button"
      containerStyle={{
        borderRadius: radii.large,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.line,
        padding: 16,
        ...shadows.card,
      }}
      onPress={onPress}
    >
      <View className="flex-row items-start gap-3.5">
        <AgentIcon category={category} size={52} uri={agent?.iconUrl} />
        <View className="min-w-0 flex-1">
          <Text
            className="text-[17px] font-bold"
            numberOfLines={1}
            style={{ color: colors.ink }}
          >
            {agent?.name ?? `Agent #${fallbackAgentId}`}
          </Text>
          <Text className="mt-1 text-[12px] capitalize" style={{ color: colors.muted }}>
            {category.replace("-", " ")}
          </Text>
          <View className="mt-3">
            <StatusBadge label={badgeLabel} tone={badgeTone} />
          </View>
        </View>
      </View>

      <View
        className="mt-4 flex-row items-center justify-between border-t pt-4"
        style={{ borderColor: colors.line }}
      >
        <View>
          <Text className="text-[10px] font-bold uppercase tracking-[1px]" style={{ color: colors.faint }}>
            {dateLabel}
          </Text>
          <Text className="mt-1 text-[12px] font-bold" style={{ color: colors.ink }}>
            {new Date(dateValue).toLocaleDateString()}
          </Text>
        </View>
        <Text className="text-[12px] font-bold" style={{ color: colors.ink }}>
          Manage →
        </Text>
      </View>
    </PressableScale>
  );
}
