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
  /**
   * Sends one contract call from the connected account and returns its
   * transaction hash.
   *
   * The ONLY transaction-sending capability in the app, and it exists for one
   * caller: publishing a review to the ERC-8004 Reputation Registry, which must
   * come from the reviewer's own address because the registry records
   * `msg.sender` as the feedback's client. Paying an agent does not go through
   * here - that settles from the Dolphin Wallet's passkey account
   * (wallet/altana-provider) and is a different account entirely.
   *
   * `chainId` is required rather than implied. A contract call sent to the
   * right address on the wrong chain is either a revert or, far worse, a call
   * to whatever happens to live at that address elsewhere - so the provider
   * verifies the wallet is on the requested chain, offers to switch, and
   * refuses rather than guessing.
   */
  writeContract: (request: ContractWriteRequest) => Promise<`0x${string}`>;
}>;

export type ContractWriteRequest = Readonly<{
  address: `0x${string}`;
  abi: readonly unknown[];
  functionName: string;
  args: readonly unknown[];
  /** The chain this call MUST execute on. Never defaulted. */
  chainId: number;
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
