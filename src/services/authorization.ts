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

const unavailableActionReason =
  "Action sessions are not available through WalletConnect because @altananetwork/sdk 0.8 does not support injected wallet signers.";

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
    return {
      ...common,
      status: "unavailable",
      available: false,
      reason:
        "ERC-8183 hiring is a separate payment escrow, and its WalletConnect transaction path has not been verified in this build.",
      nextStep:
        "Keep Hire unavailable until escrow funding and settlement pass an end-to-end WalletConnect test.",
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
