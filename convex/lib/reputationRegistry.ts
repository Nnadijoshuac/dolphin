/**
 * The ERC-8004 Reputation Registry, server side.
 *
 * MIRRORED BY HAND from src/services/reputation-registry.ts, which carries the
 * full verification record for the address and the ABI (four independent
 * sources, plus the getIdentityRegistry() pairing check). Convex functions are
 * bundled from convex/ only and cannot import from src/, which is the same
 * reason convex/lib/liveMetric.ts and convex/lib/agentCatalog.ts are duplicated.
 * If one changes, change the other in the same commit and say so in the message.
 *
 * This copy exists for ONE purpose: witnessing a transaction someone claims
 * published their review. It therefore carries the write function's ABI so the
 * transaction's calldata can be decoded and checked, and nothing else it does
 * not need.
 */

/** The proxy. Calls and comparisons both use this, never the implementation. */
export const REPUTATION_REGISTRY_ADDRESS =
  "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63";

/**
 * The identity registry THIS reputation registry attests for.
 *
 * NOT a new address: it is the primary ERC-8004 AgentIdentity registry already
 * used throughout this codebase, and the pairing was established by calling the
 * reputation registry's own `getIdentityRegistry()` during the 2026-09-06
 * verification (Agent/SESSION-LOG-2026-09-06-audit-and-remediation.md §6, one of
 * the six checks run before a line of the review-attestation path was written).
 *
 * Named here because the agentKey re-key made the pairing matter operationally
 * rather than only as documentation: a feedback transaction names a bare
 * `agentId`, so "token 25" only identifies an agent once you know which registry
 * it belongs to. `attestReviewOnChain` compares against this.
 */
export const REPUTATION_REGISTRY_IDENTITY =
  "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

export const REPUTATION_REGISTRY_ABI = [
  {
    type: "function",
    name: "giveFeedback",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "value", type: "int128" },
      { name: "valueDecimals", type: "uint8" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
      { name: "endpoint", type: "string" },
      { name: "feedbackURI", type: "string" },
      { name: "feedbackHash", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;
