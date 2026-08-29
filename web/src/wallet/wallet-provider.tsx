"use client";

import { useState, useCallback } from "react";

interface WalletState {
  isConnected: boolean;
  address: string | null;
  isAvailable: boolean;
  unavailableReason: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

/** Stub wallet provider for web — wallet connection is not yet implemented */
export function useWallet(): WalletState {
  const [isConnected, setIsConnected] = useState(false);
  const [address, setAddress] = useState<string | null>(null);

  const connect = useCallback(async () => {
    // Stub — real implementation would use RainbowKit or Reown AppKit
    setIsConnected(true);
    setAddress("0x0000000000000000000000000000000000000000");
  }, []);

  const disconnect = useCallback(async () => {
    setIsConnected(false);
    setAddress(null);
  }, []);

  return {
    isConnected,
    address,
    isAvailable: true,
    unavailableReason: null,
    connect,
    disconnect,
  };
}

export function WalletConnectButton({
  connectLabel = "Connect wallet",
}: {
  connectLabel?: string;
}) {
  const wallet = useWallet();

  return (
    <button
      onClick={() => {
        if (wallet.isConnected) {
          void wallet.disconnect();
        } else {
          void wallet.connect();
        }
      }}
      className="w-full rounded-xl py-3 px-5 font-bold text-sm transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
      style={{
        backgroundColor: wallet.isConnected ? "#FEE2E2" : "#F5B300",
        color: wallet.isConnected ? "#B91C1C" : "#111214",
      }}
    >
      {wallet.isConnected && wallet.address
        ? `Disconnect ${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`
        : connectLabel}
    </button>
  );
}
