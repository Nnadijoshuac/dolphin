import type { AgentCategory } from "@/types/agent";
import type { RecoverabilityState } from "./altana-policy";

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

/**
 * One seller's quote, as convex/agentPayments.ts normalized and checked it.
 * MIRRORS the AgentQuote type in web/src/convex/api.ts - both describe the same
 * Convex action's return shape and must change together.
 *
 * Every field here was READ - from the seller's live response, from the token
 * contract itself, or from the agent's own registered identity. Nothing in this
 * type has a default and nothing about it is hardcoded anywhere in this repo.
 */
export type AgentQuote = Readonly<{
  dialect: "instructions" | "signed-envelope";
  /** Checked server-side to equal the agent's registered ERC-8004 wallet. */
  provider: string;
  /** Atomic units as a decimal string. Never parse this into a number. */
  priceRaw: string;
  paymentToken: string;
  /** Read on-chain from the quoted token itself, not assumed. */
  paymentTokenSymbol: string;
  paymentTokenDecimals: number;
  verifyingContract: string;
  chainId: number;
  estimatedCompletionSeconds: number | null;
  quoteExpiresAt: number | null;
  negotiationHash: string | null;
  providerSignature: string | null;
  taskDescription: string;
  deliverables: string | null;
  endpoint: string;
  rawResponse: string;
}>;

/** A paid ERC-8183 job, after Dolphin read it back off the chain. */
export type AgentJobRow = Readonly<{
  tokenId: string;
  agentName: string;
  category: AgentCategory;
  altanaWalletAddress: string;
  hirerWalletAddress: string | null;
  providerAddress: string;
  escrowContract: string;
  jobId: string;
  jobStatus: string;
  budgetRaw: string;
  paymentToken: string;
  paymentTokenSymbol: string;
  paymentTokenDecimals: number;
  taskDescription: string;
  transactionHash: string | null;
  verifiedAt: string;
}>;

export type PayForAgentInput = Readonly<{
  tokenId: string;
  category: AgentCategory;
  quote: AgentQuote;
  hirerWalletAddress: string | null;
}>;

export type PaidJob = Readonly<{
  jobId: string;
  transactionHash: string | null;
  jobStatus: string;
  budgetRaw: string;
  /** What the seller said when told its escrow was funded. */
  sellerAccepted: boolean;
  sellerReply: string;
}>;

/** One ERC-20 balance, read on-chain. Decimals and symbol come from the token. */
export type TokenHolding = Readonly<{
  address: string;
  raw: bigint;
  decimals: number;
  symbol: string;
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

  /**
   * Whether THIS wallet's admin key is in Altana's on-chain KeyStore, which is
   * exactly whether a passkey could rebuild it on another device. Read live -
   * "unknown" while unread or on error, and never defaulted either way.
   */
  recoverability: RecoverabilityState;
  recoverabilityError: string | null;
  isCheckingRecoverability: boolean;
  refreshRecoverability: () => void;

  /**
   * Live KeyStore registration fee in wei. Oracle-priced and observed to move
   * between reads, so it is never cached to a constant. Null while unread.
   */
  registrationFeeWei: bigint | null;

  /**
   * Registers this wallet's admin key on-chain so it becomes recoverable,
   * without doing anything else. Costs the fee above plus relay gas, both paid
   * by the wallet - so the caller must have shown the price and got consent.
   */
  registerWallet: () => Promise<void>;

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

  /**
   * Reads one ERC-20 balance from this wallet. Takes the token address rather
   * than consulting a list, because the only token that matters is the one the
   * agent being hired actually quoted - there is deliberately no hardcoded
   * token list anywhere in this flow.
   */
  readTokenBalance: (token: string) => Promise<TokenHolding>;

  /**
   * Pays an agent's published price by funding an ERC-8183 escrow job, then
   * has Dolphin verify that job on-chain and tell the seller to start work.
   * Signed here, by the passkey - never on a server.
   */
  payForAgent: (input: PayForAgentInput) => Promise<PaidJob>;
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
