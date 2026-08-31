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
    injected({
      shimDisconnect: true,
    }),
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
  connect: (preferredType?: "injected" | "walletConnect") => Promise<void>;
  disconnect: () => Promise<void>;
}

function subscribe() {
  return () => {};
}

export function useWallet(): WalletState {
  const { address, isConnected, isConnecting: accountConnecting, isReconnecting } = useAccount();
  const { connectAsync, connectors, isPending } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const [error, setError] = useState<string | null>(null);

  const isMounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const connect = useCallback(
    async (preferredType?: "injected" | "walletConnect") => {
      setError(null);

      const injectedConn = connectors.find((c) => c.id === "injected");
      const wcConn = connectors.find((c) => c.id === "walletConnect");

      // Choose target connector
      const target =
        preferredType === "walletConnect"
          ? wcConn
          : preferredType === "injected"
            ? injectedConn
            : typeof window !== "undefined" && window.ethereum && injectedConn
              ? injectedConn
              : wcConn ?? connectors[0];

      if (!target) {
        setError("No wallet connector found. Please install MetaMask, Trust Wallet, or use WalletConnect.");
        return;
      }

      try {
        await connectAsync({ connector: target });
      } catch (cause) {
        const errorMsg = cause instanceof Error ? cause.message : String(cause);
        
        // If injected fails and WalletConnect is available, attempt fallback to WalletConnect modal
        if (target.id === "injected" && wcConn && !preferredType) {
          try {
            await connectAsync({ connector: wcConn });
            return;
          } catch (wcCause) {
            setError(wcCause instanceof Error ? wcCause.message : String(wcCause));
            return;
          }
        }

        setError(errorMsg);
      }
    },
    [connectAsync, connectors],
  );

  const disconnect = useCallback(async () => {
    setError(null);
    try {
      await disconnectAsync();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [disconnectAsync]);

  const isBusy = isPending || accountConnecting || isReconnecting;

  return {
    isConnected: isMounted && Boolean(isConnected),
    address: isMounted && address ? address : null,
    isAvailable: true,
    unavailableReason: null,
    isConnecting: isBusy,
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
        className={`interactive min-h-12 w-full rounded-xl px-5 text-sm font-semibold disabled:cursor-wait disabled:opacity-60 ${
          wallet.isConnected
            ? "border border-line bg-paper text-ink hover:border-danger hover:bg-danger-soft hover:text-danger"
            : "bg-accent text-ink hover:bg-accent-hover"
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
        <p className="mt-3 border-l-2 border-danger bg-danger-soft p-3 text-xs font-medium leading-5 text-danger">
          {wallet.error}
        </p>
      )}
    </div>
  );
}
