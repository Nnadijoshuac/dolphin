import {
  ScrollView,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";

import { AgentIcon } from "@/components/agent-icon";
import { Button } from "@/components/buttons";
import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { StatePanel } from "@/components/state-panel";
import { StatusBadge } from "@/components/status-badge";
import { Surface } from "@/components/surface";
import { colors, radii, shadows } from "@/constants/theme";
import { EDITORIAL_AGENTS } from "@/data/editorial-agents";
import { useAppStore, type HiredAgentSession } from "@/store/use-app-store";

function calculateTimeRemaining(expiresAt?: string) {
  if (!expiresAt) return "Permanent / Active";
  const diff = Date.parse(expiresAt) - Date.now();
  if (diff <= 0) return "Session Expired";
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  return `${days}d ${hours}h remaining`;
}

export default function MyAgentsScreen() {
  const router = useRouter();
  const hiredAgents = useAppStore((state) => state.hiredAgents);

  const handleManage = (session: HiredAgentSession) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: "/manage/[id]",
      params: { id: session.agentId },
    });
  };

  const handleExplore = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push("/(tabs)/categories");
  };

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
      >
        {/* Title */}
        <View className="px-6 pt-3 pb-4">
          <Text
            className="text-[34px] font-extrabold tracking-[-1px]"
            style={{ color: colors.ink }}
          >
            My Agents
          </Text>
          <Text
            className="mt-1 text-[15px]"
            style={{ color: colors.muted }}
          >
            Manage active sessions, spend caps, and monitoring
          </Text>
        </View>

        <View className="px-6">
          {hiredAgents.length > 0 ? (
            <View className="gap-4">
              {hiredAgents.map((session) => {
                const editorialAgent = EDITORIAL_AGENTS.find(
                  (a) => a.tokenId === session.agentId || a.id === session.agentId
                );
                const name = editorialAgent?.name ?? `Agent #${session.agentId}`;
                const iconUrl = editorialAgent?.iconUrl ?? null;
                const statusTone =
                  session.status === "active"
                    ? "live"
                    : session.status === "paused"
                    ? "syncing"
                    : "unavailable";

                return (
                  <PressableScale
                    key={session.agentId}
                    accessibilityLabel={`Manage ${name}`}
                    accessibilityRole="button"
                    onPress={() => handleManage(session)}
                    containerStyle={{
                      borderRadius: radii.large,
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.line,
                      padding: 16,
                      ...shadows.card,
                    }}
                  >
                    <View className="flex-row items-center justify-between">
                      <View className="flex-row items-center gap-3.5 flex-1 mr-2">
                        <AgentIcon
                          category={session.category}
                          size={48}
                          uri={iconUrl}
                        />
                        <View className="flex-1">
                          <Text
                            className="text-[17px] font-bold"
                            numberOfLines={1}
                            style={{ color: colors.ink }}
                          >
                            {name}
                          </Text>
                          <Text
                            className="text-[12px] font-medium capitalize"
                            style={{ color: colors.muted }}
                          >
                            {session.category.replace("-", " ")}
                          </Text>
                        </View>
                      </View>

                      <StatusBadge
                        label={session.status.toUpperCase()}
                        tone={statusTone}
                      />
                    </View>

                    {/* Session Metrics Bar */}
                    <View
                      className="mt-4 flex-row items-center justify-between border-t pt-3"
                      style={{ borderColor: colors.line }}
                    >
                      <View>
                        <Text className="text-[11px] font-medium text-slate-500">
                          {session.category === "monitoring" ? "Target" : "Spend Cap"}
                        </Text>
                        <Text
                          className="text-[13px] font-bold"
                          style={{ color: colors.ink }}
                        >
                          {session.category === "monitoring"
                            ? session.monitoredAddress
                              ? `${session.monitoredAddress.slice(0, 6)}…${session.monitoredAddress.slice(-4)}`
                              : "Connected Wallet"
                            : `$${session.spendCapUsd ?? 500} USD`}
                        </Text>
                      </View>

                      <View className="items-end">
                        <Text className="text-[11px] font-medium text-slate-500">
                          Session Status
                        </Text>
                        <Text
                          className="text-[13px] font-bold text-slate-700"
                        >
                          {calculateTimeRemaining(session.expiresAt)}
                        </Text>
                      </View>
                    </View>

                    {/* Manage Button */}
                    <View className="mt-3 flex-row justify-end">
                      <View className="rounded-full bg-slate-100 px-4 py-1.5">
                        <Text className="text-[12px] font-bold text-slate-900">
                          Manage Session →
                        </Text>
                      </View>
                    </View>
                  </PressableScale>
                );
              })}
            </View>
          ) : (
            /* Empty State */
            <View className="py-8 gap-6">
              <Surface>
                <View className="items-center py-6 px-4 text-center">
                  <View className="h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 mb-4">
                    <CategoryGlyph color={colors.ink} name="agents" size={28} />
                  </View>
                  <Text
                    className="text-[20px] font-bold text-center"
                    style={{ color: colors.ink }}
                  >
                    No Active Agent Sessions
                  </Text>
                  <Text
                    className="mt-2 text-[14px] text-center leading-5"
                    style={{ color: colors.muted }}
                  >
                    Explore verified BSC agents in Monitoring, Grid Trading, Health Factor, and Yield to hire your first autonomous agent.
                  </Text>

                  <View className="mt-6 w-full">
                    <Button
                      label="Browse Agent Catalog"
                      onPress={handleExplore}
                      tone="primary"
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
