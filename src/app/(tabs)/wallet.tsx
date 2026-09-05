import { useState } from "react";
import {
  Alert,
  Modal,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";

import { AltanaWalletCard } from "@/components/altana-wallet-card";
import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { WalletAvatar } from "@/components/wallet-avatar";
import { WalletOverview } from "@/components/wallet-overview";
import { colors, shadows } from "@/constants/theme";
import { useAppStore } from "@/store/use-app-store";
import { WalletConnectButton, useWallet } from "@/wallet/wallet-provider";

/**
 * The wallet screen.
 *
 * ---------------------------------------------------------------------------
 * LAYOUT
 * ---------------------------------------------------------------------------
 * Follows the consumer-fintech shape the design is aiming at: a slim top bar
 * carrying identity and one utility control, then the balance itself as the
 * hero, a row of circular actions, horizontally scrolling account cards, and
 * uppercase section rules below. wallet-overview.tsx owns everything from the
 * total down to the cards; this file is the frame around it.
 *
 * Three things from that reference are deliberately absent, all for the same
 * reason - Dolphin has nothing real behind them and will not render a control
 * that does nothing (AGENTS.md §5):
 *   "Earn $5"          no referral or rewards programme exists.
 *   "Send" / "Convert" Dolphin never moves funds out of the identity wallet and
 *                      has no swap or on-ramp. The website deleted its own Send
 *                      button for precisely this, having found it wired to an
 *                      empty handler.
 *   "Recent transactions"
 *                      Dolphin indexes no transaction history. The honest route
 *                      to one is the explorer, which the BscScan action already
 *                      opens, so a section header over an empty list would be a
 *                      promise nothing here can keep.
 *
 * The wallet.png hero was removed rather than shrunk: the reference makes the
 * balance the hero, and two heroes stacked left the first real figure below the
 * fold. The asset is untouched and restoring it is one <Image>.
 *
 * ---------------------------------------------------------------------------
 * STILL TWO ACCOUNTS, NOT ONE
 * ---------------------------------------------------------------------------
 * The reference is a single-account product, so its total is unambiguous.
 * Dolphin's is not: the identity wallet is the user's own MetaMask account that
 * Dolphin only reads, and the Dolphin Wallet is a passkey smart account that
 * pays agents. Both feed the total, both get their own card, and the detail
 * card below keeps the "this is a separate wallet" statement that the website
 * treats as the one line that must not be softened.
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
      {/* ── top bar: identity left, one utility control right ── */}
      <View
        className="w-full self-center flex-row items-center justify-between px-6 pb-2 pt-1"
        style={{ backgroundColor: colors.canvas, maxWidth: contentWidth, zIndex: 10 }}
      >
        {/*
         * The avatar is the connected address's own face, the same seed used on
         * its card below, so the two are recognisably one account. With nothing
         * connected there is no address to seed from, so it falls back to a
         * neutral mark rather than a face that would imply an account exists.
         */}
        {wallet.isConnected && wallet.address ? (
          <WalletAvatar address={wallet.address} kind="human" size={40} />
        ) : (
          <View
            className="items-center justify-center rounded-full border"
            style={{
              backgroundColor: colors.surfaceSubtle,
              borderColor: colors.line,
              height: 40,
              width: 40,
            }}
          >
            <CategoryGlyph color={colors.muted} name="wallet" size={18} />
          </View>
        )}

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
        {/*
         * Not inside the padded column: the account cards scroll horizontally
         * and must be able to run to the screen edge, otherwise the card that is
         * meant to peek gets clipped by the padding instead of by the viewport.
         * wallet-overview.tsx applies its own inset.
         */}
        <View className="w-full" style={{ maxWidth: contentWidth }}>
          <View className="px-6">
            <WalletOverview />
          </View>
        </View>

        <View className="w-full px-6" style={{ maxWidth: contentWidth }}>
          {/* ── section rule, in the reference's typographic style ── */}
          <Text
            className="mb-3 mt-8 text-[12px] font-bold uppercase tracking-[1.2px]"
            style={{ color: colors.muted }}
          >
            Account details
          </Text>

          {/*
           * The Dolphin Wallet in full: create/recover, funding, recoverability
           * and the separate-wallet notice. Its own states are complete, so it
           * is safe to mount unconditionally - on a build without passkeys
           * linked it renders the honest "not available on this build" card
           * rather than nothing.
           */}
          <AltanaWalletCard />

          {/*
           * Manage row. Only once connected, because its only job is
           * disconnecting - connect lives in the overview's empty state, and
           * rendering both would put two connect buttons on one screen.
           *
           * WalletConnectButton, never a bare Disconnect: it owns the two-step
           * confirm, and routing every disconnect through it is what stops this
           * screen and the hire screen from guarding the same action
           * differently. The website hit exactly that drift.
           */}
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
