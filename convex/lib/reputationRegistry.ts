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
