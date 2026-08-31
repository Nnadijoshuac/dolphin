import { getAddress, isAddress } from "viem";
import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { BSC_CHAIN_ID } from "./lib/bscClient";
import { agentCategoryValidator } from "./categoryStatsValidators";

// Mirrors AgentPriceModel in src/types/agent.ts field-for-field. Keep these
// two in sync by hand, same rule as the AGENT_QUERY_TIMINGS.* validators in
// categoryStatsValidators.ts.
const priceModelValidator = v.object({
  type: v.union(v.literal("flat"), v.literal("per-call"), v.literal("percentage-fee")),
  amount: v.string(),
  token: v.string(),
});

function isFreePriceModel(priceModel: { amount: string }): boolean {
  const amount = Number(priceModel.amount);
  return Number.isFinite(amount) && amount === 0;
}

/**
 * Generalized from what used to be monitoring-only hireMonitoringAgent -
 * the underlying logic was already category-agnostic (reject an unresolved
 * price, gate a non-zero price, upsert a hire record), it was just locked to
 * one category's name and table. Any category's free-tier agent can be hired
 * the same way: no session, no spend cap, no call allowlist - just a wallet
 * address.
 *
 * A NON-ZERO price is now honourable rather than refused outright, but only
 * against a payment Dolphin verified itself - see the gate below and
 * convex/agentPayments.ts. The free path is byte-for-byte what it always was.
 */
export const hireReadOnlyAgent = mutation({
  args: {
    tokenId: v.string(),
    category: agentCategoryValidator,
    walletAddress: v.string(),
    // The agent's resolved `priceModel.value` (from its LiveMetric<AgentPriceModel>
    // in src/types/agent.ts), or null if that LiveMetric hasn't resolved to
    // "live"/"stale" yet. Passed in by the caller rather than looked up here
    // because Convex doesn't persist full Agent records (only category live
    // stats) - the 8004scan/editorial Agent data this comes from only exists
    // client-side. Mirrors the agentWallet precondition on
    // categoryStats.refreshAgentCategoryStats: the caller is responsible for
    // handing over a value it actually trusts.
    priceModel: v.union(v.null(), priceModelValidator),
    /**
     * For a NON-ZERO price only: the ERC-8183 job id that paid for it.
     *
     * This is not the client asserting a payment. The row it points at can
     * only have been written by convex/agentPayments.ts's recordJobPayment,
     * which reads the escrow kernel on BSC and refuses unless the job is
     * really funded, really from this wallet, and really to this agent. So the
     * check below is "did Dolphin itself witness a payment for this", not
     * "did the caller claim one".
     *
     * Free hires never pass this and are completely unaffected.
     */
    paymentJobId: v.optional(v.union(v.null(), v.string())),
  },
  handler: async (ctx, { tokenId, category, walletAddress, priceModel, paymentJobId }) => {
    if (!isAddress(walletAddress)) {
      throw new Error(`hireReadOnlyAgent: "${walletAddress}" is not a valid EVM address.`);
    }
    const normalizedWallet = getAddress(walletAddress);

    if (priceModel === null) {
      throw new Error(
        "Cannot hire yet: this agent's priceModel has not resolved to a live value. " +
          "Wait for priceModel.status to be \"live\" or \"stale\" before calling hireReadOnlyAgent - " +
          "per AGENT.md's data-integrity rule, an unresolved price is never treated as free.",
      );
    }

    if (!isFreePriceModel(priceModel)) {
      // ---------------------------------------------------------------------
      // CHANGED 2026-08-31. This used to refuse every non-zero price outright,
      // because there was no honest way to honour one. There is now: paid
      // agents in this catalog sell over ERC-8183 escrow, and
      // convex/agentPayments.ts can both relay the negotiation and WITNESS the
      // resulting payment on-chain.
      //
      // The gate was TIGHTENED, not relaxed. It no longer asks "is this free";
      // it asks "did Dolphin itself read a funded job for this, off the chain".
      // A caller cannot talk its way past this by passing a price of zero for a
      // paid agent either - that path creates a free hire record, and the paid
      // agent's own seller would never have been paid or notified, so nothing
      // false is claimed about it anywhere.
      // ---------------------------------------------------------------------
      if (!paymentJobId) {
        throw new Error(
          `hireReadOnlyAgent: agent ${tokenId} charges ${priceModel.amount} ${priceModel.token} ` +
            `(${priceModel.type}), so a hire needs a paid ERC-8183 job to point at. Pay through ` +
            "agentPayments.recordJobPayment first - it verifies the escrow on-chain - then pass " +
            "its jobId as paymentJobId. Dolphin will not record a paid hire on an unpaid promise.",
        );
      }

      const payment = await ctx.db
        .query("agentJobs")
        .withIndex("by_job", (q) => q.eq("chainId", BSC_CHAIN_ID).eq("jobId", paymentJobId))
        .unique();

      if (!payment) {
        throw new Error(
          `hireReadOnlyAgent: no verified payment record exists for job ${paymentJobId}. ` +
            "Only agentPayments.recordJobPayment can create one, and only after reading the " +
            "funded job back off the ERC-8183 kernel.",
        );
      }
      if (payment.tokenId !== tokenId) {
        throw new Error(
          `hireReadOnlyAgent: job ${paymentJobId} paid for agent ${payment.tokenId}, not ${tokenId}. ` +
            "One payment cannot be spent on two hires.",
        );
      }
      if (payment.jobStatus === "OPEN") {
        throw new Error(
          `hireReadOnlyAgent: job ${paymentJobId} is still OPEN - its escrow was never funded.`,
        );
      }
    }

    const existing = await ctx.db
      .query("agentHires")
      .withIndex("by_agent_wallet", (q) =>
        q.eq("chainId", BSC_CHAIN_ID).eq("tokenId", tokenId).eq("walletAddress", normalizedWallet),
      )
      .unique();

    const hiredAt = new Date().toISOString();

    // Null for a free hire, which is the honest value: nothing paid for it.
    const paidBy = isFreePriceModel(priceModel) ? null : (paymentJobId ?? null);

    if (existing) {
      if (existing.status === "active") {
        return existing._id;
      }
      await ctx.db.patch(existing._id, {
        status: "active",
        hiredAt,
        cancelledAt: null,
        paymentJobId: paidBy,
      });
      return existing._id;
    }

    return ctx.db.insert("agentHires", {
      chainId: BSC_CHAIN_ID,
      tokenId,
      category,
      walletAddress: normalizedWallet,
      status: "active",
      hiredAt,
      cancelledAt: null,
      paymentJobId: paidBy,
    });
  },
});

export const getHiredAgentsForWallet = query({
  args: {
    walletAddress: v.string(),
  },
  handler: async (ctx, { walletAddress }) => {
    if (!isAddress(walletAddress)) {
      return [];
    }
    const normalizedWallet = getAddress(walletAddress);

    return ctx.db
      .query("agentHires")
      .withIndex("by_wallet", (q) => q.eq("walletAddress", normalizedWallet).eq("status", "active"))
      .collect();
  },
});
