import { describe, expect, it } from "vitest";

import { deliveryCopy, deliveryStateFor, isTerminal, UNSET_DELIVERABLE, type OnChainJob } from "./erc8183-job";

/** Job 56871 as read from the kernel on 2026-10-02: funded, nothing submitted. */
const fundedNothingSubmitted = {
  statusName: "FUNDED",
  deliverable: UNSET_DELIVERABLE,
  submittedAt: 0,
  expiredAt: 1_791_528_087,
} as unknown as OnChainJob;
/** A minute after it was funded: expiredAt is funding + 30 min deadline + the 7-day dispute window. */
const minuteAfterFunding = (1_791_528_087 - 604_800 - 1_800 + 60) * 1000;

describe("deliveryStateFor", () => {
  it("reads a funded job the seller refused as declined, not working", () => {
    const state = deliveryStateFor(fundedNothingSubmitted, 60_000, { accepted: false });
    expect(state).toBe("declined");
    expect(isTerminal(state)).toBe(true);
    expect(deliveryCopy(state).label).toBe("Job declined");
  });

  it("still reads working when the seller accepted or was never asked", () => {
    expect(deliveryStateFor(fundedNothingSubmitted, 60_000, { accepted: true }, minuteAfterFunding)).toBe("working");
    expect(deliveryStateFor(fundedNothingSubmitted, 60_000, undefined, minuteAfterFunding)).toBe("working");
  });

  it("reads a funded job past its delivery deadline as missed, not working (job 56880)", () => {
    const pastDeadline = (1_791_528_087 - 604_800 + 1) * 1000;
    const state = deliveryStateFor(fundedNothingSubmitted, 3_600_000, { accepted: true }, pastDeadline);
    expect(state).toBe("missed");
    expect(isTerminal(state)).toBe(true);
    expect(deliveryCopy(state).label).toBe("Not delivered");
  });

  it("lets a delivery outrank an earlier refusal", () => {
    const delivered = { ...fundedNothingSubmitted, statusName: "SUBMITTED", deliverable: `0x${"1".repeat(64)}` } as unknown as OnChainJob;
    expect(deliveryStateFor(delivered, 60_000, { accepted: false })).toBe("delivered");
  });
});
