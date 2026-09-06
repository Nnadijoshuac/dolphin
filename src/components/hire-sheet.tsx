import { useState } from "react";
import { Modal, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useAction } from "convex/react";

import { api } from "../../convex/_generated/api";
import { Button } from "@/components/buttons";
import { PressableScale } from "@/components/pressable-scale";
import { colors, radii, shadows } from "@/constants/theme";
import { useHireReadOnlyAgent } from "@/hooks/use-hire-read-only-agent";
import type { Agent } from "@/types/agent";
import { useAltanaWallet } from "@/wallet/altana-provider";
import type { AgentQuote } from "@/wallet/altana-types";
import {
  defaultTaskDescription,
  formatTokenAmount,
  fundingHint,
} from "@/wallet/erc8183-policy";
import { toUserMessage } from "@/wallet/wallet-errors";
import { WalletConnectButton, useWallet } from "@/wallet/wallet-provider";
import { useWalletSession } from "@/wallet/wallet-session";

/**
 * Hiring an agent, as a sheet rather than a destination.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS REPLACED A WHOLE ROUTE (2026-09-06)
 * ---------------------------------------------------------------------------
 * Hiring used to be `app/hire/[id].tsx` - a pushed screen the user navigated
 * away to, read four explainer cards on, and navigated back from. Nothing about
 * buying one job from one agent needs a page of its own. A page implies a
 * process; this is a decision with a price attached.
 *
 * So it is one button on the agent's page, and this sheet, which shows exactly
 * one thing at a time:
 *
 *   what is missing   connect a wallet / sign in / set up the paying wallet
 *   the price         asked of the agent itself, then shown with the payee
 *   the result        paid, recorded, and a way into My Agents
 *
 * Nothing here is a card inside a card. Every branch below renders a title, at
 * most two lines of explanation, and one control - because a person deciding
 * whether to spend money reads the number and the button, and everything else
 * on the screen is competing with those two things.
 *
 * The disclosures did not vanish: they live under "What hiring this does" on
 * the agent's page. What has to be read to make THIS decision - the price, who
 * receives it, and that it sits in escrow until the work lands - is here, next
 * to the button that spends it.
 */

type Stage =
  | { kind: "idle" }
  | { kind: "quoting" }
  | { kind: "quoted"; quote: AgentQuote; balanceRaw: bigint | null }
  | { kind: "paying"; quote: AgentQuote }
  | { kind: "done" };

export function HireSheet({
  agent,
  visible,
  onClose,
}: {
  agent: Agent;
  visible: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const wallet = useWallet();
  const session = useWalletSession();
  const altana = useAltanaWallet();
  const requestQuote = useAction(api.agentPayments.requestQuote);
  const hireAgent = useHireReadOnlyAgent();

  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [task, setTask] = useState(() =>
    defaultTaskDescription(agent.category, altana.address),
  );
  const [editingTask, setEditingTask] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const priceModel =
    agent.priceModel.status === "live" || agent.priceModel.status === "stale"
      ? agent.priceModel.value
      : null;

  const close = () => {
    setError(null);
    onClose();
  };

  const handleQuote = async () => {
    setStage({ kind: "quoting" });
    setError(null);
    try {
      const quote = (await requestQuote({
        tokenId: agent.tokenId,
        taskDescription: task,
      })) as AgentQuote;

      // The balance is read only once there is a quote, because only the quote
      // says which token to read. There is deliberately no token list here.
      let balanceRaw: bigint | null = null;
      try {
        balanceRaw = (await altana.readTokenBalance(quote.paymentToken)).raw;
      } catch {
        // Unreadable stays unreadable rather than becoming zero.
        balanceRaw = null;
      }

      setStage({ kind: "quoted", quote, balanceRaw });
    } catch (cause) {
      setStage({ kind: "idle" });
      setError(toUserMessage(cause, "Could not get a price from this agent."));
    }
  };

  const handlePay = async (quote: AgentQuote) => {
    setStage({ kind: "paying", quote });
    setError(null);
    try {
      const job = await altana.payForAgent({
        tokenId: agent.tokenId,
        category: agent.category,
        quote,
        hirerWalletAddress: wallet.address,
      });
      // Paying IS hiring. Recording it here rather than behind a second button
      // is the whole point: the money has moved, and asking for another tap
      // afterwards was a step that existed only because two flows were bolted
      // together.
      await hireAgent(agent.tokenId, agent.category, priceModel, job.jobId);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStage({ kind: "done" });
    } catch (cause) {
      setStage({ kind: "quoted", quote, balanceRaw: null });
      setError(toUserMessage(cause, "The payment could not be completed."));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={close}
      transparent
      visible={visible}
    >
      <PressableScale
        accessibilityLabel="Close"
        accessibilityRole="button"
        onPress={close}
        style={{ flex: 1 }}
        containerStyle={{ flex: 1, backgroundColor: colors.overlay }}
      >
        <View />
      </PressableScale>

      <View
        className="px-6 pb-9 pt-5"
        style={{
          backgroundColor: colors.canvas,
          borderTopLeftRadius: radii.xl,
          borderTopRightRadius: radii.xl,
          ...shadows.card,
        }}
      >
        <View
          className="mb-5 self-center rounded-full"
          style={{ backgroundColor: colors.line, height: 4, width: 40 }}
        />

        <Body
          agent={agent}
          altana={altana}
          editingTask={editingTask}
          error={error}
          onClose={close}
          onEditTask={() => setEditingTask(true)}
          onOpenManage={() => {
            close();
            router.push({
              pathname: "/manage/[id]",
              params: { id: agent.tokenId },
            });
          }}
          onOpenWallet={() => {
            close();
            router.push("/(tabs)/wallet");
          }}
          onPay={handlePay}
          onQuote={handleQuote}
          session={session}
          setTask={setTask}
          stage={stage}
          task={task}
          wallet={wallet}
        />
      </View>
    </Modal>
  );
}

/**
 * One branch, one job. Split out so the sheet above stays a shell and every
 * state below is readable on its own.
 */
function Body({
  agent,
  wallet,
  session,
  altana,
  stage,
  task,
  setTask,
  editingTask,
  onEditTask,
  error,
  onQuote,
  onPay,
  onOpenWallet,
  onOpenManage,
  onClose,
}: {
  agent: Agent;
  wallet: ReturnType<typeof useWallet>;
  session: ReturnType<typeof useWalletSession>;
  altana: ReturnType<typeof useAltanaWallet>;
  stage: Stage;
  task: string;
  setTask: (next: string) => void;
  editingTask: boolean;
  onEditTask: () => void;
  error: string | null;
  onQuote: () => Promise<void>;
  onPay: (quote: AgentQuote) => Promise<void>;
  onOpenWallet: () => void;
  onOpenManage: () => void;
  onClose: () => void;
}) {
  /* ── paid ─────────────────────────────────────────────────────────────── */
  if (stage.kind === "done") {
    return (
      <Layout
        title={`${agent.name} is hired`}
        body="Your payment is held in escrow and the agent has been told to start. You can follow it in My Agents."
      >
        <Button label="Open in My Agents" onPress={onOpenManage} />
      </Layout>
    );
  }

  /* ── things that must be true first ───────────────────────────────────── */
  if (!wallet.isConnected) {
    return (
      <Layout
        title="Connect your wallet"
        body={
          wallet.unavailableReason ??
          "Dolphin reads your public address and never asks for a private key."
        }
      >
        <WalletConnectButton connectLabel="Connect wallet" />
      </Layout>
    );
  }

  if (!session.isSignedIn) {
    return (
      <Layout
        title="Sign in to hire"
        body="One signature proves this wallet is yours. It moves no funds and approves no spending."
        error={session.error}
      >
        <Button
          label={session.isSigningIn ? "Check your wallet…" : "Sign in"}
          loading={session.isSigningIn}
          onPress={() => void session.signIn()}
        />
      </Layout>
    );
  }

  if (altana.status !== "connected") {
    return (
      <Layout
        title="Set up your Dolphin Wallet"
        body="Agents are paid from the Dolphin Wallet — a passkey account separate from the wallet you just connected. It takes one Face ID prompt."
        error={altana.status === "unsupported" ? altana.unsupportedReason : null}
      >
        {altana.status === "unsupported" ? (
          <Button label="Close" onPress={onClose} variant="secondary" />
        ) : (
          <Button label="Set up Dolphin Wallet" onPress={onOpenWallet} />
        )}
      </Layout>
    );
  }

  /* ── the price ────────────────────────────────────────────────────────── */
  if (stage.kind === "quoted" || stage.kind === "paying") {
    const { quote } = stage;
    const price = `${formatTokenAmount(quote.priceRaw, quote.paymentTokenDecimals)} ${quote.paymentTokenSymbol}`;
    const balanceRaw = stage.kind === "quoted" ? stage.balanceRaw : null;
    const canAfford = balanceRaw !== null && balanceRaw >= BigInt(quote.priceRaw);
    const shortBy =
      balanceRaw !== null && !canAfford ? BigInt(quote.priceRaw) - balanceRaw : null;

    return (
      <Layout title={agent.name} body={quote.deliverables ?? task}>
        <View
          className="mb-4 rounded-2xl border p-4"
          style={{ backgroundColor: colors.surface, borderColor: colors.line }}
        >
          <Text className="text-[11px] uppercase tracking-[0.8px]" style={{ color: colors.faint }}>
            This agent&apos;s price
          </Text>
          <Text className="mt-1 text-[28px] font-bold" style={{ color: colors.ink }}>
            {price}
          </Text>
          <Text className="mt-2 text-[11px] leading-4" style={{ color: colors.muted }}>
            Held in escrow on BNB Chain and released when the agent delivers.
            Refundable to you if it never does.
          </Text>
        </View>

        {shortBy !== null ? (
          <Text className="mb-3 text-[12px] leading-4" style={{ color: colors.danger }}>
            You need {formatTokenAmount(shortBy, quote.paymentTokenDecimals)} more{" "}
            {quote.paymentTokenSymbol}.{" "}
            {fundingHint(quote.paymentTokenSymbol, altana.address)}
          </Text>
        ) : null}

        {error ? (
          <Text className="mb-3 text-[12px] leading-4" style={{ color: colors.danger }}>
            {error}
          </Text>
        ) : null}

        <Button
          disabled={!canAfford || stage.kind === "paying" || altana.isBusy}
          label={stage.kind === "paying" ? "Confirm with Face ID…" : `Pay ${price}`}
          loading={stage.kind === "paying"}
          onPress={() => void onPay(quote)}
        />
      </Layout>
    );
  }

  /* ── the ask ──────────────────────────────────────────────────────────── */
  return (
    <Layout
      title={`Hire ${agent.name}`}
      body="Dolphin will ask this agent what it charges for the job below. Asking is free and signs nothing."
      error={error}
    >
      {editingTask ? (
        <TextInput
          className="mb-4 rounded-xl border p-3 text-[13px]"
          multiline
          onChangeText={setTask}
          style={{ borderColor: colors.line, color: colors.ink, minHeight: 88 }}
          value={task}
        />
      ) : (
        <PressableScale
          accessibilityLabel="Edit the job"
          accessibilityRole="button"
          onPress={onEditTask}
          containerStyle={{
            backgroundColor: colors.surfaceSubtle,
            borderColor: colors.line,
            borderRadius: radii.small,
            borderWidth: 1,
            marginBottom: 16,
            padding: 12,
          }}
        >
          <Text className="text-[12px] leading-[18px]" style={{ color: colors.muted }} numberOfLines={3}>
            {task}
          </Text>
          <Text className="mt-1.5 text-[11px] font-bold" style={{ color: colors.goldDark }}>
            Edit
          </Text>
        </PressableScale>
      )}

      <Button
        disabled={stage.kind === "quoting" || task.trim().length === 0}
        label={stage.kind === "quoting" ? "Asking the agent…" : "Get the price"}
        loading={stage.kind === "quoting"}
        onPress={() => void onQuote()}
      />
    </Layout>
  );
}

/** Title, at most two lines, one control. The only shape in this sheet. */
function Layout({
  title,
  body,
  error,
  children,
}: {
  title: string;
  body: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <View>
      <Text className="text-[20px] font-bold tracking-[-0.4px]" style={{ color: colors.ink }}>
        {title}
      </Text>
      <Text className="mb-5 mt-1.5 text-[13px] leading-[19px]" style={{ color: colors.muted }}>
        {body}
      </Text>
      {error ? (
        <Text className="mb-3 text-[12px] leading-4" style={{ color: colors.danger }}>
          {error}
        </Text>
      ) : null}
      {children}
    </View>
  );
}
