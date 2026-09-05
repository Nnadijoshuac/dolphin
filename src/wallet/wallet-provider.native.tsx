/**
 * MUST BE THE FIRST IMPORT IN THIS FILE. Nothing may go above it.
 *
 * This is the documented Reown/WalletConnect setup for React Native, and this
 * file was rebuilt onto it deliberately. It previously hand-rolled a subset of
 * what this module does, on the reasoning that compat pulls in
 * react-native-url-polyfill which once broke WebSockets on RN 0.74+. The cost
 * of that divergence turned out to be high: the hand-rolled block reproduced
 * only Buffer/btoa/atob and left out everything else compat assigns, and each
 * omission failed silently rather than loudly.
 *
 * What this one import provides, all of which had to be maintained by hand
 * before (verified by reading compat 2.23.10's index.js, not assumed):
 *
 *   react-native-get-random-values   crypto.getRandomValues, for WalletConnect's
 *                                    key generation and payload encryption.
 *   fast-text-encoding               TextEncoder/TextDecoder. Hermes has
 *                                    neither, and @walletconnect/relay-auth
 *                                    calls `new TextEncoder()` UNGUARDED while
 *                                    signing the relay JWT - so without this
 *                                    the relay socket never opens and the only
 *                                    symptom is a misleading publish timeout.
 *   react-native-url-polyfill/auto   URL().
 *   Buffer / btoa / atob             base64 + binary handling.
 *   global.Linking                   how the SDK hands off into the wallet app.
 *   global.Platform                  platform branching in relayer/pairing.
 *   global.NetInfo                   the relayer's connectivity subscription.
 *                                    Guarded as `global?.NetInfo && ...`, so
 *                                    when absent the relayer never learns the
 *                                    connection dropped or returned and never
 *                                    reconnects.
 *   global.Application               bundle id + isAppInstalled - the runtime
 *                                    half of the wallet-detection config in
 *                                    app.json + queries.js. Falls back to
 *                                    expo-application when compat's own native
 *                                    module is absent, which is the case in
 *                                    Expo Go.
 *
 * If WebSockets ever do regress, the url-polyfill is the thing to suspect - but
 * suspect it with evidence, and do not go back to reimplementing the list above
 * by hand.
 */
import "@walletconnect/react-native-compat";

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
import { EventEmitter } from "events";
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

// WalletConnect registers many listeners across its relayer, pairing and
// session stores; without this the console fills with MaxListenersExceeded.
EventEmitter.defaultMaxListeners = 1000;

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

/**
 * wallet-provider.ts imports both this file and wallet-provider.web.tsx
 * unconditionally (Metro does not apply its .native/.web resolution to an
 * explicitly-suffixed specifier), so this module's top-level code runs even in
 * a web bundle. Without the Platform guard, createAppKit()/WagmiAdapter() would
 * construct a real WalletConnect Core during the static web export's SSR pass -
 * which crashed it, because Core.init reaches AsyncStorage, which needs
 * `window`. Web deliberately has no wallet (see wallet-provider.web.tsx).
 *
 * createAppKit is a SINGLETON: if an instance already exists it is returned and
 * this config is ignored entirely. That makes module-scope the only correct
 * place to call it - and it means a config change needs a full reload, not a
 * Fast Refresh, to take effect.
 */
const reownSetup =
  projectId && Platform.OS !== "web"
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
             * Where the wallet returns the user to after they approve.
             *
             * Not hardcoded to "dolphin://": that is right for a dev or release
             * build but wrong under Expo Go, where the app does not own that
             * scheme and is reached via exp://<host>:8081/--/. createURL asks
             * the runtime what the app's URL actually is, so this is correct in
             * both and survives a rename of the scheme in app.json.
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
