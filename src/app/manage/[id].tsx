import { useState } from "react";
import {
  Alert,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";

import { AgentIcon } from "@/components/agent-icon";
import { Button } from "@/components/buttons";
import { PressableScale } from "@/components/pressable-scale";
import { SectionHeading } from "@/components/section-heading";
import { StatePanel } from "@/components/state-panel";
import { StatusBadge } from "@/components/status-badge";
import { Surface } from "@/components/surface";
import { colors, radii, shadows } from "@/constants/theme";
import { useAgentDetail } from "@/hooks/use-agents";
import { useAppStore } from "@/store/use-app-store";

export default function ManageAgentRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: agent } = useAgentDetail(id);

  const hiredAgents = useAppStore((state) => state.hiredAgents);
  const updateAgentStatus = useAppStore((state) => state.updateAgentStatus);
  const updateAgentSpendCap = useAppStore((state) => state.updateAgentSpendCap);
  const revokeAgent = useAppStore((state) => state.revokeAgent);

  const session = hiredAgents.find(
    (h) => h.agentId === id || (agent && h.agentId === agent.tokenId)
  );

  const [isEditingCap, setIsEditingCap] = useState(false);

  if (!session) {
    return (
      <SafeAreaView
        className="flex-1 px-6 justify-center"
        style={{ backgroundColor: colors.canvas }}
      >
        <StatePanel
          body="No active session found for this agent in local storage."
          state="unavailable"
          title="Session Not Found"
        />
        <View className="mt-6">
          <Button
            label="Go Back"
            onPress={() => router.back()}
            tone="primary"
          />
        </View>
      </SafeAreaView>
    );
  }

  const handleTogglePause = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const newStatus = session.status === "active" ? "paused" : "active";
    updateAgentStatus(session.agentId, newStatus);
  };

  const handleRevoke = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    Alert.alert(
      "Revoke Agent Session",
      "Are you sure you want to revoke this agent's permissions? This terminates its on-chain session key immediately.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Revoke On-Chain",
          style: "destructive",
          onPress: () => {
            revokeAgent(session.agentId);
            void Haptics.notificationAsync(
              Haptics.NotificationFeedbackType.Success
            );
          },
        },
      ]
    );
  };

  const handleAdjustCap = (newCap: number) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    updateAgentSpendCap(session.agentId, newCap);
    setIsEditingCap(false);
  };

  const isMonitoring = session.category === "monitoring";

  return (
    <SafeAreaView
      className="flex-1"
      edges={["top", "left", "right"]}
      style={{ backgroundColor: colors.canvas }}
    >
      {/* Navigation Header */}
      <View
        className="flex-row items-center justify-between px-6 pt-2 pb-3 border-b"
        style={{ borderColor: colors.line }}
      >
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
          style={{ color: colors.ink }}
        >
          Manage Session
        </Text>

        <View className="h-9 w-9" />
      </View>

      <ScrollView
        className="flex-1 px-6"
        contentContainerStyle={{ paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Agent Info Banner */}
        <View className="mt-5 flex-row items-center gap-4">
          <AgentIcon
            category={session.category}
            size={64}
            uri={agent?.iconUrl ?? null}
          />
          <View className="flex-1">
            <Text
              className="text-[20px] font-bold"
              style={{ color: colors.ink }}
            >
              {agent?.name ?? `Agent #${session.agentId}`}
            </Text>
            <Text className="text-[12px] text-slate-500 capitalize">
              {session.category.replace("-", " ")} · BSC Chain ID 56
            </Text>
            <View className="mt-2 flex-row items-center gap-2">
              <StatusBadge
                label={session.status.toUpperCase()}
                tone={
                  session.status === "active"
                    ? "live"
                    : session.status === "paused"
                    ? "syncing"
                    : "unavailable"
                }
              />
            </View>
          </View>
        </View>

        {/* Quick Action Controls */}
        <View className="mt-6 flex-row gap-3">
          {session.status !== "revoked" ? (
            <View className="flex-1">
              <Button
                label={session.status === "active" ? "Pause Agent" : "Resume Agent"}
                onPress={handleTogglePause}
                tone={session.status === "active" ? "secondary" : "primary"}
              />
            </View>
          ) : null}

          <View className="flex-1">
            <Button
              disabled={session.status === "revoked"}
              label="Revoke Key"
              onPress={handleRevoke}
              tone="destructive"
            />
          </View>
        </View>

        {/* Session Parameters */}
        <View className="mt-8">
          <SectionHeading title="Session Parameters" />
          <Surface>
            <View className="flex-row justify-between py-2 border-b" style={{ borderColor: colors.line }}>
              <Text className="text-[13px] text-slate-500">Authorization Model</Text>
              <Text className="text-[13px] font-semibold text-slate-900">
                {isMonitoring ? "Read-Only Telemetry" : "Scoped Spend Cap"}
              </Text>
            </View>

            {!isMonitoring ? (
              <View className="py-3 border-b" style={{ borderColor: colors.line }}>
                <View className="flex-row justify-between items-center">
                  <Text className="text-[13px] text-slate-500">Current Spend Cap</Text>
                  <View className="flex-row items-center gap-2">
                    <Text className="text-[14px] font-bold" style={{ color: colors.ink }}>
                      ${session.spendCapUsd ?? 500} USD
                    </Text>
                    {session.status === "active" ? (
                      <PressableScale
                        accessibilityLabel="Edit spend cap"
                        accessibilityRole="button"
                        onPress={() => setIsEditingCap(!isEditingCap)}
                      >
                        <Text className="text-[12px] font-bold text-blue-600">
                          {isEditingCap ? "Cancel" : "Adjust"}
                        </Text>
                      </PressableScale>
                    ) : null}
                  </View>
                </View>

                {isEditingCap ? (
                  <View className="mt-3 flex-row gap-2">
                    {[100, 250, 500, 1000].map((cap) => (
                      <PressableScale
                        key={cap}
                        accessibilityLabel={`Set $${cap}`}
                        accessibilityRole="button"
                        onPress={() => handleAdjustCap(cap)}
                        containerStyle={{
                          flex: 1,
                          paddingVertical: 6,
                          borderRadius: 10,
                          backgroundColor:
                            session.spendCapUsd === cap ? colors.ink : "#E9ECEF",
                          alignItems: "center",
                        }}
                      >
                        <Text
                          className="text-[11px] font-bold"
                          style={{
                            color:
                              session.spendCapUsd === cap ? "#FFF" : colors.ink,
                          }}
                        >
                          ${cap}
                        </Text>
                      </PressableScale>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : (
              <View className="flex-row justify-between py-2 border-b" style={{ borderColor: colors.line }}>
                <Text className="text-[13px] text-slate-500">Monitored Address</Text>
                <Text className="text-[12px] font-mono text-slate-900">
                  {session.monitoredAddress ?? "Self"}
                </Text>
              </View>
            )}

            <View className="flex-row justify-between py-2 border-b" style={{ borderColor: colors.line }}>
              <Text className="text-[13px] text-slate-500">Created At</Text>
              <Text className="text-[12px] text-slate-700">
                {session.hiredAt ? new Date(session.hiredAt).toLocaleDateString() : "Active"}
              </Text>
            </View>

            <View className="flex-row justify-between py-2">
              <Text className="text-[13px] text-slate-500">Auto Expiry</Text>
              <Text className="text-[12px] font-medium text-slate-700">
                {session.expiresAt ? new Date(session.expiresAt).toLocaleDateString() : "Permanent"}
              </Text>
            </View>
          </Surface>
        </View>

        {/* On-Chain Activity Log */}
        <View className="mt-8">
          <SectionHeading title="Session Activity Log" />
          <Surface>
            {session.recentActivity.map((act, index) => (
              <View
                key={`${act.timestamp}-${index}`}
                className={index === 0 ? "pb-3" : "py-3 border-t"}
                style={{ borderColor: colors.line }}
              >
                <Text className="text-[13px] font-bold" style={{ color: colors.ink }}>
                  {act.action}
                </Text>
                <Text className="mt-0.5 text-[11px] text-slate-500 font-mono">
                  {act.timestamp}
                </Text>
              </View>
            ))}
          </Surface>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
