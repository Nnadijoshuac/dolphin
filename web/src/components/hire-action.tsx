"use client";

import { useMutation } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { CategoryGlyph } from "@/components/category-glyph";
import { JobDeliveryStatus } from "@/components/job-delivery-status";
import { PaymentAction } from "@/components/payment-action";
import { agentHiresApi } from "@/convex/api";
import { useHiredAgents } from "@/hooks/use-hired-agents";
import { assessAuthorizationCapability } from "@/services/authorization";
import type { Agent } from "@/types/agent";
import { toUserMessage } from "@/wallet/wallet-errors";
import { canNegotiate } from "@/wallet/erc8183-policy";
import { useWallet } from "@/wallet/wallet-provider";
import { useWalletSession } from "@/wallet/wallet-session";

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
  const wallet = useWallet();
  const session = useWalletSession();
  const hire = useMutation(agentHiresApi.agentHires.hireReadOnlyAgent);
  const hiredAgents = useHiredAgents(wallet.address);

  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "hiring" }
    | { kind: "done"; id: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  /**
   * The verified ERC-8183 job that paid for this hire, once PaymentAction has
   * one. Held here rather than read back from Convex so the hire completes in
   * the same interaction the payment finished in.
   */
  const [paidJobId, setPaidJobId] = useState<string | null>(null);

  const access = assessAuthorizationCapability(agent.category, "read_only_hire");
  const price = agent.priceModel;
  const priceModel =
    price.status === "live" || price.status === "stale" ? price.value : null;
  const priceIsFree = priceModel !== null && Number(priceModel.amount) === 0;
  const priceRequiresPayment = priceModel !== null && !priceIsFree;
  const paymentOutstanding = priceRequiresPayment && paidJobId === null;
  const alreadyHired =
    hiredAgents?.some((record) => record.agentKey === agent.agentKey) ?? false;
  const showMyAgents = alreadyHired || state.kind === "done";
  // Offered for a real catalog price, or for an agent Dolphin could ask.
  const showPaymentStep =
    !showMyAgents && (priceRequiresPayment || canNegotiate(agent.services));

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
    setState({ kind: "hiring" });
    try {
      let address = wallet.address;
      if (!address) {
        address = await wallet.connect();
        if (!address) {
          setState({ kind: "idle" });
          return;
        }
      }

      let token = session.sessionToken;
      if (!token) {
        token = await session.signIn(address);
        if (!token) {
          setState({ kind: "idle" });
          return;
        }
      }

      const id = await hire({
        agentKey: agent.agentKey,
        sessionToken: token,
        priceModel,
        paymentJobId: jobId,
      });
      setState({ kind: "done", id: String(id) });
    } catch (cause) {
      setState({
        kind: "error",
        message: toUserMessage(cause, "The hire could not be recorded. Try again."),
      });
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
      if (wallet.isConnecting) return "Check your wallet…";
      if (session.isSigningIn) return "Sign the message…";
      return "Hiring…";
    }
    if (priceModel === null) return "Price unavailable";
    if (paymentOutstanding) return "Pay to hire";
    return "Hire agent";
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
      return `This agent charges ${priceModel.amount} ${priceModel.token}. Settle it below — Dolphin verifies the escrow on-chain, and the hire is recorded the moment it does.`;
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
              showMyAgents ? "bg-success" : "bg-faint"
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
          {priceModel === null
            ? "Not resolved"
            : `${priceModel.amount} ${priceModel.token}`}
        </span>
      </div>

      <div className="mt-5">
        {showMyAgents ? (
          <Link
            className="interactive flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-line bg-paper px-5 text-sm font-semibold text-ink no-underline hover:bg-canvas"
            href="/my-agents"
          >
            Manage in My agents
            <CategoryGlyph color="currentColor" name="arrow-right" size={16} strokeWidth={2} />
          </Link>
        ) : (
          <button
            aria-busy={busy}
            className="interactive flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-semibold text-ink hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-paper-muted disabled:text-faint"
            disabled={busy || priceModel === null || paymentOutstanding}
            onClick={() => void runHire(paidJobId)}
            type="button"
          >
            {label}
          </button>
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

      {/* The payment step. Offered when the catalog carries a real price OR
          when the agent publishes an endpoint that can be asked for one - see
          the decision note in erc8183-policy.ts for why the second condition is
          not a way of inventing a price but the opposite of one. */}
      {showPaymentStep ? (
        <div className="mt-7 border-t border-line pt-6">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-faint">
            {priceRequiresPayment ? "Payment · required" : "Buy a task · optional"}
          </p>
          <PaymentAction
            agent={agent}
            /*
             * Paying IS hiring. The hire is recorded here, off the settled
             * escrow, instead of behind a second button the user had to find
             * after their money had already moved.
             */
            onPaid={(job) => {
              setPaidJobId(job.jobId);
              void runHire(job.jobId);
            }}
            priceAmount={priceModel?.amount ?? null}
            priceToken={priceModel?.token ?? null}
          />
        </div>
      ) : null}

      {/*
       * What happened after the money moved. Placed directly under the payment
       * step on purpose: this is where someone is standing the moment they pay,
       * so the waiting state has to appear here without any navigation. It
       * renders nothing at all when there is no paid job for this agent, so the
       * free-hire path is untouched.
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
