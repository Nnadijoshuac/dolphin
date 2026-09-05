// Must be the very first import: WalletConnect's crypto (key generation,
// relay-payload encryption) calls crypto.getRandomValues(), which RN has
// no native implementation of.
import "react-native-get-random-values";

/**
 * TextEncoder / TextDecoder, which Hermes does not provide.
 *
 * This is the polyfill the hand-rolled block below was missing that could
 * actually stop a connection dead rather than merely degrade it.
 * @walletconnect/relay-auth builds the JWT that authenticates the relay
 * WebSocket, and its utf8ToBytes is `new Uint8Array(new TextEncoder().encode(t))`
 * - unguarded. With TextEncoder undefined that throws while the socket is being
 * opened, so the relay never connects, the session proposal is queued and never
 * acked, and the only thing the app surfaces is a publish timeout
 * ("Failed to publish custom payload") from sign-client's publishCustom -
 * pointing at the wrong layer entirely, because AppKit's default logger level
 * suppresses the transport error underneath it.
 *
 * fast-text-encoding is the same package @walletconnect/react-native-compat
 * uses for this (it is compat's own dependency, pinned there at the 1.0.6 now
 * declared in package.json), so this matches upstream rather than hand-rolling
 * text codecs. It self-guards: it only assigns when the globals are absent, so
 * on any runtime that does provide them this import is inert.
 *
 * Ordered after react-native-get-random-values and before everything else for
 * the same reason that one is first - WalletConnect touches both during
 * module init (AGENTS.md §3).
 */
import "fast-text-encoding";

// We purposefully do NOT use @walletconnect/react-native-compat here because
// it imports react-native-url-polyfill, which BREAKS WebSockets in React Native 0.74+ (Expo 51+).
// Instead, we manually polyfill only what WalletConnect strictly needs.
import { Buffer } from "buffer";
if (typeof global.Buffer === "undefined") {
  global.Buffer = Buffer;
}
if (typeof global.btoa === "undefined") {
  global.btoa = (str: string) => Buffer.alloc(str.length, str, "binary").toString("base64");
}
if (typeof global.atob === "undefined") {
  global.atob = (b64: string) => Buffer.from(b64, "base64").toString("binary");
}

/* --- the globals WalletConnect reads off `global` -------------------------
 *
 * The hand-rolled block above replaced @walletconnect/react-native-compat,
 * but it only ever reproduced compat's Buffer/btoa/atob third. Compat also
 * assigns four GLOBALS that WalletConnect looks up by name at runtime, and
 * those were simply absent - so the lookups silently took their fallback path
 * instead of erroring, which is why nothing pointed at this:
 *
 *   global.NetInfo     `subscribeToNetworkChange` is wrapped in
 *                      `global?.NetInfo && ...`, so with it missing the
 *                      relayer NEVER learns the connection dropped or came
 *                      back, and so never reconnects on a network change.
 *                      `isOnline()` separately does `if (global.NetInfo)
 *                      {...} return true` - i.e. it fails OPEN, reporting
 *                      "online" without ever checking.
 *   global.Linking     how the SDK hands off into the wallet app.
 *   global.Platform    platform branching inside the relayer/pairing code.
 *   global.Application bundle id + `isAppInstalled`, which is what actually
 *                      backs wallet detection - the other half of the
 *                      LSApplicationQueriesSchemes / <queries> config in
 *                      app.json + queries.js. Without it that config cannot
 *                      be consulted at all.
 *
 * Verified by reading node_modules this session, not assumed: compat 2.23.10
 * index.js for what it assigns, and @walletconnect/core's minified bundle for
 * the `global?.NetInfo && global?.NetInfo.addEventListener(...)` and
 * `if (global.NetInfo) { const e = await global.NetInfo.fetch(); return
 * e?.isConnected } return true` call sites.
 *
 * STILL NOT IMPORTING COMPAT ITSELF, deliberately - the note above about
 * react-native-url-polyfill stands, and compat pulls it in unconditionally.
 * Every module required below is already a declared dependency of this app
 * (AGENTS.md §3); nothing new was added to package.json for this.
 *
 * expo-application is the same source compat falls back to when its own
 * native module is absent (compat module/index.ts getApplicationModule ->
 * getExpoModule), so this matches compat's behaviour on an Expo build rather
 * than inventing a shape.
 */
type WalletConnectGlobals = {
  Linking?: unknown;
  Platform?: unknown;
  NetInfo?: unknown;
  Application?: unknown;
};

const wcGlobal = global as unknown as WalletConnectGlobals;

if (typeof wcGlobal.Linking === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  wcGlobal.Linking = require("react-native").Linking;
}

if (typeof wcGlobal.Platform === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  wcGlobal.Platform = require("react-native").Platform;
}

if (typeof wcGlobal.NetInfo === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  wcGlobal.NetInfo = require("@react-native-community/netinfo");
}

if (typeof wcGlobal.Application === "undefined") {
  // Non-fatal: only wallet detection degrades if this is unavailable, and it
  // must not take the whole provider down the way a missing native module
  // once took down every route (see altana-passkey-native.ts).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    wcGlobal.Application = require("expo-application");
  } catch {
    // Leave it unset; AppKit treats every wallet as not-installed.
  }
}

// WalletConnect registers many listeners; increase the limit to prevent the MaxListenersExceededWarning
import { EventEmitter } from "events";
EventEmitter.defaultMaxListeners = 1000;

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  AppKit,
  AppKitProvider,
  createAppKit,
  useAccount,
  useAppKit,
  type Storage,
} from "@reown/appkit-react-native";
import { WagmiAdapter } from "@reown/appkit-wagmi-react-native";
import * as Linking from "expo-linking";
import {
  createContext,
  useContext,
  useMemo,
  type PropsWithChildren,
} from "react";
import { Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { bsc, bscTestnet } from "viem/chains";
import { WagmiProvider } from "wagmi";

import type {
  WalletConnectButtonProps,
  WalletContextValue,
  WalletProviderProps,
} from "./wallet-types";

// The getRandomValues probe that used to sit here is removed: it was marked
// TEMPORARY, its question ("did react-native-get-random-values actually
// install?") has been settled, and it logged a crypto sample to the console on
// every launch. The import it was checking is still the first line of this
// file, and the comment above it explains why the order matters - which is the
// part worth keeping.

const MISSING_PROJECT_ID_MESSAGE =
  "Wallet connection is not configured. Add EXPO_PUBLIC_REOWN_PROJECT_ID to a local .env file.";

function deserialize<T>(value: string | null): T | undefined {
  if (value === null) {
    return undefined;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    // Preserve compatibility with any string values written without JSON encoding.
    return value as T;
  }
}

const appKitStorage: Storage = {
  async getKeys() {
    return [...(await AsyncStorage.getAllKeys())];
  },
  async getEntries<T>() {
    const keys = [...(await AsyncStorage.getAllKeys())];
    const entries = await AsyncStorage.multiGet(keys);

    return entries.flatMap<[string, T]>(([key, value]) => {
      const parsedValue = deserialize<T>(value);
      return parsedValue === undefined ? [] : [[key, parsedValue]];
    });
  },
  async getItem<T>(key: string) {
    return deserialize<T>(await AsyncStorage.getItem(key));
  },
  async setItem<T>(key: string, value: T) {
    const serializedValue = JSON.stringify(value);

    if (serializedValue === undefined) {
      await AsyncStorage.removeItem(key);
      return;
    }

    await AsyncStorage.setItem(key, serializedValue);
  },
  async removeItem(key: string) {
    await AsyncStorage.removeItem(key);
  },
};

const projectId = process.env.EXPO_PUBLIC_REOWN_PROJECT_ID?.trim();
const bscNetworks = [bsc, bscTestnet] as const;

// wallet-provider.ts imports both this file and wallet-provider.web.tsx
// unconditionally (Metro doesn't apply its .native/.web extension
// resolution to an explicitly-suffixed import specifier), so this
// module's top-level code still runs even when the app is bundled for
// web. Without this guard, createAppKit()/WagmiAdapter() would construct
// a real WalletConnect Core instance on web too - which is what was
// actually crashing the static web export's SSR pass (Core.init calling
// AsyncStorage.getItem, which needs `window`, unavailable during
// server-side rendering) and firing a stray "metadata.url differs from
// page url" warning in the browser console. Web deliberately has no
// wallet support (see wallet-provider.web.tsx) - this just makes sure
// nothing tries to set one up regardless.
const reownSetup = projectId && Platform.OS !== "web"
  ? (() => {
      const wagmiAdapter = new WagmiAdapter({
        networks: bscNetworks,
        projectId,
      });

      const appKit = createAppKit({
        projectId,
        metadata: {
          name: "Dolphin",
          description: "BSC agent marketplace",
          url: "https://github.com/Nnadijoshuac/dolphin",
          icons: [],
          /**
           * Where the wallet sends the user back after they approve.
           *
           * This was hardcoded to "dolphin://", which is correct for a dev or
           * production build but WRONG under Expo Go: there the app does not
           * own the dolphin:// scheme at all - it is reached through Expo's own
           * exp://<host>:8081/--/ URL - so the wallet's redirect resolved to
           * nothing and the user was left staring at the wallet app after
           * approving.
           *
           * Linking.createURL("") asks the runtime what the app's URL actually
           * is, so it yields exp://…/--/ under Expo Go and dolphin:// once the
           * scheme in app.json is real (dev build / release). One expression,
           * correct in both, and it stays correct if the scheme is ever
           * renamed.
           */
          redirect: {
            native: Linking.createURL(""),
          },
        },
        adapters: [wagmiAdapter],
        networks: [...bscNetworks],
        defaultNetwork: bsc,
        storage: appKitStorage,
        enableAnalytics: false,
        features: {
          onramp: false,
          socials: false,
          swaps: false,
          showWallets: true,
        },
      });

      return { appKit, wagmiAdapter };
    })()
  : null;

const WalletContext = createContext<WalletContextValue | null>(null);

const unavailableWallet: WalletContextValue = {
  status: "unavailable",
  isAvailable: false,
  isConnected: false,
  address: null,
  chainId: null,
  unavailableReason: MISSING_PROJECT_ID_MESSAGE,
  connect: async () => undefined,
  disconnect: async () => undefined,
};

function ReownWalletBridge({ children }: PropsWithChildren) {
  const { address, chainId, isConnected } = useAccount();
  const { disconnect, open } = useAppKit();

  const value = useMemo<WalletContextValue>(
    () => ({
      status: isConnected ? "connected" : "disconnected",
      isAvailable: true,
      isConnected,
      address: address ?? null,
      chainId: chainId ?? null,
      unavailableReason: null,
      connect: async () => {
        open();
      },
      disconnect: async () => {
        disconnect();
      },
    }),
    [address, chainId, disconnect, isConnected, open],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function WalletProvider({ children }: WalletProviderProps) {
  if (!reownSetup) {
    return (
      <WalletContext.Provider value={unavailableWallet}>
        {children}
      </WalletContext.Provider>
    );
  }

  return (
    <AppKitProvider instance={reownSetup.appKit}>
      <WagmiProvider config={reownSetup.wagmiAdapter.wagmiConfig}>
        <ReownWalletBridge>{children}</ReownWalletBridge>
        <View pointerEvents="box-none" style={styles.modalLayer}>
          <AppKit />
        </View>
      </WagmiProvider>
    </AppKitProvider>
  );
}

export function useWallet(): WalletContextValue {
  const wallet = useContext(WalletContext);

  if (!wallet) {
    throw new Error("useWallet must be used inside WalletProvider.");
  }

  return wallet;
}

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletConnectButton({
  className = "",
  connectLabel = "Connect wallet",
  disconnectLabel,
  disabled = false,
}: WalletConnectButtonProps) {
  const wallet = useWallet();
  const isDisabled = disabled || !wallet.isAvailable;
  const label = wallet.isConnected
    ? (disconnectLabel ?? `Disconnect ${shortenAddress(wallet.address ?? "")}`)
    : wallet.isAvailable
      ? connectLabel
      : "Wallet setup required";

  /**
   * Connect is one tap; disconnect asks first.
   *
   * The button's label when connected is the user's own address, so a stray tap
   * on what looks like an identity chip used to drop the session outright. The
   * confirm mirrors the website's two-step disconnect and the revoke dialog in
   * altana-wallet-card, so every wallet action that undoes something behaves the
   * same way across both products.
   *
   * Connecting stays a single tap: it is trivially reversible, and asking twice
   * to start would be friction for nothing.
   */
  const handlePress = () => {
    if (isDisabled) {
      return;
    }

    if (!wallet.isConnected) {
      void wallet.connect();
      return;
    }

    Alert.alert(
      "Disconnect this wallet?",
      "Your hire records are kept and reappear when you reconnect this address. Nothing on-chain changes.",
      [
        { text: "Stay connected", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () => void wallet.disconnect(),
        },
      ],
    );
  };

  return (
    <Pressable
      accessibilityHint={wallet.unavailableReason ?? undefined}
      accessibilityRole="button"
      className={`items-center justify-center rounded-full bg-slate-950 px-5 py-3 active:opacity-80 disabled:opacity-40 ${className}`}
      disabled={isDisabled}
      onPress={handlePress}
    >
      <Text className="text-sm font-semibold text-white">{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  modalLayer: {
    ...StyleSheet.absoluteFill,
  },
});
