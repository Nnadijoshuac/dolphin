import { describe, expect, it } from "vitest";

/**
 * The normalisation that convex-provider.tsx applies to NEXT_PUBLIC_CONVEX_URL.
 *
 * Kept as a pure function here rather than imported from the provider, because
 * importing that module constructs a real ConvexReactClient as a side effect of
 * evaluation — there is no way to test the expression without opening a socket.
 * The duplication is one regex; the thing being protected is the whole site.
 *
 * WHY THIS EXISTS: on 2026-09-13 the deployment URL was saved in Vercel with a
 * trailing slash. The Convex client appends its own path, so it opened
 * `wss://<deployment>.convex.cloud//api/1.45.0/sync` — note the double slash —
 * and the server 404'd the WebSocket handshake three times before giving up.
 * Every query hung in its loading state, and because this codebase renders a
 * missing backend as a calm empty state, the outage looked exactly like a
 * marketplace that had no agents in it.
 */
function normalizeConvexUrl(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim().replace(/\/+$/, "");
  return trimmed ? trimmed : undefined;
}

const DEPLOYMENT = "https://successful-ladybug-659.eu-west-1.convex.cloud";

describe("normalizeConvexUrl", () => {
  it("passes a correct URL through untouched", () => {
    expect(normalizeConvexUrl(DEPLOYMENT)).toBe(DEPLOYMENT);
  });

  /* The exact input that broke production. */
  it("strips a single trailing slash", () => {
    expect(normalizeConvexUrl(`${DEPLOYMENT}/`)).toBe(DEPLOYMENT);
  });

  it("strips several trailing slashes", () => {
    expect(normalizeConvexUrl(`${DEPLOYMENT}///`)).toBe(DEPLOYMENT);
  });

  it("strips surrounding whitespace, which pasting also adds", () => {
    expect(normalizeConvexUrl(`  ${DEPLOYMENT}/  `)).toBe(DEPLOYMENT);
  });

  /*
   * An unset or blank URL must stay falsy so the provider renders children
   * WITHOUT a client rather than constructing one against "". That is the
   * documented "degrade, don't crash" path for a deployment with no backend.
   */
  it("treats unset, empty and whitespace-only as absent", () => {
    expect(normalizeConvexUrl(undefined)).toBeUndefined();
    expect(normalizeConvexUrl("")).toBeUndefined();
    expect(normalizeConvexUrl("   ")).toBeUndefined();
  });

  /*
   * A lone "/" collapses to empty and must be treated as absent, not as a
   * relative URL the client would try to connect to.
   */
  it("treats a lone slash as absent", () => {
    expect(normalizeConvexUrl("/")).toBeUndefined();
  });

  it("does not touch slashes that are not at the end", () => {
    expect(normalizeConvexUrl("https://example.com/path/to/thing")).toBe(
      "https://example.com/path/to/thing",
    );
  });
});
