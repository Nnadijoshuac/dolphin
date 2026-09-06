import { useQuery } from "convex/react";
import { Alert, Linking, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "../../../convex/_generated/api";
import { AgentIcon } from "@/components/agent-icon";
import { Button } from "@/components/buttons";
import { CategoryGlyph, type GlyphName } from "@/components/category-glyph";
import { NavigationButton } from "@/components/navigation-button";
import { PressableScale } from "@/components/pressable-scale";
import { StatePanel } from "@/components/state-panel";
import { AGENT_CATEGORIES } from "@/constants/agents";
import { colors } from "@/constants/theme";
import { useAgentDetail } from "@/hooks/use-agents";
import { useCancelHire, useHiredAgents } from "@/hooks/use-hire-read-only-agent";
import { useAppStore } from "@/store/use-app-store";
import { useAltanaWallet } from "@/wallet/altana-provider";
import { formatTokenAmount } from "@/wallet/erc8183-policy";
import { useWallet } from "@/wallet/wallet-provider";
import { useWalletSession } from "@/wallet/wallet-session";
import { toUserMessage } from "@/wallet/wallet-errors";

function shortAddress(value: string) {
  return `${value.slice(0, 7)}…${value.slice(-5)}`;
}

function formatActivityDate(dateStr: string) {
  const ms = Date.parse(dateStr);
  if (Number.isNaN(ms)) return dateStr;
  const d = new Date(ms);
  return d.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

type ActivityEntry = {
  id: string;
  title: string;
  detail: string;
  date: string;
  icon: GlyphName;
  iconColor: string;
  iconBg: string;
  amount?: string | null;
  badge?: string;
  txHash?: string;
  sortAt: number;
};

export default function ManageAgentRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const wallet = useWallet();
  const altana = useAltanaWallet();
  const { data: agent, isLoading } = useAgentDetail(id);
  const previewHires = useAppStore((state) => state.previewHires);
  const removePreviewHire = useAppStore((state) => state.removePreviewHire);
  const preview = previewHires.find(
    (item) => item.agentId === id || item.agentId === agent?.tokenId,
  );
  const session = useWalletSession();
  const cancelHire = useCancelHire();
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const hiredAgents = useHiredAgents(wallet.address);
  const realHire = hiredAgents?.find(
    (hire) => hire.tokenId === id || hire.tokenId === agent?.tokenId,
  );

  const jobs = useQuery(
    api.agentPayments.getJobsForAgent,
    altana.address
      ? { tokenId: agent?.tokenId ?? id, altanaWalletAddress: altana.address }
      : "skip",
  );

  const handleRemove = () => {
    if (!preview) return;
    removePreviewHire(preview.agentId);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.replace("/(tabs)/my-agents");
  };

  /**
   * Confirms, then ends the hire.
   *
   * The confirmation names the one thing a user could reasonably get wrong -
   * that stopping a paid hire does not claw back the escrow - because that is
   * money, and finding out afterwards would be the worst moment to learn it.
   */
  const handleCancelHire = () => {
    const target = realHire;
    if (!target) return;

    Alert.alert(
      "Stop using this agent?",
      target.paymentJobId
        ? "It leaves My Agents. The escrow you already paid is not refunded - that payment is on-chain and bought work Dolphin cannot reverse."
        : "It leaves My Agents. Nothing on-chain changes, and you can hire it again at any time.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Stop using",
          style: "destructive",
          onPress: () => {
            setIsCancelling(true);
            setCancelError(null);
            void cancelHire(target.tokenId)
              .then(() => {
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                router.replace("/(tabs)/my-agents");
              })
              .catch((cause: unknown) => {
                setCancelError(toUserMessage(cause, "Could not stop this hire."));
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              })
              .finally(() => setIsCancelling(false));
          },
        },
      ],
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1" style={{ backgroundColor: colors.canvas }}>
        <View className="flex-1 justify-center px-5">
          <StatePanel
            body="Loading agent details..."
            state="syncing"
            title="Loading"
          />
        </View>
      </SafeAreaView>
    );
  }

  if (!preview && !realHire) {
    return (
      <SafeAreaView className="flex-1" style={{ backgroundColor: colors.canvas }}>
        <View className="px-5 pt-3">
          <NavigationButton onPress={() => router.back()} />
        </View>
        <View className="flex-1 justify-center px-5">
          <StatePanel
            body="No hire or preview is on record for this agent."
            state="empty"
            title="Nothing to manage"
          />
          <Button
            label="Browse agents"
            onPress={() => router.replace("/(tabs)/search")}
            style={{ marginTop: 18 }}
          />
        </View>
      </SafeAreaView>
    );
  }

  const category = agent?.category ?? "monitoring";
  const categoryLabel =
    AGENT_CATEGORIES.find((c) => c.slug === category)?.label ?? category;

  const isReal = Boolean(realHire);
  const targetId = agent?.tokenId ?? (realHire?.tokenId ?? preview?.agentId ?? id);
  const displayName =
    agent?.name ?? (realHire ? `Agent #${realHire.tokenId}` : `Agent #${preview?.agentId}`);
  const dateText = realHire
    ? `Hired ${formatActivityDate(realHire.hiredAt)}`
    : `Saved ${formatActivityDate(preview!.savedAt)}`;

  const handleOpenProfile = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: "/agent/[id]",
      params: { id: targetId },
    });
  };

  /**
   * The job that paid for this hire, if one did.
   *
   * Matched by the id recorded on the hire row itself, never by "the most
   * recent job for this agent": a wallet can pay the same agent more than
   * once, and only one of those payments is the one that bought this hire.
   */
  const payingJob =
    realHire && realHire.paymentJobId
      ? ((jobs ?? []).find((job) => job.jobId === realHire.paymentJobId) ?? null)
      : null;

  /**
   * What this hire cost, derived rather than asserted.
   *
   * This row used to be the literal string "Free" for every real hire,
   * including one whose `paymentJobId` points at an escrow job the backend had
   * verified on-chain - so the screen could print "Free" directly above an
   * "Escrow payment funded - 0.10 $U" row describing the same purchase. That
   * is a statement about someone's money the screen had not established, which
   * is exactly what AGENTS.md §5 exists to stop.
   *
   * The four outcomes are kept distinct on purpose. "Free" is a fact
   * (hireReadOnlyAgent writes a null paymentJobId only when nothing paid for
   * the hire). The other three are degrees of "paid, and here is how much of
   * that this screen can currently see" - never collapsed into "Free", and
   * never collapsed into each other.
   */
  const hirePriceText = (() => {
    if (!realHire) return "—";
    if (!realHire.paymentJobId) return "Free";
    if (payingJob) {
      try {
        return `${formatTokenAmount(
          payingJob.budgetRaw,
          payingJob.paymentTokenDecimals,
        )} ${payingJob.paymentTokenSymbol}`;
      } catch {
        return "Paid — amount unreadable";
      }
    }
    // getJobsForAgent is keyed on the Dolphin Wallet that funded the job, so
    // with that wallet disconnected there is nothing to match against. Say so,
    // rather than implying the hire was free.
    if (!altana.address) return "Paid — connect Dolphin Wallet for the amount";
    if (jobs === undefined) return "Paid — reading escrow…";
    return `Paid — job #${realHire.paymentJobId} not found`;
  })();

  const detailRows: readonly (readonly [string, string])[] = isReal
    ? [
        ["Status", realHire!.status === "active" ? "Active" : "Cancelled"],
        ["Category", categoryLabel],
        ["Wallet", shortAddress(realHire!.walletAddress)],
        ["Authorization", "Read-only"],
        ["Price", hirePriceText],
      ]
    : [
        ["Status", "Saved preview"],
        ["Category", categoryLabel],
        ["Authorization", "Read-only"],
      ];

  // Build unified agent activity list
  const activities: ActivityEntry[] = [];

  // 1. Paid escrow jobs on this wallet
  for (const job of jobs ?? []) {
    let amountStr: string | null = null;
    try {
      amountStr = `${formatTokenAmount(job.budgetRaw, job.paymentTokenDecimals)} ${job.paymentTokenSymbol}`;
    } catch {
      amountStr = null;
    }
    activities.push({
      id: `job-${job.jobId}`,
      title: "Escrow payment funded",
      detail: `ERC-8183 escrow · ${job.jobStatus.toLowerCase()}`,
      date: job.verifiedAt,
      icon: "wallet",
      iconColor: "#295C92",
      iconBg: "#DDE9F8",
      amount: amountStr,
      badge: job.jobStatus.toUpperCase(),
      txHash: job.transactionHash ?? undefined,
      sortAt: Date.parse(job.verifiedAt) || 0,
    });
  }

  // 2. On-chain execution actions from agent track record
  for (const [index, act] of (agent?.recentActivity ?? []).entries()) {
    activities.push({
      id: `exec-${act.timestamp}-${index}`,
      title: act.action,
      detail: act.source.label,
      date: act.timestamp,
      icon: category,
      iconColor: colors.ink,
      iconBg: "#F5F3EC",
      txHash: act.txHash,
      sortAt: Date.parse(act.timestamp) || 0,
    });
  }

  // 3. Own hire or saved preview event
  if (realHire) {
    activities.push({
      id: `hire-${realHire.tokenId}`,
      title: "Agent hired",
      detail: realHire.paymentJobId
        ? "Paid hire · ERC-8183 escrow"
        : "Free subscription · Connected to wallet",
      date: realHire.hiredAt,
      icon: "check",
      iconColor: "#1C6A44",
      iconBg: "#DCEFE4",
      badge: "Completed",
      sortAt: Date.parse(realHire.hiredAt) || 0,
    });
  } else if (preview) {
    activities.push({
      id: `preview-${preview.agentId}`,
      title: "Saved to preview",
      detail: "Local device setup",
      date: preview.savedAt,
      icon: "sparkle",
      iconColor: "#946B00",
      iconBg: "#FEF5D6",
      badge: "Saved",
      sortAt: Date.parse(preview.savedAt) || 0,
    });
  }

  activities.sort((a, b) => b.sortAt - a.sortAt);

  return (
    <SafeAreaView
      className="flex-1"
      edges={["top", "left", "right"]}
      style={{ backgroundColor: colors.canvas }}
    >
      <View className="flex-row items-center justify-between px-5 pb-3 pt-2">
        <NavigationButton onPress={() => router.back()} />
        <Text className="text-[16px] font-bold" style={{ color: colors.ink }}>
          {isReal ? "Manage hire" : "Manage preview"}
        </Text>
        <View className="h-[42px] w-[42px]" />
      </View>

      <ScrollView
        className="flex-1 px-5"
        contentContainerStyle={{ paddingBottom: 64, paddingTop: 4 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Agent Hero Banner - tapping icon or name navigates to agent profile */}
        <PressableScale
          accessibilityLabel={`View ${displayName} profile`}
          accessibilityRole="button"
          onPress={handleOpenProfile}
          containerStyle={{
            flexDirection: "row",
            alignItems: "center",
            gap: 14,
            paddingVertical: 10,
          }}
        >
          <AgentIcon category={category} size={62} uri={agent?.iconUrl} />
          <View className="min-w-0 flex-1">
            <View className="flex-row items-center gap-1.5">
              <Text
                className="text-[21px] font-bold tracking-tight flex-1"
                numberOfLines={1}
                style={{ color: colors.ink }}
              >
                {displayName}
              </Text>
              <CategoryGlyph color={colors.muted} name="chevron-right" size={15} />
            </View>
            <Text className="mt-1 text-[13px]" style={{ color: colors.muted }}>
              {dateText}
            </Text>
          </View>
        </PressableScale>

        {/* Details Section */}
        <View className="mt-7">
          <Text
            className="text-[14px] font-bold tracking-[-0.1px] pb-2.5"
            style={{ color: colors.ink }}
          >
            Details
          </Text>
          <View className="border-t" style={{ borderColor: colors.lineLight }}>
            {detailRows.map(([label, value]) => (
              <View
                className="flex-row items-center justify-between py-3 border-b"
                key={label}
                style={{ borderColor: colors.lineLight }}
              >
                <Text
                  className="text-[13.5px] font-medium"
                  style={{ color: colors.muted }}
                >
                  {label}
                </Text>
                <Text
                  className="text-[13.5px] font-semibold"
                  style={{ color: colors.ink }}
                >
                  {value}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Agent Activity Section */}
        <View className="mt-7">
          <Text
            className="text-[14px] font-bold tracking-[-0.1px] pb-2.5"
            style={{ color: colors.ink }}
          >
            Agent activity
          </Text>
          <View className="border-t" style={{ borderColor: colors.lineLight }}>
            {activities.map((item) => (
              <View
                key={item.id}
                className="flex-row items-center justify-between py-3 border-b gap-3.5"
                style={{ borderColor: colors.lineLight }}
              >
                <View
                  className="h-8 w-8 items-center justify-center rounded-full shrink-0"
                  style={{ backgroundColor: item.iconBg }}
                >
                  <CategoryGlyph color={item.iconColor} name={item.icon} size={15} />
                </View>

                <View className="flex-1 min-w-0">
                  <Text
                    className="text-[13.5px] font-semibold"
                    numberOfLines={1}
                    style={{ color: colors.ink }}
                  >
                    {item.title}
                  </Text>
                  <Text
                    className="text-[12px] mt-0.5"
                    numberOfLines={1}
                    style={{ color: colors.muted }}
                  >
                    {item.detail} · {formatActivityDate(item.date)}
                  </Text>
                </View>

                <View className="flex-row items-center gap-2 shrink-0">
                  {item.amount ? (
                    <Text
                      className="text-[13px] font-bold"
                      style={{ color: colors.ink }}
                    >
                      {item.amount}
                    </Text>
                  ) : item.badge ? (
                    <Text
                      className="text-[11.5px] font-semibold"
                      style={{
                        color:
                          item.badge === "Completed" || item.badge === "Active"
                            ? "#1C6A44"
                            : colors.muted,
                      }}
                    >
                      {item.badge}
                    </Text>
                  ) : null}

                  {item.txHash ? (
                    <PressableScale
                      accessibilityLabel="View transaction on BscScan"
                      accessibilityRole="button"
                      hitSlop={8}
                      onPress={() => {
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        void Linking.openURL(`https://bscscan.com/tx/${item.txHash}`);
                      }}
                      containerStyle={{ padding: 2 }}
                    >
                      <CategoryGlyph color={colors.muted} name="external" size={13} />
                    </PressableScale>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        </View>

        {/*
         * Ending the relationship. Both kinds have one now.
         *
         * A real hire had NO exit at all until 2026-09-06: agentHires has
         * carried a "cancelled" status since the table was defined and nothing
         * ever wrote it, so this screen - titled "Manage hire" - offered no way
         * to manage anything. In an app whose whole pitch is that the user stays
         * in control, the only irreversible action was the one they chose on
         * purpose.
         */}
        {realHire ? (
          <View className="mt-8">
            <Button
              disabled={isCancelling || !session.isSignedIn}
              label={isCancelling ? "Stopping…" : "Stop using this agent"}
              loading={isCancelling}
              onPress={handleCancelHire}
              variant="destructive"
            />
            <Text
              className="mt-2.5 text-center text-[11.5px] leading-4"
              style={{ color: colors.muted }}
            >
              {session.isSignedIn
                ? realHire.paymentJobId
                  ? "Removes this agent from My Agents. It does not refund the escrow you already paid — that money is on-chain and bought work Dolphin cannot reverse."
                  : "Removes this agent from My Agents. Nothing on-chain changes and you can hire it again later."
                : "Sign in with this wallet to stop a hire — Dolphin only accepts the instruction from the address that made it."}
            </Text>
            {cancelError ? (
              <Text
                className="mt-2 text-center text-[12px]"
                style={{ color: colors.danger }}
              >
                {cancelError}
              </Text>
            ) : null}
          </View>
        ) : preview ? (
          <View className="mt-8">
            <Button
              label="Remove preview"
              onPress={handleRemove}
              variant="destructive"
            />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
