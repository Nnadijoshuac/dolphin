import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
    Alert,
    Modal,
    ScrollView,
    Text,
    View,
    useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AltanaWalletCard } from "@/components/altana-wallet-card";
import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { WalletAvatar } from "@/components/wallet-avatar";
import { colors, shadows } from "@/constants/theme";
import { useAppStore } from "@/store/use-app-store";
import { WalletConnectButton, useWallet } from "@/wallet/wallet-provider";

/**
 * Account Details Page
 *
 * Contains wallet management, recovery, and security details.
 * Accessible from the wallet screen's profile picture button.
 */
export default function AccountScreen() {
  const router = useRouter();
  const wallet = useWallet();
  const { width: windowWidth } = useWindowDimensions();
  const contentWidth = Math.min(windowWidth || 390, 480);
  const [showInfoModal, setShowInfoModal] = useState(false);

  const previewHires = useAppStore((state) => state.previewHires);
  const setHasCompletedOnboarding = useAppStore(
    (state) => state.setHasCompletedOnboarding,
  );
  const clearPreviewHires = useAppStore((state) => state.clearPreviewHires);
  const clearRecentSearches = useAppStore((state) => state.clearRecentSearches);

  const handleReplayOnboarding = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowInfoModal(false);
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
            setShowInfoModal(false);
            void Haptics.notificationAsync(
              Haptics.NotificationFeedbackType.Success,
            );
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView
      className="flex-1"
      edges={["top", "left", "right"]}
      style={{ backgroundColor: colors.canvas }}
    >
      {/* Top bar with back button */}
      <View
        className="w-full self-center flex-row items-center justify-between px-6 pb-2 pt-1"
        style={{ backgroundColor: colors.canvas, maxWidth: contentWidth, zIndex: 10 }}
      >
        <PressableScale
          accessibilityLabel="Back"
          accessibilityRole="button"
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.back();
          }}
          containerStyle={{
            alignItems: "center",
            backgroundColor: colors.surface,
            borderColor: colors.line,
            borderRadius: 9999,
            borderWidth: 1,
            height: 40,
            justifyContent: "center",
            width: 40,
            ...shadows.subtle,
          }}
        >
          <CategoryGlyph color={colors.ink} name="chevron-left" size={18} />
        </PressableScale>

        <Text
          className="text-[18px] font-bold"
          style={{ color: colors.ink }}
        >
          Account
        </Text>

        <PressableScale
          accessibilityLabel="About Dolphin & security"
          accessibilityRole="button"
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setShowInfoModal(true);
          }}
          containerStyle={{
            alignItems: "center",
            backgroundColor: colors.surface,
            borderColor: colors.line,
            borderRadius: 9999,
            borderWidth: 1,
            height: 40,
            justifyContent: "center",
            width: 40,
            ...shadows.subtle,
          }}
        >
          <CategoryGlyph color={colors.ink} name="info" size={18} />
        </PressableScale>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          alignItems: "center",
          paddingBottom: 120,
          paddingTop: 12,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View className="w-full px-6" style={{ maxWidth: contentWidth }}>
          {/* Identity Wallet Card */}
          {wallet.isConnected && wallet.address ? (
            <View
              className="mb-6 flex-row items-center gap-3 rounded-2xl border p-4"
              style={{
                backgroundColor: colors.surface,
                borderColor: colors.line,
              }}
            >
              <WalletAvatar
                address={wallet.address}
                kind="human"
                size={48}
              />
              <View className="flex-1">
                <Text
                  className="text-[13px] font-bold"
                  style={{ color: colors.muted }}
                >
                  IDENTITY WALLET
                </Text>
                <Text
                  className="text-[15px] font-bold"
                  numberOfLines={1}
                  style={{ color: colors.ink }}
                >
                  MetaMask
                </Text>
              </View>
            </View>
          ) : null}

          {/* Dolphin Agent Wallet Section */}
          <Text
            className="mb-3 text-[12px] font-bold uppercase tracking-[1.2px]"
            style={{ color: colors.muted }}
          >
            Agent Wallet
          </Text>

          <AltanaWalletCard />

          {/* Identity Wallet Management */}
          <Text
            className="mb-3 mt-8 text-[12px] font-bold uppercase tracking-[1.2px]"
            style={{ color: colors.muted }}
          >
            Wallet Management
          </Text>

          {wallet.isConnected ? (
            <View
              className="rounded-2xl border p-4"
              style={{
                backgroundColor: colors.surfaceSubtle,
                borderColor: colors.line,
              }}
            >
              <Text className="text-[13px] font-bold" style={{ color: colors.ink }}>
                Identity wallet
              </Text>
              <Text
                className="mt-1 text-[11px] leading-4"
                style={{ color: colors.muted }}
              >
                Used to identify you for hire records. Separate from the Dolphin
                Wallet above, which holds its own balance.
              </Text>
              <View className="mt-3">
                <WalletConnectButton />
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* Info / settings modal */}
      <Modal
        animationType="slide"
        onRequestClose={() => setShowInfoModal(false)}
        transparent
        visible={showInfoModal}
      >
        <View className="flex-1 justify-end bg-black/40">
          <View
            className="rounded-t-3xl border-t bg-[#F6F4EE] px-6 pt-5 pb-9"
            style={{ borderColor: colors.line, ...shadows.card }}
          >
            <View className="flex-row items-center justify-between pb-3">
              <Text className="text-[18px] font-bold" style={{ color: colors.ink }}>
                Wallet & Security Details
              </Text>
              <PressableScale
                accessibilityRole="button"
                onPress={() => setShowInfoModal(false)}
                containerStyle={{ padding: 4 }}
              >
                <Text className="text-[14px] font-bold text-slate-500">Done</Text>
              </PressableScale>
            </View>

            <View
              className="my-3 rounded-2xl border bg-white p-4"
              style={{ borderColor: colors.line }}
            >
              <View className="flex-row justify-between py-1 border-b border-slate-100">
                <Text className="text-[13px] text-slate-500">Network</Text>
                <Text className="text-[13px] font-bold" style={{ color: colors.ink }}>
                  BNB Smart Chain (ID: 56)
                </Text>
              </View>
              <View className="flex-row justify-between py-2 border-b border-slate-100">
                <Text className="text-[13px] text-slate-500">
                  Saved Local Previews
                </Text>
                <Text className="text-[13px] font-bold" style={{ color: colors.ink }}>
                  {previewHires.length}
                </Text>
              </View>
              <View className="flex-row justify-between py-1">
                <Text className="text-[13px] text-slate-500">
                  Private Key Handling
                </Text>
                <Text className="text-[13px] font-semibold text-emerald-700">
                  Never requested
                </Text>
              </View>
            </View>

            <View className="gap-2.5 pt-2">
              <PressableScale
                accessibilityRole="button"
                onPress={handleReplayOnboarding}
                containerStyle={{
                  alignItems: "center",
                  backgroundColor: "#FFFFFF",
                  borderColor: colors.line,
                  borderRadius: 14,
                  borderWidth: 1,
                  paddingVertical: 12,
                }}
              >
                <Text className="text-[14px] font-bold" style={{ color: colors.ink }}>
                  Replay Onboarding Tour
                </Text>
              </PressableScale>

              <PressableScale
                accessibilityRole="button"
                onPress={handleClearCache}
                containerStyle={{
                  alignItems: "center",
                  backgroundColor: "#FEE2E2",
                  borderRadius: 14,
                  paddingVertical: 12,
                }}
              >
                <Text className="text-[14px] font-bold text-red-600">
                  Reset Local App Data
                </Text>
              </PressableScale>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
