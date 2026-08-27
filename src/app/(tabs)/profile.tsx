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
  const previewHires = useAppStore((state) => state.previewHires);
  const setHasCompletedOnboarding = useAppStore(
    (state) => state.setHasCompletedOnboarding
  );
  const clearPreviewHires = useAppStore((state) => state.clearPreviewHires);
  const clearRecentSearches = useAppStore((state) => state.clearRecentSearches);

  const handleReplayOnboarding = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setHasCompletedOnboarding(false);
    router.replace("/onboarding");
  };

  const handleClearCache = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      "Reset local app data",
      "This clears device previews and search history. It does not send a transaction or change registry data.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: () => {
            clearPreviewHires();
            clearRecentSearches();
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
            BNB Smart Chain account and authorization readiness
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

          {/* Truthful local and authorization state */}
          <View>
            <SectionHeading title="Authorization state" />
            <Surface>
              <View className="flex-row justify-between py-2 border-b" style={{ borderColor: colors.line }}>
                <Text className="text-[13px] text-slate-500">Saved Device Previews</Text>
                <Text className="text-[14px] font-bold" style={{ color: colors.ink }}>
                  {previewHires.length}
                </Text>
              </View>

              <View className="flex-row justify-between py-2.5 border-b" style={{ borderColor: colors.line }}>
                <Text className="text-[13px] text-slate-500">Verified Active Delegations</Text>
                <Text className="text-[14px] font-bold" style={{ color: colors.ink }}>
                  Unavailable
                </Text>
              </View>

              <View className="flex-row justify-between py-2.5">
                <Text className="text-[13px] text-slate-500">Private Key Handling</Text>
                <Text className="text-[13px] font-semibold text-emerald-700">
                  Never requested
                </Text>
              </View>
            </Surface>
          </View>

          {/* Safety boundaries verified during Spike B */}
          <View>
            <SectionHeading title="Current boundaries" />
            <Surface>
              {[
                {
                  title: "ERC-8004 is identity, not permission",
                  desc: "Each agent page reports the result of its own registry read; identity does not prove a capability works.",
                },
                {
                  title: "Action sessions are unavailable",
                  desc: "Altana SDK 0.8 does not accept the WalletConnect signer used by this mobile build. Dolphin never falls back to private-key import.",
                },
                {
                  title: "Authorization and escrow are separate",
                  desc: "Revoking future authority would not cancel or refund a separate ERC-8183 payment escrow.",
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
                accessibilityLabel="Reset local previews and search history"
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
                  Reset Local App Data
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
