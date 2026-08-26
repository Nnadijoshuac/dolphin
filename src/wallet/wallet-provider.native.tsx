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
import { Pressable, StyleSheet, Text, View } from "react-native";
import { bsc, bscTestnet } from "viem/chains";
import { WagmiProvider } from "wagmi";

import type {
  WalletConnectButtonProps,
  WalletContextValue,
  WalletProviderProps,
} from "./wallet-types";

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

const reownSetup = projectId
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

  const handlePress = () => {
    if (isDisabled) {
      return;
    }

    void (wallet.isConnected ? wallet.disconnect() : wallet.connect());
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
    ...StyleSheet.absoluteFillObject,
  },
});
