import type { Address } from "viem";

import { ERC8004_REGISTRY_ADDRESSES } from "@/constants/agents";
import type { ReviewOutcome } from "@/hooks/use-agent-reviews";

/**
 * The ERC-8004 Reputation Registry on BNB Smart Chain, and how a Dolphin review
 * is expressed as a feedback entry in it.
 *
 * ===========================================================================
 * VERIFICATION RECORD (2026-09-06) — AGENTS.md §9
 * ===========================================================================
 * AGENTS.md forbids writing a contract address or interface into this codebase
 * without independent verification, and this is a WRITE path where a wrong
 * signature costs a user real BNB in a reverted transaction. Everything below
 * was checked against the chain itself before any of it was written. The probe
 * scripts are kept in `Agent/scratch/erc8004/`.
 *
 * 1. THE ADDRESS HOLDS A CONTRACT, AND IT IS A PROXY.
 *    `eth_getCode` on 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63 returns 130
 *    bytes - an ERC-1967 forwarding stub, not an implementation. Reading the
 *    ERC-1967 implementation slot
 *    (0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc)
 *    gives 0x16e0FA7f7C56B9a767E34B192B51f921BE31dA34, which holds 10,491
 *    bytes. Probing the proxy's own bytecode for function selectors finds
 *    none, which is why the first probe came back empty and is worth recording:
 *    "no selectors found" meant "this is a proxy", not "wrong address".
 *
 * 2. THE WRITE FUNCTION'S SELECTOR IS IN THE DEPLOYED IMPLEMENTATION.
 *    Every PUSH4 constant in the implementation bytecode was extracted (36 of
 *    them) and 0x3c036a7e is among them. That is this exact signature, present
 *    in the code that will actually run.
 *
 * 3. AN INDEPENDENT SIGNATURE DATABASE AGREES.
 *    api.openchain.xyz resolves 0x3c036a7e to
 *    giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32).
 *
 * 4. THE SPEC AGREES, AND NAMES THE PARAMETERS.
 *    EIP-8004's Reputation Registry interface declares
 *    `giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals,
 *    string tag1, string tag2, string endpoint, string feedbackURI,
 *    bytes32 feedbackHash)` - the same eight types in the same order, which is
 *    what makes the parameter MEANINGS below sourced rather than guessed.
 *
 * 5. THIS REGISTRY IS PAIRED WITH THE IDENTITY REGISTRY DOLPHIN ALREADY READS.
 *    Calling `getIdentityRegistry()` on the proxy returns
 *    0x8004A169FB4a3325136EB29fA0ceB6D2e539a432, byte-for-byte the address in
 *    ERC8004_REGISTRY_ADDRESSES.identity. This is the check that rules out a
 *    correctly-shaped contract belonging to a different deployment.
 *    `getVersion()` returns "2.0.0".
 *
 * 6. A REAL ENTRY DECODES CORRECTLY.
 *    Agent #1 has one client; `readFeedback` for its latest index returns
 *    value=100, valueDecimals=0, tag1="get top 1 rank >",
 *    tag2="t.me/agent_bldr", isRevoked=false. So the ABI round-trips against
 *    live data, and the 0-100 / zero-decimals scale below is the convention
 *    actually in use on this deployment rather than one this file invented.
 *
 * CONFIDENCE: high. Four independent sources agree (deployed bytecode, public
 * selector database, the EIP text, and a live read), and the pairing check in
 * (5) ties it to the registry the rest of this app already trusts.
 */

/**
 * The proxy, not the implementation. Calls must go to the proxy so an upgrade
 * does not strand this app on an old implementation.
 */
export const REPUTATION_REGISTRY_ADDRESS: Address =
  ERC8004_REGISTRY_ADDRESSES.reputation;

/**
 * Only what Dolphin calls. A partial ABI is deliberate - an ABI is a claim
 * about what a contract does, and this file should only claim the parts that
 * were verified above and are actually used.
 *
 * MIRRORED BY HAND in convex/lib/reputationRegistry.ts, which needs the same
 * ABI to witness a transaction server-side and cannot import from src/. Same
 * manual-sync rule as convex/lib/liveMetric.ts: change both in one commit.
 */
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
  {
    type: "function",
    name: "readFeedback",
    stateMutability: "view",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "clientAddress", type: "address" },
      { name: "feedbackIndex", type: "uint64" },
    ],
    outputs: [
      { name: "value", type: "int128" },
      { name: "valueDecimals", type: "uint8" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
      { name: "isRevoked", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "getLastIndex",
    stateMutability: "view",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "clientAddress", type: "address" },
    ],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "getIdentityRegistry",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

/**
 * Dolphin's review is two structured answers; the registry's `value` is one
 * number. This is the projection between them, and it is LOSSY BY
 * CONSTRUCTION - which is exactly why the two real answers also go on-chain,
 * in tag1 and tag2, rather than only their sum.
 *
 * Anyone reading this agent's feedback back gets the authoritative answers as
 * tags and the number as a convenience. Nothing about the review is
 * reconstructed from the score.
 *
 * The scale is 0-100 with zero decimals, because that is what the live entry
 * in verification note (6) uses. Picking a different scale would be legal and
 * would make Dolphin's entries incomparable with everyone else's.
 */
export const FEEDBACK_VALUE_DECIMALS = 0;

const VALUE_BY_ANSWER: Readonly<Record<ReviewOutcome, { yes: number; no: number }>> = {
  // [wouldHireAgain]
  yes: { yes: 100, no: 70 },
  partially: { yes: 60, no: 35 },
  no: { yes: 20, no: 0 },
};

export function feedbackValueFor(
  outcome: ReviewOutcome,
  wouldHireAgain: boolean,
): number {
  return VALUE_BY_ANSWER[outcome][wouldHireAgain ? "yes" : "no"];
}

/**
 * The tags. Short, because every character is calldata the user pays for, and
 * machine-readable, because the point of putting a review on a public registry
 * is that something other than Dolphin can read it.
 */
export function feedbackTagsFor(
  outcome: ReviewOutcome,
  wouldHireAgain: boolean,
): { tag1: string; tag2: string } {
  return {
    tag1: `outcome:${outcome}`,
    tag2: `rehire:${wouldHireAgain ? "yes" : "no"}`,
  };
}

/**
 * `feedbackURI` and `feedbackHash` are left empty.
 *
 * The spec describes feedbackURI as pointing at an off-chain JSON file, with
 * feedbackHash guaranteeing its integrity. Dolphin hosts no such file. Passing
 * a URL to something that is not that JSON - an agent's page on the website,
 * say - would put a broken promise on a public registry permanently, and
 * passing a hash of nothing would be worse. Empty is the honest value, and it
 * costs less gas.
 *
 * The consequence is stated in the UI rather than hidden: a published review's
 * comment text stays in Dolphin. The two structured answers are what go
 * on-chain.
 */
export const EMPTY_FEEDBACK_URI = "";
export const EMPTY_FEEDBACK_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

/** The spec marks `endpoint` OPTIONAL and Dolphin has nothing to put in it. */
export const EMPTY_ENDPOINT = "";
