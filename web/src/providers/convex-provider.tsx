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
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();

export const convexClient = convexUrl
  ? new ConvexReactClient(convexUrl, { unsavedChangesWarning: false })
  : null;

export function ConvexClientProvider({ children }: PropsWithChildren) {
  if (!convexClient) {
    return <>{children}</>;
  }

  return <ConvexProvider client={convexClient}>{children}</ConvexProvider>;
}
