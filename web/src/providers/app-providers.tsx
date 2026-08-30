"use client";

import type { PropsWithChildren } from "react";
import { ConvexClientProvider } from "@/providers/convex-provider";
import { QueryProvider } from "@/providers/query-provider";
import { AltanaWalletProvider } from "@/wallet/altana-provider";
import { WalletProvider } from "@/wallet/wallet-provider";

/**
 * Order matters. Wallet is outermost because nothing above it depends on the
 * others; Convex sits inside Query so that a component can use both, matching
 * the Wallet -> Query -> Convex nesting the mobile app already uses in
 * src/app/_layout.tsx.
 *
 * AltanaWalletProvider sits alongside WalletProvider rather than replacing it.
 * They are two genuinely different wallets: WalletProvider is the user's
 * existing injected/WalletConnect account, which identifies them for hire
 * records; AltanaWalletProvider is Dolphin's own passkey smart account, which
 * is the only thing that can hold a scoped session. Altana's SDK has no
 * injected signer, so one cannot be built on top of the other - see
 * wallet/altana-policy.ts.
 */
export function AppProviders({ children }: PropsWithChildren) {
  return (
    <WalletProvider>
      <AltanaWalletProvider>
        <QueryProvider>
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </QueryProvider>
      </AltanaWalletProvider>
    </WalletProvider>
  );
}
