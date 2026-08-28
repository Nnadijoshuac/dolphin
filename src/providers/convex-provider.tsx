import { ConvexProvider, ConvexReactClient } from "convex/react";
import type { PropsWithChildren } from "react";

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL?.trim();

export const convexClient = convexUrl
  ? new ConvexReactClient(convexUrl, { unsavedChangesWarning: false })
  : null;

/**
 * Renders children unchanged when EXPO_PUBLIC_CONVEX_URL isn't configured -
 * mirrors WalletProvider's pattern for an optional external service (see
 * src/wallet/wallet-provider.native.tsx). Backend-aggregated category stats
 * (useAgentCategoryStats) simply stay unavailable rather than the app
 * crashing on a missing env var.
 */
export function ConvexClientProvider({ children }: PropsWithChildren) {
  if (!convexClient) {
    return <>{children}</>;
  }

  return <ConvexProvider client={convexClient}>{children}</ConvexProvider>;
}
