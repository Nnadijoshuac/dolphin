import { useState } from "react";
import { Alert, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

import { Button } from "@/components/buttons";
import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { colors, shadows } from "@/constants/theme";
import { WalletAvatar } from "@/components/wallet-avatar";
import {
  ALTANA_FUNDING_HINT,
  FEATURE_SESSION_EXECUTION,
  formatBnb,
  recoverabilityCopy,
} from "@/wallet/altana-policy";
import { useAltanaWallet, type AltanaSession } from "@/wallet/altana-provider";
import { toUserMessage } from "@/wallet/wallet-errors";

/**
 * The Dolphin Wallet card on the mobile wallet screen.
 *
 * Mirrors what the website's AltanaWalletPanel shows, in this app's own visual
 * language rather than the site's - the two products deliberately do not share
 * a look (HANDOVER.md, session 4). What must NOT differ is the substance: the
 * same balance, the same granted permissions, the same revoke, the same
 * "this is a separate wallet" statement.
 *
 * On a native build this renders the honest unsupported state instead. That is
 * not a dead end: the same wallet is reachable from the same passkey in a
 * browser, and the copy says so.
 */

/** Repeated verbatim from the website. The one line that must not be softened. */
function SeparateWalletNotice() {
  return (
    <View
      className="rounded-2xl border p-3.5"
      style={{ backgroundColor: "#FFFBEB", borderColor: "#FDE68A" }}
    >
      <View className="flex-row items-center gap-2">
        <CategoryGlyph color="#D97706" name="info" size={15} />
        <Text className="text-[12px] font-bold" style={{ color: "#946B00" }}>
          This is a separate wallet
        </Text>
      </View>
      <Text
        className="mt-1.5 text-[11px] leading-4"
        style={{ color: colors.muted }}
      >
        A Dolphin Wallet is its own account with its own balance. It is not your
        MetaMask or browser-extension wallet, and it does not hold or see those
        funds. Anything you want it to spend has to be sent to it.
      </Text>
    </View>
  );
}

function CopyRow({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <PressableScale
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        void Clipboard.setStringAsync(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        });
      }}
      containerStyle={{
        alignItems: "center",
        backgroundColor: "#FFFFFF",
        borderColor: colors.line,
        borderRadius: 12,
        borderWidth: 1,
        flexDirection: "row",
        gap: 8,
        justifyContent: "space-between",
        paddingHorizontal: 12,
        paddingVertical: 10,
      }}
    >
      <Text
        className="flex-1 text-[11px] font-semibold"
        numberOfLines={1}
        style={{ color: colors.ink }}
      >
        {value}
      </Text>
      <View className="flex-row items-center gap-1">
        <CategoryGlyph
          color={copied ? "#1C6A44" : colors.muted}
          name={copied ? "check" : "copy"}
          size={13}
        />
        <Text
          className="text-[11px] font-bold"
          style={{ color: copied ? "#1C6A44" : colors.muted }}
        >
          {copied ? "Copied" : "Copy"}
        </Text>
      </View>
    </PressableScale>
  );
}

function SessionRow({
  session,
  onRevoke,
  disabled,
}: {
  session: AltanaSession;
  onRevoke: () => void;
  disabled: boolean;
}) {
  const expiresAt = new Date(session.expiry * 1000);

  return (
    <View
      className="rounded-2xl border bg-white p-3.5"
      style={{ borderColor: colors.line }}
    >
      <Text className="text-[13px] font-bold" style={{ color: colors.ink }}>
        {session.agentName}
      </Text>
      <Text className="mt-0.5 text-[11px]" style={{ color: colors.muted }}>
        Agent #{session.tokenId} · {session.category}
      </Text>

      <View
        className="mt-2.5 border-t pt-2.5"
        style={{ borderColor: colors.line }}
      >
        <View className="flex-row justify-between py-0.5">
          <Text className="text-[11px]" style={{ color: colors.muted }}>
            Can spend up to
          </Text>
          <Text className="text-[11px] font-bold" style={{ color: colors.ink }}>
            {formatBnb(BigInt(session.spendCapWei))} BNB / {session.spendPeriod}
          </Text>
        </View>
        {session.allowlist.map((contract) => (
          <View className="mt-1.5" key={contract.address}>
            <Text className="text-[11px]" style={{ color: colors.muted }}>
              Can only call
            </Text>
            <Text
              className="text-[11px] font-bold"
              style={{ color: colors.ink }}
            >
              {contract.label}
            </Text>
            <Text className="text-[10px]" style={{ color: "#A5A79F" }}>
              {contract.address}
            </Text>
          </View>
        ))}
        <View className="mt-1.5 flex-row justify-between py-0.5">
          <Text className="text-[11px]" style={{ color: colors.muted }}>
            Expires
          </Text>
          <Text className="text-[11px] font-bold" style={{ color: colors.ink }}>
            {expiresAt.toISOString().slice(0, 10)}
          </Text>
        </View>
      </View>

      <PressableScale
        accessibilityLabel={`Revoke the permission granted to ${session.agentName}`}
        accessibilityRole="button"
        onPress={onRevoke}
        containerStyle={{
          alignItems: "center",
          backgroundColor: "#FEE2E2",
          borderRadius: 12,
          marginTop: 10,
          opacity: disabled ? 0.5 : 1,
          paddingVertical: 10,
        }}
      >
        <Text className="text-[12px] font-bold text-red-600">
          Revoke this permission
        </Text>
      </PressableScale>
    </View>
  );
}

/**
 * Whether THIS wallet could be rebuilt from its passkey on another device.
 *
 * Counterpart to the website's RecoverabilityPanel, reading the same live
 * KeyStore state and quoting the same copy from altana-policy.ts, so the two
 * products cannot tell a user different things about the same wallet.
 */
function RecoverabilityBlock() {
  const altana = useAltanaWallet();
  const [isRegistering, setIsRegistering] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const copy = recoverabilityCopy(altana.recoverability);
  const fee = altana.registrationFeeWei;
  // Compared as bigints. A null balance is "unread", never "enough".
  const canAffordFee =
    fee !== null && altana.balanceWei !== null && altana.balanceWei > fee;

  const accent =
    altana.recoverability === "registered"
      ? "#1C6A44"
      : altana.recoverability === "unregistered"
        ? colors.danger
        : colors.muted;

  const handleRegister = async () => {
    setIsRegistering(true);
    setErrorMessage(null);
    try {
      await altana.registerWallet();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (cause) {
      setErrorMessage(toUserMessage(cause, "That action could not be completed. Try again."));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsRegistering(false);
    }
  };

  return (
    <View
      className="rounded-2xl border p-3.5"
      style={{ backgroundColor: "#FBF9F4", borderColor: colors.line }}
    >
      <View className="flex-row items-start justify-between gap-3">
        <Text className="flex-1 text-[12px] font-bold" style={{ color: accent }}>
          {copy.title}
        </Text>
        <PressableScale
          accessibilityLabel="Re-check whether this wallet is recoverable"
          accessibilityRole="button"
          disabled={altana.isCheckingRecoverability}
          onPress={() => altana.refreshRecoverability()}
        >
          <Text className="text-[11px] font-bold" style={{ color: colors.muted }}>
            {altana.isCheckingRecoverability ? "Checking…" : "Re-check"}
          </Text>
        </PressableScale>
      </View>

      <Text className="mt-1 text-[11px] leading-4" style={{ color: colors.muted }}>
        {copy.body}
      </Text>

      {altana.recoverabilityError ? (
        <Text className="mt-1.5 text-[11px] leading-4" style={{ color: colors.danger }}>
          {altana.recoverabilityError}
        </Text>
      ) : null}

      {/*
       * Three mutually exclusive branches, never a disabled button. Mirrors the
       * website's RecoverabilityPanel.
       *
       * This used to render "Make recoverable — 0.000723 BNB + gas" greyed out
       * above a line explaining the balance was too low. That is a dead end:
       * the only control offered is one the user cannot use, and the thing that
       * WOULD unblock them (depositing) is not offered at all. Every Dolphin
       * Wallet in existence is empty, so that dead end was the state every user
       * actually saw.
       */}
      {altana.recoverability === "unregistered" ? (
        <View className="mt-3">
          {fee === null ? (
            <Text className="text-[11px] leading-4" style={{ color: colors.danger }}>
              The registration fee could not be read just now, so Dolphin will not
              offer an action it cannot price for you. Re-check to try again.
            </Text>
          ) : !canAffordFee ? (
            <>
              <Text className="text-[11px] font-bold" style={{ color: colors.ink }}>
                Deposit BNB to make this wallet recoverable
              </Text>
              <Text
                className="mt-1 text-[11px] leading-4"
                selectable
                style={{ color: colors.inkSecondary }}
              >
                {altana.address}
              </Text>
              <Text className="mt-1.5 text-[11px] leading-4" style={{ color: colors.muted }}>
                {/*
                 * The fee is stated exactly because it was read from the chain.
                 * Gas is named but NOT quantified - Dolphin has not measured it
                 * and will not print a plausible-looking guess beside a real
                 * figure (AGENTS.md §5).
                 */}
                Registration costs {formatBnb(fee)} BNB plus relay gas, paid by this
                wallet. It currently holds{" "}
                {altana.balanceWei === null
                  ? "an amount Dolphin could not read"
                  : `${formatBnb(altana.balanceWei)} BNB`}
                . Send BNB to the address above, then re-check.
              </Text>
            </>
          ) : (
            <>
              <Text className="text-[11px] leading-4" style={{ color: colors.muted }}>
                You can register it now without doing anything else. This is an
                on-chain transaction paid from this wallet: {formatBnb(fee)} BNB
                registration fee plus gas. Granting an agent permission or paying one
                does the same thing automatically, so this is only worth doing if you
                want the wallet secured first.
              </Text>
              <View className="mt-2.5">
                <Button
                  disabled={isRegistering || altana.isBusy}
                  label={
                    isRegistering
                      ? "Confirm with passkey…"
                      : `Make recoverable — ${formatBnb(fee)} BNB + gas`
                  }
                  loading={isRegistering}
                  onPress={() => void handleRegister()}
                />
              </View>
            </>
          )}

          {errorMessage ? (
            <Text className="mt-1.5 text-[11px] leading-4" style={{ color: colors.danger }}>
              {errorMessage}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function AltanaWalletCard() {
  const altana = useAltanaWallet();

  /* --- native, or a browser with no WebAuthn --------------------------- */
  if (altana.status === "unsupported") {
    return (
      <View className="mb-6">
        <Text className="mb-2.5 text-[14px] font-bold" style={{ color: colors.ink }}>
          Dolphin Wallet
        </Text>
        <View
          className="rounded-2xl border bg-white p-4"
          style={{ borderColor: colors.line, ...shadows.subtle }}
        >
          <View className="flex-row items-center gap-2">
            <CategoryGlyph color={colors.muted} name="wallet" size={16} />
            <Text className="text-[13px] font-bold" style={{ color: colors.ink }}>
              Not available on this build
            </Text>
          </View>
          <Text
            className="mt-1.5 text-[12px] leading-[18px]"
            style={{ color: colors.muted }}
          >
            {altana.unsupportedReason}
          </Text>
        </View>
      </View>
    );
  }

  if (altana.status === "loading") {
    return (
      <View className="mb-6">
        <Text className="text-[13px]" style={{ color: colors.muted }}>
          Checking this device…
        </Text>
      </View>
    );
  }

  /* --- no wallet yet ---------------------------------------------------- */
  if (altana.status === "no-wallet") {
    return (
      <View className="mb-6">
        <Text className="mb-2.5 text-[14px] font-bold" style={{ color: colors.ink }}>
          Dolphin Wallet
        </Text>
        <View
          className="rounded-2xl border bg-white p-4"
          style={{ borderColor: colors.line, ...shadows.subtle }}
        >
          <Text
            className="text-[12px] leading-[18px]"
            style={{ color: colors.muted }}
          >
            A smart account secured by a passkey — your device&apos;s Face ID,
            Touch ID or Windows Hello. No seed phrase, and Dolphin never sees or
            stores a key. It is what lets you give an agent a bounded, revocable
            spending permission instead of unrestricted access.
          </Text>

          <View className="mt-3.5">
            <SeparateWalletNotice />
          </View>

          <PressableScale
            accessibilityLabel="Create a Dolphin Wallet with a passkey"
            accessibilityRole="button"
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              void altana.createWallet();
            }}
            containerStyle={{
              alignItems: "center",
              backgroundColor: "#F5B300",
              borderRadius: 14,
              flexDirection: "row",
              gap: 8,
              justifyContent: "center",
              marginTop: 14,
              opacity: altana.isBusy ? 0.6 : 1,
              paddingVertical: 13,
            }}
          >
            <CategoryGlyph color={colors.ink} name="wallet" size={17} />
            <Text className="text-[14px] font-bold" style={{ color: colors.ink }}>
              {altana.isBusy ? "Waiting for your passkey…" : "Create with a passkey"}
            </Text>
          </PressableScale>

          <PressableScale
            accessibilityLabel="Recover an existing Dolphin Wallet"
            accessibilityRole="button"
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              void altana.recoverWallet();
            }}
            containerStyle={{
              alignItems: "center",
              backgroundColor: "#FFFFFF",
              borderColor: colors.line,
              borderRadius: 14,
              borderWidth: 1,
              marginTop: 8,
              paddingVertical: 11,
            }}
          >
            <Text className="text-[12px] font-bold" style={{ color: colors.muted }}>
              I already have one — recover it
            </Text>
          </PressableScale>

          {/* Verified live this session, and it surprises people: recovery
              reads the wallet's admin key from Altana's on-chain KeyStore, and
              a key only lands there on the wallet's FIRST transaction. Saying
              so here is cheaper than letting someone meet it as a raw error. */}
          <Text
            className="mt-2.5 text-[11px] leading-4"
            style={{ color: "#A5A79F" }}
          >
            Recovery needs one prior on-chain action — a wallet&apos;s key is written
            on-chain the first time the wallet does something. A wallet created
            and never used has nothing to recover from.
          </Text>

          {altana.error ? (
            <View
              className="mt-3 rounded-xl p-3"
              style={{ backgroundColor: "#FEE2E2" }}
            >
              <Text className="text-[11px] font-semibold leading-4 text-red-700">
                {altana.error}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  /* --- connected -------------------------------------------------------- */
  const address = altana.address ?? "";
  const activeSessions = (altana.sessions ?? []).filter((s) => s.status === "active");
  const isEmptyBalance = altana.balanceWei !== null && altana.balanceWei === BigInt(0);

  return (
    <View className="mb-6">
      <View className="mb-2.5 flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <WalletAvatar address={address} kind="bot" />
          <Text className="text-[14px] font-bold" style={{ color: colors.ink }}>
            Dolphin Wallet
          </Text>
        </View>
        <View
          className="rounded-full px-2.5 py-1"
          style={{ backgroundColor: "#DCEFE4" }}
        >
          <Text className="text-[10px] font-bold" style={{ color: "#1C6A44" }}>
            {altana.networkLabel} · {altana.chainId}
          </Text>
        </View>
      </View>

      <View
        className="rounded-2xl border bg-white p-4"
        style={{ borderColor: colors.line, ...shadows.subtle }}
      >
        <Text
          className="text-[10px] font-bold uppercase tracking-wider"
          style={{ color: "#A5A79F" }}
        >
          Wallet address
        </Text>
        <View className="mt-1.5">
          <CopyRow label="Copy your Dolphin Wallet address" value={address} />
        </View>

        {/* Assets. Native BNB is the whole list on purpose: every Dolphin hire
            is free and a session's cap is denominated in native BNB, so no
            other token is involved in this app's flows. A padded-out token
            list would be decoration, not information. */}
        <View className="mt-4 flex-row items-center justify-between">
          <Text className="text-[13px] font-bold" style={{ color: colors.ink }}>
            Assets
          </Text>
          <PressableScale
            accessibilityLabel="Refresh balance"
            accessibilityRole="button"
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              altana.refreshBalance();
            }}
            containerStyle={{ paddingHorizontal: 6, paddingVertical: 4 }}
          >
            <Text className="text-[11px] font-bold" style={{ color: colors.muted }}>
              {altana.isReadingBalance ? "Reading…" : "Refresh"}
            </Text>
          </PressableScale>
        </View>

        <View
          className="mt-2 flex-row items-center justify-between rounded-2xl border px-3.5 py-3"
          style={{ borderColor: colors.line }}
        >
          <View className="flex-row items-center gap-3">
            <View
              className="h-9 w-9 items-center justify-center rounded-full"
              style={{ backgroundColor: "#FFFBEB" }}
            >
              <Text className="text-[13px] font-bold" style={{ color: "#D97706" }}>
                B
              </Text>
            </View>
            <View>
              <Text className="text-[13px] font-bold" style={{ color: colors.ink }}>
                BNB
              </Text>
              <Text className="text-[11px]" style={{ color: "#A5A79F" }}>
                {altana.networkLabel} · native
              </Text>
            </View>
          </View>
          <View className="items-end">
            {altana.balanceError ? (
              <>
                <Text className="text-[13px] font-bold" style={{ color: "#B9473A" }}>
                  Unavailable
                </Text>
                <Text className="text-[10px]" style={{ color: "#A5A79F" }}>
                  Balance could not be read
                </Text>
              </>
            ) : altana.balanceWei === null ? (
              <Text className="text-[13px] font-bold" style={{ color: "#A5A79F" }}>
                {altana.isReadingBalance ? "Reading…" : "Not read yet"}
              </Text>
            ) : (
              <>
                <Text className="text-[13px] font-bold" style={{ color: colors.ink }}>
                  {formatBnb(altana.balanceWei)}
                </Text>
                <Text className="text-[10px]" style={{ color: "#A5A79F" }}>
                  Read live from chain {altana.chainId}
                </Text>
              </>
            )}
          </View>
        </View>

        {/* The wallet is counterfactual and empty until funded, so a zero
            balance with no next step would be a dead end. */}
        {isEmptyBalance ? (
          <View
            className="mt-3.5 rounded-2xl border p-3.5"
            style={{ backgroundColor: "#FBF9F4", borderColor: colors.line }}
          >
            <Text className="text-[12px] font-bold" style={{ color: colors.ink }}>
              Fund this wallet
            </Text>
            <Text
              className="mt-1 text-[11px] leading-4"
              style={{ color: colors.muted }}
            >
              {ALTANA_FUNDING_HINT}
            </Text>
            <View className="mt-2.5">
              <CopyRow label="Copy the funding address" value={address} />
            </View>
          </View>
        ) : null}

        <View className="mt-3.5">
          <RecoverabilityBlock />
        </View>

        <View className="mt-3.5">
          <SeparateWalletNotice />
        </View>
      </View>

      {/*
       * --- granted permissions ---
       *
       * Gated off by FEATURE_SESSION_EXECUTION (see altana-policy.ts for the
       * full reasoning). `false &&` removes this from the rendered tree
       * entirely rather than disabling controls inside it, while keeping the
       * markup type-checked and one flag away from returning.
       *
       * Why it is off: a granted session's signing key never reaches an agent
       * and nothing in this app can execute with one, so this section listed
       * permissions no party could exercise - and the Grant button that fed it
       * charged real BNB in gas to create them.
       */}
      {FEATURE_SESSION_EXECUTION && (
      <>
      <Text
        className="mb-2.5 mt-5 text-[14px] font-bold"
        style={{ color: colors.ink }}
      >
        What you&apos;ve authorized
      </Text>

      {altana.sessions === undefined ? (
        // "Loading" is not "none": telling someone no agent can spend from
        // their wallet before the answer arrives is a claim, not a placeholder.
        <Text className="text-[12px]" style={{ color: colors.muted }}>
          Checking what you have authorized…
        </Text>
      ) : activeSessions.length === 0 ? (
        <View
          className="rounded-2xl border bg-white p-4"
          style={{ borderColor: colors.line, ...shadows.subtle }}
        >
          <View className="flex-row items-center gap-2">
            <CategoryGlyph color="#1C6A44" name="shield" size={16} />
            <Text className="text-[13px] font-bold" style={{ color: colors.ink }}>
              No agent can spend from this wallet
            </Text>
          </View>
          <Text
            className="mt-1.5 text-[11px] leading-4"
            style={{ color: colors.muted }}
          >
            You have granted no permissions. Agents hired for information only
            never appear here — they are never given spending authority in the
            first place.
          </Text>
        </View>
      ) : (
        <View className="gap-2.5">
          {activeSessions.map((session) => (
            <SessionRow
              disabled={altana.isBusy}
              key={session.sessionPublicKey}
              onRevoke={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                Alert.alert(
                  "Revoke permission",
                  `Stop ${session.agentName} from being able to spend from this wallet? This sends a transaction.`,
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Revoke",
                      style: "destructive",
                      onPress: () => {
                        void altana
                          .revokeSession(session.sessionPublicKey)
                          .catch((cause: unknown) =>
                            Alert.alert(
                              "Could not revoke",
                              toUserMessage(cause, "That action could not be completed. Try again."),
                            ),
                          );
                      },
                    },
                  ],
                );
              }}
              session={session}
            />
          ))}
        </View>
      )}
      </>
      )}
    </View>
  );
}
