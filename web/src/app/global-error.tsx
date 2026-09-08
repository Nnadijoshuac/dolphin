"use client";

import { useEffect } from "react";

/**
 * The last-resort boundary: a crash in the root layout itself.
 *
 * app/error.tsx cannot catch this one, because it renders INSIDE the layout
 * that failed. This replaces the entire document, which is why it has to supply
 * its own <html> and <body> and cannot use any of the app's components,
 * providers, fonts or CSS variables - every one of those lives inside the tree
 * that is already broken. Hence the inline styles, which look out of place in
 * this codebase and are correct here.
 *
 * The failure it exists for is real and specific: AppProviders mounts the wagmi
 * config, the Convex client and the wallet-session provider at the root, and a
 * throw in any of them takes the whole document with it. Without this file that
 * is a blank white page with no text on it at all.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    /*
     * No `track()` here. The analytics module is part of the tree that just
     * failed to mount, and an error handler that can itself throw is worse than
     * no error handler. The console is the only reliable channel at this point.
     */
    console.error("[dolphin] root layout render failed", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          background: "#f4f3ed",
          color: "#171813",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <main style={{ maxWidth: "34rem" }}>
          <p
            style={{
              margin: 0,
              fontSize: "0.75rem",
              fontWeight: 600,
              color: "#a84235",
            }}
          >
            Dolphin failed to start
          </p>
          <h1
            style={{
              margin: "0.5rem 0 0",
              fontSize: "1.6rem",
              letterSpacing: "-0.04em",
            }}
          >
            The application could not load
          </h1>
          <p
            style={{
              margin: "0.75rem 0 0",
              fontSize: "0.9rem",
              lineHeight: 1.6,
              color: "#5f6058",
            }}
          >
            This is a fault in Dolphin, not in your wallet or your connection.
            Nothing was submitted and no transaction was signed. Reloading is
            worth trying; if it keeps happening, the reference below identifies
            the failure.
          </p>
          {error.digest ? (
            <p
              style={{
                margin: "0.75rem 0 0",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: "0.75rem",
                color: "#6a6b62",
              }}
            >
              Reference {error.digest}
            </p>
          ) : null}
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: "1.5rem",
              minHeight: "2.75rem",
              padding: "0 1.25rem",
              border: "none",
              borderRadius: "0.75rem",
              background: "#f0b90b",
              color: "#171813",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
            type="button"
          >
            Reload Dolphin
          </button>
        </main>
      </body>
    </html>
  );
}
