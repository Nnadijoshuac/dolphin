import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";

import { AgentIcon } from "@/components/agent-icon";
import { Button } from "@/components/buttons";
import { NavigationButton } from "@/components/navigation-button";
import { PaymentCard } from "@/components/payment-card";
import { JobDeliveryCard } from "@/components/job-delivery-card";
import { StatePanel } from "@/components/state-panel";
import { StatusBadge } from "@/components/status-badge";
import { Surface } from "@/components/surface";
import { colors } from "@/constants/theme";
import { useAgentDetail } from "@/hooks/use-agents";
import { useHireReadOnlyAgent, useHiredAgents } from "@/hooks/use-hire-read-only-agent";
import { assessAuthorizationCapability } from "@/services/authorization";
import { assessHireability } from "@/services/hireability";
import { useAppStore } from "@/store/use-app-store";
import type { AgentCategory } from "@/types/agent";
import { canNegotiate } from "@/wallet/erc8183-policy";
import { WalletConnectButton, useWallet } from "@/wallet/wallet-provider";
import { useWalletSession } from "@/wallet/wallet-session";
import { toUserMessage } from "@/wallet/wallet-errors";

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
  // Whether this screen can actually sell anything. Mirrors the two conditions
  // convex/agentPayments.ts's requestQuote refuses on, so the screen never
  // offers a step the backend would reject. See services/hireability.ts.
  const hireable = agent ? assessHireability(agent).hireable : false;

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
        {/*
         * The header used to read "Review setup / No transaction will be
         * submitted". The second line stopped being true the moment this screen
         * could fund an ERC-8183 escrow, and a promise that no transaction will
         * happen - printed above a flow that submits one - is the most
         * consequential thing on this screen to get wrong.
         *
         * What is true, and is what the line says now: nothing moves until the
         * user approves an amount they have been shown.
         */}
        <View>
          <Text className="text-[17px] font-bold" style={{ color: colors.ink }}>
            {hireable ? "Hire this agent" : "Review agent"}
          </Text>
          <Text className="mt-0.5 text-[11px]" style={{ color: colors.muted }}>
            {hireable
              ? "Nothing is paid until you approve an amount"
              : "No transaction will be submitted"}
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

            <WalletReadiness />

            <ReadOnlyHireAction
              agent={agent}
              isWalletConnected={wallet.isConnected}
              onHired={() =>
                router.replace({ pathname: "/manage/[id]", params: { id: agent.tokenId } })
              }
              walletAddress={wallet.address}
            />

            {/* What happened after the money moved. Placed where the payment
                step leaves off, so the waiting state appears without any
                navigation. Renders nothing when there is no paid job for this
                agent, so the free-hire path is untouched. */}
            <JobDeliveryCard tokenId={agent.tokenId} />

            {/* The session-grant step used to sit here, gated now by
                FEATURE_SESSION_EXECUTION (see altana-policy.ts). Removed from
                the rendered tree rather than disabled: a granted session's key
                is never delivered to an agent and nothing in this app can
                execute with one, so offering it charged real gas for an
                unusable permission. */}

            {/*
             * Saving for later, demoted to a footnote.
             *
             * This used to be the LAST and visually heaviest thing on the
             * screen - an amber warning panel followed by the only full-width
             * button - which framed the entire flow as a preview even when a
             * real, payable hire was available directly above it. A bookmark is
             * a fine thing to offer; presenting it as the outcome of a hire
             * flow is what made the product look like it could not do anything.
             *
             * It stays honestly labelled: a preview is local to this device and
             * buys nothing, and the copy has always said so.
             */}
            <View
              className="mt-1 border-t pt-5"
              style={{ borderColor: colors.line }}
            >
              <Text className="text-[12px] leading-[18px]" style={{ color: colors.muted }}>
                {hireable
                  ? "Not ready to hire? Saving keeps this agent in My Agents on this device. It pays nothing, authorises nothing, and creates no escrow."
                  : "Saving keeps this agent in My Agents on this device so you can find it again. It pays nothing and authorises nothing."}
              </Text>
              <View className="mt-3">
                <Button
                  label={isSaved ? "Open saved agent" : "Save for later"}
                  onPress={handlePreview}
                  variant="secondary"
                />
              </View>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Connect, then prove it.
 *
 * These are two different things and the card keeps them visibly separate,
 * because until 2026-09-06 only the first existed and the backend treated it as
 * if it were the second. Connecting tells Dolphin an address; signing proves
 * the person holds its key. Only the second is something a hire record can be
 * written against - see src/wallet/wallet-session.tsx.
 *
 * The signature moves nothing and approves no spending, and that sentence is
 * inside the message the wallet displays rather than only here, so a user does
 * not have to take this screen's word for it.
 */
function WalletReadiness() {
  const wallet = useWallet();
  const session = useWalletSession();

  const body = (() => {
    if (!wallet.isConnected) {
      return (
        wallet.unavailableReason ??
        "Connect a BNB Chain wallet. Dolphin reads your public address and never asks for a private key."
      );
    }
    switch (session.status) {
      case "unavailable":
        return `Connected as ${shortAddress(wallet.address)}. This build has no Dolphin backend configured, so hires cannot be recorded.`;
      case "restoring":
      case "checking":
        return `Connected as ${shortAddress(wallet.address)}. Checking your sign-in…`;
      case "signed-in":
        return `Signed in as ${shortAddress(session.address)}. Dolphin has verified you control this address.`;
      default:
        return `Connected as ${shortAddress(wallet.address)}. One signature proves you control this address. It moves no funds and approves no spending.`;
    }
  })();

  return (
    <Surface gradient>
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-[15px] font-bold" style={{ color: colors.ink }}>
          Wallet
        </Text>
        <StatusBadge
          label={session.isSignedIn ? "Signed in" : wallet.isConnected ? "Not signed in" : "Not connected"}
          tone={session.isSignedIn ? "live" : "neutral"}
        />
      </View>

      <Text className="mt-2 text-[13px] leading-5" style={{ color: colors.muted }}>
        {body}
      </Text>

      {session.error ? (
        <Text className="mt-2 text-[12px] leading-4" style={{ color: colors.danger }}>
          {session.error}
        </Text>
      ) : null}

      <View className="mt-4 gap-2">
        <WalletConnectButton connectLabel="Connect BNB wallet" />
        {wallet.isConnected && !session.isSignedIn && session.status !== "unavailable" ? (
          <Button
            label={session.isSigningIn ? "Waiting for signature…" : "Sign in with wallet"}
            loading={session.isSigningIn}
            onPress={() => void session.signIn()}
          />
        ) : null}
      </View>
    </Surface>
  );
}

function AccessReview({
  category,
  walletAddress,
}: {
  category: AgentCategory;
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
  const hireability = assessHireability(agent);
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
        {/*
         * This badge was hardcoded "Unavailable". ERC-8183 payment is built and
         * works; what varies is whether THIS agent can be paid, which is a
         * property of the agent rather than of the rail.
         */}
        <StatusBadge
          label={hireability.hireable ? "Escrow available" : "Not available"}
          tone={hireability.hireable ? "live" : "unavailable"}
        />
      </View>
      <Text className="mt-3 text-[13px] leading-5" style={{ color: colors.muted }}>
        {hireability.hireable ? payment.reason : hireability.reason}
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
          {hireability.hireable
            ? "Neither ERC-8004 nor 8004scan carries a price field, so no figure here would be a real one. This agent publishes an endpoint that can be asked, and asking costs nothing and signs nothing - the price, the token and the payee all come back from the agent itself, and Dolphin checks the payee against its registered on-chain wallet before showing you anything."
            : "Hiring here records a subscription and costs nothing. The publisher may charge separately at its own endpoint - ERC-8004 and 8004scan expose no price field for Dolphin to read."}
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
  const session = useWalletSession();
  // Read against the CONNECTED address, deliberately: showing someone their own
  // existing hire is a read and needs no proof of ownership. Only the write
  // below requires a signed-in session.
  const hiredAgents = useHiredAgents(walletAddress);
  const [status, setStatus] = useState<"idle" | "hiring" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /**
   * The verified ERC-8183 job that paid for this hire, once PaymentCard has
   * one. Held here rather than read back from Convex so the hire can be
   * completed in the same interaction the payment finished in.
   */
  const [paidJobId, setPaidJobId] = useState<string | null>(null);

  const alreadyHired = hiredAgents?.some((hire) => hire.tokenId === agent.tokenId) ?? false;
  const priceModel =
    agent.priceModel.status === "live" || agent.priceModel.status === "stale"
      ? agent.priceModel.value
      : null;
  const priceIsFree = priceModel !== null && Number(priceModel.amount) === 0;
  const priceRequiresPayment = priceModel !== null && !priceIsFree;
  // A paid agent is hireable once, and only once, its payment is settled and
  // verified on-chain. Before that the button stays disabled - that is the
  // payment step not being done yet, not a refusal of the agent.
  const paymentOutstanding = priceRequiresPayment && paidJobId === null;
  // Offered for a real catalog price, or for an agent Dolphin could ask.
  const showPaymentStep =
    !alreadyHired && (priceRequiresPayment || canNegotiate(agent.services));

  const handleHire = async () => {
    // The address is no longer sent - the mutation derives it from the session -
    // so what has to be true here is that a session exists, not that an address
    // is known.
    if (!session.isSignedIn) return;
    if (paymentOutstanding) return;
    setStatus("hiring");
    setErrorMessage(null);
    try {
      await hireReadOnlyAgent(
        agent.tokenId,
        agent.category,
        priceModel,
        paidJobId,
      );
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onHired();
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        toUserMessage(error, "Could not complete the hire."),
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
      "Dolphin reads your public address to know whose hire this is. It never asks for a private key.";
  } else if (!session.isSignedIn) {
    tone = "amber";
    title = "Sign in to hire";
    body =
      "One signature proves you control this address, so the hire is recorded against a wallet Dolphin has verified rather than one it was merely told about. It moves no funds and grants no spending permission.";
  } else if (priceModel === null) {
    tone = "amber";
    title = "Waiting on published price";
    body = "This agent's price hasn't resolved yet. Try again once it loads.";
  } else if (paymentOutstanding) {
    tone = "amber";
    title = "Payment required first";
    body = `This agent charges ${priceModel.amount} ${priceModel.token}. Settle it in the payment step below - Dolphin verifies the escrow on-chain before it will record a paid hire.`;
  } else if (priceRequiresPayment) {
    tone = "mint";
    title = "Paid - ready to hire";
    body = `Escrow job #${paidJobId} is funded and was verified on-chain. Hiring records it against this address.`;
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
  const disabled = alreadyHired
    ? false
    : !session.isSignedIn || priceModel === null || paymentOutstanding;

  return (
    <View className="gap-4">
      <View className={`rounded-2xl border p-4 ${bannerStyle.border} ${bannerStyle.background}`}>
        <Text className={`text-[13px] font-bold ${bannerStyle.title}`}>{title}</Text>
        <Text className={`mt-1 text-[12px] leading-5 ${bannerStyle.body}`}>{body}</Text>
      </View>

      {/* The payment step, deliberately its own step rather than folded into
          the hire button. Offered when the catalog carries a real price OR
          when the agent publishes an endpoint that can be asked for one - see
          the decision note in erc8183-policy.ts for why the second condition
          is not a way of inventing a price but the opposite of one. */}
      {showPaymentStep ? (
        <PaymentCard
          agent={agent}
          onPaid={(job) => setPaidJobId(job.jobId)}
          priceAmount={priceModel?.amount ?? null}
          priceToken={priceModel?.token ?? null}
        />
      ) : null}

      <Button
        disabled={disabled}
        label={
          alreadyHired
            ? "Open in My Agents"
            : status === "hiring"
              ? "Hiring…"
              : priceRequiresPayment
                ? "Hire paid agent"
                : "Hire — Free"
        }
        loading={status === "hiring"}
        onPress={alreadyHired ? onHired : handleHire}
      />
    </View>
  );
}
