import { useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
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
import { useAgentDetail } from "@/hooks/use-agents";
import { useAppStore } from "@/store/use-app-store";
import { useWallet, WalletConnectButton } from "@/wallet/wallet-provider";

export default function HireModalRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const wallet = useWallet();
  const { data: agent, isLoading } = useAgentDetail(id);

  const hireAgent = useAppStore((state) => state.hireAgent);

  // Configuration state
  const [spendCap, setSpendCap] = useState<number>(500);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [targetAddress, setTargetAddress] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [success, setSuccess] = useState<boolean>(false);

  const isMonitoring = agent?.category === "monitoring";

  const handleConfirmHire = async () => {
    if (!agent) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsSubmitting(true);

    // Simulate safe on-chain session registration / Keystore setup
    setTimeout(() => {
      hireAgent({
        agentId: agent.tokenId,
        category: agent.category,
        spendCapUsd: isMonitoring ? undefined : spendCap,
        durationDays,
        monitoredAddress: isMonitoring
          ? (targetAddress.trim() || wallet.address || "0xSelf")
          : undefined,
      });

      setIsSubmitting(false);
      setSuccess(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }, 1200);
  };

  const handleFinish = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.replace("/(tabs)/my-agents");
  };

  return (
    <SafeAreaView
      className="flex-1"
      edges={["top", "left", "right"]}
      style={{ backgroundColor: colors.canvas }}
    >
      {/* Modal Header */}
      <View
        className="flex-row items-center justify-between px-6 pt-3 pb-3 border-b"
        style={{ borderColor: colors.line }}
      >
        <Text
          className="text-[17px] font-bold"
          style={{ color: colors.ink }}
        >
          {success ? "Session Activated" : "Authorize Agent"}
        </Text>
        <PressableScale
          accessibilityLabel="Close modal"
          accessibilityRole="button"
          onPress={() => router.back()}
          containerStyle={{
            padding: 6,
          }}
        >
          <Text className="text-[15px] font-semibold text-slate-500">
            {success ? "Done" : "Cancel"}
          </Text>
        </PressableScale>
      </View>

      <ScrollView
        className="flex-1 px-6"
        contentContainerStyle={{ paddingBottom: 60 }}
        showsVerticalScrollIndicator={false}
      >
        {isLoading || !agent ? (
          <View className="py-20">
            <StatePanel
              body="Loading agent parameters..."
              state="syncing"
              title="Preparing Authorization"
            />
          </View>
        ) : success ? (
          /* Success Screen */
          <View className="py-10 items-center text-center">
            <View className="h-20 w-20 items-center justify-center rounded-3xl bg-emerald-50 border border-emerald-200 mb-6">
              <Text className="text-[36px]">✓</Text>
            </View>

            <Text
              className="text-[26px] font-extrabold text-center tracking-tight"
              style={{ color: colors.ink }}
            >
              {agent.name} is Active
            </Text>
            <Text
              className="mt-2 text-[15px] text-center leading-6"
              style={{ color: colors.muted }}
            >
              {isMonitoring
                ? "Monitoring agent has begun telemetry inspection. Real-time alert notifications will appear in My Agents."
                : `Session authorization granted for up to $${spendCap} USD on BNB Smart Chain. You can pause or adjust limits anytime.`}
            </Text>

            <View className="mt-8 w-full">
              <Button
                label="Go to My Agents"
                onPress={handleFinish}
                tone="primary"
              />
            </View>
          </View>
        ) : (
          /* Step Flow */
          <View className="mt-5 gap-6">
            {/* Agent Header Summary */}
            <View
              className="flex-row items-center gap-3.5 p-4 rounded-2xl bg-slate-100"
            >
              <AgentIcon category={agent.category} size={48} uri={agent.iconUrl} />
              <View className="flex-1">
                <Text
                  className="text-[17px] font-bold"
                  numberOfLines={1}
                  style={{ color: colors.ink }}
                >
                  {agent.name}
                </Text>
                <Text className="text-[12px] text-slate-600 capitalize">
                  {agent.category.replace("-", " ")} · ERC-8004 #{agent.tokenId}
                </Text>
              </View>
            </View>

            {/* Wallet Requirement Check */}
            {!wallet.isConnected ? (
              <Surface>
                <View className="items-center py-3">
                  <CategoryGlyph color="#D97706" name="wallet" size={28} />
                  <Text
                    className="mt-2 text-[16px] font-bold"
                    style={{ color: colors.ink }}
                  >
                    Connect Wallet to Continue
                  </Text>
                  <Text
                    className="mt-1 text-[13px] text-center text-slate-500"
                  >
                    Connect your Web3 wallet via Reown AppKit to grant session permissions.
                  </Text>
                  <View className="mt-4 w-full">
                    <WalletConnectButton connectLabel="Connect Wallet" />
                  </View>
                </View>
              </Surface>
            ) : null}

            {/* Parameterization */}
            {isMonitoring ? (
              /* Read-only monitoring config */
              <Surface>
                <Text className="text-[15px] font-bold" style={{ color: colors.ink }}>
                  Target Wallet Address to Watch
                </Text>
                <Text className="mt-1 text-[12px] text-slate-500">
                  Enter a custom BSC address or default to your connected wallet.
                </Text>

                <TextInput
                  value={targetAddress}
                  onChangeText={setTargetAddress}
                  placeholder={wallet.address ?? "0x... (Public BSC Address)"}
                  placeholderTextColor={colors.muted}
                  className="mt-3 p-3.5 rounded-xl bg-slate-100 text-[14px] font-medium"
                  style={{ color: colors.ink }}
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                <View className="mt-4 pt-3 border-t flex-row items-center justify-between" style={{ borderColor: colors.line }}>
                  <Text className="text-[12px] text-slate-500">Required Gas / Txs</Text>
                  <Text className="text-[12px] font-bold text-emerald-700">0 Txs (Read-Only)</Text>
                </View>
              </Surface>
            ) : (
              /* Action Agent Session Config */
              <View className="gap-5">
                {/* Spend Cap Selector */}
                <Surface>
                  <Text className="text-[15px] font-bold" style={{ color: colors.ink }}>
                    Max Spend Cap (USD)
                  </Text>
                  <Text className="mt-1 text-[12px] text-slate-500">
                    The agent can never execute transactions exceeding this cumulative limit.
                  </Text>

                  <View className="mt-3 flex-row gap-2">
                    {[100, 250, 500, 1000].map((amount) => (
                      <PressableScale
                        key={amount}
                        accessibilityLabel={`Select $${amount} spend cap`}
                        accessibilityRole="button"
                        onPress={() => {
                          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setSpendCap(amount);
                        }}
                        containerStyle={{
                          flex: 1,
                          paddingVertical: 10,
                          borderRadius: 14,
                          alignItems: "center",
                          backgroundColor:
                            spendCap === amount ? colors.ink : "#F1F3F5",
                        }}
                      >
                        <Text
                          className="text-[13px] font-bold"
                          style={{
                            color: spendCap === amount ? "#FFFFFF" : colors.ink,
                          }}
                        >
                          ${amount}
                        </Text>
                      </PressableScale>
                    ))}
                  </View>
                </Surface>

                {/* Duration Selector */}
                <Surface>
                  <Text className="text-[15px] font-bold" style={{ color: colors.ink }}>
                    Session Duration
                  </Text>
                  <Text className="mt-1 text-[12px] text-slate-500">
                    The delegation key automatically expires and becomes void after this time.
                  </Text>

                  <View className="mt-3 flex-row gap-2">
                    {[7, 14, 30].map((days) => (
                      <PressableScale
                        key={days}
                        accessibilityLabel={`Select ${days} days`}
                        accessibilityRole="button"
                        onPress={() => {
                          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setDurationDays(days);
                        }}
                        containerStyle={{
                          flex: 1,
                          paddingVertical: 10,
                          borderRadius: 14,
                          alignItems: "center",
                          backgroundColor:
                            durationDays === days ? colors.ink : "#F1F3F5",
                        }}
                      >
                        <Text
                          className="text-[13px] font-bold"
                          style={{
                            color: durationDays === days ? "#FFFFFF" : colors.ink,
                          }}
                        >
                          {days} Days
                        </Text>
                      </PressableScale>
                    ))}
                  </View>
                </Surface>
              </View>
            )}

            {/* Safety Guarantee Callout */}
            <View className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200">
              <Text className="text-[13px] font-bold text-amber-900">
                Non-Custodial Keystore Guarantee
              </Text>
              <Text className="mt-1 text-[12px] text-amber-800 leading-4">
                You never transfer private keys. Authorization is registered on BSC with strictly scoped permissions and can be revoked at any time.
              </Text>
            </View>

            {/* Action CTA */}
            <View className="mt-2">
              <Button
                disabled={isSubmitting}
                label={
                  isSubmitting
                    ? "Confirming On-Chain..."
                    : isMonitoring
                    ? "Activate Monitoring"
                    : `Confirm & Grant Session ($${spendCap})`
                }
                onPress={handleConfirmHire}
                tone="primary"
              />
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
