// Must be the very first import: WalletConnect's crypto (key generation,
// relay-payload encryption) calls crypto.getRandomValues(), which RN has
// no native implementation of. Neither @walletconnect/react-native-compat
// (installs EventEmitter/TextEncoder/URL polyfills only - checked its
// package.json, it doesn't depend on this) nor wagmi/viem/@reown's
// packages polyfill this themselves - confirmed empty grep for
// "react-native-get-random-values" across their source. Without it,
// WalletConnect silently fails to publish relay messages ("Failed to
// publish custom payload, please try again") rather than throwing a
// clear error about the missing polyfill.
import "react-native-get-random-values";
// This compatibility layer installs required React Native globals before Reown loads.
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
          redirect: {
            native: "dolphin://",
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
