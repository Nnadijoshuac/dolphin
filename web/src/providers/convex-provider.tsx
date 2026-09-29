"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import type { PropsWithChildren } from "react";

/**
 * Points at the same Convex deployment as the mobile app, so both surfaces read
 * one agent catalog (convex/agents.ts's `list`/`search`/`get`). Mirrors
 * src/providers/convex-provider.tsx in the mobile app, including its
 * "degrade, don't crash" behaviour when the URL is unset.
 *
 * NEXT_PUBLIC_CONVEX_URL IS A SEPARATE VARIABLE FROM THE APP'S
 * EXPO_PUBLIC_CONVEX_URL, in a separate .env.local, and the two have to be
 * changed together. They were not when the backend moved deployments on
 * 2026-09-07: the app was repointed and this site was left on the old one,
 * where the new query names do not exist, so every page threw
 * "Could not find public function for 'agents:list'". The same three CI
 * workflows also carry the URL as a hardcoded fallback.
 */
/**
 * TRAILING SLASHES ARE STRIPPED, AND THAT IS NOT TIDYING — IT TOOK THE SITE
 * DOWN ON 2026-09-13.
 *
 * The deployment URL was pasted into Vercel as
 * `https://<deployment>.convex.cloud/`. The Convex client appends its own path,
 * so the socket it opened was
 *
 *     wss://<deployment>.convex.cloud//api/1.45.0/sync
 *                                    ^^ two slashes
 *
 * which the server answers with a 404 on the WebSocket handshake. The client
 * retried, got 404 again, and gave up — so every query on the site hung
 * permanently in its loading state. And because this codebase renders a
 * missing backend as a calm empty state rather than an error, the result did
 * not look like an outage. It looked like a marketplace with no agents.
 *
 * One character of whitespace-class input, a totally silent failure, and the
 * whole catalog gone. Normalising here costs nothing and removes the entire
 * class: a URL is a URL whether or not somebody's clipboard added a slash.
 */
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim().replace(/\/+$/, "");

export const convexClient = convexUrl
  ? new ConvexReactClient(convexUrl, { unsavedChangesWarning: false })
  : null;

export function ConvexClientProvider({ children }: PropsWithChildren) {
  if (!convexClient) {
    return <>{children}</>;
  }

  return <ConvexProvider client={convexClient}>{children}</ConvexProvider>;
}
