import { describe, expect, it } from "vitest";

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

/**
 * The reputation-registry write path.
 *
 * This is the one place in the website that spends a user's own BNB, and it is
 * mirrored by hand into three files (here, the mobile app, and Convex). Both of
 * those facts make it worth pinning: a silent change to the ABI or to the
 * 0-100 value scale would produce either a reverted transaction the user pays
 * for, or an entry on a public registry that is incomparable with everyone
 * else's and cannot be withdrawn.
 */
describe("reputation registry constants", () => {
  it("targets the ERC-8004 reputation proxy, not the implementation", () => {
    // Verified on-chain: the proxy at this address forwards to
    // 0x16e0FA7f7C56B9a767E34B192B51f921BE31dA34, and calls must go to the
    // proxy so an upgrade does not strand this app on an old implementation.
    expect(REPUTATION_REGISTRY_ADDRESS).toBe(
      "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
    );
  });

  it("declares giveFeedback with the exact eight EIP-8004 parameters, in order", () => {
    const giveFeedback = REPUTATION_REGISTRY_ABI.find(
      (entry) => entry.type === "function" && entry.name === "giveFeedback",
    );

    expect(giveFeedback).toBeDefined();
    expect(giveFeedback?.inputs.map((input) => input.type)).toEqual([
      "uint256",
      "int128",
      "uint8",
      "string",
      "string",
      "string",
      "string",
      "bytes32",
    ]);
  });

  it("uses the 0-100 zero-decimal scale the live deployment already uses", () => {
    // Picking a different scale would be legal and would make Dolphin's entries
    // incomparable with every other client's. Verified against a real entry:
    // agent #1's feedback reads value=100, valueDecimals=0.
    expect(FEEDBACK_VALUE_DECIMALS).toBe(0);

    for (const outcome of ["yes", "partially", "no"] as const) {
      for (const rehire of [true, false]) {
        const value = feedbackValueFor(outcome, rehire);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
        expect(Number.isInteger(value)).toBe(true);
      }
    }
  });

  it("orders the score monotonically in both answers", () => {
    // The projection from two structured answers to one number is lossy by
    // construction, but it must not be INCOHERENT: a better outcome and a
    // willingness to rehire can never score lower.
    expect(feedbackValueFor("yes", true)).toBeGreaterThan(
      feedbackValueFor("partially", true),
    );
    expect(feedbackValueFor("partially", true)).toBeGreaterThan(
      feedbackValueFor("no", true),
    );

    for (const outcome of ["yes", "partially", "no"] as const) {
      expect(feedbackValueFor(outcome, true)).toBeGreaterThan(
        feedbackValueFor(outcome, false),
      );
    }
  });

  it("puts the authoritative answers in the tags, not only in the score", () => {
    // The score is lossy; the tags are not. Anyone reading this agent's
    // feedback back must be able to recover what was actually said.
    expect(feedbackTagsFor("partially", false)).toEqual({
      tag1: "outcome:partially",
      tag2: "rehire:no",
    });
    expect(feedbackTagsFor("yes", true)).toEqual({
      tag1: "outcome:yes",
      tag2: "rehire:yes",
    });
  });

  it("leaves feedbackURI and feedbackHash empty rather than pointing at nothing", () => {
    // Dolphin hosts no off-chain JSON. A URL to something that is not that JSON
    // would be a broken promise written permanently to a public registry, and a
    // hash of nothing would be worse.
    expect(EMPTY_FEEDBACK_URI).toBe("");
    expect(EMPTY_ENDPOINT).toBe("");
    expect(EMPTY_FEEDBACK_HASH).toBe(`0x${"0".repeat(64)}`);
  });
});
