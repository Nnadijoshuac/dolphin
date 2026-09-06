import type { AgentCategory } from "@/types/agent";

export const AUTHORIZATION_CAPABILITIES = [
  "read_only_hire",
  "altana_action_session",
  "erc8183_hire",
] as const;

export type AuthorizationCapability =
  (typeof AUTHORIZATION_CAPABILITIES)[number];

export type CapabilityStatus = "available" | "unavailable";

export const AUTHORIZATION_FACTS = {
  privateKeyImportAllowed: false,
  minimumGrantAndHireTransactions: 2,
  revocationCancelsEscrow: false,
  protocols: {
    erc8004:
      "ERC-8004 provides agent identity and discovery; it does not grant wallet authority or settle payment.",
    altana:
      "Altana sessions grant scoped wallet authority with call limits, spend caps, and expiry.",
    erc8183:
      "ERC-8183 escrows payment for a job; it does not grant an agent control of the buyer's wallet.",
  },
} as const;

export interface AuthorizationAssessment {
  key: `${AgentCategory}:${AuthorizationCapability}`;
  category: AgentCategory;
  capability: AuthorizationCapability;
  status: CapabilityStatus;
  available: boolean;
  reason: string;
  nextStep: string;
  minimumTransactions: number;
  privateKeyImportAllowed: false;
  revocationCancelsEscrow: false;
}

/**
 * Version re-checked 2026-09-06 against the installed package rather than
 * carried forward: `@altananetwork/sdk` is 0.9.0, and its type declarations
 * export exactly four signer factories - createPasskey, signerFromPasskey,
 * createPrivateKeySigner, signerFromPrivateKey. There is still no injected /
 * EIP-1193 signer, so a WalletConnect-connected wallet cannot drive an Altana
 * session. The sentence previously said 0.8, which had stopped being true.
 */
const unavailableActionReason =
  "Action sessions are not available through WalletConnect: @altananetwork/sdk 0.9 ships passkey and private-key signers only, with no injected-wallet signer.";

/**
 * Returns the product capability that Dolphin can truthfully offer today.
 * This intentionally fails closed: unsupported authorization paths never fall
 * back to importing a user's private key.
 */
export function assessAuthorizationCapability(
  category: AgentCategory,
  capability: AuthorizationCapability,
): AuthorizationAssessment {
  const common = {
    key: `${category}:${capability}` as const,
    category,
    capability,
    privateKeyImportAllowed: AUTHORIZATION_FACTS.privateKeyImportAllowed,
    revocationCancelsEscrow: AUTHORIZATION_FACTS.revocationCancelsEscrow,
  };

  if (capability === "read_only_hire") {
    // Generalized from a monitoring-only capability: hireReadOnlyAgent
    // (convex/agentHires.ts) has no category-specific logic, so any
    // category's free-tier agent can be hired the same no-session,
    // no-spend-cap way. Availability is gated by price resolving free at
    // the call site, not by category.
    return {
      ...common,
      status: "available",
      available: true,
      reason:
        "A read-only hire only needs a public wallet address and grants no signing or spending authority.",
      nextStep: "Choose the public wallet address this agent should watch.",
      minimumTransactions: 0,
    };
  }

  if (capability === "erc8183_hire") {
    /*
     * CORRECTED 2026-09-06.
     *
     * This used to return unavailable, with the reason "its WalletConnect
     * transaction path has not been verified in this build". That described the
     * wrong mechanism: an ERC-8183 payment does not go through WalletConnect at
     * all. It settles from the Dolphin Wallet - the Altana passkey smart
     * account - which is a different account from the connected browser wallet
     * and signs with a platform passkey rather than over WalletConnect. The
     * missing injected signer above is a real blocker for SESSIONS and has
     * never been one for PAYMENTS.
     *
     * Meanwhile the path itself is built and exercised end to end:
     * convex/agentPayments.ts relays the quote, the wallet funds the escrow,
     * and recordJobPayment reads the job back off the kernel and refuses
     * anything it cannot verify. Reporting that as unavailable made the app
     * understate what it can actually do, which is the mirror image of the
     * overstatement AGENTS.md §5 guards against and is just as inaccurate.
     *
     * Availability is per-agent, not per-category: it needs a callable A2A
     * endpoint and a registered agent wallet. That is assessHireability's job
     * (src/services/hireability.ts), and callers combine the two.
     */
    return {
      ...common,
      status: "available",
      available: true,
      reason:
        "Paid work settles into an ERC-8183 escrow on BNB Chain. Dolphin reads the funded job back off the contract before it records anything, so a hire is only marked paid once the payment is verifiable on-chain.",
      nextStep:
        "Ask the agent for a quote - that costs nothing and signs nothing - then approve the amount before any funds move.",
      minimumTransactions: AUTHORIZATION_FACTS.minimumGrantAndHireTransactions,
    };
  }

  return {
    ...common,
    status: "unavailable",
    available: false,
    reason:
      capability === "altana_action_session"
        ? unavailableActionReason
        : "This category requires action authority and cannot run as a read-only hire.",
    nextStep:
      "Keep activation unavailable until Altana supports a WalletConnect-compatible signer. Dolphin will never ask for a private key.",
    minimumTransactions:
      capability === "altana_action_session" ? 1 : 0,
  };
}
