"use client";

import { useAction, useMutation, useQuery as useConvexQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { CategoryGlyph } from "@/components/category-glyph";
import { JobDeliveryStatus } from "@/components/job-delivery-status";
import { PearlButton } from "@/components/pearl-button";
import { agentHiresApi, agentPaymentsApi, type AgentQuote } from "@/convex/api";
import { useHiredAgents } from "@/hooks/use-hired-agents";
import { assessAuthorizationCapability } from "@/services/authorization";
import type { Agent } from "@/types/agent";
import { track } from "@/lib/analytics";
import { toUserMessage } from "@/wallet/wallet-errors";
import { defaultTaskDescription, formatTokenAmount } from "@/wallet/erc8183-policy";
import { useAltanaWallet, type PaidJob } from "@/wallet/altana-provider";
import { useTokenMetadata } from "@/hooks/use-token-metadata";
import { useWallet } from "@/wallet/wallet-provider";
import { useWalletSession } from "@/wallet/wallet-session";

function shortAddress(value: string | null) {
  if (!value) return "";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/**
 * Hiring an agent, as ONE action.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS REPLACED (2026-09-07)
 * ---------------------------------------------------------------------------
 * Hiring a free agent used to take three separate clicks on three separate
 * buttons, each of which replaced the last: "Connect Wallet", then (once
 * sign-in existed) "Sign in", then "Hire read-only agent". Every one of those
 * is a precondition of the same single intent - the user pressed a button that
 * said Hire and was answered with another button.
 *
 * Now the button says what it does and does all of it: connect if not
 * connected, sign in if not signed in, then record the hire. The wallet's own
 * prompts still appear - a connection and a signature are the wallet's to
 * approve, not ours to skip - but Dolphin asks for nothing extra in between.
 *
 * PAYING IS HIRING, on the paid path. There used to be a second click after the
 * escrow settled ("Hire paid agent"), which existed only because the payment
 * step and the hire step were built as two flows and bolted together. The
 * mobile app removed that on 2026-09-06 for the same reason; this is the
 * website catching up. Money moving is the strongest possible statement of
 * intent, and asking someone to confirm it afterwards implies it might not have
 * counted.
 *
 * WHAT WAS REMOVED FROM THE PANEL, and why it is not a loss: a four-row table
 * of Dolphin price / Hire access / Required transactions / Browser wallet, and
 * a five-branch notice paragraph. Of those, only the price bears on the
 * decision, and it stays. The rest is disclosure that already appears under
 * "What hiring this does" further up the same page - it was being repeated
 * next to the button, where it competed with the two things a person actually
 * reads: the price, and what the button will do.
 */

export function HireAction({ agent }: { agent: Agent }) {
  const router = useRouter();
  const wallet = useWallet();
  const session = useWalletSession();
  const altana = useAltanaWallet();
  const hire = useMutation(agentHiresApi.agentHires.hireReadOnlyAgent);
  const requestQuote = useAction(agentPaymentsApi.agentPayments.requestQuote);
  const hiredAgents = useHiredAgents(wallet.address);

  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "hiring"; label: string }
    | { kind: "done"; id: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  /**
   * The verified ERC-8183 job that paid for this hire. Held here rather than
   * waiting for a Convex query round trip so the hire completes in the same
   * interaction the payment finished in.
   */
  const [paidJobId, setPaidJobId] = useState<string | null>(null);

  const access = assessAuthorizationCapability(agent.category, "read_only_hire");
  const price = agent.priceModel;
  const priceModel =
    price.status === "live" || price.status === "stale" ? price.value : null;

  const tokenAddress =
    agent.pricing?.token ||
    (priceModel?.token?.startsWith("0x") ? priceModel.token : null);
  const tokenMeta = useTokenMetadata(tokenAddress);

  const priceText = (() => {
    if (agent.protocol === "mcp") return "Free to Connect";
    if (agent.pricing?.display) return agent.pricing.display;
    if (agent.pricing?.amountRaw && Number(agent.pricing.amountRaw) > 0) {
      if (!agent.pricing.tokenDecimals && !tokenMeta) {
        return "Syncing price…";
      }
      const decimals = agent.pricing.tokenDecimals || tokenMeta?.decimals || 0;
      const symbol =
        agent.pricing.tokenSymbol ||
        tokenMeta?.symbol ||
        shortAddress(agent.pricing.token);
      return `${formatTokenAmount(agent.pricing.amountRaw, decimals)} ${symbol}`;
    }
    if (priceModel === null) return "Price not reported yet";
    if (Number(priceModel.amount) === 0) return "Free to hire";

    if (priceModel.token.startsWith("0x")) {
      if (!tokenMeta) {
        return "Syncing price…";
      }
      return `${formatTokenAmount(priceModel.amount, tokenMeta.decimals)} ${tokenMeta.symbol}`;
    }

    return `${priceModel.amount} ${priceModel.token}`;
  })();

  const priceIsFree =
    agent.protocol === "mcp" ||
    (agent.pricing
      ? Number(agent.pricing.amountRaw) === 0
      : priceModel === null || Number(priceModel.amount) === 0);
  const priceRequiresPayment = !priceIsFree;
  const paidJobs = useConvexQuery(
    agentPaymentsApi.agentPayments.getJobsForAgent,
    altana.address ? { agentKey: agent.agentKey, altanaWalletAddress: altana.address } : "skip",
  );
  const settledPaymentJobId = paidJobId ?? paidJobs?.[0]?.jobId ?? null;
  const paymentOutstanding = priceRequiresPayment && settledPaymentJobId === null;
  const alreadyHired =
    hiredAgents?.some((record) => record.agentKey === agent.agentKey) ?? false;
  const showMyAgents = alreadyHired || state.kind === "done";

  async function ensureIdentity(): Promise<{ address: string; sessionToken: string } | null> {
    let address = wallet.address;
    if (!address) {
      setState({ kind: "hiring", label: "Check your wallet…" });
      address = await wallet.connect();
      if (!address) {
        setState({ kind: "idle" });
        track("hire_failed", { agentKey: agent.agentKey, reason: "declined" });
        return null;
      }
      track("wallet_connected", { connector: "identity", surface: "agent" });
    }

    let sessionToken = session.sessionToken;
    if (!sessionToken) {
      setState({ kind: "hiring", label: "Sign the message…" });
      sessionToken = await session.signIn(address);
      if (!sessionToken) {
        setState({ kind: "idle" });
        track("hire_failed", { agentKey: agent.agentKey, reason: "declined" });
        return null;
      }
      track("wallet_signed_in", { surface: "agent" });
    }

    return { address, sessionToken };
  }

  async function recordHire(sessionToken: string, jobId: string | null) {
    setState({ kind: "hiring", label: "Recording hire…" });
    const id = await hire({
      agentKey: agent.agentKey,
      sessionToken,
      priceModel,
      paymentJobId: jobId,
    });
    setState({ kind: "done", id: String(id) });
    track("hire_completed", {
      agentKey: agent.agentKey,
      category: agent.category,
      paid: jobId !== null,
    });
  }

  async function payForHire(hirerWalletAddress: string): Promise<PaidJob> {
    if (altana.status !== "connected") {
      if (altana.status === "no-wallet") {
        router.push("/wallet");
        throw new Error("Set up your Dolphin Wallet, fund it with BNB, then come back and press Hire.");
      }
      throw new Error(
        altana.unsupportedReason ??
          "Your Dolphin Wallet is still loading. Try again once it appears.",
      );
    }

    setState({ kind: "hiring", label: "Getting price…" });
    const quote = (await requestQuote({
      agentKey: agent.agentKey,
      taskDescription: defaultTaskDescription(agent.category, altana.address),
    })) as AgentQuote;

    setState({ kind: "hiring", label: "Checking funds…" });
    const conversion = await altana.quoteBnbPayment({
      agentKey: agent.agentKey,
      category: agent.category,
      quote,
      hirerWalletAddress,
    });

    setState({
      kind: "hiring",
      label: conversion ? "Converting and funding escrow…" : "Funding escrow…",
    });

    if (conversion) {
      return altana.payForAgentWithBnb({
        agentKey: agent.agentKey,
        category: agent.category,
        quote,
        hirerWalletAddress,
        maxBnbInWei: conversion.maxBnbWei,
      });
    }

    return altana.payForAgent({
      agentKey: agent.agentKey,
      category: agent.category,
      quote,
      hirerWalletAddress,
    });
  }

  /**
   * The whole hire, from whatever state the user is currently in.
   *
   * Each precondition is satisfied in place and its result used directly,
   * rather than being written to state and picked up on a later render. That is
   * not a style choice: immediately after `connect()` this component's
   * `wallet.address` is still null and after `signIn()` its
   * `session.sessionToken` is still null, because neither has re-rendered yet.
   * Passing the values along is what makes a single click possible at all.
   *
   * A null from either step means the user declined or it failed. Both already
   * put a reason on screen (`wallet.failure`, `session.error`), so this returns
   * quietly instead of stacking a second message on top of the real one.
   */
  async function runHire(jobId: string | null) {
    setState({ kind: "hiring", label: "Hiring…" });
    track("hire_started", {
      agentKey: agent.agentKey,
      category: agent.category,
      requiresPayment: priceRequiresPayment,
    });
    try {
      const identity = await ensureIdentity();
      if (!identity) return;

      let paymentJobId = jobId;
      if (priceRequiresPayment && paymentJobId === null) {
        const paid = await payForHire(identity.address);
        paymentJobId = paid.jobId;
        setPaidJobId(paid.jobId);
      }

      await recordHire(identity.sessionToken, paymentJobId);
    } catch (cause) {
      setState({
        kind: "error",
        message: toUserMessage(cause, "The hire could not be recorded. Try again."),
      });
      track("hire_failed", { agentKey: agent.agentKey, reason: "error" });
    }
  }

  const busy = state.kind === "hiring" || wallet.isConnecting || session.isSigningIn;

  /**
   * One label, describing the whole action rather than the next step of it.
   *
   * It deliberately does NOT read "Connect wallet" when disconnected. The
   * button hires; connecting is something it does on the way, and naming the
   * first sub-step is what made this feel like a process in the first place.
   */
  const label = (() => {
    if (state.kind === "hiring") {
      return state.label;
    }
    if (priceModel === null) return "Price unavailable";
    return "Hire";
  })();

  /**
   * One line under the button, and only when there is something to say. The
   * five-branch notice this replaced explained the state the user was already
   * looking at; what is left is the two cases they cannot see for themselves.
   */
  const note = (() => {
    if (state.kind === "error") return state.message;
    if (priceModel === null) {
      return "Dolphin will not assume a price while this agent's catalog value is unresolved, so it cannot record a hire yet.";
    }
    if (paymentOutstanding) {
      if (altana.status !== "connected") {
        return `This agent charges ${priceText}. Hire uses your Dolphin Wallet for escrow, so set it up and fund it with BNB before paying.`;
      }
      return `This agent charges ${priceText}. Press Hire and Dolphin will quote the agent, convert BNB if needed, fund escrow, then record the hire.`;
    }
    if (priceRequiresPayment && settledPaymentJobId !== null) {
      return "Escrow is already funded for this agent. Press Hire to attach it to your hire record.";
    }
    return null;
  })();

  return (
    <div className="surface-raised p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Hire</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-ink">
            {showMyAgents ? "Agent hired" : "Add this agent"}
          </h2>
        </div>
        <span
          className={`mt-1 inline-flex items-center gap-1.5 text-xs font-medium ${
            showMyAgents ? "text-success" : "text-muted"
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${
              showMyAgents ? "bg-success" : "bg-faint-mark"
            }`}
          />
          {showMyAgents ? "Hired" : "Not hired"}
        </span>
      </div>

      <p className="mt-4 text-sm leading-6 text-muted">{access.reason}</p>

      {/* The one fact that bears on the decision. */}
      <div className="mt-5 flex items-baseline justify-between gap-4 border-y border-line py-3">
        <span className="text-xs text-muted">Price</span>
        <span className="text-sm font-semibold text-ink">
          {priceText}
        </span>
      </div>

      <div className="mt-5">
        {showMyAgents ? (
          <Link
            className="interactive flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-line bg-paper px-5 text-sm font-semibold text-ink no-underline hover:bg-canvas"
            href={`/manage/${agent.tokenId}`}
          >
            Manage this hire
            <CategoryGlyph color="currentColor" name="arrow-right" size={16} strokeWidth={2} />
          </Link>
        ) : (
          <PearlButton
            aria-busy={busy}
            disabled={busy || priceModel === null}
            onClick={() => void runHire(settledPaymentJobId)}
            type="button"
          >
            {label}
          </PearlButton>
        )}
        {state.kind === "done" ? (
          <p className="mt-3 font-mono text-[0.68rem] text-success">
            Hire record #{state.id}
          </p>
        ) : null}
        {note ? (
          <p
            className={`mt-3 text-xs leading-5 ${
              state.kind === "error" ? "text-danger" : "text-muted"
            }`}
            role={state.kind === "error" ? "alert" : "status"}
          >
            {note}
          </p>
        ) : null}
        {/*
         * Sign-in is not its own button any more, but its failures still have
         * to be readable - a declined signature otherwise looks like a button
         * that did nothing. Wallet connection failures render themselves inside
         * WalletConnectButton elsewhere on the page.
         */}
        {session.error && state.kind !== "error" ? (
          <p className="mt-3 text-xs leading-5 text-danger" role="alert">
            {session.error}
          </p>
        ) : null}
      </div>

      {/*
       * What happened after the money moved. The main Hire button now owns
       * payment and hire recording, so the delivery state stays directly under
       * that control instead of living in a separate payment panel.
       */}
      <JobDeliveryStatus agentKey={agent.agentKey} />

      {/*
       * The session-grant step used to sit here, gated now by
       * FEATURE_SESSION_EXECUTION (see altana-policy.ts). It is removed from
       * the rendered tree rather than disabled: a granted session's key is
       * never delivered to an agent and nothing in this app can execute with
       * one, so offering it charged real gas for an unusable permission.
       */}
    </div>
  );
}
