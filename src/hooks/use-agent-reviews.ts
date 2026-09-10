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
    tokenId ? { agentKey: tokenId } : "skip",
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
    tokenId ? { agentKey: tokenId, sessionToken: session.sessionToken } : "skip",
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

/**
 * The bare ERC-8004 token id inside a Dolphin agentKey.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FUNCTION HAD TO BE ADDED (2026-09-08)
 * ---------------------------------------------------------------------------
 * `giveFeedback`'s first parameter is a `uint256 agentId`, and this hook passed
 * `BigInt(input.agentKey)`. An agentKey is NOT a number - it is
 * "<chainId>:<lowercase registry address>:<tokenId>", built by
 * convex/model/agent.ts and byte-identical to 8004scan's own agent_id. Its only
 * caller, src/app/manage/[id].tsx:502, passes `realHire.agentKey`, which is
 * that composite.
 *
 * So `BigInt("56:0x8004a1…:302257")` threw a SyntaxError before the wallet was
 * ever opened, and the whole on-chain publish path - the one feature that makes
 * Dolphin a CONTRIBUTOR to ERC-8004 rather than a reader of it - could not have
 * worked for anyone. Found on 2026-09-08 while porting this hook to the website.
 *
 * Parsing here rather than changing the call site keeps `agentKey` the identity
 * everywhere (AGENTS.md SS9) while giving the contract the one field it wants.
 * Mirrors parseAgentKey in convex/model/agent.ts.
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
  const attest = useAction(api.agentReviews.attestReviewOnChain);
  const session = useWalletSession();
  const wallet = useWallet();

  return async (input: {
    agentKey: string;
    outcome: ReviewOutcome;
    wouldHireAgain: boolean;
    transactionHash?: string;
  }) => {
    const sessionToken = requireSessionToken(session);

    let transactionHash = input.transactionHash;
    if (!transactionHash) {
      /*
       * Parsed BEFORE the wallet is opened, so a malformed key fails with a
       * readable message instead of after the user has approved a transaction.
       */
      const agentId = tokenIdFromAgentKey(input.agentKey);

      const tags = feedbackTagsFor(input.outcome, input.wouldHireAgain);
      transactionHash = await wallet.writeContract({
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
    }

    // The hash alone proves nothing - the backend re-reads it before the review
    // is allowed to claim it was published.
    try {
      await attest({ sessionToken, agentKey: input.agentKey, transactionHash });
    } catch (cause) {
      const error = new Error(
        cause instanceof Error ? cause.message : "Dolphin could not verify that review transaction yet.",
      );
      (error as Error & { transactionHash?: string }).transactionHash = transactionHash;
      throw error;
    }
    return transactionHash;
  };
}

export function useSubmitReview() {
  const submit = useMutation(api.agentReviews.submitReview);
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
