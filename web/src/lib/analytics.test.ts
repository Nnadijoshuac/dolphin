import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

import { track as vercelTrack } from "@vercel/analytics";
import { track } from "@/lib/analytics";

/**
 * The analytics module's job is as much about what it CANNOT send as what it
 * can. These tests pin the privacy properties, because they are the ones a
 * future change would erode silently: adding a field to an event object is a
 * one-line diff that no reviewer would flag as a privacy decision.
 */
describe("analytics", () => {
  beforeEach(() => {
    vi.mocked(vercelTrack).mockClear();
  });

  it("forwards a declared event with its properties", () => {
    track("agent_viewed", {
      agentKey: "56:0x8004a169:302257",
      category: "yield",
      hasLiveStats: true,
      hasPerformanceSeries: false,
    });

    expect(vercelTrack).toHaveBeenCalledWith("agent_viewed", {
      agentKey: "56:0x8004a169:302257",
      category: "yield",
      hasLiveStats: true,
      hasPerformanceSeries: false,
    });
  });

  it("never lets a telemetry failure reach the caller", () => {
    // A blocked script, an ad-blocker, a quota error and a server render all
    // land in the same place, and all of them are strictly less important than
    // the page the user came for.
    vi.mocked(vercelTrack).mockImplementationOnce(() => {
      throw new Error("blocked by client");
    });

    expect(() =>
      track("catalog_viewed", { surface: "discover", categoryCount: 13 }),
    ).not.toThrow();
  });

  it("carries no wallet address in the search event", () => {
    // `search_submitted` deliberately records the query's LENGTH, never its
    // text, and no identity at all.
    track("search_submitted", {
      queryLength: 11,
      category: null,
      resultCount: 4,
    });

    const [, properties] = vi.mocked(vercelTrack).mock.calls[0];
    expect(Object.keys(properties as object)).toEqual([
      "queryLength",
      "category",
      "resultCount",
    ]);
    expect(JSON.stringify(properties)).not.toMatch(/0x[0-9a-f]{6}/i);
  });

  it("records that a wallet connected without recording which wallet", () => {
    track("wallet_connected", { connector: "identity", surface: "agent" });

    const [, properties] = vi.mocked(vercelTrack).mock.calls[0];
    expect(properties).toEqual({ connector: "identity", surface: "agent" });
    // An address is a pseudonymous handle on someone's entire financial
    // history. Joining it to behavioural events is the one thing this module
    // must never make easy.
    expect(Object.keys(properties as object)).not.toContain("address");
    expect(Object.keys(properties as object)).not.toContain("walletAddress");
  });

  it("records a failed hire as a kind, not a message", () => {
    // Messages carry user data and vendor strings; kinds are comparable across
    // releases and cannot leak a revert payload or an RPC URL.
    track("hire_failed", { agentKey: "56:0xabc:1", reason: "declined", stage: "identity" });

    const [, properties] = vi.mocked(vercelTrack).mock.calls[0];
    expect((properties as { reason: string }).reason).toBe("declined");
    // The step is a closed enum too, for the same reason the kind is one.
    expect((properties as { stage: string }).stage).toBe("identity");
    expect(Object.keys(properties as object)).not.toContain("message");
  });
});
