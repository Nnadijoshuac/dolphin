"use client";

import { WalletConnectButton, useWallet } from "@/wallet/wallet-provider";

/**
 * Secondary section: the identity wallet (wagmi / MetaMask / WalletConnect).
 * This is separate from the Dolphin (Altana passkey) wallet — it identifies
 * the user for hire records but holds no agent-spending authority.
 */
export function IdentityWalletSection() {
  const wallet = useWallet();

  return (
    <div className="wallet-identity-section">
      <div className="wallet-identity-section__content">
        <div>
          <p className="wallet-identity-section__label">Identity wallet</p>
          <p className="wallet-identity-section__sub">
            Used to identify you for hire records. Separate from the Dolphin spending wallet.
          </p>
        </div>
        <div className="wallet-identity-section__action">
          {wallet.isConnected ? (
            <button
              className="interactive wallet-identity-disconnect"
              onClick={() => void wallet.disconnect()}
              type="button"
            >
              Disconnect
            </button>
          ) : (
            <WalletConnectButton connectLabel="Connect identity wallet" />
          )}
        </div>
      </div>
    </div>
  );
}
