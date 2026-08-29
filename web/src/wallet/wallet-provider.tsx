"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import type { PropsWithChildren } from "react";
import {
  WagmiProvider,
  createConfig,
  http,
  useAccount,
  useConnect,
  useDisconnect,
} from "wagmi";
import { bsc } from "wagmi/chains";
import { injected } from "wagmi/connectors";

import { BSC_RPC_URL } from "@/constants/agents";

const wagmiConfig = createConfig({
  chains: [bsc],
  connectors: [injected()],
  transports: {
    [bsc.id]: http(BSC_RPC_URL),
  },
  ssr: true,
});

export function WalletProvider({ children }: PropsWithChildren) {
  return <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>;
}

export interface WalletState {
  isConnected: boolean;
  address: string | null;
  isAvailable: boolean;
  unavailableReason: string | null;
  isConnecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

function subscribeToEthereum(): () => void {
  return () => {};
}

const NO_PROVIDER =
  "No browser wallet detected. Install MetaMask, Trust Wallet, or another EIP-1193 extension and reload.";

export function useWallet(): WalletState {
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors, isPending } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const [error, setError] = useState<string | null>(null);

  const isAvailable = useSyncExternalStore(
    subscribeToEthereum,
    () => Boolean(window.ethereum),
    () => false,
  );

  const connect = useCallback(async () => {
    setError(null);

    const connector = connectors.find((c) => c.id === "injected") ?? connectors[0];
    if (!connector) {
      setError(NO_PROVIDER);
      return;
    }

    try {
      await connectAsync({ connector, chainId: bsc.id });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [connectAsync, connectors]);

  const disconnect = useCallback(async () => {
    setError(null);
    await disconnectAsync();
  }, [disconnectAsync]);

  return {
    isConnected,
    address: address ?? null,
    isAvailable,
    unavailableReason: isAvailable ? null : NO_PROVIDER,
    isConnecting: isPending,
    error,
    connect,
    disconnect,
  };
}

export function WalletConnectButton({
  connectLabel = "Connect Browser Wallet",
}: {
  connectLabel?: string;
}) {
  const wallet = useWallet();

  const label =
    wallet.isConnected && wallet.address
      ? `Disconnect ${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`
      : wallet.isConnecting
        ? "Check your wallet..."
        : connectLabel;

  return (
    <div className="w-full">
      <button
        aria-busy={wallet.isConnecting}
        className={`pressable-scale min-h-[48px] w-full rounded-2xl px-5 text-sm font-black transition-all disabled:cursor-wait disabled:opacity-60 shadow-sm ${
          wallet.isConnected
            ? "border border-[#ECE8DE] bg-[#F5F3EB] text-[#111214] hover:border-[#FECACA] hover:bg-[#FEE2E2] hover:text-[#B91C1C]"
            : "bg-[#F5B300] text-[#111214] hover:bg-[#E2A500]"
        }`}
        disabled={wallet.isConnecting}
        onClick={() => {
          if (wallet.isConnected) {
            void wallet.disconnect();
          } else {
            void wallet.connect();
          }
        }}
        type="button"
      >
        {label}
      </button>
      {wallet.error !== null && (
        <p className="mt-2 text-xs font-semibold leading-5 text-[#B9473A]">
          {wallet.error}
        </p>
      )}
    </div>
  );
}
