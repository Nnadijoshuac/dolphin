"use client";

import { WalletConnectButton, useWallet } from "@/wallet/wallet-provider";

/**
 * Secondary section: the identity wallet (wagmi / MetaMask / WalletConnect).
 *
 * Separate from the Dolphin (Altana passkey) wallet — this one identifies the
 * user on a hire record and holds no agent-spending authority whatsoever.
 * wallet-provider.tsx carries the full explanation of why the two accounts
 * cannot be merged.
 *
 * Deliberately stateless: every connection concern lives in
 * WalletConnectButton, so this component has nothing to keep in sync.
 */
export function IdentityWalletSection() {
  const wallet = useWallet();

  /*
   * Only rendered once an address is connected.
   *
   * This is the "manage the connected identity" row - its real job is the
   * disconnect control. While nothing is connected, AltanaWalletPanel already
   * shows the single Connect prompt, and rendering this too put two identical
   * Connect buttons on one screen.
   */
  if (!wallet.isConnected) return null;

  return (
    <div className="wallet-identity-section">
      <div className="wallet-identity-section__content">
        <div>
          <p className="wallet-identity-section__label">Identity wallet</p>
          <p className="wallet-identity-section__sub">
            Used to identify you for hire records. Separate from the Dolphin spending wallet.
          </p>
        </div>
        {/*
         * Always WalletConnectButton, in both states.
         *
         * This used to render its own bare "Disconnect" button when connected,
         * which bypassed the two-step confirm that lives in WalletConnectButton
         * - so the same action was guarded on one screen and one click away on
         * another. Delegating both states to one component is what stops those
         * from drifting apart again.
         */}
        <div className="wallet-identity-section__action">
          <WalletConnectButton connectLabel="Connect identity wallet" />
        </div>
      </div>
    </div>
  );
}
