"use client";

import { useQuery } from "@tanstack/react-query";

import type { AgentJobRow } from "@/convex/api";
import { useNow } from "@/hooks/use-now";
import {
  DELIVERY_TIMEOUT_MS,
  POLL_INTERVAL_MS,
  SLOW_POLL_INTERVAL_MS,
  type DeliveryState,
  type OnChainJob,
  deliveryStateFor,
  isTerminal,
  readOnChainJob,
} from "@/wallet/erc8183-job";

/**
 * Polls one ERC-8183 job until the agent delivers.
 *
 * See erc8183-job.ts for why this polls rather than subscribing (there is no
 * push signal on this rail, and `eth_getLogs` is unavailable on this project's
 * RPC), and for the reasoning behind the two intervals and the timeout.
 */

export type JobDelivery = Readonly<{
  /** Last successful chain reading. `undefined` until the first one lands. */
  onChain: OnChainJob | undefined;
  state: DeliveryState | undefined;
  /** Age of the job, from when Dolphin witnessed the payment. */
  elapsedMs: number;
  /**
   * True when the most recent poll failed but a previous one succeeded.
   *
   * Deliberately NOT called "error". A poll that fails says nothing about the
   * job - the escrow is exactly as funded as it was - so the UI shows a quiet
   * "reconnecting" note over the last known state rather than an error panel.
   * Treating a transport failure as a job failure would be the single most
   * misleading thing this screen could do.
   */
  isReconnecting: boolean;
  /** True before any reading at all has succeeded. */
  isFirstLoad: boolean;
  refresh: () => void;
}>;

export function useJobDelivery(job: AgentJobRow | null | undefined): JobDelivery {
  const now = useNow();

  /**
   * Elapsed is measured from `verifiedAt` - the moment convex/agentPayments.ts
   * read the funded job off the chain - not from when this component mounted.
   * A reload or a revisit therefore shows the job's real age instead of
   * restarting the clock, which would let a user refresh their way out of the
   * "taking longer than expected" state without anything having changed.
   */
  const startedAtMs = job ? Date.parse(job.verifiedAt) : Number.NaN;
  const elapsedMs =
    now === 0 || Number.isNaN(startedAtMs) ? 0 : Math.max(0, now - startedAtMs);

  const query = useQuery({
    queryKey: ["erc8183-job", job?.escrowContract, job?.jobId],
    enabled: Boolean(job),
    queryFn: () => readOnChainJob(job!.escrowContract, job!.jobId),

    /**
     * Fast until the timeout, slower after it, and stopped once the job
     * reaches a state nothing will change on its own. Computed from
     * `Date.now()` rather than the bucketed `useNow()` because this runs
     * outside render, where an exact clock is fine and the 30s bucket would
     * make the handover to the slow cadence imprecise.
     */
    refetchInterval: (q) => {
      const data = q.state.data;
      if (data && isTerminal(deliveryStateFor(data, elapsedFrom(job)))) return false;
      return elapsedFrom(job) >= DELIVERY_TIMEOUT_MS
        ? SLOW_POLL_INTERVAL_MS
        : POLL_INTERVAL_MS;
    },
    // Keep polling while the tab is backgrounded: a demo where the judge
    // switches windows and comes back to a stale spinner helps nobody.
    refetchIntervalInBackground: true,

    /**
     * A failed read is a transport problem, not a job problem. Retry a couple
     * of times with backoff; if those fail the scheduled interval tries again
     * anyway, so the poll is self-healing without an unbounded retry storm.
     * `data` from the last success is preserved throughout.
     */
    retry: 2,
    retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 15_000),

    // Every read is a fresh on-chain fact; nothing here is cacheable.
    staleTime: 0,
  });

  const onChain = query.data;
  const state = onChain ? deliveryStateFor(onChain, elapsedMs) : undefined;

  return {
    onChain,
    state,
    elapsedMs,
    isReconnecting: query.isError && onChain !== undefined,
    isFirstLoad: query.isPending && Boolean(job),
    refresh: () => void query.refetch(),
  };
}

/** Exact elapsed, for scheduling decisions made outside render. */
function elapsedFrom(job: AgentJobRow | null | undefined): number {
  if (!job) return 0;
  const startedAt = Date.parse(job.verifiedAt);
  return Number.isNaN(startedAt) ? 0 : Math.max(0, Date.now() - startedAt);
}
