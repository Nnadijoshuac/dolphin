import { describe, expect, it } from "vitest";
import { BaseError, ContractFunctionExecutionError, UserRejectedRequestError } from "viem";

import { classifyConnectError, toUserMessage } from "./wallet-errors";

/**
 * The rule this file defends, in both directions at once:
 *
 *  - a dependency's NAME or VERSION must never reach a screen (the 2026-09-01
 *    bug, still closed), and
 *  - a failure must still SAY something, because "Try again." is not advice
 *    when trying again does the identical thing (the 2026-09-12 bug).
 *
 * Those pull against each other, which is why the old code satisfied the first
 * by sacrificing the second. Every case below asserts both.
 */

const FALLBACK = "The hire could not be recorded. Try again.";

describe("toUserMessage", () => {
  it("passes Dolphin's own deliberate refusals through unchanged", () => {
    // hireReadOnlyAgent's real copy. These are written for the user and are
    // the whole reason this function does not simply always return a fallback.
    const message =
      "hireReadOnlyAgent: agent 56:0xabc:341225 charges 100000000000000000 " +
      "0xcE24439F2D9C6a2289F741120FE202248B666666 (flat), so a hire needs a paid ERC-8183 job.";

    expect(toUserMessage(new Error(message), FALLBACK)).toBe(message);
  });

  it("shows a viem error's shortMessage instead of discarding it", () => {
    // The regression this file exists for. viem's `message` concatenates
    // shortMessage with its Details/Version block; shortMessage carries
    // neither, so it is safe AND it is the only description of what happened.
    const cause = new ContractFunctionExecutionError(
      new BaseError("Execution reverted."),
      { abi: [], functionName: "fund" },
    );

    const result = toUserMessage(cause, FALLBACK);

    expect(result).not.toBe(FALLBACK);
    expect(result).toBe(cause.shortMessage.replace(/\s+/g, " ").trim());
  });

  it("never lets a dependency name and version reach the screen", () => {
    // Belt and braces: a library error wrapped in a plain Error upstream, so
    // there is no shortMessage to prefer and the raw message is all there is.
    const leaky = new Error(
      "Something failed.\nDetails: reverted\nVersion: viem@2.56.0",
    );
    expect(toUserMessage(leaky, FALLBACK)).toBe("Something failed.");

    // And the case where the version survives on the first line anyway.
    expect(toUserMessage(new Error("viem@2.56.0 exploded"), FALLBACK)).toBe(FALLBACK);
  });

  it("unwraps a Convex server error to the sentence the handler threw", () => {
    // Convex wraps a backend throw in a function path, a request id and a
    // stack. Only the middle line was written for a person.
    const convex = new Error(
      "[CONVEX M(agentHires:hireReadOnlyAgent)] [Request ID: 4f2a] Server Error\n" +
        "Uncaught Error: Job 12 is still OPEN - its escrow was never funded.\n" +
        "    at handler (../convex/agentHires.ts:140:8)\n" +
        "    at async invokeMutation (../convex/server.ts:1:1)",
    );

    expect(toUserMessage(convex, FALLBACK)).toBe(
      "Job 12 is still OPEN - its escrow was never funded.",
    );
  });

  it("treats a dismissed wallet prompt as a choice, not a crash", () => {
    const result = toUserMessage(new UserRejectedRequestError(new Error("denied")), FALLBACK);

    expect(result).toContain("nothing was spent");
    // Must not name connecting specifically - the same rejection arrives from
    // a sign-in signature and from approving a payment.
    expect(result).not.toContain("Connection cancelled");
  });

  it("caps a message Dolphin did not write", () => {
    // A seller's A2A endpoint can put arbitrary prose in a JSON-RPC error and
    // agentPayments relays it verbatim.
    const flood = new Error("x".repeat(5_000));
    const result = toUserMessage(flood, FALLBACK);

    expect(result.length).toBe(400);
    expect(result.endsWith("…")).toBe(true);
  });

  it("falls back when there is genuinely nothing to say", () => {
    expect(toUserMessage(new Error(""), FALLBACK)).toBe(FALLBACK);
    expect(toUserMessage(undefined, FALLBACK)).toBe(FALLBACK);
    expect(toUserMessage("a thrown string", FALLBACK)).toBe(FALLBACK);
  });
});

describe("classifyConnectError", () => {
  it("classifies on name and code, never on prose", () => {
    expect(classifyConnectError(new UserRejectedRequestError(new Error("x")))).toBe("cancelled");
    expect(classifyConnectError({ code: 4001 })).toBe("cancelled");
    expect(classifyConnectError({ code: -32002 })).toBe("busy");
    // Wrapped one level down - wagmi wraps viem, which wraps the provider.
    expect(classifyConnectError({ cause: { code: 4001 } })).toBe("cancelled");
    expect(classifyConnectError(new Error("User rejected the request"))).toBe("unknown");
  });
});
