"use client";

import type { PropsWithChildren } from "react";
import { useCallback, useState, useSyncExternalStore } from "react";
import {
  WagmiProvider,
  createConfig,
  http,
  useAccount,
  useConnect,
  useDisconnect,
} from "wagmi";
import { bsc } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";

import { BSC_RPC_URL } from "@/constants/agents";

// Reown / WalletConnect Project ID
export const projectId =
  process.env.NEXT_PUBLIC_REOWN_PROJECT_ID || "f7d3e8b6dfc7cd94443105a09b378eef";

export const wagmiConfig = createConfig({
  chains: [bsc],
  connectors: [
    injected(),
    walletConnect({
      projectId,
      metadata: {
        name: "Dolphin Marketplace",
        description: "AI Agent Marketplace on BNB Chain",
        url: typeof window !== "undefined" ? window.location.origin : "https://dolphin.agency",
        icons: ["https://api.8004scan.io/favicon.ico"],
      },
      showQrModal: true,
    }),
  ],
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

function subscribe() {
  return () => {};
}

export function useWallet(): WalletState {
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors, isPending } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const [error, setError] = useState<string | null>(null);

  const isMounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const connect = useCallback(async () => {
    setError(null);

    // Prefer injected extension if available, otherwise launch Reown WalletConnect modal
    const wcConnector = connectors.find((c) => c.id === "walletConnect");
    const injectedConnector = connectors.find((c) => c.id === "injected");

    const connector =
      typeof window !== "undefined" && window.ethereum && injectedConnector
        ? injectedConnector
        : wcConnector ?? connectors[0];

    if (!connector) {
      setError("No wallet connector available.");
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
    try {
      await disconnectAsync();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [disconnectAsync]);

  return {
    isConnected: isMounted && Boolean(isConnected),
    address: isMounted && address ? address : null,
    isAvailable: true,
    unavailableReason: null,
    isConnecting: isPending,
    error,
    connect,
    disconnect,
  };
}

export function WalletConnectButton({
  connectLabel = "Connect Wallet",
}: {
  connectLabel?: string;
}) {
  const wallet = useWallet();

  const label =
    wallet.isConnected && wallet.address
      ? `Disconnect ${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`
      : wallet.isConnecting
        ? "Connecting..."
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
      {wallet.error && (
        <p className="mt-2 text-xs font-semibold text-[#B9473A]">
          {wallet.error}
        </p>
      )}
    </div>
  );
}
