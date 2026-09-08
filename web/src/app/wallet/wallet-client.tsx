"use client";

import { AltanaWalletPanel } from "@/components/altana-wallet-panel";
import { IdentityWalletSection } from "@/components/identity-wallet-section";
import { MobileWallet } from "@/components/mobile-wallet";
import { useMobileLayout } from "@/hooks/use-mobile-layout";

export function WalletClient() {
  const isMobile = useMobileLayout();
  if (isMobile) return <MobileWallet />;
  return (
    <div className="site-frame" style={{ paddingBlock: "clamp(2rem, 5vw, 4rem)" }}>
      {/* Dolphin (Altana passkey) wallet — top priority */}
      <AltanaWalletPanel />

      {/* Identity wallet (wagmi / MetaMask / WalletConnect) — secondary */}
      <IdentityWalletSection />
    </div>
  );
}
