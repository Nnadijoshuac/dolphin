"use client";

import { useAction, useMutation, useQuery } from "convex/react";

import {
  agentRetentionApi,
  agentReviewsApi,
  type ReviewOutcome,
} from "@/convex/api";
import { convexClient } from "@/providers/convex-provider";
import {
  EMPTY_ENDPOINT,
  EMPTY_FEEDBACK_HASH,
  EMPTY_FEEDBACK_URI,
  FEEDBACK_VALUE_DECIMALS,
  REPUTATION_REGISTRY_ABI,
  REPUTATION_REGISTRY_ADDRESS,
  feedbackTagsFor,
  feedbackValueFor,
} from "@/services/reputation-registry";
import { BSC_CHAIN_ID } from "@/constants/agents";
import { useWallet } from "@/wallet/wallet-provider";
import { requireSessionToken, useWalletSession } from "@/wallet/wallet-session";

/**
 * Reviews and retention for one agent.
 *
 * Mirrors src/hooks/use-agent-reviews.ts in the mobile app, which has had these
 * since 2026-09-06. See the note on `agentReviewsApi` in @/convex/api for why
 * the website is only getting them now, and convex/agentReviews.ts for why they
 * are structured outcomes rather than stars.
 *
 * All three gates on writing a review - authenticated, has hired it, hire at
 * least 24 hours old - are enforced in the Convex mutation. These hooks only
 * make the UI agree with the backend, so someone is told why the form is
 * unavailable instead of discovering it on submit. A gate the client owns is
 * not a gate.
 *
 * Same Convex-provider precondition as every other backend hook here: only call
 * these below a configured ConvexClientProvider. `convexClient` is a module
 * constant, so the "skip" branches never change hook order.
 */

export type { ReviewOutcome };

export function useAgentReviews(agentKey: string | null | undefined) {
  return useQuery(
    agentReviewsApi.agentReviews.getAgentReviews,
    convexClient && agentKey ? { agentKey } : "skip",
  );
}

/**
 * Whether the signed-in wallet may review this agent, why not if not, and its
 * existing review if it has one.
 *
 * The session token is an ARGUMENT rather than ambient identity because there
 * is no ambient identity on a Convex query - see convex/lib/walletAuth.ts. A
 * null token is a valid input and returns "sign in first" rather than throwing,
 * which is what lets the form render its real reason to a signed-out visitor.
 */
export function useReviewEligibility(agentKey: string | null | undefined) {
  const session = useWalletSession();

  return useQuery(
    agentReviewsApi.agentReviews.getReviewEligibility,
    convexClient && agentKey
      ? { agentKey, sessionToken: session.sessionToken }
      : "skip",
  );
}

/**
 * Retention: the share of hires still running after 7 and 30 days.
 *
 * The most honest comparison signal this marketplace can produce, and the only
 * one that needs no reviewer at all - it is computed from Dolphin's own hire
 * table. Ships alongside reviews rather than behind them for exactly that
 * reason: an agent with no reviews yet still has a retention record.
 */
export function useAgentRetention(agentKey: string | null | undefined) {
  return useQuery(
    agentRetentionApi.agentRetention.getAgentRetention,
    convexClient && agentKey ? { agentKey } : "skip",
  );
}

export function useSubmitReview() {
  const submit = useMutation(agentReviewsApi.agentReviews.submitReview);
  const session = useWalletSession();

  return async (input: {
    agentKey: string;
    outcome: ReviewOutcome;
    wouldHireAgain: boolean;
    comment: string | null;
  }) => {
    const sessionToken = requireSessionToken(session);
    return submit({ ...input, sessionToken });
  };
}

/**
 * Publishes an already-saved review to the ERC-8004 Reputation Registry.
 *
 * ===========================================================================
 * TWO STEPS, AND NEITHER CAN BE COLLAPSED INTO THE OTHER
 * ===========================================================================
 * 1. The TRANSACTION is sent by the reviewer's own wallet. The registry records
 *    `msg.sender` as the feedback's client, so a review published by Dolphin's
 *    key would be a review BY Dolphin. Dolphin also holds no key that could,
 *    and this project's entire authorization story depends on it never
 *    starting to.
 * 2. The BACKEND is then handed the hash and reads the transaction back off BNB
 *    Chain itself - checking it succeeded, went to the registry, came from this
 *    reviewer, and named this agent. A hash proves nothing on its own; anyone
 *    can pass a string. Only after that does the review claim to be published.
 *
 * This costs real BNB in gas. Every caller must have said so first, in words,
 * before the button is pressed.
 */
/**
 * The bare ERC-8004 token id inside a Dolphin agentKey.
 *
 * `giveFeedback` takes a `uint256 agentId`. An agentKey is
 * "<chainId>:<lowercase registry address>:<tokenId>" and is not a number, so it
 * has to be parsed rather than cast. The mobile app passed the whole composite
 * to `BigInt()`, which threw before the wallet ever opened and meant the
 * on-chain publish path could not have worked for anyone - found and fixed on
 * 2026-09-08 (src/hooks/use-agent-reviews.ts). Mirrors parseAgentKey in
 * convex/model/agent.ts.
 */
function tokenIdFromAgentKey(agentKey: string): bigint {
  const segments = agentKey.split(":");
  const tokenId = segments[segments.length - 1]?.trim() ?? "";

  if (!/^\d+$/.test(tokenId)) {
    throw new Error(
      `Cannot publish this review on-chain: "${agentKey}" does not end in a numeric ERC-8004 token id, ` +
        "and the Reputation Registry keys feedback by that id. Nothing was sent and no gas was spent.",
    );
  }

  return BigInt(tokenId);
}

export function usePublishReviewOnChain() {
  const attest = useAction(agentReviewsApi.agentReviews.attestReviewOnChain);
  const session = useWalletSession();
  const wallet = useWallet();

  return async (input: {
    agentKey: string;
    outcome: ReviewOutcome;
    wouldHireAgain: boolean;
  }) => {
    const sessionToken = requireSessionToken(session);
    const tags = feedbackTagsFor(input.outcome, input.wouldHireAgain);
    /* Parsed before the wallet opens, so a bad key costs no gas and no approval. */
    const agentId = tokenIdFromAgentKey(input.agentKey);

    const transactionHash = await wallet.writeContract({
      address: REPUTATION_REGISTRY_ADDRESS,
      abi: REPUTATION_REGISTRY_ABI,
      functionName: "giveFeedback",
      args: [
        agentId,
        BigInt(feedbackValueFor(input.outcome, input.wouldHireAgain)),
        FEEDBACK_VALUE_DECIMALS,
        tags.tag1,
        tags.tag2,
        EMPTY_ENDPOINT,
        EMPTY_FEEDBACK_URI,
        EMPTY_FEEDBACK_HASH,
      ],
      chainId: BSC_CHAIN_ID,
    });

    await attest({ sessionToken, agentKey: input.agentKey, transactionHash });
    return transactionHash;
  };
}
