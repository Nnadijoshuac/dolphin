"use client";

import { AltanaWalletPanel, RecoverabilityPanel } from "@/components/altana-wallet-panel";
import { IdentityWalletSection } from "@/components/identity-wallet-section";
import { LiquidationAlertPanel } from "@/components/liquidation-alert-panel";
import { MobileWallet } from "@/components/mobile-wallet";
import { useMobileLayout } from "@/hooks/use-mobile-layout";

export function WalletClient() {
  const isMobile = useMobileLayout();
  if (isMobile) return <MobileWallet />;
  return (
    <div className="site-frame" style={{ paddingBlock: "clamp(2rem, 5vw, 4rem)" }}>
      {/* Recoverability warning — top of page */}
      <RecoverabilityPanel />

      {/* Dolphin (Altana passkey) wallet — top priority */}
      <AltanaWalletPanel />

      {/* Identity wallet (wagmi / MetaMask / WalletConnect) — secondary */}
      <IdentityWalletSection />

      {/*
        * Liquidation alerts. On the wallet screen rather than an agent page
        * because it watches the USER'S position, not an agent's - putting it
        * on a listing would imply that listing was doing the watching.
        * Renders nothing when the deployment has no mail transport.
        */}
      <LiquidationAlertPanel />
    </div>
  );
}
