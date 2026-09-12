"use client";

import { useAction, useMutation, useQuery as useConvexQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { CategoryGlyph } from "@/components/category-glyph";
import { agentRouteId } from "@/constants/agents";
import { JobDeliveryStatus } from "@/components/job-delivery-status";
import { PearlButton } from "@/components/pearl-button";
import { agentHiresApi, agentPaymentsApi, type AgentQuote } from "@/convex/api";
import { useHiredAgents } from "@/hooks/use-hired-agents";
import { usePriceText } from "@/hooks/use-price-text";
import { assessAuthorizationCapability } from "@/services/authorization";
import type { Agent } from "@/types/agent";
import { track } from "@/lib/analytics";
// Shared with the wallet screen's own recoverability panel on purpose: two
// cards denominated in BNB that round differently is the mismatch
// altana-policy.ts already warns about.
import { formatBnb } from "@/wallet/altana-policy";
import { toUserMessage } from "@/wallet/wallet-errors";
import { defaultTaskDescription } from "@/wallet/erc8183-policy";
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

/**
 * The three steps a hire runs through, in order. Only used to explain a
 * failure, so it is deliberately coarser than the progress labels.
 */
type HireStage = "identity" | "payment" | "record";

/**
 * What to say when the thrown error carried nothing renderable of its own.
 *
 * Only reached when `toUserMessage` finds no usable text, which after the
 * 2026-09-12 change to wallet-errors.ts is rare - a viem or Altana failure now
 * arrives with its own `shortMessage` and says what actually went wrong. These
 * are the last resort, and each one is scoped to a step so it cannot assert
 * something about a step that never ran.
 */
const HIRE_STAGE_FALLBACK: Readonly<Record<HireStage, string>> = {
  identity:
    "Dolphin could not confirm your wallet, so nothing was signed and nothing was spent. Try again.",
  /*
   * Deliberately does NOT say "nothing was spent".
   *
   * This step funds an on-chain escrow and then records it. If the funding
   * batch succeeded and the verification after it did not, the money HAS moved
   * and telling the user otherwise would be the exact kind of plausible,
   * comforting, unverified claim AGENTS.md §5 exists to stop. It points at the
   * wallet's own activity instead, which is the only authority on this.
   */
  payment:
    "Paying this agent did not finish. Check your Dolphin Wallet's activity before trying again, in case the escrow was funded.",
  record:
    "The hire could not be recorded. Try again.",
};

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
    // The stage is carried so the error can offer the action that fixes it -
    // a payment refusal is almost always "fund the wallet", and the deposit
    // flow with a copyable address already exists on the wallet screen.
    | { kind: "error"; message: string; stage: HireStage }
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

  /*
   * "Still reading" and "cannot read" are different claims, and only one of
   * them gets better by waiting. The old code said "Syncing price…" for both,
   * so a failed read left the panel spinning forever on a price it was never
   * going to show.
   */
  const priceUnreadableText =
    tokenMeta.status === "unavailable" ? "Price unavailable" : "Syncing price…";

  /*
   * `tokenDecimals: 0` and `tokenSymbol: ""` are how convex/lib/probe.ts
   * records "not read yet" - it refuses to store a guess for either, since a
   * fabricated number on a PRICE is where AGENTS.md §5 bites hardest - so
   * falsy here means MISSING, not a real zero-decimals token. For every paid
   * agent in this catalog that makes the live read below the only source of
   * what the user is about to pay.
   */
  const liveToken = tokenMeta.status === "ready" ? tokenMeta.metadata : null;
  const chargedRaw =
    agent.pricing?.amountRaw && Number(agent.pricing.amountRaw) > 0
      ? agent.pricing.amountRaw
      : priceModel?.token?.startsWith("0x") && Number(priceModel.amount) > 0
        ? priceModel.amount
        : null;

  /*
   * PRICED IN DOLLARS (2026-09-12).
   *
   * This used to render "1.2 U" and that is not a price to anybody who has not
   * looked up what $U is worth - it is a quantity of a thing. The dollar
   * figure is the only form of this number a person can weigh against anything
   * else they might buy, and deciding whether to spend is the entire job of
   * this line.
   *
   * usePriceText falls back to the token amount, unchanged, whenever no rate
   * can be read. There is no estimate and no last-known price in between.
   */
  const usdPrice = usePriceText({
    amountRaw: chargedRaw,
    token: tokenAddress,
    decimals: agent.pricing?.tokenDecimals || liveToken?.decimals || null,
    symbol:
      agent.pricing?.tokenSymbol ||
      liveToken?.symbol ||
      (tokenAddress ? shortAddress(tokenAddress) : null),
  });

  const priceText = (() => {
    if (agent.protocol === "mcp") return "Free to Connect";

    const isFreeQuote =
      chargedRaw === null &&
      (priceModel === null || Number(priceModel.amount) === 0);

    if (chargedRaw !== null) {
      if (usdPrice.status === "usd" || usdPrice.status === "token") return usdPrice.text;
      if (usdPrice.status === "loading") return "Syncing price…";
      // The seller's own display string is the last resort rather than the
      // first: it is free text they chose, so it can say anything, and a rate
      // Dolphin read itself beats a label somebody typed.
      return agent.pricing?.display ?? priceUnreadableText;
    }

    if (priceModel === null) return "Price not reported yet";
    if (isFreeQuote) return "Free to hire";

    // A quote denominated in something that is not a token address - a seller
    // naming a currency in words. Passed through as-is; there is nothing to
    // convert and nothing to verify.
    return `${priceModel.amount} ${priceModel.token}`;
  })();

  const priceIsFree =
    agent.protocol === "mcp" ||
    (agent.pricing
      ? Number(agent.pricing.amountRaw) === 0
      : priceModel === null || Number(priceModel.amount) === 0);
  const priceRequiresPayment = !priceIsFree;

  /*
   * A PAYMENT WHOSE AMOUNT CANNOT BE SHOWN IS NOT OFFERED.
   *
   * Pressing Hire on a paid agent funds an escrow in the same interaction -
   * there is no separate confirmation step by design ("PAYING IS HIRING"
   * above). So the price beside the button is the ONLY place the user is told
   * what it costs, and when the token read fails there is no such place. The
   * button stayed enabled through all of this: a user could authorise a
   * payment of an amount the screen had just admitted it could not state.
   *
   * Free and MCP agents are unaffected - nothing is spent, so nothing needs
   * quoting.
   */
  const priceUnreadable = priceRequiresPayment && tokenMeta.status === "unavailable";

  /*
   * WHAT A FIRST PURCHASE REALLY COSTS, SAID BEFORE IT IS MADE.
   *
   * ---------------------------------------------------------------------------
   * WHY THIS ROW EXISTS (2026-09-12)
   * ---------------------------------------------------------------------------
   * The Altana relay prepends a KeyStore registration to a wallet's FIRST admin
   * intent, carrying its own BNB value (see readFirstActionSurcharge in
   * altana-policy.ts). Measured live it is ~0.00068 BNB against the ~0.00014 BNB
   * a 0.1 U hire converts - roughly FIVE TIMES the thing being bought.
   *
   * Until now nothing on this page said so. A user funded the wallet for the
   * price they could see, pressed Hire, and got a refusal. The cost was never
   * wrong - it buys something real, and the wallet screen has explained it for
   * a while - it was simply disclosed in the wrong place, after the decision
   * rather than before it.
   *
   * So it is a ROW BESIDE THE PRICE, not a warning and not an error. It is a
   * real line item on a first purchase, it is charged once per wallet ever, and
   * what it buys - a wallet a passkey can rebuild on another device - is worth
   * more than the hire is.
   *
   * Shown only for "unregistered", never for "unknown": a cost Dolphin has not
   * confirmed is one it must not put a number against (AGENTS.md §5). Free and
   * MCP agents never reach an admin intent from this button, so they never see
   * it either.
   */
  const needsWalletSetup =
    priceRequiresPayment && altana.recoverability === "unregistered";
  const walletSetupText = !needsWalletSetup
    ? null
    : altana.registrationFeeWei === null
      ? "Syncing…"
      : `${formatBnb(altana.registrationFeeWei)} BNB`;
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
        track("hire_failed", { agentKey: agent.agentKey, reason: "declined", stage: "identity" });
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
        track("hire_failed", { agentKey: agent.agentKey, reason: "declined", stage: "identity" });
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
    /*
     * WHICH STEP WAS RUNNING, so a failure can say so.
     *
     * Every failure used to fall back to "The hire could not be recorded",
     * including the ones that happened before recording was ever attempted.
     * On a paid hire that sentence was usually false and always unhelpful: a
     * quote that was declined, a wallet short of BNB and an escrow that never
     * funded all reported that the RECORD step failed, which is the one step
     * that had not run. The stage is tracked here rather than inferred in the
     * catch because only the try block knows how far it got.
     */
    let stage: HireStage = "identity";
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
        stage = "payment";
        const paid = await payForHire(identity.address);
        paymentJobId = paid.jobId;
        setPaidJobId(paid.jobId);
      }

      stage = "record";
      await recordHire(identity.sessionToken, paymentJobId);
    } catch (cause) {
      /*
       * The raw cause, once, for whoever has to diagnose this. `toUserMessage`
       * deliberately reduces it to one line, and a support conversation that
       * starts from that line alone has nothing to go on - there was no console
       * output on this path at all before.
       */
      console.error(`[hire:${stage}] ${agent.agentKey}`, cause);
      setState({
        kind: "error",
        message: toUserMessage(cause, HIRE_STAGE_FALLBACK[stage]),
        stage,
      });
      track("hire_failed", { agentKey: agent.agentKey, reason: "error", stage });
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
    if (priceModel === null || priceUnreadable) return "Price unavailable";
    return "Hire";
  })();

  /**
   * One line under the button, and only when there is something to say. The
   * five-branch notice this replaced explained the state the user was already
   * looking at; what is left is the two cases they cannot see for themselves.
   */
  const note = (() => {
    if (state.kind === "error") return state.message;
    if (priceUnreadable) {
      return tokenMeta.status === "unavailable"
        ? `${tokenMeta.reason} Reload in a moment; Dolphin will not start a payment it cannot price.`
        : null;
    }
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

      {/* The facts that bear on the decision, and on a first purchase there
          are two of them. */}
      <div className="mt-5 border-y border-line">
        <div className="flex items-baseline justify-between gap-4 py-3">
          <span className="text-xs text-muted">Price</span>
          <span className="text-sm font-semibold text-ink">
            {priceText}
          </span>
        </div>
        {walletSetupText ? (
          <div className="flex items-baseline justify-between gap-4 border-t border-line py-3">
            <span className="text-xs text-muted">One-time wallet setup</span>
            <span className="text-sm font-semibold text-ink">{walletSetupText}</span>
          </div>
        ) : null}
      </div>
      {walletSetupText ? (
        <p className="mt-3 text-xs leading-5 text-muted">
          Your first purchase also registers this wallet&rsquo;s key on BNB Chain, so your
          passkey can rebuild it on another device or after you clear this browser.
          Charged once and never again &mdash; later hires pay only the price above.
        </p>
      ) : null}

      <div className="mt-5">
        {showMyAgents ? (
          <Link
            className="interactive flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-line bg-paper px-5 text-sm font-semibold text-ink no-underline hover:bg-canvas"
            // The bare token id, like every other agent URL in the product.
            // See agentRouteId for why bare is correct on a read path.
            href={`/manage/${agentRouteId(agent.agentKey)}`}
          >
            Manage this hire
            <CategoryGlyph color="currentColor" name="arrow-right" size={16} strokeWidth={2} />
          </Link>
        ) : (
          <PearlButton
            aria-busy={busy}
            disabled={busy || priceModel === null || priceUnreadable}
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
            // `whitespace-pre-line` so an itemised refusal keeps its lines.
            // preflightBnbConversion breaks a shortfall into price, gas, held
            // and what to add - one per line is the whole point of it.
            className={`mt-3 whitespace-pre-line text-xs leading-5 ${
              state.kind === "error" ? "text-danger" : "text-muted"
            }`}
            role={state.kind === "error" ? "alert" : "status"}
          >
            {note}
          </p>
        ) : null}
        {/*
         * A refusal with somewhere to go.
         *
         * Every way the payment stage fails is answered on the wallet screen -
         * it holds the deposit banner with a copyable address, the live
         * balance, and the recoverability panel that explains the setup charge.
         * Naming an amount and leaving the user to find that themselves is half
         * an answer.
         */}
        {state.kind === "error" && state.stage === "payment" ? (
          <Link
            className="interactive mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-ink no-underline hover:underline"
            href="/wallet"
          >
            Open your Dolphin Wallet
            <CategoryGlyph color="currentColor" name="arrow-right" size={14} strokeWidth={2} />
          </Link>
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
