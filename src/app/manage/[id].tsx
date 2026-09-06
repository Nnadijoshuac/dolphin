import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";

import { AgentIcon } from "@/components/agent-icon";
import { Button } from "@/components/buttons";
import { NavigationButton } from "@/components/navigation-button";
import { StatePanel } from "@/components/state-panel";
import { StatusBadge } from "@/components/status-badge";
import { AGENT_CATEGORIES } from "@/constants/agents";
import { colors } from "@/constants/theme";
import { useAgentDetail } from "@/hooks/use-agents";
import { useHiredAgents } from "@/hooks/use-hire-read-only-agent";
import { useAppStore } from "@/store/use-app-store";
import { useWallet } from "@/wallet/wallet-provider";

function shortAddress(value: string) {
  return `${value.slice(0, 7)}…${value.slice(-5)}`;
}

export default function ManageAgentRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const wallet = useWallet();
  const { data: agent, isLoading } = useAgentDetail(id);
  const previewHires = useAppStore((state) => state.previewHires);
  const removePreviewHire = useAppStore((state) => state.removePreviewHire);
  const preview = previewHires.find(
    (item) => item.agentId === id || item.agentId === agent?.tokenId,
  );
  const hiredAgents = useHiredAgents(wallet.address);
  const realHire = hiredAgents?.find(
    (hire) => hire.tokenId === id || hire.tokenId === agent?.tokenId,
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
            body="Loading agent details..."
            state="syncing"
            title="Loading"
          />
        </View>
      </SafeAreaView>
    );
  }

  if (!preview && !realHire) {
    return (
      <SafeAreaView className="flex-1" style={{ backgroundColor: colors.canvas }}>
        <View className="px-5 pt-3">
          <NavigationButton onPress={() => router.back()} />
        </View>
        <View className="flex-1 justify-center px-5">
          <StatePanel
            body="No hire or preview is on record for this agent."
            state="empty"
            title="Nothing to manage"
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
  const categoryLabel =
    AGENT_CATEGORIES.find((c) => c.slug === category)?.label ?? category;

  if (realHire) {
    return (
      <SafeAreaView
        className="flex-1"
        edges={["top", "left", "right"]}
        style={{ backgroundColor: colors.canvas }}
      >
        <View className="flex-row items-center justify-between px-5 pb-3 pt-2">
          <NavigationButton onPress={() => router.back()} />
          <Text className="text-[16px] font-bold" style={{ color: colors.ink }}>
            Manage hire
          </Text>
          <View className="h-[42px] w-[42px]" />
        </View>

        <ScrollView
          className="flex-1 px-5"
          contentContainerStyle={{ paddingBottom: 48 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Agent Banner */}
          <View className="flex-row items-center gap-4 pt-2 pb-6">
            <AgentIcon category={category} size={60} uri={agent?.iconUrl} />
            <View className="min-w-0 flex-1">
              <Text
                className="text-[20px] font-bold tracking-tight"
                numberOfLines={1}
                style={{ color: colors.ink }}
              >
                {agent?.name ?? `Agent #${realHire.tokenId}`}
              </Text>
              <Text className="mt-1 text-[12.5px]" style={{ color: colors.muted }}>
                Hired {new Date(realHire.hiredAt).toLocaleDateString()}
              </Text>
              <View className="mt-2.5 flex-row items-center">
                <StatusBadge label="Hired" tone="live" />
              </View>
            </View>
          </View>

          {/* Details */}
          <View className="pt-2">
            <Text
              className="text-[14px] font-bold pb-2"
              style={{ color: colors.ink }}
            >
              Details
            </Text>
            <View className="border-t" style={{ borderColor: colors.line }}>
              {[
                ["Status", "Active"],
                ["Category", categoryLabel],
                ["Wallet", shortAddress(realHire.walletAddress)],
                ["Authorization", "Read-only"],
                ["Price", "Free"],
              ].map(([label, value]) => (
                <View
                  className="flex-row items-center justify-between py-3.5 border-b"
                  key={label}
                  style={{ borderColor: colors.line }}
                >
                  <Text
                    className="text-[13.5px] font-medium"
                    style={{ color: colors.muted }}
                  >
                    {label}
                  </Text>
                  <Text
                    className="text-[13.5px] font-semibold"
                    style={{ color: colors.ink }}
                  >
                    {value}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          <View className="mt-8">
            <Button
              label="View agent profile"
              onPress={() =>
                router.push({
                  pathname: "/agent/[id]",
                  params: { id: agent?.tokenId ?? realHire.tokenId },
                })
              }
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (!preview) {
    return null;
  }

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
        {/* Agent Banner */}
        <View className="flex-row items-center gap-4 pt-2 pb-6">
          <AgentIcon category={category} size={60} uri={agent?.iconUrl} />
          <View className="min-w-0 flex-1">
            <Text
              className="text-[20px] font-bold tracking-tight"
              numberOfLines={1}
              style={{ color: colors.ink }}
            >
              {agent?.name ?? `Agent #${preview.agentId}`}
            </Text>
            <Text className="mt-1 text-[12.5px]" style={{ color: colors.muted }}>
              Saved {new Date(preview.savedAt).toLocaleDateString()}
            </Text>
            <View className="mt-2.5 flex-row items-center">
              <StatusBadge label="Device preview" tone="preview" />
            </View>
          </View>
        </View>

        {/* Details */}
        <View className="pt-2">
          <Text
            className="text-[14px] font-bold pb-2"
            style={{ color: colors.ink }}
          >
            Details
          </Text>
          <View className="border-t" style={{ borderColor: colors.line }}>
            {[
              ["Status", "Saved preview"],
              ["Category", categoryLabel],
              ["Authorization", "Read-only"],
            ].map(([label, value]) => (
              <View
                className="flex-row items-center justify-between py-3.5 border-b"
                key={label}
                style={{ borderColor: colors.line }}
              >
                <Text
                  className="text-[13.5px] font-medium"
                  style={{ color: colors.muted }}
                >
                  {label}
                </Text>
                <Text
                  className="text-[13.5px] font-semibold"
                  style={{ color: colors.ink }}
                >
                  {value}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View className="mt-8 gap-3">
          <Button
            label="View agent profile"
            onPress={() =>
              router.push({
                pathname: "/agent/[id]",
                params: { id: agent?.tokenId ?? preview.agentId },
              })
            }
          />
          <Button
            label="Remove preview"
            onPress={handleRemove}
            variant="destructive"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
