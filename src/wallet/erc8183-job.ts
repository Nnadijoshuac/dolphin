import { getAddress } from "viem";

import { bscPublicClient } from "@/services/chain";

/**
 * Reading an ERC-8183 job back off the chain, so a paid hire can say what
 * actually happened to it rather than sitting on "active" forever.
 *
 * MIRRORED BY HAND from web/src/wallet/erc8183-job.ts. The two products share
 * no node_modules and no code, so this file has a twin that must be edited in
 * the same change - the same rule AGENTS.md §9 already applies to LiveMetric,
 * the category stat validators and altana-policy.ts. The two are currently
 * byte-identical; if they ever diverge, the two products will disagree about
 * whether a job was delivered.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE IMPORTS NO SDK, DELIBERATELY
 * ---------------------------------------------------------------------------
 * `@altananetwork/sdk` ships `getErc8183Job`, and using it here would be the
 * obvious move. It is not used, for the same measured reason recorded beside
 * ALTANA_CHAIN_ID in altana-policy.ts: the package root is a barrel, so
 * importing one function from it drags the whole SDK into any bundle that
 * touches this module. This one is rendered by the hire flow and My Agents,
 * which the native Expo target also builds.
 *
 * Everything needed is available without it:
 *   - the escrow ADDRESS comes from the `agentJobs` row, which
 *     convex/agentPayments.ts wrote only after verifying it on-chain;
 *   - the ABI is four fields of a struct, copied below from the same place
 *     convex/agentPayments.ts copied it (the SDK's own ABI).
 * So there is still no hand-invented contract address anywhere in this flow.
 *
 * ---------------------------------------------------------------------------
 * WHY POLLING, AND NOT AN EVENT SUBSCRIPTION
 * ---------------------------------------------------------------------------
 * Measured 2026-08-31, not assumed. ERC-8183 offers no push signal of any kind:
 * the seller has no callback into Dolphin (`notify_funded` is one-way, Dolphin
 * -> seller), and the one on-chain event that would carry a completion signal
 * (`JobInitialised` on the policy contract) could not be found at all - a raw
 * unfiltered scan of the policy contract over ~20,000 blocks returned ZERO
 * events. On top of that, this project's configured RPC
 * (bsc-dataseed.bnbchain.org) rejects `eth_getLogs` at every range with
 * "Request exceeds defined limit", so log-watching is not available here even
 * where events exist.
 *
 * What IS reliable is `getJob`, a single `eth_call`, which works on every RPC
 * tried and returns a `deliverable` that is non-zero exactly when the seller
 * has submitted. Verified against six real third-party mainnet jobs (56673,
 * 56675-56678, 56680), all of which carried a real 32-byte deliverable.
 *
 * So: poll one cheap call. Nothing here ever calls `getLogs`.
 */

/**
 * The kernel's `getJob`. Order-locked with the contract - the tuple's fields
 * are positional, so this must stay byte-for-byte in the same order as
 * convex/agentPayments.ts's copy and the SDK's own.
 */
export const COMMERCE_GET_JOB_ABI = [
  {
    name: "getJob",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          { name: "client", type: "address" },
          { name: "provider", type: "address" },
          { name: "evaluator", type: "address" },
          { name: "description", type: "string" },
          { name: "budget", type: "uint256" },
          { name: "expiredAt", type: "uint256" },
          { name: "status", type: "uint8" },
          { name: "hook", type: "address" },
          { name: "submittedAt", type: "uint256" },
          { name: "deliverable", type: "bytes32" },
        ],
      },
    ],
  },
] as const;

/** Order-locked with the kernel. Index into this, never a magic number. */
export const JOB_STATUS = [
  "OPEN",
  "FUNDED",
  "SUBMITTED",
  "COMPLETED",
  "REJECTED",
  "EXPIRED",
] as const;

/**
 * `deliverable` before the seller submits. The SDK's own type documents this:
 * "32 zero-bytes until the seller submits." It is the single most reliable
 * delivery signal on this rail, which is why the whole poll turns on it.
 */
export const UNSET_DELIVERABLE = `0x${"0".repeat(64)}`;

/** What one `getJob` call tells us. Raw values, no interpretation. */
export type OnChainJob = Readonly<{
  statusName: string;
  /** 32-byte commitment the seller wrote. `UNSET_DELIVERABLE` until it does. */
  deliverable: string;
  /** Unix seconds, 0 until submitted. */
  submittedAt: number;
  /** Unix seconds. After this the buyer can reclaim an undelivered escrow. */
  expiredAt: number;
  budgetRaw: string;
}>;

/** One `eth_call`. Throws on RPC failure - the caller decides what that means. */
export async function readOnChainJob(
  escrowContract: string,
  jobId: string,
): Promise<OnChainJob> {
  const job = await bscPublicClient.readContract({
    address: getAddress(escrowContract) as `0x${string}`,
    abi: COMMERCE_GET_JOB_ABI,
    functionName: "getJob",
    args: [BigInt(jobId)],
  });

  return {
    statusName: JOB_STATUS[job.status] ?? `UNKNOWN(${job.status})`,
    deliverable: job.deliverable,
    submittedAt: Number(job.submittedAt),
    expiredAt: Number(job.expiredAt),
    budgetRaw: job.budget.toString(),
  };
}

/* ---------------------------------------------------------------------------
 * The delivery state machine.
 * ------------------------------------------------------------------------ */

/**
 * How fast the poll runs before the timeout below.
 *
 * 10 seconds. Chosen against the sellers' OWN completion estimates, measured
 * live in session 7: 120-600 seconds. At 10s that is 12-60 polls across the
 * expected window and a delivery becomes visible within 10s of happening,
 * which reads as live to someone watching. The cost is one `eth_call` per 10s
 * per in-flight job - negligible even on a rate-limited public RPC, and it
 * never touches `getLogs`, which is the call that actually breaks here.
 */
export const POLL_INTERVAL_MS = 10_000;

/**
 * How fast it runs AFTER the timeout. Slower, but never zero.
 *
 * Freezing the poll at the timeout would leave a stale state on screen for a
 * job that may still be delivered - the escrow is real and the seller may
 * simply be slow. So the STATE changes and the cadence relaxes; the reading
 * does not stop.
 */
export const SLOW_POLL_INTERVAL_MS = 60_000;

/**
 * When "in progress" becomes "taking longer than expected".
 *
 * 10 minutes = 2x the slowest seller estimate observed (600s). Long enough not
 * to cry wolf on an agent having an ordinary slow run, short enough that
 * nobody is left staring at a spinner with no acknowledgement.
 *
 * This is a PRESENTATION threshold only. The real deadline is the job's own
 * on-chain `expiredAt`, after which the escrow becomes reclaimable, and that
 * is what the UI shows the user - never this number dressed up as a deadline.
 */
export const DELIVERY_TIMEOUT_MS = 10 * 60 * 1000;

export type DeliveryState =
  /** Escrow funded, seller has not submitted, inside the expected window. */
  | "working"
  /** Same, but past DELIVERY_TIMEOUT_MS. Not an error - just honest. */
  | "overdue"
  /** Seller submitted a deliverable. This is what the user is waiting for. */
  | "delivered"
  /** Delivered AND the escrow has been released to the seller. */
  | "settled"
  /** The kernel says the job was rejected. */
  | "rejected"
  /** Past `expiredAt` with nothing delivered - the escrow is reclaimable. */
  | "expired"
  /** Recorded but never funded. Should not happen for a witnessed payment. */
  | "unfunded";

/** True once the seller has written a commitment. The core signal. */
export function hasDeliverable(job: OnChainJob): boolean {
  return job.deliverable.toLowerCase() !== UNSET_DELIVERABLE;
}

/**
 * Maps a chain reading plus elapsed time onto what the user is told.
 *
 * `elapsedMs` is measured from the moment Dolphin WITNESSED the payment
 * (`agentJobs.verifiedAt`), not from when this component mounted - so a
 * reload or a revisit shows the true age of the job rather than restarting
 * the clock at zero.
 */
export function deliveryStateFor(job: OnChainJob, elapsedMs: number): DeliveryState {
  if (job.statusName === "COMPLETED") return "settled";
  if (job.statusName === "REJECTED") return "rejected";
  if (hasDeliverable(job)) return "delivered";
  if (job.statusName === "EXPIRED") return "expired";
  if (job.statusName === "OPEN") return "unfunded";
  return elapsedMs >= DELIVERY_TIMEOUT_MS ? "overdue" : "working";
}

/** A state nothing further will change without someone acting. Stops the poll. */
export function isTerminal(state: DeliveryState): boolean {
  return (
    state === "delivered" ||
    state === "settled" ||
    state === "rejected" ||
    state === "expired"
  );
}

/** Human copy per state. Kept here so both products cannot describe one differently. */
export function deliveryCopy(state: DeliveryState): {
  label: string;
  body: string;
} {
  switch (state) {
    case "working":
      return {
        label: "Agent working",
        body: "The escrow is funded and the agent has been told to start. Dolphin is reading the job from BNB Smart Chain every 10 seconds and will show the deliverable the moment it is submitted.",
      };
    case "overdue":
      return {
        label: "Taking longer than expected",
        body: "Nothing has been submitted yet. This is not an error - the escrow is still funded and the agent can still deliver. Dolphin is still checking, less often.",
      };
    case "delivered":
      return {
        label: "Delivered",
        body: "The agent submitted its deliverable on-chain. The commitment hash below is the agent's own record of what it produced, read from the escrow kernel.",
      };
    case "settled":
      return {
        label: "Delivered and settled",
        body: "The agent submitted its deliverable and the escrow has been released. Nothing further is outstanding.",
      };
    case "rejected":
      return {
        label: "Rejected",
        body: "The kernel records this job as rejected, so the escrow was not released to the agent.",
      };
    case "expired":
      return {
        label: "Expired without delivery",
        body: "The job passed its on-chain deadline with nothing submitted, so its escrow can be reclaimed.",
      };
    case "unfunded":
      return {
        label: "Not funded",
        body: "The kernel still reports this job as OPEN, meaning its escrow was never funded. No payment has moved.",
      };
  }
}
