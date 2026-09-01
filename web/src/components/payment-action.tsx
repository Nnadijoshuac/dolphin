"use client";

import { useAction, useQuery as useConvexQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { CategoryGlyph } from "@/components/category-glyph";
import { agentPaymentsApi, type AgentQuote } from "@/convex/api";
import type { Agent } from "@/types/agent";
import { toUserMessage } from "@/wallet/wallet-errors";
import {
  defaultTaskDescription,
  formatTokenAmount,
  fundingHint,
} from "@/wallet/erc8183-policy";
import { useAltanaWallet, type PaidJob } from "@/wallet/altana-provider";
import { useWallet } from "@/wallet/wallet-provider";

/**
 * The payment step of a paid hire.
 *
 * Structured deliberately like SessionGrantAction: a distinct step with the
 * real terms on screen before anything is signed, never folded into the hire
 * button. The terms shown are the ones the seller actually quoted seconds
 * earlier - a real amount, a real token read from its own contract, and a real
 * payee cross-checked against the agent's registered ERC-8004 wallet. Nothing
 * on this screen is a constant.
 *
 * Renders nothing at all for a free agent, which today is every agent in the
 * catalog (see SESSION-LOG-2026-08-31-payments.md §0.2). The step appears the
 * moment an agent publishes a real price.
 */

type Phase =
  | { kind: "idle" }
  | { kind: "quoting" }
  | { kind: "quoted"; quote: AgentQuote; balanceRaw: bigint | null; balanceError: string | null }
  | { kind: "paying"; quote: AgentQuote }
  | { kind: "paid"; job: PaidJob; quote: AgentQuote }
  | { kind: "error"; message: string };

export function PaymentAction({
  agent,
  priceAmount,
  priceToken,
  onPaid,
}: {
  agent: Agent;
  /**
   * The agent's resolved catalog price, or null when the catalog carries none.
   * Null is the normal case today and is NOT treated as "free" - it means
   * Dolphin does not know what this agent charges, which is why the step's
   * whole job is to go and ask.
   */
  priceAmount: string | null;
  priceToken: string | null;
  /** Handed the verified job id so the hire can reference it. */
  onPaid: (job: PaidJob) => void;
}) {
  const altana = useAltanaWallet();
  const hirer = useWallet();
  const requestQuote = useAction(agentPaymentsApi.agentPayments.requestQuote);

  const [task, setTask] = useState(() =>
    defaultTaskDescription(agent.category, altana.address),
  );
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  // Null whenever the catalog has no price for this agent, which is every
  // agent today. Deliberately not defaulted to "free" or to a number.
  const catalogPrice =
    priceAmount !== null && priceToken !== null ? `${priceAmount} ${priceToken}` : null;

  const paidJobs = useConvexQuery(
    agentPaymentsApi.agentPayments.getJobsForAgent,
    altana.address ? { tokenId: agent.tokenId, altanaWalletAddress: altana.address } : "skip",
  );
  const alreadyPaid = paidJobs?.[0] ?? null;

  /* --- already paid: show the checkable evidence, not a claim ------------ */
  if (alreadyPaid && phase.kind !== "paid") {
    return (
      <div className="mt-4 border-l-2 border-success pl-4">
        <p className="text-xs font-semibold text-success">Payment settled</p>
        <p className="mt-1.5 text-xs leading-5 text-muted">
          {formatTokenAmount(alreadyPaid.budgetRaw, alreadyPaid.paymentTokenDecimals)}{" "}
          {alreadyPaid.paymentTokenSymbol} is held in ERC-8183 escrow for this agent.
          Dolphin read this job back off the chain to confirm it.
        </p>
        <dl className="mt-3 space-y-1.5 text-[0.68rem]">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Job</dt>
            <dd className="font-mono text-ink">#{alreadyPaid.jobId}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">On-chain status</dt>
            <dd className="font-medium text-ink">{alreadyPaid.jobStatus}</dd>
          </div>
          {alreadyPaid.transactionHash ? (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Transaction</dt>
              <dd className="break-all font-mono text-faint">{alreadyPaid.transactionHash}</dd>
            </div>
          ) : null}
        </dl>
      </div>
    );
  }

  /* --- no wallet: this step cannot happen here --------------------------- */
  if (altana.status !== "connected") {
    return (
      <div className="mt-4 border-l-2 border-accent pl-4">
        <p className="text-xs font-semibold text-ink">Dolphin Wallet required to pay</p>
        <p className="mt-1.5 text-xs leading-5 text-muted">
          {catalogPrice
            ? `This agent charges ${catalogPrice}. `
            : "This agent sells its work over ERC-8183 escrow. "}
          Payment settles from the Dolphin Wallet, a separate passkey account from
          the connected browser wallet — the two do not share a balance.
        </p>
        {altana.status === "unsupported" ? (
          <p className="mt-2 text-xs font-medium leading-5 text-danger">
            {altana.unsupportedReason}
          </p>
        ) : (
          <Link
            className="interactive mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-line bg-paper px-4 text-xs font-semibold text-ink no-underline hover:bg-canvas"
            href="/wallet"
          >
            Set up Dolphin Wallet
            <CategoryGlyph color="currentColor" name="arrow-right" size={14} strokeWidth={2} />
          </Link>
        )}
      </div>
    );
  }

  async function onGetQuote() {
    setPhase({ kind: "quoting" });
    try {
      const quote = await requestQuote({ tokenId: agent.tokenId, taskDescription: task });
      // The balance is read only once there is a quote, because only the quote
      // says which token to read. There is deliberately no token list here.
      let balanceRaw: bigint | null = null;
      let balanceError: string | null = null;
      try {
        balanceRaw = (await altana.readTokenBalance(quote.paymentToken)).raw;
      } catch (cause) {
        balanceError = toUserMessage(cause, "The payment step could not be completed. Try again.");
      }
      setPhase({ kind: "quoted", quote, balanceRaw, balanceError });
    } catch (cause) {
      setPhase({
        kind: "error",
        message: toUserMessage(cause, "The payment step could not be completed. Try again."),
      });
    }
  }

  async function onPay(quote: AgentQuote) {
    setPhase({ kind: "paying", quote });
    try {
      const job = await altana.payForAgent({
        tokenId: agent.tokenId,
        category: agent.category,
        quote,
        hirerWalletAddress: hirer.address,
      });
      setPhase({ kind: "paid", job, quote });
      onPaid(job);
    } catch (cause) {
      setPhase({
        kind: "error",
        message: toUserMessage(cause, "The payment step could not be completed. Try again."),
      });
    }
  }

  /* --- paid, this session ------------------------------------------------ */
  if (phase.kind === "paid") {
    return (
      <div className="mt-4 border-l-2 border-success pl-4">
        <p className="text-xs font-semibold text-success">Paid — escrow funded</p>
        <p className="mt-1.5 text-xs leading-5 text-muted">
          {formatTokenAmount(phase.job.budgetRaw, phase.quote.paymentTokenDecimals)}{" "}
          {phase.quote.paymentTokenSymbol} is escrowed for this agent. Job #
          {phase.job.jobId}, read back on-chain as {phase.job.jobStatus}.
        </p>
        <p className="mt-2 text-[0.68rem] leading-5 text-muted">
          {phase.job.sellerAccepted
            ? "The agent accepted the job and is working on it."
            : "Dolphin told the agent its escrow is funded. It has not confirmed acceptance yet — " +
              "the escrow is on-chain either way and is refundable if it never delivers."}
        </p>
        {phase.job.transactionHash ? (
          <p className="mt-2 break-all font-mono text-[0.64rem] leading-4 text-faint">
            {phase.job.transactionHash}
          </p>
        ) : null}
      </div>
    );
  }

  /* --- a live quote is on screen ----------------------------------------- */
  if (phase.kind === "quoted" || phase.kind === "paying") {
    const quote = phase.quote;
    const balanceRaw = phase.kind === "quoted" ? phase.balanceRaw : null;
    const balanceError = phase.kind === "quoted" ? phase.balanceError : null;
    const price = BigInt(quote.priceRaw);
    const canAfford = balanceRaw !== null && balanceRaw >= price;
    const shortBy = balanceRaw !== null && !canAfford ? price - balanceRaw : null;

    return (
      <div className="mt-4">
        <p className="text-xs font-semibold text-ink">The agent quoted this price</p>
        {quote.deliverables ? (
          <p className="mt-1.5 text-xs leading-5 text-muted">{quote.deliverables}</p>
        ) : null}

        <dl className="mt-4 border-y border-line text-xs">
          <div className="flex items-center justify-between gap-3 py-3">
            <dt className="text-muted">Price</dt>
            <dd className="font-semibold text-ink">
              {formatTokenAmount(quote.priceRaw, quote.paymentTokenDecimals)}{" "}
              {quote.paymentTokenSymbol}
            </dd>
          </div>
          <div className="grid gap-1 border-t border-line py-3 sm:grid-cols-[110px_minmax(0,1fr)]">
            <dt className="text-muted">Token</dt>
            <dd className="break-all font-mono text-[0.64rem] leading-4 text-faint sm:text-right">
              {quote.paymentToken}
            </dd>
          </div>
          <div className="grid gap-1 border-t border-line py-3 sm:grid-cols-[110px_minmax(0,1fr)]">
            <dt className="text-muted">Paid to</dt>
            <dd className="break-all font-mono text-[0.64rem] leading-4 text-faint sm:text-right">
              {quote.provider}
            </dd>
          </div>
          <div className="grid gap-1 border-t border-line py-3 sm:grid-cols-[110px_minmax(0,1fr)]">
            <dt className="text-muted">Held in escrow by</dt>
            <dd className="break-all font-mono text-[0.64rem] leading-4 text-faint sm:text-right">
              {quote.verifyingContract}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-line py-3">
            <dt className="text-muted">Your balance</dt>
            <dd
              className={`font-medium ${
                balanceRaw === null ? "text-muted" : canAfford ? "text-success" : "text-danger"
              }`}
            >
              {balanceRaw === null
                ? "Could not read"
                : `${formatTokenAmount(balanceRaw, quote.paymentTokenDecimals)} ${quote.paymentTokenSymbol}`}
            </dd>
          </div>
          {quote.estimatedCompletionSeconds !== null ? (
            <div className="flex items-center justify-between gap-3 border-t border-line py-3">
              <dt className="text-muted">Agent&apos;s own estimate</dt>
              <dd className="font-medium text-ink">
                {quote.estimatedCompletionSeconds}s
              </dd>
            </div>
          ) : null}
        </dl>

        {balanceError ? (
          <p className="mt-3 border-l-2 border-danger bg-danger-soft p-3 text-[0.7rem] font-medium leading-5 text-danger">
            {balanceError}
          </p>
        ) : null}

        {shortBy !== null ? (
          <div className="mt-3 border-l-2 border-danger bg-danger-soft p-3">
            <p className="text-[0.7rem] font-semibold leading-5 text-danger">
              Not enough {quote.paymentTokenSymbol} to pay this
            </p>
            <p className="mt-1 text-[0.7rem] leading-5 text-danger">
              You need {formatTokenAmount(shortBy, quote.paymentTokenDecimals)} more{" "}
              {quote.paymentTokenSymbol}.{" "}
              {fundingHint(quote.paymentTokenSymbol, altana.address)}
            </p>
          </div>
        ) : null}

        <button
          className="interactive mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 text-xs font-semibold text-ink hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-paper-muted disabled:text-faint"
          disabled={phase.kind === "paying" || !canAfford || altana.isBusy}
          onClick={() => void onPay(quote)}
          type="button"
        >
          {phase.kind === "paying"
            ? "Confirm with passkey…"
            : `Pay ${formatTokenAmount(quote.priceRaw, quote.paymentTokenDecimals)} ${quote.paymentTokenSymbol}`}
        </button>

        <p className="mt-3 text-center text-[0.68rem] leading-5 text-faint">
          Payment funds an on-chain ERC-8183 escrow. The agent is only paid once it
          delivers; an undelivered job is refundable to you after its deadline.
        </p>
      </div>
    );
  }

  /* --- idle / quoting / error -------------------------------------------- */
  return (
    <div className="mt-4">
      <p className="text-xs font-semibold text-ink">
        {catalogPrice ? "This agent charges for its work" : "Buy a task from this agent"}
      </p>
      <p className="mt-1.5 text-xs leading-5 text-muted">
        {catalogPrice
          ? `Dolphin's catalog lists ${catalogPrice}. Ask the agent itself for a firm quote before paying anything — `
          : "Dolphin has no published price for this agent — ERC-8004 carries no price field, so no price here would be a real one. This agent does publish an endpoint that can be asked, and asking is free. "}
        The price, the token and the payee all come from the agent, and Dolphin
        checks the payee against its registered on-chain identity before showing
        you anything.
      </p>

      <label className="mt-4 block">
        <span className="text-xs font-semibold text-ink">What are you asking it to do?</span>
        <textarea
          className="mt-2 min-h-24 w-full rounded-xl border border-line bg-paper p-3 text-xs leading-5 text-ink"
          onChange={(event) => setTask(event.target.value)}
          value={task}
        />
      </label>
      <p className="mt-1.5 text-[0.68rem] leading-5 text-faint">
        This text is written into the escrow job on-chain, so it is what the agent is
        held to.
      </p>

      <button
        className="interactive mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-line bg-paper px-4 text-xs font-semibold text-ink hover:bg-canvas disabled:cursor-wait disabled:opacity-60"
        disabled={phase.kind === "quoting" || task.trim().length === 0}
        onClick={() => void onGetQuote()}
        type="button"
      >
        {phase.kind === "quoting" ? "Asking the agent…" : "Get a price from this agent"}
      </button>

      {phase.kind === "error" ? (
        <p className="mt-3 border-l-2 border-danger bg-danger-soft p-3 text-[0.7rem] font-medium leading-5 text-danger">
          {phase.message}
        </p>
      ) : null}

      <p className="mt-3 text-center text-[0.68rem] leading-5 text-faint">
        Asking for a price costs nothing and signs nothing.
      </p>
    </div>
  );
}
