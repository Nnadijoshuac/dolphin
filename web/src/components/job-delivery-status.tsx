"use client";

import { useQuery as useConvexQuery } from "convex/react";

import { agentPaymentsApi, type AgentJobRow } from "@/convex/api";
import { useJobDelivery } from "@/hooks/use-job-delivery";
import { convexClient } from "@/providers/convex-provider";
import { formatTokenAmount } from "@/wallet/erc8183-policy";
import {
  DELIVERY_TIMEOUT_MS,
  deliveryCopy,
  hasDeliverable,
  type DeliveryState,
} from "@/wallet/erc8183-job";
import { useAltanaWallet } from "@/wallet/altana-provider";

/**
 * What happened to a paid hire after the money moved.
 *
 * Before this existed a paid hire showed "active" forever: Dolphin funded an
 * escrow, told the seller to start, and then never looked again. This reads the
 * job back off the ERC-8183 kernel and says which of the real on-chain states
 * it is actually in.
 *
 * Renders NOTHING when there is no paid job for this agent, so it is safe to
 * drop into any surface that shows a hire - the free-hire path is completely
 * unaffected and shows no delivery UI at all, because nothing was bought.
 */

/** Tone per state, so one state cannot look "good" on one screen and "bad" on another. */
const STATE_TONE: Record<DeliveryState, "live" | "wait" | "warn"> = {
  working: "wait",
  overdue: "warn",
  delivered: "live",
  settled: "live",
  rejected: "warn",
  expired: "warn",
  unfunded: "warn",
};

function formatElapsed(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h ago` : `${hours} h ${rest} min ago`;
}

/** Unix seconds -> a date a person can check against. Never a relative guess. */
function formatDeadline(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return "an unread date";
  return new Date(unixSeconds * 1000).toLocaleString();
}

export function JobDeliveryStatus({ tokenId }: { tokenId: string }) {
  const wallet = useAltanaWallet();

  // Paid jobs are keyed by the Dolphin Wallet that funded them, so with no
  // wallet on this device there is nothing to look up.
  const jobs = useConvexQuery(
    agentPaymentsApi.agentPayments.getJobsForAgent,
    wallet.address && convexClient !== null
      ? { tokenId, altanaWalletAddress: wallet.address }
      : "skip",
  ) as AgentJobRow[] | undefined;

  // getJobsForAgent returns newest first, so the head is the current purchase.
  const job = jobs?.[0] ?? null;
  const delivery = useJobDelivery(job);

  if (!job) return null;

  const copy = delivery.state ? deliveryCopy(delivery.state) : null;
  const tone = delivery.state ? STATE_TONE[delivery.state] : "wait";
  const delivered = delivery.onChain ? hasDeliverable(delivery.onChain) : false;

  /*
   * Link preference: the funding transaction when we have one, because that is
   * the single most checkable artefact of the purchase. Falling back to the
   * escrow contract still lands the reader somewhere they can verify the job
   * themselves, which a status dot alone never does.
   */
  const explorerHref = job.transactionHash
    ? `https://bscscan.com/tx/${job.transactionHash}`
    : `https://bscscan.com/address/${job.escrowContract}`;

  return (
    <div className="mt-4 border-t border-line pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${
              tone === "live" ? "bg-success" : tone === "warn" ? "bg-danger" : "bg-accent"
            }`}
          />
          <p className="text-xs font-semibold text-ink">
            {copy?.label ?? (delivery.isFirstLoad ? "Reading job…" : "Job status")}
          </p>
          <span className="font-mono text-[0.64rem] text-faint">#{job.jobId}</span>
        </div>

        <button
          className="interactive text-[0.68rem] font-medium text-muted hover:text-ink"
          onClick={delivery.refresh}
          type="button"
        >
          Check now
        </button>
      </div>

      {copy && <p className="mt-2 text-xs leading-5 text-muted">{copy.body}</p>}

      {/*
       * A failed poll is reported as a connection note, never as a job state.
       * The escrow is exactly as funded as it was a moment ago; only our
       * ability to read it lapsed.
       */}
      {delivery.isReconnecting && (
        <p className="mt-2 text-[0.68rem] leading-5 text-faint">
          Could not reach the chain on the last check — still trying. The status
          above is the last confirmed reading, not a failure of the job.
        </p>
      )}

      <dl className="mt-4 border-t border-line text-xs">
        <div className="flex items-start justify-between gap-4 border-b border-line py-2.5">
          <dt className="text-muted">Paid</dt>
          <dd className="text-right font-medium text-ink">
            {formatTokenAmount(job.budgetRaw, job.paymentTokenDecimals)}{" "}
            {job.paymentTokenSymbol}
          </dd>
        </div>
        <div className="flex items-start justify-between gap-4 border-b border-line py-2.5">
          <dt className="text-muted">Ordered</dt>
          <dd className="text-right font-medium text-ink">
            {formatElapsed(delivery.elapsedMs)}
          </dd>
        </div>

        {/*
         * The real, on-chain deadline - shown only once we have actually read
         * it. DELIVERY_TIMEOUT_MS is a presentation threshold and is never
         * printed as if it were a contractual deadline.
         */}
        {delivery.onChain && !delivered && (
          <div className="flex items-start justify-between gap-4 border-b border-line py-2.5">
            <dt className="text-muted">Refundable after</dt>
            <dd className="text-right font-medium text-ink">
              {formatDeadline(delivery.onChain.expiredAt)}
            </dd>
          </div>
        )}

        {/*
         * THE DELIVERY EVIDENCE. This is a 32-byte commitment the agent wrote
         * on-chain, not the deliverable's content - and it is labelled as
         * exactly that. The content lives at a URL published in an event that
         * could not be found on this chain (see erc8183-job.ts), so presenting
         * this hash as "the result" would be a claim Dolphin cannot support.
         */}
        {delivery.onChain && delivered && (
          <div className="grid gap-1.5 border-b border-line py-2.5 sm:grid-cols-[140px_minmax(0,1fr)]">
            <dt className="text-muted">Deliverable hash</dt>
            <dd className="break-all font-mono text-[0.64rem] leading-4 text-ink-soft sm:text-right">
              {delivery.onChain.deliverable}
            </dd>
          </div>
        )}
      </dl>

      <a
        className="interactive mt-3 inline-block text-[0.68rem] font-medium text-muted hover:text-ink"
        href={explorerHref}
        rel="noreferrer"
        target="_blank"
      >
        View on BscScan ↗
      </a>

      {delivery.state === "overdue" && (
        <p className="mt-3 text-[0.68rem] leading-5 text-faint">
          Dolphin stopped expecting delivery after{" "}
          {Math.round(DELIVERY_TIMEOUT_MS / 60_000)} minutes, which is twice the
          slowest completion time the agents in this catalog quote for
          themselves. It is still checking once a minute.
        </p>
      )}
    </div>
  );
}
