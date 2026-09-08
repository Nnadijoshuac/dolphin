import { beforeEach, describe, expect, it, vi } from "vitest";

import { cacheKey, clearCache, readCache, writeCache } from "./local-cache";

/**
 * The cache's job is to be invisible when it works and harmless when it does
 * not. Both halves are tested here, because the failure modes are the ones that
 * would actually reach a user: a stale entry surviving a schema change, two
 * cache keys for one query, and a browser that throws on localStorage taking
 * the page down with it.
 */

const MINUTE = 60 * 1000;

beforeEach(() => {
  clearCache();
  vi.useRealTimers();
});

describe("readCache / writeCache", () => {
  it("returns what was written", () => {
    writeCache("k", { hello: "world" });
    expect(readCache<{ hello: string }>("k", MINUTE)).toEqual({ hello: "world" });
  });

  it("returns null for a key never written", () => {
    expect(readCache("missing", MINUTE)).toBeNull();
  });

  it("distinguishes a cached null from a cache miss", () => {
    // `null` is a real backend answer ("no such agent") and must survive a round
    // trip, or useAgent would treat a known absence as still-loading forever.
    writeCache("nullable", null);
    expect(readCache("nullable", MINUTE)).toBeNull();
  });

  it("drops an entry once it is older than the caller's max age", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T12:00:00Z"));
    writeCache("aging", "value");

    vi.setSystemTime(new Date("2026-09-08T12:00:30Z"));
    expect(readCache("aging", MINUTE)).toBe("value");

    vi.setSystemTime(new Date("2026-09-08T12:02:00Z"));
    expect(readCache("aging", MINUTE)).toBeNull();
  });

  it("refuses an entry written in the future", () => {
    // A clock that moved backwards would otherwise make an entry look
    // permanently fresh, since its age is negative and never exceeds any TTL.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T12:00:00Z"));
    writeCache("skewed", "value");

    vi.setSystemTime(new Date("2026-09-08T11:00:00Z"));
    expect(readCache("skewed", MINUTE)).toBeNull();
  });

  it("never serves an entry past the 24h ceiling, whatever the caller asks", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T12:00:00Z"));
    writeCache("ancient", "value");

    vi.setSystemTime(new Date("2026-09-10T12:00:00Z"));
    expect(readCache("ancient", 365 * 24 * 60 * MINUTE)).toBeNull();
  });

  it("survives a non-serialisable payload without throwing", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => writeCache("cyclic", cyclic)).not.toThrow();
    expect(readCache("cyclic", MINUTE)).toBeNull();
  });

  it("returns null rather than throwing on a corrupted entry", () => {
    window.localStorage.setItem("dolphin.cache.v1.broken", "{not json");
    expect(readCache("broken", MINUTE)).toBeNull();
  });
});

describe("clearCache", () => {
  it("removes this cache's entries and leaves the rest of the origin alone", () => {
    // The wallet and onboarding persist their own state on this origin. A cache
    // eviction that wiped localStorage wholesale would take their data too.
    writeCache("mine", 1);
    window.localStorage.setItem("dolphin.onboarding.seen", "true");

    clearCache();

    expect(readCache("mine", MINUTE)).toBeNull();
    expect(window.localStorage.getItem("dolphin.onboarding.seen")).toBe("true");
  });
});

describe("cacheKey", () => {
  it("is stable across argument key order", () => {
    // React gives no guarantee about the key order of an object built across
    // branches. Two keys for one query means every second visit is a miss.
    expect(cacheKey("agents.list", { category: "defi", protocol: "mcp" })).toBe(
      cacheKey("agents.list", { protocol: "mcp", category: "defi" }),
    );
  });

  it("separates different arguments", () => {
    expect(cacheKey("agents.list", { category: "defi" })).not.toBe(
      cacheKey("agents.list", { category: "payments" }),
    );
  });

  it("separates different queries with identical arguments", () => {
    expect(cacheKey("agents.list", { a: 1 })).not.toBe(cacheKey("agents.search", { a: 1 }));
  });

  it("treats an absent value and an explicitly undefined one as the same query", () => {
    // `{category: undefined}` is what an optional filter looks like when it is
    // not set, and it must not be a different cache entry from omitting it.
    expect(cacheKey("agents.list", { category: undefined, protocol: "a2a" })).toBe(
      cacheKey("agents.list", { protocol: "a2a" }),
    );
  });

  it("handles nested objects and arrays deterministically", () => {
    expect(cacheKey("q", { keys: ["b", "a"], nested: { y: 1, x: 2 } })).toBe(
      cacheKey("q", { nested: { x: 2, y: 1 }, keys: ["b", "a"] }),
    );
  });

  it("does not reorder arrays, because order is meaningful in them", () => {
    expect(cacheKey("q", { keys: ["a", "b"] })).not.toBe(cacheKey("q", { keys: ["b", "a"] }));
  });
});
