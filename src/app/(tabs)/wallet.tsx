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

import { AltanaWalletCard } from "@/components/altana-wallet-card";
import { CategoryGlyph } from "@/components/category-glyph";
import { ConstellationBg } from "@/components/constellation-bg";
import { IdentityWalletCard } from "@/components/identity-wallet-card";
import { PressableScale } from "@/components/pressable-scale";
import { colors, shadows } from "@/constants/theme";
import { useAppStore } from "@/store/use-app-store";
import { WalletConnectButton, useWallet } from "@/wallet/wallet-provider";

const walletHeroImage = require("../../../assets/images/wallet.png");

/**
 * The wallet screen: two accounts, each shown as its own card.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS MIRRORS, AND WHERE IT DELIBERATELY DIFFERS
 * ---------------------------------------------------------------------------
 * The website's wallet page (web/src/app/wallet/page.tsx) renders
 * AltanaWalletPanel over IdentityWalletSection, and inside that panel the two
 * wallets sit side by side in a two-column grid. This screen carries the same
 * SUBSTANCE - the same two accounts, the same balances read the same way, the
 * same "these are separate wallets" statement - in this app's own visual
 * language, which the two products deliberately do not share.
 *
 * ORDER IS INVERTED ON PURPOSE. The website puts the Dolphin Wallet first
 * because in a two-column grid neither card is "above" the other; order there
 * is reading order, not priority. On a phone the stack is vertical, so order IS
 * priority - and the identity wallet is the one that makes hiring work at all
 * and is available on every build, while the Dolphin Wallet is explicitly
 * optional and reports "not available on this build" wherever passkeys are not
 * linked (Expo Go, most notably). Leading with a card that is frequently
 * unsupported would bury the one thing a new user actually needs.
 *
 * THE DOLPHIN WALLET CARD IS BACK. It was removed from this screen earlier
 * while the identity wallet was the only working half; the component was kept
 * rather than deleted precisely so restoring it would be one line, and this is
 * that line. Nothing about the wallet itself changed - AltanaWalletProvider was
 * mounted in app-providers.tsx the whole time and the hire flow has been using
 * it continuously.
 */
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

  /*
   * There is no handleConnectToggle here any more.
   *
   * This screen used to own a gold CTA that ran its own Alert-based disconnect
   * confirm, while WalletConnectButton carried a second, different one. Two
   * confirms for one action, free to drift apart - which is the exact bug the
   * website hit and fixed by deleting its bare Disconnect button and delegating
   * both states to WalletConnectButton. Same fix here: connecting lives in
   * IdentityWalletCard's empty state, disconnecting lives in the manage row
   * below, and both are the same component.
   */

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
      {/* Sticky pinned top header */}
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
            <Text
              className="text-[32px] font-bold tracking-[-0.6px]"
              style={{ color: colors.ink }}
            >
              Wallet
            </Text>
            {/*
             * The subtitle is back, and it is now true again.
             *
             * It was removed when this screen showed exactly one account,
             * because it described a second card that was no longer here. Both
             * cards are present again, so the line does its original job:
             * telling someone why there are two of these before they scroll
             * into them.
             */}
            <Text
              className="mt-1 text-[13px] leading-[18px]"
              style={{ color: colors.muted }}
            >
              Two accounts: one identifies you, one pays agents.
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
        /*
         * Top-aligned again, not centred.
         *
         * The centring here existed only because removing the Dolphin Wallet
         * card left roughly half a screen of content floating under the header.
         * With both cards back the content fills and overflows the viewport, so
         * flexGrow + justifyContent: "center" would now fight the scroll rather
         * than help it. paddingBottom still clears the floating tab bar, which
         * is absolutely positioned ~90px from the bottom (see (tabs)/_layout).
         */
        contentContainerStyle={{
          alignItems: "center",
          paddingBottom: 120,
          paddingTop: 4,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View className="w-full px-6" style={{ maxWidth: contentWidth }}>
          {/*
           * Hero graphic, at 120px rather than the 190px it occupied when it
           * was carrying a nearly empty screen. It is brand furniture, not
           * information: with two real cards below it, the old height pushed
           * the first balance below the fold on a small device.
           */}
          <View
            className="mb-5 items-center justify-center"
            style={{ height: 120, width: "100%" }}
          >
            <ConstellationBg opacity={0.35} />
            <Image
              cachePolicy="memory-disk"
              contentFit="contain"
              priority="high"
              source={walletHeroImage}
              style={{ height: 112, width: 160 }}
            />
          </View>

          {/* 1. The identity wallet - the user's own MetaMask/WalletConnect
                 account. Read-only to Dolphin; identifies hire records. */}
          <IdentityWalletCard />

          {/* 2. The Dolphin Wallet - the Altana passkey smart account that
                 actually pays agents. Renders its own unsupported / no-wallet /
                 connected states, so it is safe to mount unconditionally. */}
          <AltanaWalletCard />

          {/*
           * Manage row. Only once something is connected, because its only job
           * is disconnecting - the connect affordance lives in the card's empty
           * state, and rendering both would put two connect buttons on one
           * screen. Exactly how the website's IdentityWalletSection behaves.
           */}
          {wallet.isConnected ? (
            <View
              className="rounded-2xl border p-4"
              style={{ backgroundColor: colors.surfaceSubtle, borderColor: colors.line }}
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
              {/*
               * WalletConnectButton, never a bare Disconnect. It owns the
               * two-step confirm, so routing every disconnect through it is what
               * stops this screen and the hire screen from guarding the same
               * action differently.
               */}
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
                <Text className="text-[13px] text-slate-500">Network</Text>
                <Text
                  className="text-[13px] font-bold"
                  style={{ color: colors.ink }}
                >
                  BNB Smart Chain (ID: 56)
                </Text>
              </View>
              <View className="flex-row justify-between py-2 border-b border-slate-100">
                <Text className="text-[13px] text-slate-500">
                  Saved Local Previews
                </Text>
                <Text
                  className="text-[13px] font-bold"
                  style={{ color: colors.ink }}
                >
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
