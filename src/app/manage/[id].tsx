import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";

import { AgentIcon } from "@/components/agent-icon";
import { Button } from "@/components/buttons";
import { NavigationButton } from "@/components/navigation-button";
import { SectionHeading } from "@/components/section-heading";
import { StatePanel } from "@/components/state-panel";
import { StatusBadge } from "@/components/status-badge";
import { Surface } from "@/components/surface";
import { colors } from "@/constants/theme";
import { useAgentDetail } from "@/hooks/use-agents";
import {
  AUTHORIZATION_FACTS,
  assessAuthorizationCapability,
} from "@/services/authorization";
import { useAppStore } from "@/store/use-app-store";

export default function ManageAgentRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: agent, isLoading } = useAgentDetail(id);
  const previewHires = useAppStore((state) => state.previewHires);
  const removePreviewHire = useAppStore((state) => state.removePreviewHire);
  const preview = previewHires.find(
    (item) => item.agentId === id || item.agentId === agent?.tokenId,
  );

  const handleRemove = () => {
    if (!preview) return;
    removePreviewHire(preview.agentId);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.replace("/(tabs)/my-agents");
  };

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1" style={{ backgroundColor: colors.canvas }}>
        <View className="flex-1 justify-center px-5">
          <StatePanel
            body="Loading the saved preview and current capability evidence."
            state="syncing"
            title="Opening preview"
          />
        </View>
      </SafeAreaView>
    );
  }

  if (!preview) {
    return (
      <SafeAreaView className="flex-1" style={{ backgroundColor: colors.canvas }}>
        <View className="px-5 pt-3">
          <NavigationButton onPress={() => router.back()} />
        </View>
        <View className="flex-1 justify-center px-5">
          <StatePanel
            body="No device preview is saved for this agent. No onchain session was inferred."
            state="empty"
            title="Preview not found"
          />
          <Button
            label="Browse agents"
            onPress={() => router.replace("/(tabs)/search")}
            style={{ marginTop: 18 }}
          />
        </View>
      </SafeAreaView>
    );
  }

  const category = agent?.category ?? "monitoring";
  const access = assessAuthorizationCapability(
    category,
    category === "monitoring" ? "read_only_monitoring" : "altana_action_session",
  );

  return (
    <SafeAreaView
      className="flex-1"
      edges={["top", "left", "right"]}
      style={{ backgroundColor: colors.canvas }}
    >
      <View className="flex-row items-center justify-between px-5 pb-3 pt-2">
        <NavigationButton onPress={() => router.back()} />
        <Text className="text-[16px] font-bold" style={{ color: colors.ink }}>
          Manage preview
        </Text>
        <View className="h-[42px] w-[42px]" />
      </View>

      <ScrollView
        className="flex-1 px-5"
        contentContainerStyle={{ paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
      >
        <Surface gradient>
          <View className="flex-row items-center gap-4">
            <AgentIcon category={category} size={62} uri={agent?.iconUrl} />
            <View className="min-w-0 flex-1">
              <Text
                className="text-[20px] font-bold"
                numberOfLines={1}
                style={{ color: colors.ink }}
              >
                {agent?.name ?? `Agent #${preview.agentId}`}
              </Text>
              <Text className="mt-1 text-[12px]" style={{ color: colors.muted }}>
                Saved {new Date(preview.savedAt).toLocaleDateString()}
              </Text>
              <View className="mt-3">
                <StatusBadge label="Device preview · not onchain" tone="preview" />
              </View>
            </View>
          </View>
        </Surface>

        <View className="mt-8">
          <SectionHeading title="Current state" />
          <Surface>
            {[
              ["Monitoring or execution", "Not started"],
              ["Wallet authorization", "None"],
              ["Payment or escrow", "None"],
              ["Onchain activity log", "Unavailable"],
            ].map(([label, value], index) => (
              <View
                className={
                  index === 0
                    ? "flex-row justify-between pb-4"
                    : "flex-row justify-between border-t py-4"
                }
                key={label}
                style={{ borderColor: colors.line }}
              >
                <Text className="text-[12px]" style={{ color: colors.muted }}>
                  {label}
                </Text>
                <Text className="text-[12px] font-bold" style={{ color: colors.ink }}>
                  {value}
                </Text>
              </View>
            ))}
          </Surface>
        </View>

        <View className="mt-8">
          <SectionHeading title="Authorization readiness" />
          <Surface>
            <View className="flex-row items-center justify-between gap-3">
              <Text className="text-[14px] font-bold" style={{ color: colors.ink }}>
                {category === "monitoring" ? "Read-only observation" : "Action session"}
              </Text>
              <StatusBadge
                label={access.status}
                tone={access.available ? "live" : "unavailable"}
              />
            </View>
            <Text className="mt-3 text-[13px] leading-5" style={{ color: colors.muted }}>
              {access.reason}
            </Text>
            <Text className="mt-2 text-[12px] leading-5" style={{ color: colors.muted }}>
              {access.nextStep}
            </Text>
          </Surface>
        </View>

        <View className="mt-8">
          <SectionHeading title="Protocol boundaries" />
          <Surface>
            {Object.entries(AUTHORIZATION_FACTS.protocols).map(
              ([protocol, description], index) => (
                <View
                  className={index === 0 ? "pb-4" : "border-t py-4"}
                  key={protocol}
                  style={{ borderColor: colors.line }}
                >
                  <Text
                    className="text-[11px] font-bold uppercase tracking-[1px]"
                    style={{ color: colors.muted }}
                  >
                    {protocol}
                  </Text>
                  <Text className="mt-1 text-[12px] leading-5" style={{ color: colors.ink }}>
                    {description}
                  </Text>
                </View>
              ),
            )}
            <Text className="border-t pt-4 text-[11px] leading-4" style={{ borderColor: colors.line, color: colors.danger }}>
              Revoking an authorization would not cancel or refund a separate escrow.
            </Text>
          </Surface>
        </View>

        <Button
          label="Remove device preview"
          onPress={handleRemove}
          style={{ marginTop: 28 }}
          variant="destructive"
        />
      </ScrollView>
    </SafeAreaView>
  );
}
