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
import {
  classifyConnectError,
  connectFailureCopy,
  type ConnectFailureKind,
} from "@/wallet/wallet-errors";

/**
 * The IDENTITY wallet: the user's own MetaMask / OKX / WalletConnect account.
 *
 * ---------------------------------------------------------------------------
 * THIS IS NOT THE DOLPHIN WALLET, AND THE DIFFERENCE IS LOAD-BEARING
 * ---------------------------------------------------------------------------
 * Dolphin has two accounts and they can never be the same one:
 *
 *   THIS FILE          an address the user already controls. Dolphin only ever
 *                      READS it. Its single job is to identify who a hire
 *                      record belongs to (`agentHires.walletAddress`). Dolphin
 *                      never asks it to sign anything and never moves funds
 *                      from it - there is deliberately no "Send" affordance
 *                      anywhere in this product for it.
 *
 *   altana-provider    the Dolphin Wallet: an Altana passkey smart account that
 *                      actually pays agents. Separate balance, separate keys.
 *
 * They cannot be merged. `@altananetwork/sdk` 0.8.0 exports no injected-wallet
 * signer (`signerFromInjected` appears only in its doc comments - verified by
 * grepping dist/), so an Altana session or payment cannot be signed by a
 * MetaMask account. altana-policy.ts carries the full decision record.
 *
 * ---------------------------------------------------------------------------
 * NO REOWN APPKIT HERE, UNLIKE THE MOBILE APP
 * ---------------------------------------------------------------------------
 * `@reown/appkit-*` is a dependency of the Expo app only; this project's
 * package.json does not carry it. The website uses wagmi's own connectors
 * directly, which means:
 *
 *   - with a browser extension installed, `injected()` hands off to the
 *     extension's OWN popup - there is no Dolphin-rendered modal, and that is
 *     expected rather than a missing feature;
 *   - without one, `walletConnect({ showQrModal: true })` raises wagmi's QR
 *     modal.
 *
 * The mobile app's wallet-provider.native.tsx does use AppKit and does render a
 * modal. The two products genuinely differ here.
 */

/**
 * WalletConnect (Reown) project id.
 *
 * ---------------------------------------------------------------------------
 * DECISION (2026-09-01): no hardcoded fallback. A missing id fails visibly.
 * ---------------------------------------------------------------------------
 * This used to fall back to a literal project id checked into source. That is
 * the worst of both worlds: the credential is public in the repo, and a
 * misconfigured deployment looks like it is working while quietly billing
 * someone else's Reown project. Silence was the actual bug, not the value.
 *
 * It now degrades the way the mobile app already does
 * (wallet-provider.native.tsx's MISSING_PROJECT_ID_MESSAGE): the WalletConnect
 * connector is simply not built, `connect()` says exactly what is missing, and
 * a console error names the variable at load.
 *
 * WHY NOT `throw`. A hard throw at module scope would take the whole site down
 * on a deploy that forgot one variable, and this site is one env var away from
 * that today - `.github/workflows/build-web-site.yml` does not set
 * NEXT_PUBLIC_REOWN_PROJECT_ID at all. Injected wallets (MetaMask, OKX) do not
 * need this id and keep working without it, so taking the page down would
 * remove a working path to punish a missing optional one. Loud and degraded
 * beats loud and dead.
 */
const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID?.trim();

const MISSING_PROJECT_ID_MESSAGE =
  "WalletConnect is not configured for this deployment: NEXT_PUBLIC_REOWN_PROJECT_ID " +
  "is missing. A browser extension wallet (MetaMask, OKX) still works; scanning a QR " +
  "code from a phone does not.";

if (!projectId && typeof window !== "undefined") {
  // Named at load rather than only at click time, so a misconfigured deploy is
  // discoverable from the console without first reproducing a failed connect.
  console.error(`[wallet] ${MISSING_PROJECT_ID_MESSAGE}`);
}

/**
 * Connectors, in preference order. WalletConnect is included only when it can
 * actually work - an unconfigured connector that always throws is worse than an
 * absent one, because the UI would offer it.
 */
const connectors = [
  injected({ shimDisconnect: true }),
  ...(projectId
    ? [
        walletConnect({
          projectId,
          metadata: {
            name: "Dolphin Marketplace",
            description: "AI Agent Marketplace on BNB Chain",
            url:
              typeof window !== "undefined"
                ? window.location.origin
                : "https://dolphin.agency",
            icons: ["https://api.8004scan.io/favicon.ico"],
          },
          showQrModal: true,
        }),
      ]
    : []),
];

export const wagmiConfig = createConfig({
  chains: [bsc],
  connectors,
  transports: {
    // Same RPC the rest of the product reads from, so a balance shown here and
    // a chain read elsewhere cannot come from two different views of the chain.
    [bsc.id]: http(BSC_RPC_URL),
  },
  // Next prerenders every page under app/, so wagmi must not touch browser
  // storage during the server pass.
  ssr: true,
});

/** Wraps the tree in wagmi. Mounted once, in the root layout. */
export function WalletProvider({ children }: PropsWithChildren) {
  return <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>;
}

/** The identity wallet's public surface. Read-only plus connect/disconnect. */
export interface WalletState {
  isConnected: boolean;
  address: string | null;
  isAvailable: boolean;
  unavailableReason: string | null;
  isConnecting: boolean;
  /**
   * What went wrong last, as a KIND rather than a message.
   *
   * Deliberately not a string: a `string | null` is what let viem's raw
   * `message` reach the screen in the first place. A caller cannot render this
   * verbatim - it has to go through connectFailureCopy, which only ever
   * produces text written for a person. See wallet-errors.ts.
   */
  failure: ConnectFailureKind | null;
  clearFailure: () => void;
  connect: (preferredType?: "injected" | "walletConnect") => Promise<void>;
  disconnect: () => Promise<void>;
}

/** No-op subscribe: the store below never changes after mount. */
function subscribe() {
  return () => {};
}

/**
 * Connection state for the identity wallet.
 *
 * The `isMounted` gate exists because wagmi's account state is browser-only:
 * the server render and the first client render must agree or React throws a
 * hydration error (#418 has already happened once on this site - see
 * altana-storage.ts for the same fix applied to localStorage). Returning
 * `false`/`null` until mounted is what keeps those two renders identical.
 */
export function useWallet(): WalletState {
  const { address, isConnected, isConnecting: accountConnecting, isReconnecting } = useAccount();
  const { connectAsync, connectors: available, isPending } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const [failure, setFailure] = useState<ConnectFailureKind | null>(null);

  const isMounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const connect = useCallback(
    async (preferredType?: "injected" | "walletConnect") => {
      setFailure(null);

      const injectedConn = available.find((c) => c.id === "injected");
      const wcConn = available.find((c) => c.id === "walletConnect");

      /*
       * Connector choice. An explicit preference wins; otherwise an installed
       * extension is preferred over a QR code, because someone who has one
       * almost never wants to scan.
       *
       * KNOWN LIMITATION, logged rather than silently accepted: wagmi's
       * EIP-6963 discovery is on by default, so each installed wallet also
       * appears as its own connector (e.g. `com.okex.wallet`). This function
       * only ever selects the generic `injected` one, so with TWO extensions
       * installed the user cannot choose between them - they contend for
       * `window.ethereum` and whichever wins, wins. With one extension of any
       * brand it behaves correctly.
       */
      const target =
        preferredType === "walletConnect"
          ? wcConn
          : preferredType === "injected"
            ? injectedConn
            : typeof window !== "undefined" && window.ethereum && injectedConn
              ? injectedConn
              : wcConn ?? available[0];

      if (!target) {
        setFailure("no-wallet");
        return;
      }

      try {
        await connectAsync({ connector: target });
      } catch (cause) {
        const kind = classifyConnectError(cause);

        /*
         * One retry on WalletConnect, but only when the injected connector
         * looks genuinely unusable - `no-wallet` or an unrecognised failure.
         * Only when the caller expressed no preference, too: someone who
         * explicitly asked for injected should see why it failed rather than
         * be silently handed a QR code.
         *
         * NOT retried for `cancelled` or `busy`, and that exclusion was found
         * by running it. Both mean the extension is present and talking to the
         * user: one just had its popup dismissed, the other has a request
         * still open in it. Raising a WalletConnect QR modal over either is
         * the app talking past someone who is already mid-decision - the exact
         * complaint that started this fix. Caught live when a -32002 test
         * opened a QR code instead of saying "your wallet is already asking".
         */
        const injectedUnusable = kind === "no-wallet" || kind === "unknown";
        if (injectedUnusable && target.id === "injected" && wcConn && !preferredType) {
          try {
            await connectAsync({ connector: wcConn });
            return;
          } catch (wcCause) {
            setFailure(classifyConnectError(wcCause));
            return;
          }
        }

        setFailure(kind);
      }
    },
    [connectAsync, available],
  );

  /**
   * Clears the wagmi session. Nothing on-chain changes; no funds move.
   *
   * A failure here is logged rather than surfaced, and that is a considered
   * choice rather than a swallow: wagmi drops its local connection state
   * regardless, so the UI already reflects the disconnection, and there is no
   * action a person could take in response. Rendering "couldn't disconnect"
   * over an already-disconnected wallet would be the more confusing outcome.
   */
  const disconnect = useCallback(async () => {
    setFailure(null);
    try {
      await disconnectAsync();
    } catch (cause) {
      console.error("[wallet] disconnect failed", cause);
    }
  }, [disconnectAsync]);

  const isBusy = isPending || accountConnecting || isReconnecting;

  return {
    isConnected: isMounted && Boolean(isConnected),
    address: isMounted && address ? address : null,
    // Injected always works, so the wallet is never wholly unavailable here -
    // unlike the native provider, which has nothing at all without a project id.
    isAvailable: true,
    unavailableReason: projectId ? null : MISSING_PROJECT_ID_MESSAGE,
    isConnecting: isBusy,
    failure,
    clearFailure: () => setFailure(null),
    connect,
    disconnect,
  };
}

/**
 * Connect / disconnect control.
 *
 * DISCONNECT IS TWO STEPS, deliberately. It used to be a single click on a
 * button whose label was the user's own address, which made an accidental
 * disconnect easy and gave no chance to change course. The confirm mirrors the
 * pattern already used by the wallet screen's "Remove from this device", so
 * both destructive-looking wallet actions behave the same way.
 *
 * Connecting stays one click: it is trivially reversible and asking twice to
 * start would be friction for nothing.
 */
export function WalletConnectButton({
  connectLabel = "Connect Wallet",
}: {
  connectLabel?: string;
}) {
  const wallet = useWallet();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  if (wallet.isConnected && confirmDisconnect) {
    return (
      <div className="w-full">
        <p className="text-xs font-semibold text-ink">Disconnect this wallet?</p>
        <p className="mt-1 text-xs leading-5 text-muted">
          Your hire records are kept and reappear when you reconnect this
          address. Nothing on-chain changes.
        </p>
        <div className="mt-3 flex gap-2">
          <button
            className="interactive min-h-11 flex-1 rounded-lg border border-line bg-paper px-4 text-sm font-semibold text-ink hover:bg-canvas"
            onClick={() => setConfirmDisconnect(false)}
            type="button"
          >
            Stay connected
          </button>
          <button
            className="interactive min-h-11 flex-1 rounded-lg border border-danger bg-danger-soft px-4 text-sm font-semibold text-danger"
            onClick={() => {
              setConfirmDisconnect(false);
              void wallet.disconnect();
            }}
            type="button"
          >
            Disconnect
          </button>
        </div>
      </div>
    );
  }

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
        className={`interactive min-h-12 w-full rounded-lg px-5 text-sm font-semibold disabled:cursor-wait disabled:opacity-60 ${
          wallet.isConnected
            ? "border border-line bg-paper text-ink hover:border-danger hover:bg-danger-soft hover:text-danger"
            : "bg-accent text-ink hover:bg-accent-hover"
        }`}
        disabled={wallet.isConnecting}
        onClick={() => {
          if (wallet.isConnected) {
            setConfirmDisconnect(true);
          } else {
            void wallet.connect();
          }
        }}
        type="button"
      >
        {label}
      </button>
      {/*
       * The failure state, written for a person.
       *
       * An inline block under the button rather than a modal: it matches the
       * disconnect confirm directly above and the wallet screen's other inline
       * states, and a cancelled connection is not worth interrupting anyone
       * over. Nothing here can render a library message - `failure` is a union
       * of four kinds and the copy comes from connectFailureCopy.
       *
       * Cancelling gets NEUTRAL styling. Red on "you closed a popup" tells
       * someone they broke something when they simply chose not to continue.
       */}
      {wallet.failure && (() => {
        const copy = connectFailureCopy(wallet.failure);
        const warn = copy.tone === "warn";
        return (
          <div
            className={`mt-3 rounded-lg border p-3 ${
              warn ? "border-danger bg-danger-soft" : "border-line bg-canvas"
            }`}
            role="status"
          >
            <div className="flex items-start justify-between gap-3">
              <p className={`text-xs font-semibold ${warn ? "text-danger" : "text-ink"}`}>
                {copy.title}
              </p>
              <button
                aria-label="Dismiss"
                className="interactive text-xs font-medium text-muted hover:text-ink"
                onClick={wallet.clearFailure}
                type="button"
              >
                ✕
              </button>
            </div>
            <p className={`mt-1 text-xs leading-5 ${warn ? "text-danger" : "text-muted"}`}>
              {copy.body}
            </p>
            {copy.retryable && (
              <button
                className="interactive mt-2.5 text-xs font-semibold text-ink underline underline-offset-4"
                disabled={wallet.isConnecting}
                onClick={() => void wallet.connect()}
                type="button"
              >
                Try again
              </button>
            )}
          </div>
        );
      })()}
    </div>
  );
}
