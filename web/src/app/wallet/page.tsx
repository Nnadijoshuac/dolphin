import type { Metadata } from "next";

import { WalletClient } from "@/app/wallet/wallet-client";

/**
 * Server shell, for metadata only. See app/search/page.tsx for the reasoning.
 *
 * Not indexed, for the same index-quality reason as /my-agents: without a
 * connected wallet this page is a pair of empty panels.
 */
export const metadata: Metadata = {
  title: "Wallet & permissions",
  description:
    "The wallets connected to Dolphin, what each one has authorised, and how to revoke it.",
  robots: { index: false, follow: false },
};

export default function WalletPage() {
  return <WalletClient />;
}
