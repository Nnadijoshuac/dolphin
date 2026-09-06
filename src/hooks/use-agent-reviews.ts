import { useMutation, useQuery } from "convex/react";

import { api } from "../../convex/_generated/api";
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
