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
import { WalletConnectButton, useWallet } from "@/wallet/wallet-provider";

function shortAddress(value: string | null) {
  if (!value) return "Not connected";
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

export function HireAction({ agent }: { agent: Agent }) {
  const wallet = useWallet();
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
   * one. Held here rather than read back from Convex so the hire can be
   * completed in the same interaction the payment finished in.
   */
  const [paidJobId, setPaidJobId] = useState<string | null>(null);

  const access = assessAuthorizationCapability(agent.category, "read_only_hire");
  const price = agent.priceModel;
  const priceModel =
    price.status === "live" || price.status === "stale" ? price.value : null;
  const priceIsFree = priceModel !== null && Number(priceModel.amount) === 0;
  const priceRequiresPayment = priceModel !== null && !priceIsFree;
  // A paid agent is hireable once, and only once, its payment is settled and
  // verified. Before that the button stays disabled - it is not a refusal of
  // the agent, it is the payment step not being done yet.
  const paymentOutstanding = priceRequiresPayment && paidJobId === null;
  const alreadyHired =
    hiredAgents?.some((record) => record.tokenId === agent.tokenId) ?? false;
  const showMyAgents = alreadyHired || state.kind === "done";
  // Offered for a real catalog price, or for an agent Dolphin could ask.
  const showPaymentStep =
    !showMyAgents && (priceRequiresPayment || canNegotiate(agent.services));

  async function onHire() {
    if (!wallet.address || !priceModel) return;
    if (priceRequiresPayment && paidJobId === null) return;

    setState({ kind: "hiring" });
    try {
      const id = await hire({
        tokenId: agent.tokenId,
        category: agent.category,
        walletAddress: wallet.address,
        priceModel,
        paymentJobId: paidJobId,
      });
      setState({ kind: "done", id: String(id) });
    } catch (cause) {
      setState({
        kind: "error",
        message: toUserMessage(cause, "The hire could not be recorded. Try again."),
      });
    }
  }

  let noticeTitle = "Read-only hire";
  let noticeBody =
    "This creates a Dolphin hire record. It does not grant an agent permission to spend from either wallet.";

  if (showMyAgents) {
    noticeTitle = "Already in My agents";
    noticeBody = "This connected address already has a hire record for this agent.";
  } else if (!wallet.isConnected) {
    noticeTitle = "Connect an address to continue";
    noticeBody =
      "The browser wallet supplies the public address attached to the hire record. This step does not request spending permission.";
  } else if (priceModel === null) {
    noticeTitle = "Price policy unavailable";
    noticeBody =
      "Dolphin will not assume a price while the catalog value is unresolved.";
  } else if (paymentOutstanding) {
    noticeTitle = "Payment required first";
    noticeBody = `This agent publishes a price of ${priceModel.amount} ${priceModel.token}. Settle it in the payment step below — Dolphin verifies the escrow on-chain before it will record a paid hire.`;
  } else if (priceRequiresPayment) {
    noticeTitle = "Paid — ready to hire";
    noticeBody = `Escrow job #${paidJobId} is funded and was verified on-chain. Hiring records it against this address.`;
  } else if (state.kind === "error") {
    noticeTitle = "Hire failed";
    noticeBody = state.message;
  }

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

      <dl className="mt-6 border-t border-line text-xs">
        <div className="flex items-start justify-between gap-4 border-b border-line py-3">
          <dt className="text-muted">Dolphin price</dt>
          <dd className="text-right font-medium text-ink">
            {priceModel === null
              ? "Not resolved"
              : priceIsFree
                ? `0 ${priceModel.token}`
                : `${priceModel.amount} ${priceModel.token}`}
          </dd>
        </div>
        <div className="flex items-start justify-between gap-4 border-b border-line py-3">
          <dt className="text-muted">Hire access</dt>
          <dd className="text-right font-medium text-ink">Read-only record</dd>
        </div>
        <div className="flex items-start justify-between gap-4 border-b border-line py-3">
          <dt className="text-muted">Required transactions</dt>
          <dd className="text-right font-medium text-ink">{access.minimumTransactions}</dd>
        </div>
        <div className="flex items-start justify-between gap-4 border-b border-line py-3">
          <dt className="text-muted">Browser wallet</dt>
          <dd className="break-all text-right font-mono font-medium text-ink-soft">
            {shortAddress(wallet.address)}
          </dd>
        </div>
      </dl>

      <div className="mt-5 border-l-2 border-accent pl-4">
        <p className="text-xs font-semibold text-ink">{noticeTitle}</p>
        <p className="mt-1 text-xs leading-5 text-muted">{noticeBody}</p>
        {state.kind === "done" ? (
          <p className="mt-2 font-mono text-[0.68rem] text-success">
            Hire record #{state.id}
          </p>
        ) : null}
      </div>

      <div className="mt-6">
        {showMyAgents ? (
          <Link
            className="interactive flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-line bg-paper px-5 text-sm font-semibold text-ink no-underline hover:bg-canvas"
            href="/my-agents"
          >
            Manage in My agents
            <CategoryGlyph color="currentColor" name="arrow-right" size={16} strokeWidth={2} />
          </Link>
        ) : !wallet.isConnected ? (
          <WalletConnectButton connectLabel="Connect wallet to hire" />
        ) : (
          <button
            className="interactive flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-semibold text-ink hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-paper-muted disabled:text-faint"
            disabled={state.kind === "hiring" || priceModel === null || paymentOutstanding}
            onClick={() => void onHire()}
            type="button"
          >
            {state.kind === "hiring"
              ? "Adding agent…"
              : priceRequiresPayment
                ? "Hire paid agent"
                : "Hire read-only agent"}
          </button>
        )}
      </div>

      {/* The payment step, deliberately its own step above the authorization
          one. Offered when the catalog carries a real price OR when the agent
          publishes an endpoint that can be asked for one - see the decision
          note in erc8183-policy.ts for why the second condition is not a way
          of inventing a price but the opposite of one. */}
      {showPaymentStep ? (
        <div className="mt-7 border-t border-line pt-6">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-faint">
            {priceRequiresPayment ? "Payment · required" : "Buy a task · optional"}
          </p>
          <PaymentAction
            agent={agent}
            onPaid={(job) => setPaidJobId(job.jobId)}
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
      <JobDeliveryStatus tokenId={agent.tokenId} />

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
