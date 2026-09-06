import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";

import { AgentIcon } from "@/components/agent-icon";
import { Button } from "@/components/buttons";
import { CategoryGlyph } from "@/components/category-glyph";
import { NavigationButton } from "@/components/navigation-button";
import { PaymentCard } from "@/components/payment-card";
import { JobDeliveryCard } from "@/components/job-delivery-card";
import { PressableScale } from "@/components/pressable-scale";
import { StatePanel } from "@/components/state-panel";
import { colors, radii } from "@/constants/theme";
import { useAgentDetail } from "@/hooks/use-agents";
import { useHireReadOnlyAgent, useHiredAgents } from "@/hooks/use-hire-read-only-agent";
import { assessHireability } from "@/services/hireability";
import { useAppStore } from "@/store/use-app-store";
import { WalletConnectButton, useWallet } from "@/wallet/wallet-provider";
import { useWalletSession } from "@/wallet/wallet-session";
import { toUserMessage } from "@/wallet/wallet-errors";

/**
 * The hire sheet.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SCREEN USED TO BE, AND WHY IT WAS REBUILT (2026-09-06)
 * ---------------------------------------------------------------------------
 * It read as an audit report rather than a purchase. Before reaching any action
 * a user scrolled past four numbered explainer cards - "1. Identity",
 * "2. Access", "3. Payment", "Wallet readiness" - most of which restated facts
 * already on the agent's own page, and one of which printed three price rows
 * where two permanently said "Not published" and "Not verified".
 *
 * Two things were actively misleading rather than merely long:
 *
 *   THE MOST PROMINENT BUTTON SAID "DISCONNECT". WalletConnectButton renders
 *   the connected address as a dark full-width "Disconnect 0x1234…abcd", and it
 *   sat in the middle of the hire flow. The single loudest control on a screen
 *   for buying something was the one that undoes your wallet.
 *
 *   THERE WERE TWO WAYS TO HIRE, AND ONE DID NOTHING. A hireable agent got both
 *   a "Hire — Free" button and a separate payment step, because Dolphin's
 *   catalog prices every agent at zero while the agent itself quotes a real
 *   price over A2A. The free button wrote a database row and contacted nobody.
 *
 * The rebuilt screen has ONE path: say what you want, get a real price from the
 * agent, pay it into escrow, and the hire is recorded from that payment. The
 * honest disclosures are not deleted - they are collected into one disclosure
 * the user can open, because a wall of caveats nobody reads protects nobody.
 * What must be read to make the decision (the price, the payee, what the money
 * does) stays inline, next to the button that spends it.
 */

type AgentDetail = NonNullable<ReturnType<typeof useAgentDetail>["data"]>;

function shortAddress(value: string | null) {
  if (!value) return "Not connected";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export default function HireModalRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: agent, isError, isLoading } = useAgentDetail(id);
  const previewHires = useAppStore((state) => state.previewHires);
  const savePreviewHire = useAppStore((state) => state.savePreviewHire);
  const isSaved = previewHires.some(
    (preview) => preview.agentId === id || preview.agentId === agent?.tokenId,
  );
  const hireability = agent ? assessHireability(agent) : null;

  const handleSaveForLater = () => {
    if (!agent) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    savePreviewHire(agent.tokenId);
    router.replace({ pathname: "/manage/[id]", params: { id: agent.tokenId } });
  };

  return (
    <SafeAreaView
      className="flex-1"
      edges={["top", "left", "right"]}
      style={{ backgroundColor: colors.canvas }}
    >
      {/* One compact header. The agent is identified once, here, and not
          restated in a card below it. */}
      <View
        className="flex-row items-center gap-3 border-b px-5 pb-3 pt-2"
        style={{ borderColor: colors.line }}
      >
        {agent ? (
          <AgentIcon category={agent.category} size={38} uri={agent.iconUrl} />
        ) : null}
        <View className="min-w-0 flex-1">
          <Text
            className="text-[16px] font-bold"
            numberOfLines={1}
            style={{ color: colors.ink }}
          >
            {agent?.name ?? "Agent"}
          </Text>
          <Text className="text-[11px]" style={{ color: colors.muted }}>
            {agent ? `ERC-8004 #${agent.tokenId}` : "Loading"}
          </Text>
        </View>
        <NavigationButton kind="close" onPress={() => router.back()} />
      </View>

      <ScrollView
        className="flex-1 px-5"
        contentContainerStyle={{ paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          <View className="py-16">
            <StatePanel
              body="Resolving this agent's registry identity."
              state="syncing"
              title="Checking agent"
            />
          </View>
        ) : isError || !agent || !hireability ? (
          <View className="py-16">
            <StatePanel
              body="This agent could not be resolved from the registry."
              state="unavailable"
              title="Agent unavailable"
            />
          </View>
        ) : (
          <View className="gap-4 pt-4">
            <WalletRow />

            {hireability.hireable ? (
              <HireAction
                agent={agent}
                onHired={() =>
                  router.replace({
                    pathname: "/manage/[id]",
                    params: { id: agent.tokenId },
                  })
                }
              />
            ) : (
              <View
                className="rounded-2xl border p-4"
                style={{ backgroundColor: colors.surfaceSubtle, borderColor: colors.line }}
              >
                <Text className="text-[14px] font-bold" style={{ color: colors.ink }}>
                  Not hireable yet
                </Text>
                <Text
                  className="mt-1.5 text-[12px] leading-[18px]"
                  style={{ color: colors.muted }}
                >
                  {hireability.reason}
                </Text>
              </View>
            )}

            {/* Where the money went and what came back. Renders nothing until
                there is a job, so it costs no space on a first visit. */}
            <JobDeliveryCard tokenId={agent.tokenId} />

            <WhatHiringDoes hireable={hireability.hireable} />

            <PressableScale
              accessibilityLabel={isSaved ? "Open saved agent" : "Save for later"}
              accessibilityRole="button"
              onPress={handleSaveForLater}
              containerStyle={{ alignItems: "center", paddingVertical: 10 }}
            >
              <Text className="text-[13px] font-semibold" style={{ color: colors.muted }}>
                {isSaved ? "Open saved agent" : "Save for later"}
              </Text>
            </PressableScale>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * The wallet, as one line rather than a card.
 *
 * It shows a control ONLY when the user has to do something. Signed in, it is a
 * quiet status line - no button at all, and specifically not the "Disconnect
 * 0x…" that WalletConnectButton renders when connected, which is the wrong
 * thing to make prominent on a screen for buying something. Disconnecting still
 * exists, on the Wallet tab, where it belongs.
 */
function WalletRow() {
  const wallet = useWallet();
  const session = useWalletSession();

  if (session.isSignedIn) {
    return (
      <View className="flex-row items-center gap-2 px-1">
        <CategoryGlyph color={colors.success} name="check" size={14} strokeWidth={2.4} />
        <Text className="text-[12px]" style={{ color: colors.muted }}>
          Signed in as{" "}
          <Text style={{ color: colors.ink, fontWeight: "600" }}>
            {shortAddress(session.address)}
          </Text>
        </Text>
      </View>
    );
  }

  if (!wallet.isConnected) {
    return (
      <View
        className="rounded-2xl border p-4"
        style={{ backgroundColor: colors.surface, borderColor: colors.line }}
      >
        <Text className="text-[13px] font-bold" style={{ color: colors.ink }}>
          Connect your wallet
        </Text>
        <Text className="mt-1 text-[12px] leading-[18px]" style={{ color: colors.muted }}>
          {wallet.unavailableReason ??
            "Dolphin reads your public address and never asks for a private key."}
        </Text>
        <View className="mt-3">
          <WalletConnectButton connectLabel="Connect wallet" />
        </View>
      </View>
    );
  }

  return (
    <View
      className="rounded-2xl border p-4"
      style={{ backgroundColor: colors.surface, borderColor: colors.line }}
    >
      <Text className="text-[13px] font-bold" style={{ color: colors.ink }}>
        Sign in to continue
      </Text>
      <Text className="mt-1 text-[12px] leading-[18px]" style={{ color: colors.muted }}>
        One signature proves {shortAddress(wallet.address)} is yours. It moves no
        funds and approves no spending.
      </Text>
      {session.error ? (
        <Text className="mt-2 text-[12px] leading-4" style={{ color: colors.danger }}>
          {session.error}
        </Text>
      ) : null}
      <View className="mt-3">
        <Button
          label={session.isSigningIn ? "Check your wallet…" : "Sign in"}
          loading={session.isSigningIn}
          onPress={() => void session.signIn()}
        />
      </View>
    </View>
  );
}

/**
 * The one path to hiring: describe the task, get a real price from the agent,
 * pay it, done.
 *
 * The separate "Hire — Free" button is gone. It existed because Dolphin's
 * catalog prices every agent at zero, so the hire gate always saw a free agent
 * and offered a free hire - which wrote a row and contacted nobody, while the
 * real purchase sat underneath it as an optional-looking extra step. Paying IS
 * the hire now, and the hire is recorded from the verified payment rather than
 * needing a second tap.
 */
function HireAction({
  agent,
  onHired,
}: {
  agent: AgentDetail;
  onHired: () => void;
}) {
  const hireAgent = useHireReadOnlyAgent();
  const session = useWalletSession();
  const wallet = useWallet();
  // Read against the CONNECTED address deliberately: showing someone their own
  // existing hire is a read and needs no proof of ownership.
  const hiredAgents = useHiredAgents(wallet.address);
  const [status, setStatus] = useState<"idle" | "recording" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const alreadyHired =
    hiredAgents?.some((hire) => hire.tokenId === agent.tokenId) ?? false;
  const priceModel =
    agent.priceModel.status === "live" || agent.priceModel.status === "stale"
      ? agent.priceModel.value
      : null;

  if (alreadyHired) {
    return (
      <View
        className="rounded-2xl border p-4"
        style={{ backgroundColor: colors.mint, borderColor: "#BFE3CD" }}
      >
        <Text className="text-[13px] font-bold" style={{ color: colors.mintInk }}>
          You have hired this agent
        </Text>
        <View className="mt-3">
          <Button label="Open in My Agents" onPress={onHired} />
        </View>
      </View>
    );
  }

  if (!session.isSignedIn) {
    // The wallet row above already says what to do and offers the control.
    // Repeating it here was half the screen's redundancy.
    return null;
  }

  /**
   * Called the moment PaymentCard has an escrow job Dolphin verified on-chain.
   * The hire is recorded from it immediately - the user paid, which is the
   * whole act of hiring, and asking them to tap a second button afterwards was
   * a step that existed only because the two flows were bolted together.
   */
  const handlePaid = async (jobId: string) => {
    setStatus("recording");
    setErrorMessage(null);
    try {
      await hireAgent(agent.tokenId, agent.category, priceModel, jobId);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onHired();
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        toUserMessage(
          error,
          "Your payment went through, but Dolphin could not record the hire. Your escrow is unaffected.",
        ),
      );
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  return (
    <View>
      <PaymentCard
        agent={agent}
        onPaid={(job) => void handlePaid(job.jobId)}
        priceAmount={priceModel?.amount ?? null}
        priceToken={priceModel?.token ?? null}
      />

      {status === "recording" ? (
        <Text className="mt-3 text-[12px]" style={{ color: colors.muted }}>
          Recording your hire…
        </Text>
      ) : null}

      {errorMessage ? (
        <Text className="mt-3 text-[12px] leading-4" style={{ color: colors.danger }}>
          {errorMessage}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Every caveat this screen used to shout, collected into one thing the user can
 * open.
 *
 * Nothing here was deleted for being inconvenient - it was moved because four
 * separate warning cards ahead of the action is not more honest than one
 * disclosure behind it, it is just less likely to be read. The facts that bear
 * on the decision itself - the price, the payee, what the escrow does - stay
 * inline in PaymentCard, beside the button that spends the money.
 */
function WhatHiringDoes({ hireable }: { hireable: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <View
      className="rounded-2xl border"
      style={{ backgroundColor: colors.surface, borderColor: colors.line }}
    >
      <PressableScale
        accessibilityLabel="What hiring this does"
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setOpen((previous) => !previous);
        }}
        containerStyle={{
          alignItems: "center",
          borderRadius: radii.large,
          flexDirection: "row",
          justifyContent: "space-between",
          padding: 16,
        }}
      >
        <Text className="text-[13px] font-semibold" style={{ color: colors.ink }}>
          What hiring this does
        </Text>
        <CategoryGlyph
          color={colors.muted}
          name={open ? "chevron-left" : "chevron-right"}
          size={15}
        />
      </PressableScale>

      {open ? (
        <View className="gap-3 px-4 pb-4">
          {(hireable
            ? [
                [
                  "You pay for one job, not a subscription",
                  "The amount is fixed before you approve it. The agent cannot come back for more, and nothing in Dolphin can spend from your wallet on its behalf.",
                ],
                [
                  "The money sits in escrow",
                  "Payment funds an on-chain ERC-8183 escrow. The agent is paid when it delivers, and an undelivered job is refundable to you after its deadline.",
                ],
                [
                  "Dolphin checks who gets paid",
                  "The price, the token and the payee all come from the agent itself. Dolphin verifies the payee against the wallet registered in its on-chain ERC-8004 record before showing you anything.",
                ],
                [
                  "No key ever leaves your device",
                  "Dolphin never asks for a private key or a seed phrase.",
                ],
              ]
            : [
                [
                  "This agent cannot be hired through Dolphin",
                  "It has a real registry identity, but nothing published to reach it with. Saving it keeps it in My Agents on this device; it pays nothing and authorises nothing.",
                ],
                [
                  "No key ever leaves your device",
                  "Dolphin never asks for a private key or a seed phrase.",
                ],
              ]
          ).map(([title, body]) => (
            <View key={title}>
              <Text className="text-[12px] font-bold" style={{ color: colors.ink }}>
                {title}
              </Text>
              <Text
                className="mt-1 text-[12px] leading-[18px]"
                style={{ color: colors.muted }}
              >
                {body}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
