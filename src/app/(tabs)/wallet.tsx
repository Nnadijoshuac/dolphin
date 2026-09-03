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


import { CategoryGlyph } from "@/components/category-glyph";
import { ConstellationBg } from "@/components/constellation-bg";
import { PressableScale } from "@/components/pressable-scale";
import { WalletAvatar } from "@/components/wallet-avatar";
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
      {/* Sticky Pinned Top Header */}
      <View
        className="w-full self-center px-6 pb-3 pt-2"
        style={{
          backgroundColor: colors.canvas,
          maxWidth: contentWidth,
          zIndex: 10,
        }}
      >
        <View className="flex-row items-start justify-between">
          <View>
            {/* No subtitle here on purpose. It used to read "Two accounts: one
                identifies you, one can be given bounded spending permission.",
                which described the Dolphin Wallet card that used to sit below.
                With that card gone this screen shows exactly one account, so
                the line was both wrong and a third layer of explanation above
                a section that already explains itself. */}
            <Text
              className="text-[32px] font-bold tracking-[-0.6px]"
              style={{ color: colors.ink }}
            >
              Wallet
            </Text>
          </View>

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
              marginTop: 4,
              width: 36,
              ...shadows.subtle,
            }}
          >
            <CategoryGlyph color={colors.ink} name="info" size={18} />
          </PressableScale>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          alignItems: "center",
          paddingBottom: 110,
          paddingTop: 4,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View
          className="w-full px-6"
          style={{ maxWidth: contentWidth }}
        >
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
              cachePolicy="memory-disk"
              contentFit="contain"
              priority="high"
              source={walletHeroImage}
              style={{
                height: 170,
                width: 240,
              }}
            />
          </View>

          {/*
           * <AltanaWalletCard /> was removed from this screen.
           *
           * ONLY THE UI IS GONE. The Dolphin Wallet itself is untouched and
           * still reachable: AltanaWalletProvider is still mounted in
           * app-providers.tsx, and payment-card.tsx, session-grant-card.tsx and
           * job-delivery-card.tsx all still consume it inside the hire flow -
           * which is where a person actually needs it. The component file is
           * kept, not deleted, so restoring it here is one line.
           */}

          {/* Heading & Subtitle */}
          <View className="items-center px-4 mb-6">
            <Text
              className="text-center text-[22px] font-bold tracking-[-0.5px]"
              style={{ color: colors.ink }}
            >
              Your own wallet
            </Text>
            {/* Hard-wrapped with \n before, which broke at any width but this
                one. Let it wrap. */}
            <Text
              className="mt-2 text-center text-[14px] leading-5"
              style={{ color: colors.muted }}
            >
              MetaMask or any WalletConnect wallet. Dolphin reads only your
              public address, to remember which agents you have hired — no agent
              can ever spend from it.
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
            {/* The connected address gets its own face; the disconnected state
                has no address to seed one from, so it keeps the generic glyph. */}
            {wallet.isConnected && wallet.address ? (
              <WalletAvatar address={wallet.address} kind="human" size={22} />
            ) : (
              <CategoryGlyph color={colors.ink} name="wallet" size={20} />
            )}
            <Text
              className="text-[16px] font-bold"
              style={{ color: colors.ink }}
            >
              {wallet.isConnected && wallet.address
                ? `Connected: ${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`
                : "Connect wallet"}
            </Text>
          </PressableScale>

          {/*
           * The "You stay in control" section was removed here.
           *
           * It listed "Review every permission", "Set caps and expiry" and
           * "Revoke from one place" - all three describing the spending-session
           * model, which FEATURE_SESSION_EXECUTION gates off in this build
           * (see wallet/altana-policy.ts). With sessions hidden, this section
           * advertised three capabilities a user cannot reach from anywhere in
           * the app. Same correction already applied to the website's
           * agent-detail copy.
           *
           * Restore it in the same change that flips that flag, not before.
           */}
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
