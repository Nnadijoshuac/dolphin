import { describe, expect, it } from "vitest";

import { deliveryCopy, deliveryStateFor, isTerminal, UNSET_DELIVERABLE, type OnChainJob } from "./erc8183-job";

/** Job 56871 as read from the kernel on 2026-10-02: funded, nothing submitted. */
const fundedNothingSubmitted = {
  statusName: "FUNDED",
  deliverable: UNSET_DELIVERABLE,
  submittedAt: 0,
  expiredAt: 1_791_528_087,
} as unknown as OnChainJob;

describe("deliveryStateFor", () => {
  it("reads a funded job the seller refused as declined, not working", () => {
    const state = deliveryStateFor(fundedNothingSubmitted, 60_000, { accepted: false });
    expect(state).toBe("declined");
    expect(isTerminal(state)).toBe(true);
    expect(deliveryCopy(state).label).toBe("Declined by the agent");
  });

  it("still reads working when the seller accepted or was never asked", () => {
    expect(deliveryStateFor(fundedNothingSubmitted, 60_000, { accepted: true })).toBe("working");
    expect(deliveryStateFor(fundedNothingSubmitted, 60_000)).toBe("working");
  });

  it("lets a delivery outrank an earlier refusal", () => {
    const delivered = { ...fundedNothingSubmitted, statusName: "SUBMITTED", deliverable: `0x${"1".repeat(64)}` } as unknown as OnChainJob;
    expect(deliveryStateFor(delivered, 60_000, { accepted: false })).toBe("delivered");
  });
});
