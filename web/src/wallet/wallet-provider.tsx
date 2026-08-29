"use client";

import { useCallback, useMemo, useState } from "react";
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

/**
 * Real browser-wallet connection for the website.
 *
 * WHAT THIS REPLACES. Until 2026-08-29 this file exported a `useWallet` stub
 * that, on "connect", set `isConnected: true` and an address of
 * 0x0000000000000000000000000000000000000000 - a hardcoded fake. Anything
 * downstream reading that address would have been reading a fabricated wallet,
 * which is precisely what AGENTS.md SS5 forbids, and it is why connecting
 * "worked" on screen while nothing was actually connected.
 *
 * WHY `injected()` AND NOT WalletConnect/Reown. This is a plain browser app, so
 * the wallet is already in the page as EIP-1193 `window.ethereum`. `injected()`
 * talks to it directly: no project id, no relay, no extra dependency beyond
 * wagmi itself. It also sidesteps the blocker recorded in HANDOVER.md SS4 - this
 * project's test network refuses to resolve relay.walletconnect.org, so a
 * relay-based connector could not be verified from here at all.
 *
 * wagmi is pinned to 2.19.5 to match the version the mobile app already uses,
 * rather than pulling 3.x into one half of the repo.
 */

const wagmiConfig = createConfig({
  chains: [bsc],
  connectors: [injected()],
  transports: {
    [bsc.id]: http(BSC_RPC_URL),
  },
  // Next.js prerenders these pages, so wagmi must not touch window/localStorage
  // while there is no browser. This is wagmi's documented SSR flag.
  ssr: true,
});

export function WalletProvider({ children }: PropsWithChildren) {
  return <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>;
}

export interface WalletState {
  isConnected: boolean;
  address: string | null;
  /** False when no EIP-1193 provider is present - no extension, or SSR. */
  isAvailable: boolean;
  unavailableReason: string | null;
  isConnecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const NO_PROVIDER =
  "No browser wallet detected. Install MetaMask (or another EIP-1193 wallet extension) and reload.";

export function useWallet(): WalletState {
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors, isPending } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const [error, setError] = useState<string | null>(null);

  // `typeof window` guards SSR; wagmi's own connector list is the same on both
  // sides of hydration, so the availability check must be the thing that varies.
  const isAvailable = useMemo(
    () => typeof window !== "undefined" && Boolean(window.ethereum),
    [],
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
      // Surface the wallet's real refusal (user rejected, locked, wrong
      // network) rather than swallowing it and leaving the button inert.
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
  connectLabel = "Connect wallet",
}: {
  connectLabel?: string;
}) {
  const wallet = useWallet();

  const label = wallet.isConnected && wallet.address
    ? `Disconnect ${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`
    : wallet.isConnecting
      ? "Check your wallet…"
      : connectLabel;

  return (
    <div className="w-full">
      <button
        onClick={() => {
          if (wallet.isConnected) {
            void wallet.disconnect();
          } else {
            void wallet.connect();
          }
        }}
        disabled={wallet.isConnecting}
        className="w-full rounded-xl py-3 px-5 font-bold text-sm transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60 disabled:hover:scale-100"
        style={{
          backgroundColor: wallet.isConnected ? "#FEE2E2" : "#F5B300",
          color: wallet.isConnected ? "#B91C1C" : "#111214",
        }}
      >
        {label}
      </button>
      {wallet.error !== null && (
        <p className="mt-2 text-xs font-medium text-red-600">{wallet.error}</p>
      )}
    </div>
  );
}
