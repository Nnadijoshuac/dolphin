"use client";

import Link from "next/link";

import { AltanaWalletPanel } from "@/components/altana-wallet-panel";
import { CategoryGlyph } from "@/components/category-glyph";
import { MobileMenuButton } from "@/components/mobile-nav";
import { WalletAvatar } from "@/components/wallet-avatar";
import { useWallet } from "@/wallet/wallet-provider";

/* ═══════════════════════════════════════════════════════════════════════════
   THE PHONE WALLET
   ═══════════════════════════════════════════════════════════════════════════

   Rebuilt 2026-10-02 (owner: "the mobile wallet page looks not thought out").

   This file used to be a second wallet screen: its own total, its own circular
   Receive/BscScan/Withdraw keys, and two account cards of its own. The desktop
   screen kept moving on - an asset picker, Add funds and Withdraw on the
   Dolphin Wallet card, what agents may spend, device access - and the phone
   got none of it, because none of it was shared. The phone's "Agent payments"
   card could not add funds or show U at all.

   Now the phone renders the desktop's parts, in one column, in
   AltanaWalletPanel's "phone" layout. What stays here is only what a phone
   needs and a desktop does not: the top bar with the account avatar and the
   menu (there is no site header on a phone).
   ═══════════════════════════════════════════════════════════════════════════ */

export function MobileWallet() {
  const identity = useWallet();
  const identityAddress = identity.isConnected ? identity.address : null;

  return (
    <div className="mobile-wallet">
      <header className="mobile-wallet-topbar">
        <Link aria-label="Account details" className="mobile-circle overflow-hidden" href="/account">
          {identityAddress ? (
            <WalletAvatar address={identityAddress} kind="human" radius={19} size={38} />
          ) : (
            <CategoryGlyph name="wallet" size={20} />
          )}
        </Link>
        <h1 className="mobile-wallet-title">Wallet</h1>
        <MobileMenuButton />
      </header>

      <AltanaWalletPanel layout="phone" />
    </div>
  );
}
