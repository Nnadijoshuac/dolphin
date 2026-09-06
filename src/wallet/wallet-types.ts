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
  /**
   * Signs a plain-text message with the connected account (EIP-191), returning
   * the signature hex.
   *
   * This is the app's ONLY signing capability and it deliberately cannot do
   * anything else: no transaction, no typed data, no approval. It exists so the
   * backend can verify that whoever is claiming an address actually holds its
   * key (convex/lib/walletAuth.ts), which is what turns a wallet address from a
   * claim anyone can type into an identity.
   *
   * Throws rather than returning null when no wallet is available, so a caller
   * cannot proceed on a signature it did not get.
   */
  signMessage: (message: string) => Promise<string>;
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
