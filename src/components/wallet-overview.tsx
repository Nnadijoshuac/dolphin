import { Linking, Text, View, useWindowDimensions } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useBalance } from "wagmi";

import { CategoryGlyph, type GlyphName } from "@/components/category-glyph";
import { ConstellationBg } from "@/components/constellation-bg";
import { PressableScale } from "@/components/pressable-scale";
import { WalletAvatar } from "@/components/wallet-avatar";
import { colors, shadows } from "@/constants/theme";
import { formatBnb } from "@/wallet/altana-policy";
import { useAltanaWallet } from "@/wallet/altana-provider";
import { WalletConnectButton, useWallet } from "@/wallet/wallet-provider";

/**
 * The top of the wallet screen: one total, three actions, two account cards.
 *
 * ---------------------------------------------------------------------------
 * LAYOUT BORROWED, SUBSTANCE NOT
 * ---------------------------------------------------------------------------
 * The shape here follows a consumer-fintech reference the design is aiming at:
 * a centred TOTAL BALANCE chip, a large figure with a hide toggle, a row of
 * circular actions, then horizontally scrolling account cards with the next one
 * peeking off the right edge. What is NOT borrowed is that reference's palette
 * (white/blue) or its action set.
 *
 * THE ACTION ROW IS DELIBERATELY NOT "ADD MONEY / SEND / CONVERT".
 * Dolphin has nothing real behind any of those three:
 *   - it never moves funds out of the identity wallet, which is the user's own
 *     MetaMask account with a far better send UI already;
 *   - it has no swap or on-ramp integration at all.
 * The website already learned this the expensive way and deleted its Send
 * button rather than disable it, because it had been wired to an empty handler
 * and rendered as a live control that silently did nothing. Every action below
 * does something real (AGENTS.md §5).
 *
 * WHY THIS WHOLE SECTION IS GATED ON `wallet.isAvailable`:
 * useBalance is a wagmi hook and throws without a WagmiProvider above it. That
 * provider is mounted only when wallet-provider.native.tsx built a Reown setup,
 * which needs both a native platform AND a projectId - exactly the condition
 * `isAvailable` reports. The Expo web target ships no wallet by design, so it
 * takes the fallback branch rather than crashing the export.
 */

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/* ─────────────── circular action ─────────────── */

/**
 * One circular action with its label underneath.
 *
 * These were Unicode marks (↓ ↗ ↻) while category-glyph.tsx had no
 * receive/external/refresh glyph and drawing three by hand for one row was not
 * worth it. That file now delegates its interface icons to Hugeicons and
 * carries all three, so these are real icons that scale and take a stroke
 * weight like every other icon on the screen.
 */
function CircleAction({
  glyph,
  label,
  onPress,
  disabled = false,
}: {
  glyph: GlyphName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <View className="items-center" style={{ width: 84 }}>
      <PressableScale
        accessibilityLabel={label}
        accessibilityRole="button"
        disabled={disabled}
        onPress={onPress}
        containerStyle={{
          alignItems: "center",
          backgroundColor: colors.surface,
          borderColor: colors.line,
          borderRadius: 9999,
          borderWidth: 1,
          height: 64,
          justifyContent: "center",
          opacity: disabled ? 0.45 : 1,
          width: 64,
          ...shadows.subtle,
        }}
      >
        <CategoryGlyph color={colors.ink} name={glyph} size={24} />
      </PressableScale>
      <Text
        className="mt-2 text-center text-[13px] font-semibold"
        style={{ color: colors.inkSecondary }}
      >
        {label}
      </Text>
    </View>
  );
}

/* ─────────────── account card ─────────────── */

/**
 * One account, summarised. Purely presentational so both wallets render through
 * the same component and cannot drift into looking like different products.
 *
 * `balance` is a pre-resolved string rather than a number, because the caller is
 * the only place that knows whether a figure was actually read. Passing a
 * number would force this component to invent a fallback, and the only honest
 * fallbacks are words ("Unavailable", "Reading…"), not zero.
 *
 * `address` is nullable because BOTH slots render whether or not their account
 * exists yet - see the scroller below for why. With no address there is nothing
 * to seed a face from, so it draws the neutral glyph for that kind of account
 * rather than a face, which would imply an account that is not there.
 */
function AccountCard({
  address,
  kind,
  title,
  subtitle,
  balance,
  balanceTone = "normal",
  footnote,
  width,
}: {
  address: string | null;
  kind: "human" | "bot";
  title: string;
  subtitle: string;
  balance: string;
  balanceTone?: "normal" | "muted" | "error";
  footnote: string;
  width: number;
}) {
  return (
    <View
      className="rounded-2xl border p-4"
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.line,
        height: 168,
        justifyContent: "space-between",
        width,
        ...shadows.subtle,
      }}
    >
      <View className="flex-row items-center gap-2.5">
        {address ? (
          <WalletAvatar address={address} kind={kind} size={36} />
        ) : (
          <View
            className="items-center justify-center rounded-[7px] border"
            style={{
              backgroundColor: colors.surfaceSubtle,
              borderColor: colors.line,
              height: 36,
              width: 36,
            }}
          >
            <CategoryGlyph
              color={colors.faint}
              name={kind === "bot" ? "agents" : "wallet"}
              size={17}
            />
          </View>
        )}
        <View className="flex-1">
          <Text
            className="text-[15px] font-bold"
            numberOfLines={1}
            style={{ color: colors.ink }}
          >
            {title}
          </Text>
          <Text
            className="text-[12px] font-semibold"
            numberOfLines={1}
            style={{ color: colors.faint }}
          >
            {subtitle}
          </Text>
        </View>
      </View>

      <View>
        <Text
          className="text-[26px] font-bold tracking-[-0.5px]"
          numberOfLines={1}
          style={{
            color:
              balanceTone === "error"
                ? colors.danger
                : balanceTone === "muted"
                  ? colors.faint
                  : colors.ink,
          }}
        >
          {balance}
        </Text>
        <Text
          className="mt-1 text-[12px] font-semibold"
          numberOfLines={1}
          style={{ color: colors.muted }}
        >
          {footnote}
        </Text>
      </View>
    </View>
  );
}

/* ─────────────── the section ─────────────── */

/**
 * `hidden` is owned by the screen, not by this component.
 *
 * The reference hides the total AND every amount below it from one control, so
 * the state has to sit above both this section and the activity list. Keeping
 * it local would have given the page two independent notions of "hidden" and a
 * toggle that visibly missed half the figures.
 */
function Overview({
  hidden,
  onToggleHidden,
}: {
  hidden: boolean;
  onToggleHidden: () => void;
}) {
  const identity = useWallet();
  const altana = useAltanaWallet();
  const { width: windowWidth } = useWindowDimensions();

  const contentWidth = Math.min(windowWidth || 390, 480) - 48;
  // Single card takes full width.
  const cardWidth = contentWidth;

  const identityAddress = identity.isConnected ? identity.address : null;
  const {
    data: identityBalance,
    isLoading: identityLoading,
    isError: identityFailed,
    refetch: refetchIdentity,
  } = useBalance({
    address: (identityAddress ?? undefined) as `0x${string}` | undefined,
    query: { enabled: Boolean(identityAddress) },
  });

  const dolphinAddress =
    altana.status === "connected" ? altana.address : null;

  /*
   * What the agent-wallet slot says when there is no agent wallet to read.
   *
   * Each branch names the actual reason and, where there is one, the next step
   * - the card is the only place on this screen that mentions the wallet at all
   * before someone scrolls to Account details. "Not available on this build" is
   * the one branch with no action attached, because there is genuinely none:
   * passkey wallets need a dev build, which no tap here can produce.
   */
  const dolphinPlaceholder =
    altana.status === "loading"
      ? { balance: "…", footnote: "Checking this device…" }
      : altana.status === "unsupported"
        ? { balance: "Unavailable", footnote: "Not available on this build" }
        : { balance: "Not set up", footnote: "Create one in Account details" };

  /*
   * The total, and the rule it follows.
   *
   * A total is a CLAIM about everything the user holds here. If any account
   * that exists could not be read, a number would understate it while looking
   * complete - which is worse than no number, because nothing signals the
   * shortfall. So the total renders only when every present account was read;
   * otherwise it says so and names why (AGENTS.md §5).
   */
  const parts: { readable: boolean; wei: bigint | null }[] = [];
  if (identityAddress) {
    parts.push({
      readable: !identityFailed && identityBalance !== undefined,
      wei: identityBalance?.value ?? null,
    });
  }
  if (dolphinAddress) {
    parts.push({
      readable: !altana.balanceError && altana.balanceWei !== null,
      wei: altana.balanceWei,
    });
  }

  const anyLoading = identityLoading || altana.isReadingBalance;
  const allReadable = parts.length > 0 && parts.every((p) => p.readable);
  const totalWei = allReadable
    ? parts.reduce((sum, p) => sum + (p.wei ?? BigInt(0)), BigInt(0))
    : null;

  const totalText =
    parts.length === 0
      ? "—"
      : totalWei !== null
        ? hidden
          ? "••••"
          : formatBnb(totalWei)
        : anyLoading
          ? "…"
          : "—";

  const totalNote =
    parts.length === 0
      ? "Connect a wallet to see a balance"
      : totalWei !== null
        ? `Across ${parts.length === 1 ? "1 account" : `${parts.length} accounts`} on BNB Smart Chain`
        : anyLoading
          ? "Reading balances…"
          : "A balance could not be read, so no total is shown";

  const handleCopy = () => {
    if (!identityAddress) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void Clipboard.setStringAsync(identityAddress);
  };

  const handleExplorer = () => {
    if (!identityAddress) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void Linking.openURL(`https://bscscan.com/address/${identityAddress}`);
  };

  const handleRefresh = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (identityAddress) void refetchIdentity();
    if (dolphinAddress) altana.refreshBalance();
  };

  return (
    <View>
      {/* ── total balance ── */}
      <View className="items-center" style={{ paddingBottom: 4 }}>
        <ConstellationBg opacity={0.3} />

        {/*
         * The chip carries the label alone.
         *
         * It used to stack the two account avatars inside it, mirroring the
         * reference's stacked currency flags. That put a second face on a
         * screen whose top bar already shows the connected address's avatar, so
         * the same account was drawn twice within one viewport and read as two
         * different identities. The count it encoded is already stated in words
         * directly underneath ("Across 2 accounts…"), and each account still
         * carries its own face on its card below.
         *
         * No chevron, unlike the reference. A chevron promises a picker, and
         * there is nothing to pick between: the total is every account or it is
         * nothing.
         */}
        <View
          className="mt-2 flex-row items-center gap-2 rounded-full border px-3.5 py-2"
          style={{ backgroundColor: colors.surface, borderColor: colors.line }}
        >
          <Text
            className="text-[11px] font-bold uppercase tracking-[1px]"
            style={{ color: colors.muted }}
          >
            Total balance
          </Text>
        </View>

        <View className="mt-3 flex-row items-center gap-2.5">
          <Text
            className="text-[44px] font-bold tracking-[-1.5px]"
            style={{ color: parts.length === 0 ? colors.faint : colors.ink }}
          >
            {totalText}
          </Text>
          {totalWei !== null ? (
            <>
              {!hidden ? (
                <Text
                  className="text-[16px] font-bold"
                  style={{ color: colors.muted }}
                >
                  BNB
                </Text>
              ) : null}
              {/*
               * A worded toggle rather than an eye icon: category-glyph.tsx has
               * no eye, and a label is unambiguous to a screen reader without
               * needing one written for it.
               */}
              <PressableScale
                accessibilityLabel={hidden ? "Show balance" : "Hide balance"}
                accessibilityRole="button"
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onToggleHidden();
                }}
                containerStyle={{
                  backgroundColor: colors.surfaceSubtle,
                  borderColor: colors.line,
                  borderRadius: 9999,
                  borderWidth: 1,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                }}
              >
                <Text
                  className="text-[11px] font-bold"
                  style={{ color: colors.muted }}
                >
                  {hidden ? "Show" : "Hide"}
                </Text>
              </PressableScale>
            </>
          ) : null}
        </View>

        <Text
          className="mt-1.5 text-center text-[12px]"
          style={{ color: colors.muted }}
        >
          {totalNote}
        </Text>
      </View>

      {/* ── actions ── */}
      {identityAddress ? (
        <View className="mt-6 flex-row justify-center gap-3">
          <CircleAction glyph="receive" label="Receive" onPress={handleCopy} />
          <CircleAction glyph="external" label="BscScan" onPress={handleExplorer} />
          <CircleAction
            disabled={identityLoading || altana.isReadingBalance}
            glyph="refresh"
            label="Refresh"
            onPress={handleRefresh}
          />
        </View>
      ) : (
        /*
         * No disabled action row while disconnected. Three greyed circles would
         * be three dead ends where the one thing that unblocks the user is not
         * offered - the same dead end the website removed from its
         * recoverability panel.
         */
        <View className="mt-6 px-2">
          <WalletConnectButton connectLabel="Connect wallet" />
        </View>
      )}

      {/*
       * ── the agent wallet ──
       *
       * ONE CARD, AND IT IS NOT THE USER'S OWN WALLET. This was a horizontal
       * row of two, the identity wallet first. That card said nothing the top of
       * this screen had not already said: the figure above it is that wallet's
       * balance, the avatar in the bar is its face, and all three actions act on
       * it. It was the same account stated a third time, and it pushed the one
       * account that had NOT been mentioned - the agent wallet Dolphin pays
       * from - off the right edge.
       *
       * With one card there is nothing to scroll, so the horizontal ScrollView
       * went with it and the card takes the full column width.
       *
       * The card renders whether or not the wallet exists yet, because its
       * absence is the thing most people need told. It still states no figure it
       * has not read: the balance line is a word - "Not set up", "Unavailable",
       * "…" - never a zero, which would read as a funded account holding nothing
       * (AGENTS.md §5).
       */}
      <View className="mt-7">
        <AccountCard
          address={dolphinAddress}
          balance={
            !dolphinAddress
              ? dolphinPlaceholder.balance
              : hidden
                ? "••••"
                : altana.balanceError
                  ? "Unavailable"
                  : altana.balanceWei !== null
                    ? formatBnb(altana.balanceWei)
                    : altana.isReadingBalance
                      ? "…"
                      : "—"
          }
          balanceTone={
            !dolphinAddress
              ? "muted"
              : altana.balanceError
                ? "error"
                : altana.balanceWei !== null
                  ? "normal"
                  : "muted"
          }
          footnote={
            dolphinAddress
              ? shortenAddress(dolphinAddress)
              : dolphinPlaceholder.footnote
          }
          kind="bot"
          subtitle="BNB · pays agents you hire"
          title="Dolphin Wallet"
          width={cardWidth}
        />
      </View>
    </View>
  );
}

export function WalletOverview({
  hidden,
  onToggleHidden,
}: {
  hidden: boolean;
  onToggleHidden: () => void;
}) {
  const identity = useWallet();

  /*
   * The fallback branch. Reached on the Expo web target (no wallet by design)
   * and on a native build with no projectId configured. Either way there is no
   * WagmiProvider, so Overview - which calls useBalance - must not mount.
   */
  if (!identity.isAvailable) {
    return (
      <View
        className="rounded-2xl border p-4"
        style={{ backgroundColor: colors.surface, borderColor: colors.line, ...shadows.subtle }}
      >
        <Text className="text-[13px] font-bold" style={{ color: colors.ink }}>
          Balances unavailable here
        </Text>
        <Text
          className="mt-1.5 text-[12px] leading-[18px]"
          style={{ color: colors.muted }}
        >
          {identity.unavailableReason}
        </Text>
      </View>
    );
  }

  return <Overview hidden={hidden} onToggleHidden={onToggleHidden} />;
}
