"use client";

import { AltanaWalletPanel } from "@/components/altana-wallet-panel";
import { WalletConnectButton, useWallet } from "@/wallet/wallet-provider";

export default function WalletPage() {
  const wallet = useWallet();

  return (
    <div className="site-frame page-shell" style={{ paddingBlockStart: "clamp(1.5rem, 4vw, 3rem)" }}>
      <AltanaWalletPanel />

      <div className="mt-12 border-t border-line pt-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <p className="text-xs leading-5 text-faint">
            Dolphin never asks for a private key or seed phrase. Removing a local
            wallet does not revoke an on-chain session; use the permission controls above.
          </p>
          <div className="shrink-0">
            {wallet.isConnected ? (
              <button
                className="interactive text-xs font-medium text-muted underline-offset-4 hover:text-danger hover:underline"
                onClick={() => void wallet.disconnect()}
                type="button"
              >
                Disconnect identity wallet
              </button>
            ) : (
              <WalletConnectButton connectLabel="Connect identity wallet" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}