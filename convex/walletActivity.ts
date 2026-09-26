import { getAddress, isAddress } from "viem";
import { v } from "convex/values";

import { query } from "./_generated/server";
import { BSC_CHAIN_ID } from "./lib/bscClient";

/**
 * A wallet's on-chain history, as Dolphin sent it. (2026-09-26)
 *
 * Every entry is a real BSC transaction with a hash, so each one links to its
 * BscScan page. Entries come only from rows that were VERIFIED against the
 * chain before they were written (agentJobs via recordJobPayment and
 * recordJobRefund, ratings via attestReviewOnChain). Nothing here is a
 * database-only event dressed as a transaction: a free "hire" has no
 * transaction, so it is not in this list.
 *
 * What this cannot contain: anything the wallet did outside Dolphin, and the
 * few Dolphin actions that do not record a hash yet (swaps, transfers). The
 * UI says so and links the address's full BscScan history beside it, which is
 * complete by construction.
 */
export type WalletActivityEntry = {
  kind: "payment" | "refund" | "rating";
  transactionHash: string;
  /** ISO time: when Dolphin verified it, which is at or just after the block. */
  at: string;
  agentKey: string;
  agentName: string;
  jobId: string | null;
  /** Atomic units, and how to read them. Null when nothing moved. */
  amountRaw: string | null;
  tokenSymbol: string | null;
  tokenDecimals: number | null;
};

export const forWallets = query({
  args: {
    /** The Dolphin (Altana) wallet: payments and refunds. */
    altanaWalletAddress: v.optional(v.union(v.string(), v.null())),
    /** The connected identity wallet: ratings it published. */
    identityWalletAddress: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { altanaWalletAddress, identityWalletAddress }) => {
    const entries: WalletActivityEntry[] = [];

    if (altanaWalletAddress && isAddress(altanaWalletAddress)) {
      const jobs = await ctx.db
        .query("agentJobs")
        .withIndex("by_altana_wallet", (q) =>
          q.eq("chainId", BSC_CHAIN_ID).eq("altanaWalletAddress", getAddress(altanaWalletAddress)),
        )
        .take(200);

      for (const job of jobs) {
        const amount = {
          amountRaw: job.budgetRaw,
          tokenSymbol: job.paymentTokenSymbol,
          tokenDecimals: job.paymentTokenDecimals,
        };
        if (job.transactionHash) {
          entries.push({
            kind: "payment",
            transactionHash: job.transactionHash,
            // _creationTime is when the verified payment was recorded; verifiedAt
            // moves on every re-read, so it cannot date the payment itself.
            at: new Date(job._creationTime).toISOString(),
            agentKey: job.agentKey,
            agentName: job.agentName,
            jobId: job.jobId,
            ...amount,
          });
        }
        if (job.refundTransactionHash) {
          entries.push({
            kind: "refund",
            transactionHash: job.refundTransactionHash,
            at: job.refundedAt ?? job.verifiedAt,
            agentKey: job.agentKey,
            agentName: job.agentName,
            jobId: job.jobId,
            ...amount,
          });
        }
      }
    }

    if (identityWalletAddress && isAddress(identityWalletAddress)) {
      const reviews = await ctx.db
        .query("agentReviews")
        .withIndex("by_reviewer", (q) => q.eq("walletAddress", identityWalletAddress.toLowerCase()))
        .take(200);
      for (const review of reviews) {
        if (!review.onChainTxHash) continue;
        const agent = await ctx.db
          .query("agents")
          .withIndex("by_key", (q) => q.eq("agentKey", review.agentKey))
          .unique();
        entries.push({
          kind: "rating",
          transactionHash: review.onChainTxHash,
          at: review.updatedAt,
          agentKey: review.agentKey,
          agentName: agent?.name ?? `Agent #${review.agentKey.split(":").pop()}`,
          jobId: review.paidJobId,
          amountRaw: null,
          tokenSymbol: null,
          tokenDecimals: null,
        });
      }
    }

    return entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  },
});
