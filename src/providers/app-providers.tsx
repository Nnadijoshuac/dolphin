import type { PropsWithChildren } from "react";

import { QueryProvider } from "@/providers/query-provider";
import { WalletProvider } from "@/wallet/wallet-provider";

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <WalletProvider>
      <QueryProvider>{children}</QueryProvider>
    </WalletProvider>
  );
}

