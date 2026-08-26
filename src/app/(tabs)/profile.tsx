import {
  Alert,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";

import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { SectionHeading } from "@/components/section-heading";
import { StatusBadge } from "@/components/status-badge";
import { Surface } from "@/components/surface";
import { colors } from "@/constants/theme";
import { useAppStore } from "@/store/use-app-store";
import { useWallet, WalletConnectButton } from "@/wallet/wallet-provider";

export default function ProfileScreen() {
  const router = useRouter();
  const wallet = useWallet();
  const hiredAgents = useAppStore((state) => state.hiredAgents);
  const setHasCompletedOnboarding = useAppStore(
    (state) => state.setHasCompletedOnboarding
  );
  const clearPreviewHires = useAppStore((state) => state.clearPreviewHires);

  const activeSessionsCount = hiredAgents.filter(
    (a) => a.status === "active"
  ).length;

  const totalSpendCapUsd = hiredAgents
    .filter((a) => a.status === "active")
    .reduce((sum, a) => sum + (a.spendCapUsd ?? 0), 0);

  const handleReplayOnboarding = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setHasCompletedOnboarding(false);
    router.replace("/onboarding");
  };

  const handleClearCache = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      "Reset Local Session Cache",
      "This will clear local demo hires and search history. On-chain registry data will remain intact.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: () => {
            clearPreviewHires();
            void Haptics.notificationAsync(
              Haptics.NotificationFeedbackType.Success
            );
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView
      className="flex-1"
      edges={["top", "left", "right"]}
      style={{ backgroundColor: colors.canvas }}
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Title Header */}
        <View className="px-6 pt-3 pb-4">
          <Text
            className="text-[34px] font-extrabold tracking-[-1px]"
            style={{ color: colors.ink }}
          >
            Wallet & Security
          </Text>
          <Text
            className="mt-1 text-[15px]"
            style={{ color: colors.muted }}
          >
            BNB Smart Chain account and active authorization limits
          </Text>
        </View>

        <View className="px-6 gap-6">
          {/* Wallet Card */}
          <Surface>
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-3">
                <View className="h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 border border-amber-200">
                  <CategoryGlyph color="#D97706" name="wallet" size={24} />
                </View>
                <View>
                  <Text
                    className="text-[17px] font-bold"
                    style={{ color: colors.ink }}
                  >
                    {wallet.isConnected && wallet.address
                      ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`
                      : "Wallet Not Connected"}
                  </Text>
                  <Text className="text-[12px] text-slate-500 font-medium">
                    BNB Smart Chain (Chain ID: 56)
                  </Text>
                </View>
              </View>

              <StatusBadge
                label={wallet.isConnected ? "CONNECTED" : "DISCONNECTED"}
                tone={wallet.isConnected ? "live" : "neutral"}
              />
            </View>

            <View className="mt-5 pt-4 border-t" style={{ borderColor: colors.line }}>
              <WalletConnectButton
                connectLabel="Connect BNB Wallet"
                disconnectLabel="Disconnect Wallet"
              />
            </View>
          </Surface>

          {/* Active Session Authorizations */}
          <View>
            <SectionHeading title="Active Spend & Delegation Limits" />
            <Surface>
              <View className="flex-row justify-between py-2 border-b" style={{ borderColor: colors.line }}>
                <Text className="text-[13px] text-slate-500">Active Delegations</Text>
                <Text className="text-[14px] font-bold" style={{ color: colors.ink }}>
                  {activeSessionsCount} {activeSessionsCount === 1 ? "Agent" : "Agents"}
                </Text>
              </View>

              <View className="flex-row justify-between py-2.5 border-b" style={{ borderColor: colors.line }}>
                <Text className="text-[13px] text-slate-500">Total Bounded Cap</Text>
                <Text className="text-[14px] font-bold" style={{ color: colors.ink }}>
                  ${totalSpendCapUsd.toLocaleString()} USD
                </Text>
              </View>

              <View className="flex-row justify-between py-2.5">
                <Text className="text-[13px] text-slate-500">Custody Model</Text>
                <Text className="text-[13px] font-semibold text-emerald-700">
                  Non-Custodial (Zero Private Keys)
                </Text>
              </View>
            </Surface>
          </View>

          {/* Safety & Protocol Guarantees */}
          <View>
            <SectionHeading title="Safety Guarantees" />
            <Surface>
              {[
                {
                  title: "ERC-8004 Registry Verification",
                  desc: "All agents are checked against the BSC ERC-8004 identity contract.",
                },
                {
                  title: "Scoped Session Allowances",
                  desc: "Action agents can only execute approved contract calls up to your specified spend cap.",
                },
                {
                  title: "Instant Revocation",
                  desc: "You can revoke or pause any agent's authorization in a single on-chain transaction.",
                },
              ].map((item, idx) => (
                <View
                  key={item.title}
                  className={idx === 0 ? "pb-3" : "py-3 border-t"}
                  style={{ borderColor: colors.line }}
                >
                  <Text className="text-[14px] font-bold" style={{ color: colors.ink }}>
                    {item.title}
                  </Text>
                  <Text className="mt-0.5 text-[12px] leading-4" style={{ color: colors.muted }}>
                    {item.desc}
                  </Text>
                </View>
              ))}
            </Surface>
          </View>

          {/* App Preferences & Replay */}
          <View>
            <SectionHeading title="Application" />
            <Surface>
              <PressableScale
                accessibilityLabel="Replay onboarding tour"
                accessibilityRole="button"
                onPress={handleReplayOnboarding}
                containerStyle={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingVertical: 4,
                }}
              >
                <Text className="text-[14px] font-semibold" style={{ color: colors.ink }}>
                  Replay Onboarding Guide
                </Text>
                <Text className="text-[14px] text-blue-600 font-bold">→</Text>
              </PressableScale>

              <View className="my-3 border-t" style={{ borderColor: colors.line }} />

              <PressableScale
                accessibilityLabel="Reset local session state"
                accessibilityRole="button"
                onPress={handleClearCache}
                containerStyle={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingVertical: 4,
                }}
              >
                <Text className="text-[14px] font-semibold text-rose-600">
                  Reset Local Cache
                </Text>
                <Text className="text-[12px] font-bold text-rose-600">Clear</Text>
              </PressableScale>
            </Surface>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
