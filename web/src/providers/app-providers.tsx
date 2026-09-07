"use client";

import type { PropsWithChildren } from "react";
import { ConvexClientProvider } from "@/providers/convex-provider";
import { QueryProvider } from "@/providers/query-provider";
import { AltanaWalletProvider } from "@/wallet/altana-provider";
import { WalletProvider } from "@/wallet/wallet-provider";
import { WalletSessionProvider } from "@/wallet/wallet-session";

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
 *
 * Altana sits INSIDE both QueryProvider and ConvexClientProvider, because it
 * needs each for a different thing: TanStack Query for its balance (a live
 * on-chain value with a refetch cycle, which is what this stack already uses
 * for exactly that, project-scope.md §3), and Convex for its session grants,
 * which are backend-owned so the wallet screen and a hire record cannot end up
 * telling two different stories about the same authority.
 *
 * WalletSessionProvider's position is forced from both sides, exactly as in the
 * mobile app's src/providers/app-providers.tsx: it asks WalletProvider for a
 * signature and asks Convex to verify it, so both must already be mounted above
 * it. It is what turns a connected address into a proven one - which is the
 * only kind the backend will accept a write from.
 *
 * AltanaWalletProvider sits inside it because its grant and revoke writes are
 * authenticated too.
 */
export function AppProviders({ children }: PropsWithChildren) {
  return (
    <WalletProvider>
      <QueryProvider>
        <ConvexClientProvider>
          <WalletSessionProvider>
            <AltanaWalletProvider>{children}</AltanaWalletProvider>
          </WalletSessionProvider>
        </ConvexClientProvider>
      </QueryProvider>
    </WalletProvider>
  );
}
