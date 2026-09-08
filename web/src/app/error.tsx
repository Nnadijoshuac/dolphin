"use client";

import Link from "next/link";
import { useEffect } from "react";

import { CategoryGlyph } from "@/components/category-glyph";
import { track } from "@/lib/analytics";

/**
 * The route-level error boundary.
 *
 * ===========================================================================
 * WHY THIS FILE DID NOT EXIST, AND WHAT THAT COST (2026-09-08)
 * ===========================================================================
 * There was no error.tsx, no not-found.tsx and no global-error.tsx anywhere in
 * app/. Combined with there being no error reporting of any kind, a render
 * crash in production was:
 *
 *   - Next's unstyled default error page, or in some paths a blank screen
 *   - with no route back into the product
 *   - and no signal to anyone that it had happened. Not one.
 *
 * That last clause is the real defect. A bug you cannot see is a bug you cannot
 * prioritise, and this site had no channel through which a user's crash could
 * ever reach the people who could fix it.
 *
 * ===========================================================================
 * WHAT IT REPORTS, AND WHAT IT DELIBERATELY DOES NOT
 * ===========================================================================
 * `digest` only - the hash Next assigns an error so a production stack trace can
 * be matched to it server-side. NOT `error.message`, which on this site can
 * contain a wallet address, an RPC URL, a Convex argument-validation dump or a
 * viem revert payload. A crash report must never become the exfiltration path
 * for the data the rest of the app is careful about.
 *
 * The user is told the truth ("this page failed", not "something went wrong")
 * and given the two things they actually need: a retry that re-renders the
 * segment, and a way out that is not the back button.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    track("render_error", {
      surface: typeof window === "undefined" ? "server" : window.location.pathname,
      digest: error.digest ?? null,
    });

    /*
     * Also to the console, in full. The browser console is the developer's
     * channel and is not transmitted anywhere, so it is the one place the
     * message and stack can safely stay intact.
     */
    console.error("[dolphin] route render failed", error);
  }, [error]);

  return (
    <div className="site-frame page-shell">
      <div className="max-w-2xl">
        <div className="flex gap-4 border-y border-line py-8">
          <span aria-hidden="true" className="mt-0.5 shrink-0 text-danger">
            <CategoryGlyph color="currentColor" name="info" size={22} strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-danger">Page failed</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-ink">
              This page did not finish loading
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted">
              Something in this page threw while rendering. Nothing was
              submitted, no hire was recorded, and no wallet action was taken.
            </p>
            {error.digest ? (
              <p className="mt-3 font-mono text-xs text-faint">
                Reference {error.digest}
              </p>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                className="interactive inline-flex min-h-11 items-center rounded-xl bg-accent px-5 text-sm font-semibold text-ink hover:bg-accent-hover"
                onClick={reset}
                type="button"
              >
                Try again
              </button>
              <Link
                className="interactive inline-flex min-h-11 items-center rounded-xl border border-line bg-paper px-5 text-sm font-semibold text-ink no-underline hover:bg-canvas"
                href="/"
              >
                Back to Discover
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
