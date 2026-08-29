import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";

import { AgentIcon } from "@/components/agent-icon";
import { Button } from "@/components/buttons";
import { NavigationButton } from "@/components/navigation-button";
import { StatePanel } from "@/components/state-panel";
import { StatusBadge } from "@/components/status-badge";
import { Surface } from "@/components/surface";
import { colors } from "@/constants/theme";
import { useAgentDetail } from "@/hooks/use-agents";
import { useHireReadOnlyAgent, useHiredAgents } from "@/hooks/use-hire-read-only-agent";
import { assessAuthorizationCapability } from "@/services/authorization";
import { useAppStore } from "@/store/use-app-store";
import { WalletConnectButton, useWallet } from "@/wallet/wallet-provider";

type AgentDetail = NonNullable<ReturnType<typeof useAgentDetail>["data"]>;

function shortAddress(value: string | null) {
  if (!value) return "Not connected";
  return `${value.slice(0, 7)}…${value.slice(-5)}`;
}

export default function HireModalRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const wallet = useWallet();
  const { data: agent, isError, isLoading } = useAgentDetail(id);
  const previewHires = useAppStore((state) => state.previewHires);
  const savePreviewHire = useAppStore((state) => state.savePreviewHire);
  const isSaved = previewHires.some(
    (preview) => preview.agentId === id || preview.agentId === agent?.tokenId,
  );

  const handlePreview = () => {
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
      <View
        className="flex-row items-center justify-between border-b px-5 pb-3 pt-2"
        style={{ borderColor: colors.line }}
      >
        <View>
          <Text className="text-[17px] font-bold" style={{ color: colors.ink }}>
            Review setup
          </Text>
          <Text className="mt-0.5 text-[11px]" style={{ color: colors.muted }}>
            No transaction will be submitted
          </Text>
        </View>
        <NavigationButton kind="close" onPress={() => router.back()} />
      </View>

      <ScrollView
        className="flex-1 px-5"
        contentContainerStyle={{ paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          <View className="py-16">
            <StatePanel
              body="Resolving identity and capability evidence before setup."
              state="syncing"
              title="Checking agent"
            />
          </View>
        ) : isError || !agent ? (
          <View className="py-16">
            <StatePanel
              body="This agent could not be resolved from the current registry or editorial fallback."
              state="unavailable"
              title="Agent unavailable"
            />
          </View>
        ) : (
          <View className="gap-5 pt-5">
            <Surface>
              <View className="flex-row items-center gap-3">
                <AgentIcon category={agent.category} size={54} uri={agent.iconUrl} />
                <View className="min-w-0 flex-1">
                  <Text
                    className="text-[18px] font-bold"
                    numberOfLines={1}
                    style={{ color: colors.ink }}
                  >
                    {agent.name}
                  </Text>
                  <Text className="mt-1 text-[12px]" style={{ color: colors.muted }}>
                    ERC-8004 #{agent.tokenId} · {agent.category.replace("-", " ")}
                  </Text>
                </View>
                <StatusBadge
                  label={agent.recordStatus === "indexed" ? "Indexed" : "Fallback"}
                  tone={agent.recordStatus === "indexed" ? "indexed" : "neutral"}
                />
              </View>
            </Surface>

            <Surface>
              <Text className="text-[16px] font-bold" style={{ color: colors.ink }}>
                1. Identity
              </Text>
              <Text className="mt-2 text-[13px] leading-5" style={{ color: colors.muted }}>
                ERC-8004 identifies the publisher and metadata. It does not grant wallet
                authority or settle payment.
              </Text>
              <View className="mt-4 flex-row items-center justify-between border-t pt-4" style={{ borderColor: colors.line }}>
                <Text className="text-[12px]" style={{ color: colors.muted }}>
                  Registry check
                </Text>
                <StatusBadge
                  label={agent.registryVerification.registered.status}
                  tone={agent.registryVerification.registered.status}
                />
              </View>
            </Surface>

            <AccessReview category={agent.category} walletAddress={wallet.address} />
            <PaymentReview agent={agent} />

            <Surface gradient>
              <Text className="text-[15px] font-bold" style={{ color: colors.ink }}>
                Wallet readiness
              </Text>
              <Text className="mt-2 text-[13px] leading-5" style={{ color: colors.muted }}>
                {wallet.isConnected
                  ? `Connected as ${shortAddress(wallet.address)}. No signature is requested by this preview.`
                  : wallet.unavailableReason ??
                    "Connect a BNB Chain wallet to prepare for future verified flows."}
              </Text>
              <View className="mt-4">
                <WalletConnectButton connectLabel="Connect BNB wallet" />
              </View>
            </Surface>

            <ReadOnlyHireAction
              agent={agent}
              isWalletConnected={wallet.isConnected}
              onHired={() =>
                router.replace({ pathname: "/manage/[id]", params: { id: agent.tokenId } })
              }
              walletAddress={wallet.address}
            />

            <View className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <Text className="text-[13px] font-bold text-amber-900">
                Device preview only
              </Text>
              <Text className="mt-1 text-[12px] leading-5 text-amber-800">
                Saving adds this agent to My Agents on this device. It does not pay,
                authorize, start execution, create an Altana session, or create an
                ERC-8183 escrow.
              </Text>
            </View>

            <Button
              label={isSaved ? "Open saved preview" : "Save device preview"}
              onPress={handlePreview}
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function AccessReview({
  category,
  walletAddress,
}: {
  category: "monitoring" | "rebalancing" | "grid-trading" | "health-factor" | "yield";
  walletAddress: string | null;
}) {
  // Every category's real capability today is a read-only backend hire - no
  // category currently has a live action-session flow (Altana is blocked on
  // a missing WalletConnect-compatible signer, see authorization.ts).
  const assessment = assessAuthorizationCapability(category, "read_only_hire");

  return (
    <Surface>
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-[16px] font-bold" style={{ color: colors.ink }}>
          2. Access
        </Text>
        <StatusBadge
          label={assessment.available ? "Read-only available" : "Action unavailable"}
          tone={assessment.available ? "live" : "unavailable"}
        />
      </View>
      <Text className="mt-3 text-[13px] leading-5" style={{ color: colors.muted }}>
        {assessment.reason}
      </Text>
      <Text className="mt-2 text-[12px] leading-5" style={{ color: colors.muted }}>
        {assessment.nextStep}
      </Text>
      {assessment.available ? (
        <View className="mt-4 flex-row items-center justify-between border-t pt-4" style={{ borderColor: colors.line }}>
          <Text className="text-[12px]" style={{ color: colors.muted }}>
            Public address
          </Text>
          <Text className="text-[12px] font-bold" style={{ color: colors.ink }}>
            {shortAddress(walletAddress)}
          </Text>
        </View>
      ) : (
        <Text className="mt-4 text-[11px] leading-4" style={{ color: colors.danger }}>
          Dolphin will never ask you to import a private key as a workaround.
        </Text>
      )}
    </Surface>
  );
}

function PaymentReview({ agent }: { agent: AgentDetail }) {
  const payment = assessAuthorizationCapability(agent.category, "erc8183_hire");
  // Deliberately labeled as Dolphin's price, not the publisher's. The value
  // comes from DEFAULT_READ_ONLY_PRICE_MODEL (src/constants/agents.ts) and
  // describes what a hire here costs - it is not a price the publisher
  // published, because neither ERC-8004 nor 8004scan exposes one.
  const priceModel =
    agent.priceModel.status === "live" || agent.priceModel.status === "stale"
      ? agent.priceModel.value
      : null;
  const dolphinHirePrice =
    priceModel === null
      ? "Not resolved"
      : Number(priceModel.amount) === 0
        ? "Free"
        : `${priceModel.amount} ${priceModel.token}`;

  return (
    <Surface>
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-[16px] font-bold" style={{ color: colors.ink }}>
          3. Payment
        </Text>
        <StatusBadge label="Unavailable" tone="unavailable" />
      </View>
      <Text className="mt-3 text-[13px] leading-5" style={{ color: colors.muted }}>
        {payment.reason}
      </Text>
      <View className="mt-4 gap-3 border-t pt-4" style={{ borderColor: colors.line }}>
        <View className="flex-row justify-between">
          <Text className="text-[12px]" style={{ color: colors.muted }}>
            Dolphin hire price
          </Text>
          <Text className="text-[12px] font-bold" style={{ color: colors.ink }}>
            {dolphinHirePrice}
          </Text>
        </View>
        <View className="flex-row justify-between">
          <Text className="text-[12px]" style={{ color: colors.muted }}>
            Publisher price
          </Text>
          <Text className="text-[12px] font-bold" style={{ color: colors.ink }}>
            Not published
          </Text>
        </View>
        <View className="flex-row justify-between">
          <Text className="text-[12px]" style={{ color: colors.muted }}>
            Grant + hire estimate
          </Text>
          <Text className="text-[12px] font-bold" style={{ color: colors.ink }}>
            Not verified
          </Text>
        </View>
        <Text className="text-[11px] leading-4" style={{ color: colors.muted }}>
          Hiring here records a read-only subscription and costs nothing. The
          publisher may charge separately at its own endpoint - ERC-8004 and
          8004scan expose no price field for Dolphin to read.
        </Text>
      </View>
    </Surface>
  );
}

type HireBannerTone = "amber" | "coral" | "mint";

const HIRE_BANNER_STYLES: Record<
  HireBannerTone,
  { border: string; background: string; title: string; body: string }
> = {
  amber: {
    border: "border-amber-200",
    background: "bg-amber-50",
    title: "text-amber-900",
    body: "text-amber-800",
  },
  coral: {
    border: "border-red-200",
    background: "bg-red-50",
    title: "text-red-900",
    body: "text-red-800",
  },
  mint: {
    border: "border-emerald-200",
    background: "bg-emerald-50",
    title: "text-emerald-900",
    body: "text-emerald-800",
  },
};

/**
 * Real hire action for any category - backed by convex/agentHires.ts, not a
 * device-only preview. Generalized from a monitoring-only component: the
 * underlying hire is a read-only subscription (project-scope.md SS6/SS7) for
 * every category today, since no category has a live action-session flow
 * built yet. No session, spend cap, or signature, just a wallet address. A
 * non-zero priceModel is left disabled rather than faked - see
 * hireReadOnlyAgent's own rejection for why (no x402 seller-side integration
 * is wired up yet).
 */
function ReadOnlyHireAction({
  agent,
  walletAddress,
  isWalletConnected,
  onHired,
}: {
  agent: AgentDetail;
  walletAddress: string | null;
  isWalletConnected: boolean;
  onHired: () => void;
}) {
  const hireReadOnlyAgent = useHireReadOnlyAgent();
  const hiredAgents = useHiredAgents(walletAddress);
  const [status, setStatus] = useState<"idle" | "hiring" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const alreadyHired = hiredAgents?.some((hire) => hire.tokenId === agent.tokenId) ?? false;
  const priceModel =
    agent.priceModel.status === "live" || agent.priceModel.status === "stale"
      ? agent.priceModel.value
      : null;
  const priceIsFree = priceModel !== null && Number(priceModel.amount) === 0;
  const priceBlocksHire = priceModel !== null && !priceIsFree;

  const handleHire = async () => {
    if (!walletAddress) return;
    setStatus("hiring");
    setErrorMessage(null);
    try {
      await hireReadOnlyAgent(agent.tokenId, agent.category, walletAddress, priceModel);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onHired();
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Could not complete the hire.",
      );
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  let tone: HireBannerTone;
  let title: string;
  let body: string;

  if (alreadyHired) {
    tone = "mint";
    title = "Already hired";
    body =
      "This wallet is recorded as having hired this agent. Dolphin does not yet run live activity for it - see Manage.";
  } else if (!isWalletConnected) {
    tone = "amber";
    title = "Connect a wallet to hire";
    body =
      "Hiring this agent only needs your public wallet address - no signature, spend cap, or session is created.";
  } else if (priceModel === null) {
    tone = "amber";
    title = "Waiting on published price";
    body = "This agent's price hasn't resolved yet. Try again once it loads.";
  } else if (priceBlocksHire) {
    tone = "coral";
    title = "Payment required - not supported yet";
    body = `This agent charges ${priceModel.amount} ${priceModel.token}. Paid hiring isn't available in this build - no x402 seller-side integration is wired up.`;
  } else if (status === "error") {
    tone = "coral";
    title = "Hire failed";
    body = errorMessage ?? "Something went wrong.";
  } else {
    tone = "mint";
    title = "Free to hire";
    body =
      "This saves a real record of this wallet hiring this agent. It does not create a wallet session, spend cap, or execute any transaction.";
  }

  const bannerStyle = HIRE_BANNER_STYLES[tone];
  const disabled = alreadyHired ? false : !isWalletConnected || priceModel === null || priceBlocksHire;

  return (
    <View className="gap-4">
      <View className={`rounded-2xl border p-4 ${bannerStyle.border} ${bannerStyle.background}`}>
        <Text className={`text-[13px] font-bold ${bannerStyle.title}`}>{title}</Text>
        <Text className={`mt-1 text-[12px] leading-5 ${bannerStyle.body}`}>{body}</Text>
      </View>

      <Button
        disabled={disabled}
        label={alreadyHired ? "Open in My Agents" : status === "hiring" ? "Hiring…" : "Hire — Free"}
        loading={status === "hiring"}
        onPress={alreadyHired ? onHired : handleHire}
      />
    </View>
  );
}
