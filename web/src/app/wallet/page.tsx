"use client";

import { AltanaWalletPanel } from "@/components/altana-wallet-panel";
import { IdentityWalletSection } from "@/components/identity-wallet-section";

export default function WalletPage() {
  return (
    <main className="site-frame" style={{ paddingBlock: "clamp(2rem, 5vw, 4rem)" }}>
      {/* Dolphin (Altana passkey) wallet — top priority */}
      <AltanaWalletPanel />

      {/* Identity wallet (wagmi / MetaMask / WalletConnect) — secondary */}
      <IdentityWalletSection />
    </main>
  );
}