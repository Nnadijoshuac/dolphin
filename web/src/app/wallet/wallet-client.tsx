"use client";

import { AltanaWalletPanel } from "@/components/altana-wallet-panel";
import { MobileWallet } from "@/components/mobile-wallet";
import { useMobileLayout } from "@/hooks/use-mobile-layout";

/**
 * ---------------------------------------------------------------------------
 * FLATTENED 2026-09-12.
 * ---------------------------------------------------------------------------
 * This file used to stack four siblings: RecoverabilityPanel, then
 * AltanaWalletPanel, then IdentityWalletSection, then the alerts. Three of
 * those described the same two accounts, in an order nobody chose — the page
 * opened on a red "not recoverable" warning, showed the balances third, and
 * restated the identity wallet a fourth time underneath.
 *
 * Ordering a wallet screen is not a routing concern. AltanaWalletPanel now owns
 * the whole account surface and its internal order, so the sections cannot
 * drift apart from the cards they belong to again. IdentityWalletSection still
 * exists and is still used — on /account, where a standalone "manage the
 * connected identity" row is the actual subject of the page.
 */
export function WalletClient() {
  const isMobile = useMobileLayout();
  if (isMobile) return <MobileWallet />;
  return (
    <div className="site-frame" style={{ paddingBlock: "clamp(2rem, 5vw, 4rem)" }}>
      <AltanaWalletPanel />

      {/* Liquidation alerts now sit inside the dashboard's layout (altana-wallet-panel.tsx). */}
    </div>
  );
}
