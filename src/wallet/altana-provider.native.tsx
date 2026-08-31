import { createContext, useContext, useMemo, type PropsWithChildren } from "react";

import { ALTANA_CHAIN_ID, ALTANA_NETWORK_LABEL } from "./altana-policy";
import {
  NATIVE_PASSKEY_UNAVAILABLE_MESSAGE,
  type AltanaWalletValue,
} from "./altana-types";

/**
 * The Altana wallet on a native Expo target: honestly unavailable.
 *
 * This file deliberately imports NOTHING from @altananetwork/sdk. There is no
 * point paying for porto/ox in a native bundle to reach an API that cannot run
 * there, and keeping the import out means a native build cannot break on the
 * SDK's browser-oriented dependencies.
 *
 * WHY it is unavailable is in NATIVE_PASSKEY_UNAVAILABLE_MESSAGE and the long
 * note above it in altana-types.ts. Short version, verified rather than
 * assumed: React Native's global navigator is `{product: 'ReactNative'}`, so
 * there is no `navigator.credentials` for WebAuthn, and the SDK's only other
 * signer is a raw private key this app declines to take custody of.
 *
 * This is NOT a dead end for a user. The same Dolphin Wallet is reachable from
 * the same passkey in a browser, including this app's own web build, and the
 * wallet screen says so with somewhere to go.
 */

const unavailable: AltanaWalletValue = {
  status: "unsupported",
  unsupportedReason: NATIVE_PASSKEY_UNAVAILABLE_MESSAGE,
  address: null,
  chainId: ALTANA_CHAIN_ID,
  networkLabel: ALTANA_NETWORK_LABEL,
  balanceWei: null,
  balanceError: null,
  isReadingBalance: false,
  refreshBalance: () => undefined,
  sessions: [],
  liveSessionKeys: [],
  sessionsUnavailable: true,
  isBusy: false,
  error: null,
  createWallet: async () => {
    throw new Error(NATIVE_PASSKEY_UNAVAILABLE_MESSAGE);
  },
  recoverWallet: async () => {
    throw new Error(NATIVE_PASSKEY_UNAVAILABLE_MESSAGE);
  },
  forgetWallet: () => undefined,
  grantSession: async () => {
    throw new Error(NATIVE_PASSKEY_UNAVAILABLE_MESSAGE);
  },
  revokeSession: async () => {
    throw new Error(NATIVE_PASSKEY_UNAVAILABLE_MESSAGE);
  },
  // Paying needs the same passkey signature granting does, so it is
  // unavailable here for exactly the same reason and says exactly the same
  // thing. Note this refuses rather than degrading to some other signer: the
  // alternative the SDK offers is a raw private key, and taking custody of one
  // to sell someone an agent would be a worse trade than not selling it.
  readTokenBalance: async () => {
    throw new Error(NATIVE_PASSKEY_UNAVAILABLE_MESSAGE);
  },
  payForAgent: async () => {
    throw new Error(NATIVE_PASSKEY_UNAVAILABLE_MESSAGE);
  },
};

const AltanaContext = createContext<AltanaWalletValue | null>(null);

export function AltanaWalletProvider({ children }: PropsWithChildren) {
  const value = useMemo(() => unavailable, []);
  return <AltanaContext.Provider value={value}>{children}</AltanaContext.Provider>;
}

export function useAltanaWallet(): AltanaWalletValue {
  const value = useContext(AltanaContext);
  if (!value) {
    throw new Error("useAltanaWallet must be used inside AltanaWalletProvider.");
  }
  return value;
}
