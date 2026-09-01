// ─────────────────────────────────────────────────────────
// FUTURE WORK — NOT LIVE IN THIS BUILD
// This implements the delegated-portfolio-management permission layer:
// spend caps, protocol allowlist, session duration. The permission
// plumbing is complete, but no execution path exists yet — a granted
// session's signing key is never delivered to an agent and never used
// by this app (see altana-storage.ts for why it's intentionally not
// persisted). Do not wire this to UI until key-custody and an
// agent-side execution runtime are designed.
// ─────────────────────────────────────────────────────────
//
// No caller renders this component today: app/hire/[id].tsx dropped its
// <SessionGrantCard> in the same change that added FEATURE_SESSION_EXECUTION.
// The guard below is a second line of defence, so re-adding the tag somewhere
// cannot quietly put a gas-charging Grant button back in front of a user
// without the flag also being flipped.

import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";

import { CategoryGlyph } from "@/components/category-glyph";
import { PressableScale } from "@/components/pressable-scale";
import { colors, shadows } from "@/constants/theme";
import type { Agent } from "@/types/agent";
import {
  DEFAULT_SESSION_DURATION_DAYS,
  DEFAULT_SPEND_CAP_WEI,
  FEATURE_SESSION_EXECUTION,
  SESSION_DURATION_CHOICES_DAYS,
  SPEND_CAP_CHOICES_WEI,
  formatBnb,
  sessionPolicyFor,
} from "@/wallet/altana-policy";
import { useAltanaWallet } from "@/wallet/altana-provider";
import { useWallet } from "@/wallet/wallet-provider";
import { toUserMessage } from "@/wallet/wallet-errors";

/**
 * The session-grant step of the mobile hire flow - the counterpart to the
 * website's session-grant-action.tsx, reading the same CATEGORY_SESSION_POLICY
 * so the two products can never offer different authority for the same agent.
 *
 * Rendered for every agent, including those that need no session: being told
 * "this agent needs no spending permission, and here is why" is the point, not
 * an omission.
 */
export function SessionGrantCard({ agent }: { agent: Agent }) {
  const altana = useAltanaWallet();
  const hirer = useWallet();
  const router = useRouter();
  const policy = sessionPolicyFor(agent.category);

  const [spendCapWei, setSpendCapWei] = useState<bigint>(DEFAULT_SPEND_CAP_WEI);
  const [durationDays, setDurationDays] = useState<number>(
    DEFAULT_SESSION_DURATION_DAYS,
  );
  const [isGranting, setIsGranting] = useState(false);

  const existing = (altana.sessions ?? []).find(
    (s) => s.tokenId === agent.tokenId && s.status === "active",
  );

  // See the banner at the top of this file. Placed after every hook, so this
  // is a legal early return rather than a conditional hook call.
  if (!FEATURE_SESSION_EXECUTION) return null;

  /* --- categories that honestly need no session -------------------------- */
  if (policy.kind === "read-only") {
    return (
      <View
        className="mt-3 rounded-2xl border p-3.5"
        style={{ backgroundColor: "#FBF9F4", borderColor: colors.line }}
      >
        <View className="flex-row items-center gap-2">
          <CategoryGlyph color="#1C6A44" name="shield" size={15} />
          <Text className="text-[12px] font-bold" style={{ color: colors.ink }}>
            No spending permission needed
          </Text>
        </View>
        <Text
          className="mt-1.5 text-[11px] leading-4"
          style={{ color: colors.muted }}
        >
          {policy.reason}
        </Text>
      </View>
    );
  }

  /* --- already granted --------------------------------------------------- */
  if (existing) {
    return (
      <View
        className="mt-3 rounded-2xl border p-3.5"
        style={{ backgroundColor: "#DCEFE4", borderColor: "#BFE0CC" }}
      >
        <View className="flex-row items-center gap-2">
          <CategoryGlyph color="#1C6A44" name="check" size={15} />
          <Text className="text-[12px] font-bold" style={{ color: "#1C6A44" }}>
            Spending permission active
          </Text>
        </View>
        <Text className="mt-1.5 text-[11px] leading-4" style={{ color: "#1C6A44" }}>
          Up to {formatBnb(BigInt(existing.spendCapWei))} BNB per{" "}
          {existing.spendPeriod}, and only against{" "}
          {existing.allowlist.map((c) => c.label).join(", ")}.
        </Text>
        <PressableScale
          accessibilityLabel="Revoke this spending permission"
          accessibilityRole="button"
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            Alert.alert(
              "Revoke permission",
              `Stop ${agent.name} from being able to spend from your Dolphin Wallet?`,
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Revoke",
                  style: "destructive",
                  onPress: () => {
                    void altana
                      .revokeSession(existing.sessionPublicKey)
                      .catch((cause: unknown) =>
                        Alert.alert(
                          "Could not revoke",
                          toUserMessage(cause, "That permission could not be revoked. Try again."),
                        ),
                      );
                  },
                },
              ],
            );
          }}
          containerStyle={{
            alignItems: "center",
            backgroundColor: "#FFFFFF",
            borderColor: "#BFE0CC",
            borderRadius: 12,
            borderWidth: 1,
            marginTop: 10,
            paddingVertical: 10,
          }}
        >
          <Text className="text-[12px] font-bold" style={{ color: "#1C6A44" }}>
            Revoke now
          </Text>
        </PressableScale>
      </View>
    );
  }

  /* --- no Dolphin Wallet yet --------------------------------------------- */
  if (altana.status !== "connected") {
    return (
      <View
        className="mt-3 rounded-2xl border p-3.5"
        style={{ backgroundColor: "#FFFBEB", borderColor: "#FDE68A" }}
      >
        <View className="flex-row items-center gap-2">
          <CategoryGlyph color="#D97706" name="wallet" size={15} />
          <Text className="text-[12px] font-bold" style={{ color: "#946B00" }}>
            This agent can be given a spending permission
          </Text>
        </View>
        <Text
          className="mt-1.5 text-[11px] leading-4"
          style={{ color: colors.muted }}
        >
          {policy.reason}
          {altana.status === "unsupported"
            ? ` ${altana.unsupportedReason}`
            : " That needs a Dolphin Wallet — a separate passkey account, not your browser extension wallet."}
        </Text>
        {altana.status === "unsupported" ? null : (
          <PressableScale
            accessibilityLabel="Go to the wallet screen to set up a Dolphin Wallet"
            accessibilityRole="button"
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push("/(tabs)/wallet");
            }}
            containerStyle={{
              alignItems: "center",
              backgroundColor: "#F5B300",
              borderRadius: 12,
              marginTop: 10,
              paddingVertical: 11,
            }}
          >
            <Text className="text-[12px] font-bold" style={{ color: colors.ink }}>
              Set up a Dolphin Wallet
            </Text>
          </PressableScale>
        )}
      </View>
    );
  }

  /* --- the grant step ---------------------------------------------------- */
  return (
    <View
      className="mt-3 rounded-2xl border bg-white p-3.5"
      style={{ borderColor: colors.line, ...shadows.subtle }}
    >
      <View className="flex-row items-center gap-2">
        <CategoryGlyph color="#D97706" name="shield" size={15} />
        <Text className="text-[12px] font-bold" style={{ color: colors.ink }}>
          Give this agent a spending permission
        </Text>
      </View>
      <Text className="mt-1.5 text-[11px] leading-4" style={{ color: colors.muted }}>
        {policy.reason}
      </Text>

      {/* Exactly what is being authorized, before anything is signed. */}
      <View
        className="mt-2.5 rounded-xl border p-3"
        style={{ backgroundColor: "#FBF9F4", borderColor: colors.line }}
      >
        <Text className="text-[11px]" style={{ color: colors.muted }}>
          It can only call
        </Text>
        {policy.allowlist.map((contract) => (
          <View key={contract.address}>
            <Text className="text-[11px] font-bold" style={{ color: colors.ink }}>
              {contract.label}
            </Text>
            <Text className="text-[10px]" style={{ color: "#A5A79F" }}>
              {contract.address}
            </Text>
          </View>
        ))}
        <View
          className="mt-2 flex-row justify-between border-t pt-2"
          style={{ borderColor: colors.line }}
        >
          <Text className="text-[11px]" style={{ color: colors.muted }}>
            Anything else
          </Text>
          <Text className="text-[11px] font-bold" style={{ color: "#1C6A44" }}>
            Rejected on-chain
          </Text>
        </View>
      </View>

      <Text className="mt-3 text-[11px] font-bold" style={{ color: colors.ink }}>
        Most it can spend
      </Text>
      <View className="mt-1.5 flex-row gap-2">
        {SPEND_CAP_CHOICES_WEI.map((choice) => {
          const selected = spendCapWei === choice.wei;
          return (
            <PressableScale
              accessibilityLabel={`Set the cap to ${choice.label}`}
              accessibilityRole="button"
              key={choice.label}
              onPress={() => setSpendCapWei(choice.wei)}
              containerStyle={{
                alignItems: "center",
                backgroundColor: selected ? "#FFFBEB" : "#FFFFFF",
                borderColor: selected ? "#F5B300" : colors.line,
                borderRadius: 10,
                borderWidth: 1,
                flex: 1,
                paddingVertical: 9,
              }}
            >
              <Text
                className="text-[10px] font-bold"
                style={{ color: selected ? "#946B00" : colors.muted }}
              >
                {choice.label}
              </Text>
            </PressableScale>
          );
        })}
      </View>

      <Text className="mt-3 text-[11px] font-bold" style={{ color: colors.ink }}>
        Permission expires after
      </Text>
      <View className="mt-1.5 flex-row gap-2">
        {SESSION_DURATION_CHOICES_DAYS.map((days) => {
          const selected = durationDays === days;
          return (
            <PressableScale
              accessibilityLabel={`Expire after ${days} days`}
              accessibilityRole="button"
              key={days}
              onPress={() => setDurationDays(days)}
              containerStyle={{
                alignItems: "center",
                backgroundColor: selected ? "#FFFBEB" : "#FFFFFF",
                borderColor: selected ? "#F5B300" : colors.line,
                borderRadius: 10,
                borderWidth: 1,
                flex: 1,
                paddingVertical: 9,
              }}
            >
              <Text
                className="text-[11px] font-bold"
                style={{ color: selected ? "#946B00" : colors.muted }}
              >
                {days} days
              </Text>
            </PressableScale>
          );
        })}
      </View>

      <Text
        className="mt-3 rounded-xl p-2.5 text-[10px] leading-4"
        style={{ backgroundColor: "#F5F3EB", color: colors.muted }}
      >
        You are authorizing at most {formatBnb(spendCapWei)} BNB per day for{" "}
        {durationDays} days, against the contract
        {policy.allowlist.length === 1 ? "" : "s"} listed above and nothing else.
        You can revoke it at any time from your wallet, and it stops working on
        its own when it expires.
      </Text>

      <PressableScale
        accessibilityLabel={`Grant a cap of ${formatBnb(spendCapWei)} BNB per day`}
        accessibilityRole="button"
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          setIsGranting(true);
          void altana
            .grantSession({
              tokenId: agent.tokenId,
              agentName: agent.name,
              category: agent.category,
              spendCapWei,
              durationDays,
              hirerWalletAddress: hirer.address,
            })
            .then(
              () => setIsGranting(false),
              (cause: unknown) => {
                setIsGranting(false);
                Alert.alert(
                  "Could not grant permission",
                  toUserMessage(cause, "That permission could not be granted. Try again."),
                );
              },
            );
        }}
        containerStyle={{
          alignItems: "center",
          backgroundColor: "#F5B300",
          borderRadius: 12,
          marginTop: 12,
          opacity: isGranting || altana.isBusy ? 0.6 : 1,
          paddingVertical: 12,
        }}
      >
        <Text className="text-[13px] font-bold" style={{ color: colors.ink }}>
          {isGranting
            ? "Confirm with your passkey…"
            : `Grant ${formatBnb(spendCapWei)} BNB / day`}
        </Text>
      </PressableScale>

      {/* This costs real BNB. Saying so before the button is pressed, not
          after it fails, is the difference between a bounded surprise and an
          unbounded one - see the mainnet decision in altana-policy.ts. */}
      <Text
        className="mt-2 text-center text-[10px] leading-4"
        style={{ color: "#A5A79F" }}
      >
        Granting is an on-chain transaction on BNB Smart Chain and costs gas
        from your Dolphin Wallet.
      </Text>
    </View>
  );
}
