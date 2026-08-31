import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useAction, useQuery as useConvexQuery } from "convex/react";

import { Button } from "@/components/buttons";
import { api } from "../../convex/_generated/api";
import { colors } from "@/constants/theme";
import type { Agent } from "@/types/agent";
import {
  defaultTaskDescription,
  formatTokenAmount,
  fundingHint,
} from "@/wallet/erc8183-policy";
import { useAltanaWallet } from "@/wallet/altana-provider";
import { useWallet } from "@/wallet/wallet-provider";
import type { AgentJobRow, AgentQuote, PaidJob } from "@/wallet/altana-types";

/**
 * The payment step of the mobile hire flow - the counterpart to the website's
 * payment-action.tsx, driving the same Convex actions and the same wallet
 * method, so a paid hire cannot mean two different things on the two products.
 *
 * Rendered only for an agent that publishes a real non-zero price, which today
 * is none of them: Dolphin's catalog prices every agent at zero because no
 * publisher exposes a price field it can read. The step exists so that the
 * moment one does, both products can honour it.
 *
 * On a native build every path here ends in the same honest refusal the wallet
 * itself gives (React Native has no WebAuthn, so no passkey, so no signature).
 * The Expo WEB export - the build that is actually publicly reachable - runs
 * all of it for real.
 */
export function PaymentCard({
  agent,
  priceAmount,
  priceToken,
  onPaid,
}: {
  agent: Agent;
  /**
   * The agent's resolved catalog price, or null when the catalog carries none.
   * Null is the normal case today and is NOT treated as "free" - it means
   * Dolphin does not know what this agent charges, which is why this step's
   * whole job is to go and ask.
   */
  priceAmount: string | null;
  priceToken: string | null;
  onPaid: (job: PaidJob) => void;
}) {
  const altana = useAltanaWallet();
  const hirer = useWallet();
  const router = useRouter();
  const requestQuote = useAction(api.agentPayments.requestQuote);

  const [task, setTask] = useState(() =>
    defaultTaskDescription(agent.category, altana.address),
  );
  const [quote, setQuote] = useState<AgentQuote | null>(null);
  const [balanceRaw, setBalanceRaw] = useState<bigint | null>(null);
  const [paid, setPaid] = useState<PaidJob | null>(null);
  const [busy, setBusy] = useState<"idle" | "quoting" | "paying">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Null whenever the catalog has no price for this agent, which is every
  // agent today. Deliberately not defaulted to "free" or to a number.
  const catalogPrice =
    priceAmount !== null && priceToken !== null ? `${priceAmount} ${priceToken}` : null;

  const paidJobs = useConvexQuery(
    api.agentPayments.getJobsForAgent,
    altana.address
      ? { tokenId: agent.tokenId, altanaWalletAddress: altana.address }
      : "skip",
  ) as AgentJobRow[] | undefined;
  const settled = paid === null ? (paidJobs?.[0] ?? null) : null;

  /* --- already paid: the checkable evidence, not a claim ------------------ */
  if (settled) {
    return (
      <View
        className="mt-3 rounded-2xl border p-3.5"
        style={{ backgroundColor: "#F2FAF5", borderColor: "#BFE3CD" }}
      >
        <Text className="text-[12px] font-bold" style={{ color: "#1C6A44" }}>
          Payment settled
        </Text>
        <Text className="mt-1.5 text-[11px] leading-4" style={{ color: colors.muted }}>
          {formatTokenAmount(settled.budgetRaw, settled.paymentTokenDecimals)}{" "}
          {settled.paymentTokenSymbol} is held in ERC-8183 escrow for this agent.
          Dolphin read this job back off the chain to confirm it.
        </Text>
        <View className="mt-3 gap-1.5 border-t pt-3" style={{ borderColor: colors.line }}>
          <Row label="Job" value={`#${settled.jobId}`} />
          <Row label="On-chain status" value={settled.jobStatus} />
        </View>
      </View>
    );
  }

  /* --- paid in this session ---------------------------------------------- */
  if (paid) {
    return (
      <View
        className="mt-3 rounded-2xl border p-3.5"
        style={{ backgroundColor: "#F2FAF5", borderColor: "#BFE3CD" }}
      >
        <Text className="text-[12px] font-bold" style={{ color: "#1C6A44" }}>
          Paid — escrow funded
        </Text>
        <Text className="mt-1.5 text-[11px] leading-4" style={{ color: colors.muted }}>
          Job #{paid.jobId}, read back on-chain as {paid.jobStatus}.{" "}
          {paid.sellerAccepted
            ? "The agent accepted the job and is working on it."
            : "Dolphin told the agent its escrow is funded; it has not confirmed acceptance yet. " +
              "The escrow is on-chain either way and is refundable if it never delivers."}
        </Text>
      </View>
    );
  }

  /* --- no wallet: this step cannot happen here ---------------------------- */
  if (altana.status !== "connected") {
    return (
      <View
        className="mt-3 rounded-2xl border p-3.5"
        style={{ backgroundColor: "#FBF9F4", borderColor: colors.line }}
      >
        <Text className="text-[12px] font-bold" style={{ color: colors.ink }}>
          Dolphin Wallet required to pay
        </Text>
        <Text className="mt-1.5 text-[11px] leading-4" style={{ color: colors.muted }}>
          {catalogPrice
            ? `This agent charges ${catalogPrice}. `
            : "This agent sells its work over ERC-8183 escrow. "}
          Payment settles from the Dolphin Wallet, a separate passkey account from
          the connected browser wallet — the two do not share a balance.
        </Text>
        {altana.status === "unsupported" ? (
          <Text className="mt-2 text-[11px] leading-4" style={{ color: colors.danger }}>
            {altana.unsupportedReason}
          </Text>
        ) : (
          <View className="mt-3">
            <Button
              label="Set up Dolphin Wallet"
              onPress={() => router.push("/(tabs)/wallet")}
            />
          </View>
        )}
      </View>
    );
  }

  const handleQuote = async () => {
    setBusy("quoting");
    setErrorMessage(null);
    try {
      const result = (await requestQuote({
        tokenId: agent.tokenId,
        taskDescription: task,
      })) as AgentQuote;
      // The balance is read only once there is a quote, because only the quote
      // says which token to read. There is deliberately no token list here.
      try {
        const holding = await altana.readTokenBalance(result.paymentToken);
        setBalanceRaw(holding.raw);
      } catch {
        // Unreadable stays unreadable rather than becoming zero.
        setBalanceRaw(null);
      }
      setQuote(result);
    } catch (cause) {
      setErrorMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy("idle");
    }
  };

  const handlePay = async () => {
    if (!quote) return;
    setBusy("paying");
    setErrorMessage(null);
    try {
      const job = await altana.payForAgent({
        tokenId: agent.tokenId,
        category: agent.category,
        quote,
        hirerWalletAddress: hirer.address,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPaid(job);
      onPaid(job);
    } catch (cause) {
      setErrorMessage(cause instanceof Error ? cause.message : String(cause));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBusy("idle");
    }
  };

  /* --- a live quote is on screen ------------------------------------------ */
  if (quote) {
    const price = BigInt(quote.priceRaw);
    const canAfford = balanceRaw !== null && balanceRaw >= price;
    const shortBy = balanceRaw !== null && !canAfford ? price - balanceRaw : null;

    return (
      <View
        className="mt-3 rounded-2xl border p-3.5"
        style={{ backgroundColor: "#FBF9F4", borderColor: colors.line }}
      >
        <Text className="text-[12px] font-bold" style={{ color: colors.ink }}>
          The agent quoted this price
        </Text>
        {quote.deliverables ? (
          <Text className="mt-1.5 text-[11px] leading-4" style={{ color: colors.muted }}>
            {quote.deliverables}
          </Text>
        ) : null}

        <View className="mt-3 gap-1.5 border-t pt-3" style={{ borderColor: colors.line }}>
          <Row
            label="Price"
            value={`${formatTokenAmount(quote.priceRaw, quote.paymentTokenDecimals)} ${quote.paymentTokenSymbol}`}
          />
          <Row label="Paid to" value={quote.provider} />
          <Row label="Escrowed by" value={quote.verifyingContract} />
          <Row
            label="Your balance"
            tone={balanceRaw === null ? "muted" : canAfford ? "good" : "bad"}
            value={
              balanceRaw === null
                ? "Could not read"
                : `${formatTokenAmount(balanceRaw, quote.paymentTokenDecimals)} ${quote.paymentTokenSymbol}`
            }
          />
        </View>

        {shortBy !== null ? (
          <View className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3">
            <Text className="text-[11px] font-bold text-red-900">
              Not enough {quote.paymentTokenSymbol} to pay this
            </Text>
            <Text className="mt-1 text-[11px] leading-4 text-red-800">
              You need {formatTokenAmount(shortBy, quote.paymentTokenDecimals)} more{" "}
              {quote.paymentTokenSymbol}.{" "}
              {fundingHint(quote.paymentTokenSymbol, altana.address)}
            </Text>
          </View>
        ) : null}

        {errorMessage ? (
          <Text className="mt-3 text-[11px] leading-4" style={{ color: colors.danger }}>
            {errorMessage}
          </Text>
        ) : null}

        <View className="mt-3">
          <Button
            disabled={!canAfford || busy === "paying" || altana.isBusy}
            label={
              busy === "paying"
                ? "Confirm with passkey…"
                : `Pay ${formatTokenAmount(quote.priceRaw, quote.paymentTokenDecimals)} ${quote.paymentTokenSymbol}`
            }
            loading={busy === "paying"}
            onPress={() => void handlePay()}
          />
        </View>

        <Text className="mt-2 text-[10px] leading-4" style={{ color: colors.muted }}>
          Payment funds an on-chain ERC-8183 escrow. The agent is only paid once it
          delivers; an undelivered job is refundable to you after its deadline.
        </Text>
      </View>
    );
  }

  /* --- idle --------------------------------------------------------------- */
  return (
    <View
      className="mt-3 rounded-2xl border p-3.5"
      style={{ backgroundColor: "#FBF9F4", borderColor: colors.line }}
    >
      <Text className="text-[12px] font-bold" style={{ color: colors.ink }}>
        {catalogPrice ? "This agent charges for its work" : "Buy a task from this agent"}
      </Text>
      <Text className="mt-1.5 text-[11px] leading-4" style={{ color: colors.muted }}>
        {catalogPrice
          ? `Dolphin's catalog lists ${catalogPrice}. Ask the agent itself for a firm quote before paying anything — `
          : "Dolphin has no published price for this agent — ERC-8004 carries no price field, so no price here would be a real one. This agent does publish an endpoint that can be asked, and asking is free. "}
        The price, the token and the payee all come from the agent, and Dolphin
        checks the payee against its registered on-chain identity before showing
        you anything.
      </Text>

      <Text className="mt-3 text-[11px] font-bold" style={{ color: colors.ink }}>
        What are you asking it to do?
      </Text>
      <TextInput
        className="mt-2 rounded-xl border p-3 text-[11px]"
        multiline
        onChangeText={setTask}
        style={{ borderColor: colors.line, color: colors.ink, minHeight: 88 }}
        value={task}
      />
      <Text className="mt-1.5 text-[10px] leading-4" style={{ color: colors.muted }}>
        This text is written into the escrow job on-chain, so it is what the agent is
        held to.
      </Text>

      {errorMessage ? (
        <Text className="mt-3 text-[11px] leading-4" style={{ color: colors.danger }}>
          {errorMessage}
        </Text>
      ) : null}

      <View className="mt-3">
        <Button
          disabled={busy === "quoting" || task.trim().length === 0}
          label={busy === "quoting" ? "Asking the agent…" : "Get a price from this agent"}
          loading={busy === "quoting"}
          onPress={() => void handleQuote()}
        />
      </View>
      <Text className="mt-2 text-[10px] leading-4" style={{ color: colors.muted }}>
        Asking for a price costs nothing and signs nothing.
      </Text>
    </View>
  );
}

function Row({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "muted" | "good" | "bad";
}) {
  const color =
    tone === "good"
      ? "#1C6A44"
      : tone === "bad"
        ? colors.danger
        : tone === "muted"
          ? colors.muted
          : colors.ink;
  return (
    <View className="flex-row items-start justify-between gap-3">
      <Text className="text-[11px]" style={{ color: colors.muted }}>
        {label}
      </Text>
      <Text
        className="flex-1 text-right text-[11px] font-bold"
        numberOfLines={2}
        style={{ color }}
      >
        {value}
      </Text>
    </View>
  );
}
