import type { ReactNode } from "react";

export type WalletStatus = "unavailable" | "disconnected" | "connected";

export type WalletContextValue = Readonly<{
  status: WalletStatus;
  isAvailable: boolean;
  isConnected: boolean;
  address: string | null;
  chainId: string | null;
  unavailableReason: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}>;

export type WalletProviderProps = Readonly<{
  children: ReactNode;
}>;

export type WalletConnectButtonProps = Readonly<{
  className?: string;
  connectLabel?: string;
  disconnectLabel?: string;
  disabled?: boolean;
}>;

export const NATIVE_BUILD_REQUIRED_MESSAGE =
  "Wallet connection requires a native development build.";
