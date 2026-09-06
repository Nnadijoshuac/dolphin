import { v } from "convex/values";
import { decodeFunctionData, getAddress } from "viem";

import { internal } from "./_generated/api";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { BSC_CHAIN_ID, bscPublicClient } from "./lib/bscClient";
import {
  REPUTATION_REGISTRY_ABI,
  REPUTATION_REGISTRY_ADDRESS,
} from "./lib/reputationRegistry";
import { requireWalletAddress } from "./lib/walletAuth";

/**
 * Reviews that a wallet has earned the right to write.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT STARS
 * ---------------------------------------------------------------------------
 * src/components/agent-detail.tsx's header is a list of things deleted from
 * that page for being fabricated, and three of them were a "4.9" rating, five
 * gold stars, and a star histogram. The obvious way to "add reviews" is to put
 * that shape back with real numbers underneath it. That would be a mistake for
 * reasons that have nothing to do with the old fake data:
 *
 *  - A five-star mean over a marketplace this size is noise. Twenty-seven
 *    agents and a handful of reviewers produce averages that reorder on a
 *    single opinion.
 *  - "How did you feel about it" is the wrong question for software that moves
 *    money. "Did it do the thing" and "would you pay for it again" are
 *    answerable, comparable, and hard to be vague about.
 *  - Stars invite bulk manufacture. Two structured questions tied to a
 *    verified, aged, sometimes-paid hire do not.
 *
 * ---------------------------------------------------------------------------
 * WHO MAY WRITE ONE
 * ---------------------------------------------------------------------------
 * Three gates, all enforced here rather than in the UI, because a gate the
 * client owns is not a gate:
 *
 *  1. AUTHENTICATED. The address comes from the session, so a review is
 *     attributable to a wallet that proved it holds its key.
 *  2. HIRED IT. There must be an agentHires row for this wallet and this agent.
 *     A cancelled hire still qualifies - someone who tried an agent and stopped
 *     has the most useful thing to say about it, and excluding them would
 *     select for satisfied users by construction.
 *  3. LIVED WITH IT. The hire must be at least MIN_REVIEW_AGE_MS old. Hiring
 *     and immediately reviewing is not an experience of the agent, and this is
 *     the cheapest structural defence against a burst of self-reviews.
 *
 * One review per wallet per agent, editable. Editable rather than append-only
 * because an opinion formed on day two should be allowed to change on day
 * thirty, and the alternative is people writing a second review to correct the
 * first.
 */

/**
 * How long a hire must have run before it can be reviewed.
 *
 * 24 hours. Long enough that a review reflects use rather than a first
 * impression, short enough that someone who genuinely tried an agent and was
 * disappointed on day one is not silenced for a week. Recorded as a judgement
 * call, not a derived figure.
 */
export const MIN_REVIEW_AGE_MS = 24 * 60 * 60 * 1000;

/** Free text is capped rather than unbounded. See the schema note on moderation. */
export const REVIEW_COMMENT_MAX_LENGTH = 280;

/**
 * Minimum reviews before a percentage is computed, matching
 * convex/agentRetention.ts's threshold and for the same reason: "100% would
 * hire again" over one review is true arithmetic and a false impression.
 */
const MIN_DENOMINATOR = 5;

const outcomeValidator = v.union(
  v.literal("yes"),
  v.literal("partially"),
  v.literal("no"),
);

/**
 * Whether this wallet may review this agent, and if not, why not.
 *
 * Public so the UI can show the real reason - "your hire is 3 hours old" is a
 * different thing to tell someone than "you have not hired this agent" - rather
 * than offering a form that fails on submit.
 */
export const getReviewEligibility = query({
  args: {
    tokenId: v.string(),
    sessionToken: v.union(v.string(), v.null()),
  },
  returns: v.object({
    eligible: v.boolean(),
    reason: v.union(v.string(), v.null()),
    /** The caller's existing review, when there is one, so the form can prefill. */
    existing: v.union(
      v.null(),
      v.object({
        outcome: outcomeValidator,
        wouldHireAgain: v.boolean(),
        comment: v.union(v.string(), v.null()),
        updatedAt: v.string(),
        onChainTxHash: v.union(v.string(), v.null()),
      }),
    ),
  }),
  handler: async (ctx, { tokenId, sessionToken }) => {
    if (!sessionToken) {
      return {
        eligible: false,
        reason: "Sign in with the wallet that hired this agent to leave a review.",
        existing: null,
      };
    }

    let walletAddress: string;
    try {
      walletAddress = await requireWalletAddress(ctx, sessionToken, "getReviewEligibility");
    } catch {
      return {
        eligible: false,
        reason: "Sign in with the wallet that hired this agent to leave a review.",
        existing: null,
      };
    }

    const hire = await ctx.db
      .query("agentHires")
      .withIndex("by_agent_wallet", (q) =>
        q.eq("chainId", BSC_CHAIN_ID).eq("tokenId", tokenId).eq("walletAddress", walletAddress),
      )
      .unique();

    const existingReview = await ctx.db
      .query("agentReviews")
      .withIndex("by_agent_reviewer", (q) =>
        q.eq("chainId", BSC_CHAIN_ID).eq("tokenId", tokenId).eq("walletAddress", walletAddress),
      )
      .unique();

    const existing = existingReview
      ? {
          outcome: existingReview.outcome,
          wouldHireAgain: existingReview.wouldHireAgain,
          comment: existingReview.comment,
          updatedAt: existingReview.updatedAt,
          onChainTxHash: existingReview.onChainTxHash ?? null,
        }
      : null;

    if (!hire) {
      return {
        eligible: false,
        reason:
          "Only wallets that have hired this agent can review it. That is what keeps these reviews worth reading.",
        existing,
      };
    }

    const age = Date.now() - Date.parse(hire.hiredAt);
    if (Number.isNaN(age) || age < MIN_REVIEW_AGE_MS) {
      const hoursLeft = Number.isNaN(age)
        ? 24
        : Math.max(1, Math.ceil((MIN_REVIEW_AGE_MS - age) / (60 * 60 * 1000)));
      return {
        eligible: false,
        reason: `You can review this agent once you have had it for a day — about ${hoursLeft} more ${hoursLeft === 1 ? "hour" : "hours"}.`,
        existing,
      };
    }

    return { eligible: true, reason: null, existing };
  },
});

export const submitReview = mutation({
  args: {
    sessionToken: v.string(),
    tokenId: v.string(),
    outcome: outcomeValidator,
    wouldHireAgain: v.boolean(),
    comment: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, { sessionToken, tokenId, outcome, wouldHireAgain, comment }) => {
    const walletAddress = await requireWalletAddress(ctx, sessionToken, "submitReview");

    const hire = await ctx.db
      .query("agentHires")
      .withIndex("by_agent_wallet", (q) =>
        q.eq("chainId", BSC_CHAIN_ID).eq("tokenId", tokenId).eq("walletAddress", walletAddress),
      )
      .unique();

    if (!hire) {
      throw new Error(
        "submitReview: only a wallet that has hired this agent can review it, and this one has no hire on record.",
      );
    }

    const age = Date.now() - Date.parse(hire.hiredAt);
    if (Number.isNaN(age) || age < MIN_REVIEW_AGE_MS) {
      throw new Error(
        "submitReview: this hire is less than a day old. A review is meant to describe using the agent, not hiring it.",
      );
    }

    const trimmed = comment?.trim() ?? "";
    if (trimmed.length > REVIEW_COMMENT_MAX_LENGTH) {
      throw new Error(
        `submitReview: the comment is ${trimmed.length} characters and the limit is ${REVIEW_COMMENT_MAX_LENGTH}.`,
      );
    }

    const now = new Date().toISOString();
    const existing = await ctx.db
      .query("agentReviews")
      .withIndex("by_agent_reviewer", (q) =>
        q.eq("chainId", BSC_CHAIN_ID).eq("tokenId", tokenId).eq("walletAddress", walletAddress),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        outcome,
        wouldHireAgain,
        comment: trimmed.length > 0 ? trimmed : null,
        updatedAt: now,
        // Provenance is refreshed too: a hire that has since been paid for, or
        // has run longer, should be described accurately by its own review.
        hiredAt: hire.hiredAt,
        paidJobId: hire.paymentJobId ?? null,
      });
      return null;
    }

    await ctx.db.insert("agentReviews", {
      chainId: BSC_CHAIN_ID,
      tokenId,
      walletAddress,
      outcome,
      wouldHireAgain,
      comment: trimmed.length > 0 ? trimmed : null,
      hiredAt: hire.hiredAt,
      paidJobId: hire.paymentJobId ?? null,
      createdAt: now,
      updatedAt: now,
      onChainTxHash: null,
    });

    return null;
  },
});

/**
 * Records that a review was mirrored into the ERC-8004 Reputation Registry -
 * after reading the transaction back off BNB Chain and checking it really was.
 *
 * ---------------------------------------------------------------------------
 * A WITNESS, NOT A NOTE-TAKER
 * ---------------------------------------------------------------------------
 * This is the same shape as convex/agentPayments.ts's recordJobPayment and for
 * the same reason. The client hands over a transaction hash; everything that
 * matters is then read from the chain and compared against what this backend
 * independently knows. A client that made the hash up, or borrowed someone
 * else's, gets an error naming the failed check rather than an "On-chain" badge.
 *
 * Five checks, and each one exists because of a specific way this could
 * otherwise be lied to:
 *
 *   1. the transaction succeeded          a reverted tx published nothing
 *   2. it was sent to the registry        otherwise it is some unrelated tx
 *   3. its sender is the reviewer         otherwise it is someone else's review
 *   4. its calldata is giveFeedback       right contract, wrong function
 *   5. its agentId is this agent          right function, different agent
 *
 * Nothing here can cause a transaction, only confirm one. Convex holds no key
 * material and this project does not start now.
 */
export const attestReviewOnChain = action({
  args: {
    sessionToken: v.string(),
    tokenId: v.string(),
    transactionHash: v.string(),
  },
  returns: v.object({ transactionHash: v.string() }),
  handler: async (
    ctx,
    { sessionToken, tokenId, transactionHash },
  ): Promise<{ transactionHash: string }> => {
    const reviewer: string = await ctx.runQuery(
      internal.agentReviews.reviewerForSession,
      { sessionToken, tokenId },
    );

    if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) {
      throw new Error(`attestReviewOnChain: "${transactionHash}" is not a transaction hash.`);
    }
    const hash = transactionHash as `0x${string}`;

    const receipt = await bscPublicClient.getTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(
        "That transaction reverted, so nothing was published to the registry. Nothing has been recorded.",
      );
    }
    if (
      !receipt.to ||
      getAddress(receipt.to) !== getAddress(REPUTATION_REGISTRY_ADDRESS)
    ) {
      throw new Error(
        `That transaction was sent to ${receipt.to ?? "a contract creation"}, not to the ERC-8004 ` +
          "Reputation Registry. Refusing to mark a review as published by it.",
      );
    }
    if (getAddress(receipt.from) !== getAddress(reviewer)) {
      throw new Error(
        `That transaction was sent by ${getAddress(receipt.from)}, not by ${getAddress(reviewer)}. ` +
          "A review can only be published by the wallet that wrote it.",
      );
    }

    const transaction = await bscPublicClient.getTransaction({ hash });
    let decoded;
    try {
      decoded = decodeFunctionData({
        abi: REPUTATION_REGISTRY_ABI,
        data: transaction.input,
      });
    } catch {
      throw new Error(
        "That transaction's calldata is not a call this registry's giveFeedback function would produce.",
      );
    }
    if (decoded.functionName !== "giveFeedback") {
      throw new Error(
        `That transaction called ${decoded.functionName}, not giveFeedback.`,
      );
    }

    const agentIdArg = decoded.args[0];
    if (String(agentIdArg) !== tokenId) {
      throw new Error(
        `That transaction left feedback for agent ${String(agentIdArg)}, not agent ${tokenId}.`,
      );
    }

    await ctx.runMutation(internal.agentReviews.setReviewTransaction, {
      tokenId,
      walletAddress: reviewer,
      transactionHash: hash,
    });

    return { transactionHash: hash };
  },
});

/**
 * The signed-in address, but only if it already has a review of this agent.
 *
 * Internal, and deliberately does both jobs at once: an attestation with no
 * review to attach to is meaningless, and checking that here means the action
 * cannot proceed far enough to read a chain on behalf of a caller with nothing
 * at stake.
 */
export const reviewerForSession = internalQuery({
  args: { sessionToken: v.string(), tokenId: v.string() },
  returns: v.string(),
  handler: async (ctx, { sessionToken, tokenId }) => {
    const walletAddress = await requireWalletAddress(
      ctx,
      sessionToken,
      "attestReviewOnChain",
    );

    const review = await ctx.db
      .query("agentReviews")
      .withIndex("by_agent_reviewer", (q) =>
        q.eq("chainId", BSC_CHAIN_ID).eq("tokenId", tokenId).eq("walletAddress", walletAddress),
      )
      .unique();

    if (!review) {
      throw new Error(
        "attestReviewOnChain: there is no Dolphin review by this wallet to attach a transaction to. Save the review first.",
      );
    }

    return walletAddress;
  },
});

export const setReviewTransaction = internalMutation({
  args: {
    tokenId: v.string(),
    walletAddress: v.string(),
    transactionHash: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { tokenId, walletAddress, transactionHash }) => {
    const review = await ctx.db
      .query("agentReviews")
      .withIndex("by_agent_reviewer", (q) =>
        q.eq("chainId", BSC_CHAIN_ID).eq("tokenId", tokenId).eq("walletAddress", walletAddress),
      )
      .unique();

    if (!review) return null;
    await ctx.db.patch(review._id, { onChainTxHash: transactionHash });
    return null;
  },
});

/**
 * Every review of one agent, newest first, plus the summary the detail page
 * shows above them.
 *
 * The reviewer's address is returned in full rather than anonymised: it is
 * already public on-chain, and being able to look up who said something is most
 * of what makes a review checkable rather than merely present.
 */
export const getAgentReviews = query({
  args: { tokenId: v.string() },
  handler: async (ctx, { tokenId }) => {
    const rows = await ctx.db
      .query("agentReviews")
      .withIndex("by_agent", (q) => q.eq("chainId", BSC_CHAIN_ID).eq("tokenId", tokenId))
      .collect();

    const total = rows.length;
    const wouldHireAgain = rows.filter((row) => row.wouldHireAgain).length;
    const paidReviews = rows.filter((row) => row.paidJobId !== null).length;
    const onChainReviews = rows.filter((row) => Boolean(row.onChainTxHash)).length;

    const outcomes = {
      yes: rows.filter((row) => row.outcome === "yes").length,
      partially: rows.filter((row) => row.outcome === "partially").length,
      no: rows.filter((row) => row.outcome === "no").length,
    };

    return {
      total,
      paidReviews,
      onChainReviews,
      outcomes,
      wouldHireAgainCount: wouldHireAgain,
      /**
       * Null below the threshold rather than a small-sample percentage, the
       * same rule convex/agentRetention.ts applies. A caller that gets null
       * must render the counts.
       */
      wouldHireAgainRate: total >= MIN_DENOMINATOR ? wouldHireAgain / total : null,
      reviews: rows
        .map((row) => ({
          walletAddress: row.walletAddress,
          outcome: row.outcome,
          wouldHireAgain: row.wouldHireAgain,
          comment: row.comment,
          paidJobId: row.paidJobId,
          onChainTxHash: row.onChainTxHash ?? null,
          hiredAt: row.hiredAt,
          updatedAt: row.updatedAt,
        }))
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    };
  },
});
