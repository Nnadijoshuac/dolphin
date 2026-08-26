import { createContext, useContext } from "react";
import { Pressable, Text } from "react-native";

import {
  NATIVE_BUILD_REQUIRED_MESSAGE,
  type WalletConnectButtonProps,
  type WalletContextValue,
  type WalletProviderProps,
} from "./wallet-types";

const webWallet: WalletContextValue = {
  status: "unavailable",
  isAvailable: false,
  isConnected: false,
  address: null,
  chainId: null,
  unavailableReason: NATIVE_BUILD_REQUIRED_MESSAGE,
  connect: async () => undefined,
  disconnect: async () => undefined,
};

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: WalletProviderProps) {
  return (
    <WalletContext.Provider value={webWallet}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const wallet = useContext(WalletContext);

  if (!wallet) {
    throw new Error("useWallet must be used inside WalletProvider.");
  }

  return wallet;
}

export function WalletConnectButton({
  className = "",
  disabled = false,
}: WalletConnectButtonProps) {
  return (
    <Pressable
      accessibilityHint={NATIVE_BUILD_REQUIRED_MESSAGE}
      accessibilityRole="button"
      className={`items-center justify-center rounded-full bg-slate-950 px-5 py-3 opacity-40 ${className}`}
      disabled={disabled || true}
    >
      <Text className="text-center text-sm font-semibold text-white">
        Native development build required
      </Text>
    </Pressable>
  );
}
