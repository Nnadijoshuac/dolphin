"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import type { PropsWithChildren } from "react";

/**
 * Points at the same Convex deployment as the mobile app, so both surfaces read
 * one agent catalog (convex/agents.ts's listAgents). Mirrors
 * src/providers/convex-provider.tsx in the mobile app, including its
 * "degrade, don't crash" behaviour when the URL is unset.
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
