// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { markAskIntent, takeAskIntent } from "@/lib/ask-intent";

describe("ask intent (a real click before an automatic question)", () => {
  afterEach(() => vi.useRealTimers());

  it("a fresh click on this agent lets the chat send, once", () => {
    markAskIntent("56:0xabc:1");
    expect(takeAskIntent("56:0xabc:1")).toBe(true);
    expect(takeAskIntent("56:0xabc:1")).toBe(false);
  });

  it("no click - a crawler or a pasted link - never sends", () => {
    expect(takeAskIntent("56:0xabc:1")).toBe(false);
  });

  it("a click on another agent, or an old click, does not count", () => {
    markAskIntent("56:0xabc:2");
    expect(takeAskIntent("56:0xabc:1")).toBe(false);
    vi.useFakeTimers();
    markAskIntent("56:0xabc:1");
    vi.advanceTimersByTime(121_000);
    expect(takeAskIntent("56:0xabc:1")).toBe(false);
  });
});
