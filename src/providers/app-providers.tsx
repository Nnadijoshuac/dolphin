import type { PropsWithChildren } from "react";

import { ConvexClientProvider } from "@/providers/convex-provider";
import { QueryProvider } from "@/providers/query-provider";
import { WalletProvider } from "@/wallet/wallet-provider";

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <WalletProvider>
      <QueryProvider>
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </QueryProvider>
    </WalletProvider>
  );
}

