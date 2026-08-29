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

/**
 * An injected provider is set once, before our JS runs, and is never removed
 * while the page lives - so there is nothing to subscribe to. The unsubscribe
 * is a no-op; useSyncExternalStore still re-reads the snapshot on hydration,
 * which is all this needs.
 */
function subscribeToEthereum(): () => void {
  return () => {};
}

const NO_PROVIDER =
  "No browser wallet detected. Install MetaMask (or another EIP-1193 wallet extension) and reload.";

export function useWallet(): WalletState {
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors, isPending } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const [error, setError] = useState<string | null>(null);

  // Availability can only be known in the browser, and React must render the
  // same thing on the server and on the first client pass or hydration fails
  // (this threw "Minified React error #418" when it was a useMemo reading
  // window.ethereum directly: the server rendered "No wallet detected", the
  // client rendered "Not connected").
  //
  // useSyncExternalStore is the purpose-built answer: its third argument is the
  // server/hydration snapshot, so the first pass on both sides returns false
  // and the client re-reads immediately afterwards. Doing it with
  // useState + useEffect instead works but calls setState synchronously in an
  // effect, which cascades an extra render (and react-hooks/set-state-in-effect
  // flags it).
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
        className={`pressable-scale min-h-12 w-full rounded-xl border px-5 text-sm font-black disabled:cursor-wait disabled:opacity-60 ${
          wallet.isConnected
            ? "border-white/18 bg-white/8 text-white hover:border-white/35 hover:bg-white/12"
            : "border-[#e9b949] bg-[#e9b949] text-[#17140c] hover:border-[#f0c665] hover:bg-[#f0c665]"
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
        <p className="mt-2 text-xs font-semibold leading-5 text-[var(--danger)]">
          {wallet.error}
        </p>
      )}
    </div>
  );
}
