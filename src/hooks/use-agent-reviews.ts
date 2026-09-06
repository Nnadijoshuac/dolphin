import { useAction, useMutation, useQuery } from "convex/react";

import { api } from "../../convex/_generated/api";
import { BSC_CHAIN_ID } from "@/constants/agents";
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
import { useWallet } from "@/wallet/wallet-provider";
import { requireSessionToken, useWalletSession } from "@/wallet/wallet-session";

/**
 * Reviews for one agent, plus whether the current wallet may write one.
 *
 * See convex/agentReviews.ts for why these are structured outcomes rather than
 * stars, and for the three gates a reviewer has to pass. All three are enforced
 * server-side; these hooks only make the UI agree with them, so a user is told
 * why the form is unavailable instead of finding out on submit.
 *
 * Same Convex-provider precondition as the other backend hooks: only call these
 * from a subtree mounted under a configured ConvexClientProvider.
 */

export type ReviewOutcome = "yes" | "partially" | "no";

export function useAgentReviews(tokenId: string | null | undefined) {
  return useQuery(
    api.agentReviews.getAgentReviews,
    tokenId ? { tokenId } : "skip",
  );
}

/**
 * Whether this wallet can review this agent, the reason if not, and its
 * existing review if it has one.
 *
 * The session token is passed as an argument rather than read server-side,
 * because there is no ambient identity on a Convex query - see
 * convex/lib/walletAuth.ts for why the session is a bearer token.
 */
export function useReviewEligibility(tokenId: string | null | undefined) {
  const session = useWalletSession();

  return useQuery(
    api.agentReviews.getReviewEligibility,
    tokenId ? { tokenId, sessionToken: session.sessionToken } : "skip",
  );
}

/**
 * Publishes an already-saved review to the ERC-8004 Reputation Registry, from
 * the reviewer's own wallet, and then asks the backend to verify it.
 *
 * TWO STEPS ON PURPOSE. The transaction is sent by the user's wallet, because
 * the registry records `msg.sender` as the feedback's client - Dolphin cannot
 * send it on anyone's behalf and holds no key that could. The backend is then
 * given the hash and reads the transaction back off BNB Chain itself, checking
 * it succeeded, went to the registry, came from this reviewer, called
 * giveFeedback, and named this agent. Only then is the review marked as
 * published. See attestReviewOnChain in convex/agentReviews.ts.
 *
 * This costs real BNB in gas. Every caller must have said so first.
 */
export function usePublishReviewOnChain() {
  const attest = useAction(api.agentReviews.attestReviewOnChain);
  const session = useWalletSession();
  const wallet = useWallet();

  return async (input: {
    tokenId: string;
    outcome: ReviewOutcome;
    wouldHireAgain: boolean;
  }) => {
    const sessionToken = requireSessionToken(session);

    const tags = feedbackTagsFor(input.outcome, input.wouldHireAgain);
    const transactionHash = await wallet.writeContract({
      address: REPUTATION_REGISTRY_ADDRESS,
      abi: REPUTATION_REGISTRY_ABI,
      functionName: "giveFeedback",
      args: [
        BigInt(input.tokenId),
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

    // The hash alone proves nothing - the backend re-reads it before the review
    // is allowed to claim it was published.
    await attest({ sessionToken, tokenId: input.tokenId, transactionHash });
    return transactionHash;
  };
}

export function useSubmitReview() {
  const submit = useMutation(api.agentReviews.submitReview);
  const session = useWalletSession();

  return async (input: {
    tokenId: string;
    outcome: ReviewOutcome;
    wouldHireAgain: boolean;
    comment: string | null;
  }) => {
    const sessionToken = requireSessionToken(session);
    return submit({ ...input, sessionToken });
  };
}
