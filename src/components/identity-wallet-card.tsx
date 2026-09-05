import { useState } from "react";
import { Linking, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useBalance } from "wagmi";

import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { WalletAvatar } from "@/components/wallet-avatar";
import { colors, shadows } from "@/constants/theme";
import { formatBnb } from "@/wallet/altana-policy";
import { WalletConnectButton, useWallet } from "@/wallet/wallet-provider";

/**
 * The identity wallet card on the mobile wallet screen.
 *
 * Counterpart to the website's IdentityWalletCard (web/src/components/
 * altana-wallet-panel.tsx), in this app's visual language rather than the
 * site's - the two products deliberately do not share a look. What must not
 * differ is the substance: the same address, the same balance, read the same
 * way and formatted with the same helper.
 *
 * ---------------------------------------------------------------------------
 * THIS IS NOT THE DOLPHIN WALLET
 * ---------------------------------------------------------------------------
 * This is the user's OWN MetaMask / WalletConnect account. Dolphin only ever
 * READS it - its single job is to identify who a hire record belongs to. It is
 * never asked to sign and no agent can ever spend from it. The Dolphin Wallet
 * (altana-wallet-card.tsx) is the separate passkey account that pays agents.
 * wallet-provider.native.tsx and altana-policy.ts carry the full reasoning for
 * why the two cannot be merged.
 *
 * NO "SEND" ACTION, deliberately - the same call the website made. Dolphin
 * never moves funds out of this wallet, and the user already has a far better
 * send UI in the wallet app itself. A worse copy of it here would be a dead end
 * at best. Every control on this card does something real.
 */

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * One tappable action. Mirrors the website's WalletAction.
 *
 * `glyph` is optional because not every action has one in this app's icon set
 * (there is no "refresh" or "external link" glyph - see category-glyph.tsx),
 * and inventing one for a single call site is not worth a new SVG path.
 */
function WalletAction({
  glyph,
  label,
  onPress,
}: {
  glyph?: "copy" | "check" | "arrow-right";
  label: string;
  onPress: () => void;
}) {
  return (
    <PressableScale
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      containerStyle={{
        alignItems: "center",
        backgroundColor: "#FFFFFF",
        borderColor: colors.line,
        borderRadius: 12,
        borderWidth: 1,
        flex: 1,
        flexDirection: "row",
        gap: 6,
        justifyContent: "center",
        paddingVertical: 10,
      }}
    >
      {glyph ? <CategoryGlyph color={colors.muted} name={glyph} size={13} /> : null}
      <Text className="text-[12px] font-bold" style={{ color: colors.ink }}>
        {label}
      </Text>
    </PressableScale>
  );
}

/**
 * The connected card. Split out as its own component ON PURPOSE.
 *
 * useBalance is a wagmi hook and needs a WagmiProvider above it. On the Expo
 * WEB target there is none - wallet-provider.web.tsx deliberately ships no
 * wallet at all, so it never mounts one. Keeping the hook in a child that is
 * only rendered once `isConnected` is true means it can never run there:
 * webWallet reports `isConnected: false` permanently, so this component is
 * simply never mounted on web. Calling useBalance up in IdentityWalletCard
 * instead would run it on every platform and crash the web export.
 */
function ConnectedIdentityCard({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const {
    data: balance,
    isLoading: isReadingBalance,
    isError: balanceFailed,
  } = useBalance({ address: address as `0x${string}` });

  const handleCopy = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void Clipboard.setStringAsync(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <View
      className="rounded-2xl border bg-white p-4"
      style={{ borderColor: colors.line, ...shadows.subtle }}
    >
      {/* Identity row: the face and the address it belongs to. */}
      <View className="flex-row items-center gap-2.5">
        <WalletAvatar address={address} kind="human" size={34} />
        <View className="flex-1">
          <Text
            className="text-[10px] font-bold uppercase tracking-wider"
            style={{ color: colors.faint }}
          >
            Your wallet
          </Text>
          <Text
            className="mt-0.5 text-[13px] font-bold"
            selectable
            style={{ color: colors.ink }}
          >
            {truncateAddress(address)}
          </Text>
        </View>
      </View>

      {/*
       * Hero balance.
       *
       * Three honest states and no fourth. A balance that has not been read is
       * never rendered as a number, and a failed read says so rather than
       * showing 0 - "0 BNB" and "we could not ask" look identical to a reader
       * but mean opposite things (AGENTS.md §5).
       *
       * Formatted with formatBnb, the SAME helper altana-wallet-card uses, so
       * two cards on one screen cannot disagree about the same quantity. The
       * website hit exactly that bug when the two used different formatters:
       * one rendered 0.00001 as "0.0000", which reads as empty when it is not.
       */}
      <View className="mt-4 flex-row items-baseline">
        {balanceFailed ? (
          <Text className="text-[28px] font-bold" style={{ color: colors.danger }}>
            Unavailable
          </Text>
        ) : isReadingBalance || !balance ? (
          <Text className="text-[28px] font-bold" style={{ color: colors.faint }}>
            {isReadingBalance ? "…" : "—"}
          </Text>
        ) : (
          <>
            <Text
              className="text-[28px] font-bold tracking-[-0.5px]"
              style={{ color: colors.ink }}
            >
              {formatBnb(balance.value)}
            </Text>
            <Text
              className="ml-1.5 text-[14px] font-bold"
              style={{ color: colors.muted }}
            >
              BNB
            </Text>
          </>
        )}
      </View>
      <Text className="mt-0.5 text-[11px]" style={{ color: colors.muted }}>
        {balanceFailed
          ? "Balance could not be read from chain 56"
          : "Identity · used to remember your hires"}
      </Text>

      {/* Actions. Both do something real; neither moves funds. */}
      <View className="mt-4 flex-row gap-2">
        <WalletAction
          glyph={copied ? "check" : "copy"}
          label={copied ? "Copied" : "Receive"}
          onPress={handleCopy}
        />
        <WalletAction
          glyph="arrow-right"
          label="BscScan"
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            void Linking.openURL(`https://bscscan.com/address/${address}`);
          }}
        />
      </View>

      {/*
       * Asset row. Native BNB is the whole list on purpose - the same call
       * altana-wallet-card makes. Every Dolphin hire is denominated in native
       * BNB, so no other token is involved in any flow this app has. A
       * padded-out token list would be decoration, not information.
       */}
      <View
        className="mt-4 flex-row items-center justify-between rounded-2xl border px-3.5 py-3"
        style={{ borderColor: colors.line }}
      >
        <View className="flex-row items-center gap-3">
          <View
            className="h-9 w-9 items-center justify-center rounded-full"
            style={{ backgroundColor: colors.goldMuted }}
          >
            <Text className="text-[13px] font-bold" style={{ color: colors.goldDark }}>
              B
            </Text>
          </View>
          <View>
            <Text className="text-[13px] font-bold" style={{ color: colors.ink }}>
              BNB
            </Text>
            <Text className="text-[11px]" style={{ color: colors.faint }}>
              BNB Smart Chain · native
            </Text>
          </View>
        </View>
        <Text
          className="text-[13px] font-bold"
          style={{
            color: balanceFailed
              ? colors.danger
              : balance
                ? colors.ink
                : colors.faint,
          }}
        >
          {balanceFailed
            ? "Unavailable"
            : isReadingBalance
              ? "Reading…"
              : balance
                ? `${formatBnb(balance.value)} BNB`
                : "Not read yet"}
        </Text>
      </View>
    </View>
  );
}

export function IdentityWalletCard() {
  const wallet = useWallet();

  /*
   * The empty state is a CARD, not an absence - the website's call, and it
   * matters more here than there. On a vertical phone stack, a section that
   * disappears when disconnected makes everything below it jump; keeping the
   * same slot at roughly the same size means connecting changes what is inside
   * the card, not the shape of the screen.
   *
   * This branch also covers the Expo web target, where wallet-provider.web.tsx
   * reports permanently unavailable - hence `unavailableReason` being shown
   * rather than assumed to be "not connected yet".
   */
  if (!wallet.isConnected || !wallet.address) {
    return (
      <View className="mb-6">
        <Text className="mb-2.5 text-[14px] font-bold" style={{ color: colors.ink }}>
          Your wallet
        </Text>
        <View
          className="rounded-2xl border bg-white p-4"
          style={{ borderColor: colors.line, ...shadows.subtle }}
        >
          <View className="flex-row items-center gap-2">
            <CategoryGlyph color={colors.muted} name="wallet" size={16} />
            <Text className="text-[13px] font-bold" style={{ color: colors.ink }}>
              {wallet.isAvailable ? "Not connected" : "Not available here"}
            </Text>
          </View>
          <Text
            className="mt-1.5 text-[12px] leading-[18px]"
            style={{ color: colors.muted }}
          >
            {wallet.isAvailable
              ? "Connect MetaMask or any WalletConnect wallet so Dolphin can remember which agents you have hired. It reads your public address only — no agent can ever spend from it."
              : wallet.unavailableReason}
          </Text>

          {wallet.isAvailable ? (
            <View className="mt-3.5">
              <WalletConnectButton connectLabel="Connect wallet" />
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View className="mb-6">
      <View className="mb-2.5 flex-row items-center justify-between">
        <Text className="text-[14px] font-bold" style={{ color: colors.ink }}>
          Your wallet
        </Text>
        <View
          className="rounded-full px-2.5 py-1"
          style={{ backgroundColor: colors.mint }}
        >
          <Text className="text-[10px] font-bold" style={{ color: colors.mintInk }}>
            Connected
          </Text>
        </View>
      </View>

      <ConnectedIdentityCard address={wallet.address} />
    </View>
  );
}
