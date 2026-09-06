import type { PropsWithChildren } from "react";

import { ConvexClientProvider } from "@/providers/convex-provider";
import { QueryProvider } from "@/providers/query-provider";
import { AltanaWalletProvider } from "@/wallet/altana-provider";
import { WalletProvider } from "@/wallet/wallet-provider";
import { WalletSessionProvider } from "@/wallet/wallet-session";

/**
 * AltanaWalletProvider sits alongside WalletProvider, not in place of it.
 * They are two genuinely different wallets: WalletProvider is the user's own
 * injected/WalletConnect account, which identifies them on a hire record;
 * AltanaWalletProvider is Dolphin's own passkey smart account, the only one
 * that can hold a scoped session. Altana's SDK ships no injected signer, so
 * one cannot be built on top of the other - see wallet/altana-policy.ts.
 *
 * It is innermost because it reads its session grants from Convex, which is
 * the single source of truth for them (convex/agentSessions.ts) and must
 * therefore already be mounted.
 *
 * WalletSessionProvider sits between them, and its position is forced from both
 * sides: it asks WalletProvider for a signature and asks Convex to verify it,
 * so both must already be mounted above it. It is what turns the connected
 * address into a proven one - see wallet/wallet-session.tsx for why a connected
 * address alone is not something a backend can act on.
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
