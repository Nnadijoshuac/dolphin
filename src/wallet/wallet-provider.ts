import { Platform } from "react-native";
import * as NativeWallet from "./wallet-provider.native";
import * as WebWallet from "./wallet-provider.web";

export const WalletProvider =
  Platform.OS === "web" ? WebWallet.WalletProvider : NativeWallet.WalletProvider;

export const useWallet =
  Platform.OS === "web" ? WebWallet.useWallet : NativeWallet.useWallet;

export const WalletConnectButton =
  Platform.OS === "web"
    ? WebWallet.WalletConnectButton
    : NativeWallet.WalletConnectButton;

export * from "./wallet-types";
