import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
    ScrollView,
    View,
    useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AgentActivity } from "@/components/agent-activity";
import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { WalletAvatar } from "@/components/wallet-avatar";
import { WalletOverview } from "@/components/wallet-overview";
import { colors } from "@/constants/theme";
import { useWallet } from "@/wallet/wallet-provider";

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
  const [balancesHidden, setBalancesHidden] = useState(false);



  return (
    <SafeAreaView
      className="flex-1"
      edges={["top", "left", "right"]}
      style={{ backgroundColor: colors.canvas }}
    >
      {/* ── top bar: identity left, profile/account access right ── */}
      <View
        className="w-full self-center flex-row items-center justify-between px-6 pb-2 pt-1"
        style={{ backgroundColor: colors.canvas, maxWidth: contentWidth, zIndex: 10 }}
      >
        {/*
         * The avatar is the connected address's own face, the same seed used on
         * its card below, so the two are recognisably one account. With nothing
         * connected there is no address to seed from, so it falls back to a
         * neutral mark rather than a face that would imply an account exists.
         *
         * Circular, at the same 40pt as the profile button opposite it, so the two
         * ends of the bar are the same shape. As a bare squircle it read as a
         * stray image dropped into the bar rather than as the row's left-hand
         * control. The connected and disconnected states now occupy an
         * identical 40pt circle, so the bar does not change shape when a wallet
         * connects.
         */}
        {wallet.isConnected && wallet.address ? (
          <WalletAvatar
            address={wallet.address}
            kind="human"
            radius={20}
            size={40}
          />
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

        {/*
         * Profile/Account access button. Shows the identity wallet's avatar when
         * connected, tapping navigates to the account details page. When
         * disconnected, shows a neutral wallet glyph.
         */}
        <PressableScale
          accessibilityLabel="Account details"
          accessibilityRole="button"
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push("../account");
          }}
          containerStyle={{
            alignItems: "center",
            height: 40,
            justifyContent: "center",
            width: 40,
          }}
        >
          {wallet.isConnected && wallet.address ? (
            <WalletAvatar
              address={wallet.address}
              kind="human"
              radius={20}
              size={40}
            />
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
            <WalletOverview
              hidden={balancesHidden}
              onToggleHidden={() => setBalancesHidden((prev: boolean) => !prev)}
            />
          </View>
        </View>

        <View className="w-full px-6" style={{ maxWidth: contentWidth }}>
          {/*
           * ── agent activity ──
           *
           * The reference's "recent transactions" slot. Every row is a record
           * Dolphin already holds - an ERC-8183 job it read back off the chain,
           * or a free hire - so the list is short and often empty rather than
           * padded. See agent-activity.tsx for why it reads two sources keyed by
           * two different wallets.
           */}
          <View className="mt-8">
            <AgentActivity hidden={balancesHidden} />
          </View>

          {/*
           * The reference's "OTHER PRODUCTS" chip row has no counterpart here
           * and was left out. The only destinations Dolphin could put in it -
           * browse, search, my agents - are already permanent tabs one thumb
           * away, so a chip row would be a section header over duplicated
           * navigation. If something belongs there, it is a product that does
           * not exist yet rather than a layout gap.
           */}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
