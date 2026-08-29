"use client";

import type { PropsWithChildren } from "react";
import { ConvexClientProvider } from "@/providers/convex-provider";
import { QueryProvider } from "@/providers/query-provider";
import { WalletProvider } from "@/wallet/wallet-provider";

/**
 * Order matters. Wallet is outermost because nothing above it depends on the
 * others; Convex sits inside Query so that a component can use both, matching
 * the Wallet -> Query -> Convex nesting the mobile app already uses in
 * src/app/_layout.tsx.
 */
export function AppProviders({ children }: PropsWithChildren) {
  return (
    <WalletProvider>
      <QueryProvider>
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </QueryProvider>
    </WalletProvider>
  );
}
