import type { AgentCategory } from "@/types/agent";

/**
 * Shared shape for the Altana wallet across both Expo targets, so the web
 * implementation and the native "not here" state cannot drift apart. Mirrors
 * the pattern wallet-types.ts already establishes for the Reown wallet.
 */

export type AltanaWalletStatus =
  | "unsupported"
  | "loading"
  | "no-wallet"
  | "connected";

/** A granted session as Convex holds it. No key material - see convex/agentSessions.ts. */
export type AltanaSession = Readonly<{
  tokenId: string;
  agentName: string;
  category: AgentCategory;
  altanaWalletAddress: string;
  hirerWalletAddress: string | null;
  sessionPublicKey: string;
  allowlist: readonly { address: string; label: string }[];
  spendCapWei: string;
  spendPeriod: string;
  expiry: number;
  grantedAt: string;
  revokedAt: string | null;
  grantTransactionHash: string | null;
  status: "active" | "revoked" | "expired";
}>;

export type GrantSessionInput = Readonly<{
  tokenId: string;
  agentName: string;
  category: AgentCategory;
  spendCapWei: bigint;
  durationDays: number;
  hirerWalletAddress: string | null;
}>;

export type AltanaWalletValue = Readonly<{
  status: AltanaWalletStatus;
  /** Why a wallet cannot exist here. Null unless status is "unsupported". */
  unsupportedReason: string | null;
  address: string | null;
  chainId: number;
  networkLabel: string;

  /** Native balance in wei. Null while unread - never rendered as zero. */
  balanceWei: bigint | null;
  balanceError: string | null;
  isReadingBalance: boolean;
  refreshBalance: () => void;

  /** undefined while loading. Convex is the source of truth. */
  sessions: readonly AltanaSession[] | undefined;
  /** Sessions whose signing key is held in this runtime. Empty after a reload. */
  liveSessionKeys: readonly string[];
  sessionsUnavailable: boolean;

  isBusy: boolean;
  error: string | null;

  createWallet: () => Promise<void>;
  recoverWallet: () => Promise<void>;
  forgetWallet: () => void;

  grantSession: (input: GrantSessionInput) => Promise<void>;
  revokeSession: (publicKey: string) => Promise<void>;
}>;

/**
 * The native story, stated once so both the provider and the wallet screen
 * quote the same words.
 *
 * VERIFIED, not assumed (session 6, Task 0): React Native's global navigator is
 * literally `{product: 'ReactNative'}` - see
 * node_modules/react-native/Libraries/Core/setUpNavigator.js - so there is no
 * `credentials` property for WebAuthn to hang off. Altana's SDK offers exactly
 * two signer families, raw private key and browser WebAuthn passkey, and
 * `createPasskey` throws outside a browser by design. `signerFromInjected`
 * appears only in the SDK's doc comments and is not implemented.
 *
 * A React Native passkey library (react-native-passkeys, expo-passkey) does not
 * close this: platform passkeys need a verified domain serving
 * apple-app-site-association / assetlinks.json, which this project has none for
 * its native builds, and Altana needs a flat P256 x||y encoding neither library
 * documents. That is a domain-and-encoding problem, not a missing package.
 *
 * A private-key signer WOULD run here - and is deliberately not used, because
 * it would make this app solely responsible for generating and storing a key
 * with no recovery path. See ALTANA_SIGNER_STRATEGY in altana-policy.ts.
 */
export const NATIVE_PASSKEY_UNAVAILABLE_MESSAGE =
  "A Dolphin Wallet needs a passkey, and React Native has no WebAuthn API to " +
  "create one with. Open Dolphin in a browser to create or use your Dolphin " +
  "Wallet - it is the same wallet, reachable from the same passkey.";
