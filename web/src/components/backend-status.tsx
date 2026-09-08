"use client";

import { useEffect, useRef, useState } from "react";

import { CategoryGlyph } from "@/components/category-glyph";
import { track, type AnalyticsSurface } from "@/lib/analytics";
import { convexClient } from "@/providers/convex-provider";

/**
 * ===========================================================================
 * "THE CATALOG IS EMPTY" AND "I CANNOT REACH THE CATALOG" ARE DIFFERENT
 * SENTENCES, AND THE SITE USED TO SAY THE FIRST ONE FOR BOTH. (2026-09-08)
 * ===========================================================================
 *
 * WHAT WAS THERE. Both list pages hardcoded their own error state to false:
 *
 *     const isError = false;                    // app/page.tsx
 *     const refetch = () => undefined;
 *     const isError = false;                    // app/search/page.tsx
 *
 * Every error branch downstream was therefore unreachable dead code - the
 * "Catalog unavailable" notice, the "latest refresh failed" alert and its Retry
 * button, the "Search unavailable" panel. All written, all rendered by a
 * condition that could not become true.
 *
 * WHAT ACTUALLY HAPPENED when Convex was unreachable: `usePaginatedQuery` never
 * resolves, `results` stays empty, `status` leaves LoadingFirstPage, and the
 * page told the user
 *
 *     "The shared catalog does not contain any agent records yet."
 *
 * That is the product asserting a fact about the world - there are no agents -
 * when the truth is it could not reach its own backend. AGENTS.md SS5 forbids
 * presenting a fabricated number as live; a fabricated ABSENCE is the same
 * failure and a worse one, because an empty marketplace looks like a verdict
 * rather than a fault. This is not hypothetical: convex-provider.tsx records
 * that this site spent time pointed at a dead deployment on 2026-09-07, and
 * with no error path it would have looked simply unpopular.
 *
 * ===========================================================================
 * WHY THE CONNECTION STATE AND NOT A THROWN ERROR
 * ===========================================================================
 * Convex's React hooks do not hand a caller an `isError`. A query that fails
 * server-side THROWS, to be caught by an error boundary (there is one, in
 * app/error.tsx). But the failure that matters here is not a throwing query -
 * it is a socket that never opens, because the URL is wrong, the deployment is
 * gone, or the user is offline. In that case nothing throws and nothing
 * resolves; the client retries forever behind a spinner.
 *
 * `ConvexReactClient.subscribeToConnectionState()` is the only thing that can
 * see that, so it is what this reads.
 */

/** How long a first connection may take before it is reported as a problem. */
const CONNECTING_GRACE_MS = 6_000;

export type BackendStatus =
  /** NEXT_PUBLIC_CONVEX_URL is not set. A deployment fault, not a network one. */
  | { kind: "unconfigured"; reason: string }
  /** Socket is open. Anything empty on screen is genuinely empty. */
  | { kind: "connected" }
  /** Still opening the first socket, inside the grace window. */
  | { kind: "connecting" }
  /** Retrying, or past the grace window with nothing open. */
  | { kind: "unreachable"; reason: string };

const UNCONFIGURED_REASON =
  "NEXT_PUBLIC_CONVEX_URL is not set in this deployment, so there is no catalog to read.";

/**
 * Whether the shared catalog is actually reachable right now.
 *
 * Safe to call above a missing provider: `convexClient` is a module constant,
 * so branching on it never changes hook order.
 */
export function useBackendStatus(): BackendStatus {
  const [status, setStatus] = useState<BackendStatus>(() =>
    convexClient
      ? { kind: "connecting" }
      : { kind: "unconfigured", reason: UNCONFIGURED_REASON },
  );

  useEffect(() => {
    const client = convexClient;
    if (!client) return undefined;

    /*
     * The grace timer is armed once per mount rather than reset on every state
     * change. A client that is flapping - connecting, dropping, reconnecting -
     * would otherwise never exhaust its grace period and would look healthy
     * forever, which is precisely the state a user most needs told about.
     */
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      setStatus((current) =>
        current.kind === "connecting"
          ? {
              kind: "unreachable",
              reason:
                "The catalog did not answer. This is a connection problem, not an empty catalog.",
            }
          : current,
      );
    }, CONNECTING_GRACE_MS);

    const apply = () => {
      const state = client.connectionState();

      if (state.isWebSocketConnected) {
        setStatus({ kind: "connected" });
        return;
      }

      if (state.connectionRetries > 0) {
        setStatus({
          kind: "unreachable",
          reason: state.hasEverConnected
            ? "The connection to the catalog dropped and has not come back."
            : "Dolphin could not open a connection to the shared catalog.",
        });
        return;
      }

      setStatus(
        expired
          ? {
              kind: "unreachable",
              reason:
                "The catalog did not answer. This is a connection problem, not an empty catalog.",
            }
          : { kind: "connecting" },
      );
    };

    apply();
    const unsubscribe = client.subscribeToConnectionState(apply);

    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  return status;
}

/**
 * Reports an unreachable backend exactly once per outage, so the ONE question
 * this whole module exists to make answerable - "was anyone looking while it
 * was down?" - has an answer.
 */
export function useReportBackendStatus(
  status: BackendStatus,
  surface: AnalyticsSurface,
) {
  const reported = useRef<string | null>(null);

  useEffect(() => {
    if (status.kind !== "unreachable" && status.kind !== "unconfigured") {
      reported.current = null;
      return;
    }

    const signature = `${status.kind}:${status.reason}`;
    if (reported.current === signature) return;
    reported.current = signature;

    track("backend_unavailable", { surface, reason: status.reason });
  }, [status, surface]);
}

/**
 * The notice shown INSTEAD of an empty state when the backend is the problem.
 *
 * There is no Retry button, and its absence is deliberate rather than an
 * omission: the Convex client is already reconnecting on its own backoff, and a
 * button that cannot make that happen sooner is a button that lies about who is
 * in control. The status line below updates by itself when the socket returns.
 */
export function CatalogUnavailable({
  status,
  title = "Catalog unavailable",
}: {
  status: Extract<BackendStatus, { kind: "unreachable" | "unconfigured" }>;
  title?: string;
}) {
  return (
    <div
      className="flex gap-4 border-y border-line bg-danger-soft/40 px-5 py-6 sm:px-6"
      role="alert"
    >
      <span aria-hidden="true" className="mt-0.5 shrink-0 text-danger">
        <CategoryGlyph color="currentColor" name="info" size={20} strokeWidth={2} />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-danger">
          {status.kind === "unconfigured" ? "Not configured" : "Cannot reach the catalog"}
        </p>
        <h3 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-ink">
          {title}
        </h3>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{status.reason}</p>
        {/*
         * Said out loud, because the difference between these two sentences is
         * the entire reason this component exists.
         */}
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
          No records are being shown and none are being substituted. This is not
          a statement that the catalog is empty.
        </p>
        {status.kind === "unreachable" ? (
          <p aria-live="polite" className="mt-3 text-xs text-faint">
            Reconnecting automatically.
          </p>
        ) : null}
      </div>
    </div>
  );
}
