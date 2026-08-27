import { useState } from "react";
import {
  Alert,
  Modal,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";

import { BrandMark, BnbBadge } from "@/components/brand-mark";
import { CategoryGlyph } from "@/components/category-glyph";
import { ConstellationBg } from "@/components/constellation-bg";
import { PressableScale } from "@/components/pressable-scale";
import { colors, shadows } from "@/constants/theme";
import { useAppStore } from "@/store/use-app-store";
import { useWallet } from "@/wallet/wallet-provider";

const walletHeroImage = require("../../../assets/images/wallet.png");

export default function WalletScreen() {
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

  const handleConnectToggle = async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (wallet.isConnected) {
      Alert.alert(
        "Disconnect Wallet",
        `Disconnect ${wallet.address?.slice(0, 6)}…${wallet.address?.slice(-4)}?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Disconnect",
            style: "destructive",
            onPress: () => {
              void wallet.disconnect();
              void Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success,
              );
            },
          },
        ],
      );
    } else {
      try {
        await wallet.connect();
      } catch (err) {
        console.warn("Wallet connect error", err);
      }
    }
  };

  const handleFeaturePress = (title: string, desc: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(title, desc);
  };

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
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          alignItems: "center",
          paddingBottom: 110,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View
          className="w-full px-6 pt-2"
          style={{ maxWidth: contentWidth }}
        >
          {/* Top Bar */}
          <View className="flex-row items-center justify-between pb-4">
            <View className="flex-row items-center gap-2.5">
              <BrandMark size={28} />
              <View>
                <Text
                  className="text-[14px] font-black uppercase tracking-[1.5px]"
                  style={{ color: colors.ink }}
                >
                  DOLPHIN
                </Text>
                <Text
                  className="text-[8px] font-bold uppercase tracking-[1px]"
                  style={{ color: colors.muted }}
                >
                  ERC-8004 AI AGENTS
                </Text>
                <View className="mt-0.5">
                  <BnbBadge label="ON BNB SMART CHAIN" />
                </View>
              </View>
            </View>

            {/* Info button */}
            <PressableScale
              accessibilityLabel="About Dolphin & security"
              accessibilityRole="button"
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowInfoModal(true);
              }}
              containerStyle={{
                alignItems: "center",
                backgroundColor: "#FFFFFF",
                borderColor: colors.line,
                borderRadius: 9999,
                borderWidth: 1,
                height: 36,
                justifyContent: "center",
                width: 36,
                ...shadows.subtle,
              }}
            >
              <CategoryGlyph color={colors.ink} name="info" size={18} />
            </PressableScale>
          </View>

          {/* Screen Title */}
          <Text
            className="text-[34px] font-black tracking-[-1px] mb-2"
            style={{ color: colors.ink }}
          >
            Wallet
          </Text>

          {/* Hero 3D Wallet graphic */}
          <View
            className="items-center justify-center py-4 my-2"
            style={{
              height: 190,
              width: "100%",
            }}
          >
            <ConstellationBg opacity={0.35} />
            <Image
              contentFit="contain"
              priority="high"
              source={walletHeroImage}
              style={{
                height: 170,
                width: 240,
              }}
            />
          </View>

          {/* Heading & Subtitle */}
          <View className="items-center px-4 mb-6">
            <Text
              className="text-center text-[22px] font-bold tracking-[-0.5px]"
              style={{ color: colors.ink }}
            >
              Connect to hire and manage
            </Text>
            <Text
              className="mt-2 text-center text-[14px] leading-5"
              style={{ color: colors.muted }}
            >
              Your address unlocks registry search,{"\n"}hiring, and session
              controls.
            </Text>
          </View>

          {/* Primary CTA Button */}
          <PressableScale
            accessibilityLabel={
              wallet.isConnected ? "Disconnect wallet" : "Connect wallet"
            }
            accessibilityRole="button"
            onPress={handleConnectToggle}
            containerStyle={{
              alignItems: "center",
              backgroundColor: "#F5B300",
              borderRadius: 16,
              flexDirection: "row",
              justifyContent: "center",
              gap: 8,
              height: 52,
              marginBottom: 24,
              paddingHorizontal: 20,
              width: "100%",
              ...shadows.goldGlow,
            }}
          >
            <CategoryGlyph color={colors.ink} name="wallet" size={20} />
            <Text
              className="text-[16px] font-bold"
              style={{ color: colors.ink }}
            >
              {wallet.isConnected && wallet.address
                ? `Connected: ${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`
                : "Connect wallet"}
            </Text>
          </PressableScale>

          {/* "You stay in control" Section */}
          <View className="mb-6">
            <Text
              className="mb-2.5 text-[14px] font-bold"
              style={{ color: colors.ink }}
            >
              You stay in control
            </Text>

            <View
              className="overflow-hidden rounded-2xl border bg-white"
              style={{ borderColor: colors.line, ...shadows.subtle }}
            >
              {/* Row 1: Review every permission */}
              <PressableScale
                accessibilityRole="button"
                onPress={() =>
                  handleFeaturePress(
                    "Review every permission",
                    "Granular authorizations ensure agents only execute what you explicitly approve onchain.",
                  )
                }
                containerStyle={{
                  alignItems: "center",
                  flexDirection: "row",
                  justifyContent: "space-between",
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                }}
              >
                <View className="flex-row items-center gap-3.5">
                  <View
                    className="h-9 w-9 items-center justify-center rounded-full border"
                    style={{
                      backgroundColor: "#FFFBEB",
                      borderColor: "#FDE68A",
                    }}
                  >
                    <CategoryGlyph color="#D97706" name="shield" size={18} />
                  </View>
                  <Text
                    className="text-[14px] font-semibold"
                    style={{ color: colors.ink }}
                  >
                    Review every permission
                  </Text>
                </View>
                <CategoryGlyph
                  color={colors.muted}
                  name="chevron-right"
                  size={16}
                />
              </PressableScale>

              <View
                className="mx-4 border-t"
                style={{ borderColor: colors.line }}
              />

              {/* Row 2: Set caps and expiry */}
              <PressableScale
                accessibilityRole="button"
                onPress={() =>
                  handleFeaturePress(
                    "Set caps and expiry",
                    "Set hard budget ceilings and automatic expiration windows for all active agent delegations.",
                  )
                }
                containerStyle={{
                  alignItems: "center",
                  flexDirection: "row",
                  justifyContent: "space-between",
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                }}
              >
                <View className="flex-row items-center gap-3.5">
                  <View
                    className="h-9 w-9 items-center justify-center rounded-full border"
                    style={{
                      backgroundColor: "#FFFBEB",
                      borderColor: "#FDE68A",
                    }}
                  >
                    <CategoryGlyph color="#D97706" name="clock" size={18} />
                  </View>
                  <Text
                    className="text-[14px] font-semibold"
                    style={{ color: colors.ink }}
                  >
                    Set caps and expiry
                  </Text>
                </View>
                <CategoryGlyph
                  color={colors.muted}
                  name="chevron-right"
                  size={16}
                />
              </PressableScale>

              <View
                className="mx-4 border-t"
                style={{ borderColor: colors.line }}
              />

              {/* Row 3: Revoke from one place */}
              <PressableScale
                accessibilityRole="button"
                onPress={() =>
                  handleFeaturePress(
                    "Revoke from one place",
                    "Instantly terminate any agent session or smart account authority with one tap.",
                  )
                }
                containerStyle={{
                  alignItems: "center",
                  flexDirection: "row",
                  justifyContent: "space-between",
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                }}
              >
                <View className="flex-row items-center gap-3.5">
                  <View
                    className="h-9 w-9 items-center justify-center rounded-full border"
                    style={{
                      backgroundColor: "#FFFBEB",
                      borderColor: "#FDE68A",
                    }}
                  >
                    <CategoryGlyph color="#D97706" name="revoke" size={18} />
                  </View>
                  <Text
                    className="text-[14px] font-semibold"
                    style={{ color: colors.ink }}
                  >
                    Revoke from one place
                  </Text>
                </View>
                <CategoryGlyph
                  color={colors.muted}
                  name="chevron-right"
                  size={16}
                />
              </PressableScale>
            </View>
          </View>

          {/* Bottom Security / Status Indicator */}
          <View className="flex-row items-center justify-center gap-2 pt-2">
            <CategoryGlyph
              color={wallet.isConnected ? "#10B981" : colors.muted}
              name="shield"
              size={14}
            />
            <Text
              className="text-[12px] font-medium"
              style={{
                color: wallet.isConnected ? "#059669" : colors.muted,
              }}
            >
              {wallet.isConnected && wallet.address
                ? `Connected to BNB Chain (${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)})`
                : "No wallet connected"}
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Info / Settings Modal */}
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
              <Text
                className="text-[18px] font-bold"
                style={{ color: colors.ink }}
              >
                Wallet & Security Details
              </Text>
              <PressableScale
                accessibilityRole="button"
                onPress={() => setShowInfoModal(false)}
                containerStyle={{ padding: 4 }}
              >
                <Text className="text-[14px] font-bold text-slate-500">
                  Done
                </Text>
              </PressableScale>
            </View>

            {/* Protocol details */}
            <View
              className="my-3 rounded-2xl border bg-white p-4"
              style={{ borderColor: colors.line }}
            >
              <View className="flex-row justify-between py-1 border-b border-slate-100">
                <Text className="text-[13px] text-slate-500">
                  Network
                </Text>
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

            {/* Actions */}
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
                <Text
                  className="text-[14px] font-bold"
                  style={{ color: colors.ink }}
                >
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
