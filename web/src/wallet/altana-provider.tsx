"use client";

import {
  BNB,
  createClient,
  erc8183Addresses,
  hireErc8183Agent,
  signerFromPasskey,
  type Client,
  type Session,
  type Signer,
} from "@altananetwork/sdk";
import { createPublicClient, http } from "viem";
import { useQuery as useTanstackQuery, useQueryClient } from "@tanstack/react-query";
import { useAction, useMutation, useQuery as useConvexQuery } from "convex/react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from "react";
import type { Address, Hex } from "viem";

import {
  agentPaymentsApi,
  agentSessionsApi,
  type AgentQuote,
  type AgentSessionRow,
} from "@/convex/api";
import { useNow } from "@/hooks/use-now";
import { convexClient } from "@/providers/convex-provider";
import type { AgentCategory } from "@/types/agent";
import {
  ALTANA_CHAIN_ID,
  ALTANA_WALLET_LABEL,
  KEYSTORE_GET_KEYS_ABI,
  KEYSTORE_REGISTRATION_FEE_ABI,
  buildSessionPermissions,
  expiryFromNow,
  sessionPolicyFor,
  type RecoverabilityState,
} from "./altana-policy";
import { ERC8183_CHAIN_ID, JOB_DEADLINE_SECONDS } from "./erc8183-policy";
import {
  forgetLocalWallet,
  getAltanaServerSnapshot,
  getAltanaSnapshot,
  saveWallet,
  subscribeToAltanaStorage,
} from "./altana-storage";
import { toUserMessage } from "./wallet-errors";

/**
 * Dolphin's Altana wallet - a passkey-backed smart account, separate from the
 * wagmi/injected wallet in wallet-provider.tsx. See altana-policy.ts for why it
 * is a second wallet rather than an upgrade of the user's existing one.
 *
 * Mirrors convex-provider.tsx's "degrade, don't crash" pattern: a module-level
 * client created lazily, and a real "this browser cannot do it" state rather
 * than a throw, so a page that merely renders this provider never breaks.
 *
 * SSR: Next prerenders every page under app/, so nothing here may touch a
 * browser-only API during the server pass. The stored credential arrives
 * through useSyncExternalStore (see altana-storage.ts) and the balance through
 * TanStack Query - deliberately no useState+useEffect pair, which is the exact
 * shape that threw React error #418 on this site once already.
 */

/**
 * The SDK's own BNB config, resolved HERE rather than in altana-policy.ts.
 * The policy module stays free of SDK imports so the native Expo bundle never
 * has to carry the SDK (measured - see the note beside ALTANA_CHAIN_ID). This
 * assertion is what stops the two from silently disagreeing about which chain
 * a wallet is on.
 */
const ALTANA_NETWORK = BNB;

if (ALTANA_NETWORK.chainId !== ALTANA_CHAIN_ID) {
  throw new Error(
    `Altana network mismatch: policy says chain ${ALTANA_CHAIN_ID}, SDK config is ` +
      `chain ${ALTANA_NETWORK.chainId}. Reconcile altana-policy.ts with the SDK before shipping.`,
  );
}

if (ERC8183_CHAIN_ID !== ALTANA_NETWORK.chainId) {
  throw new Error(
    `ERC-8183 policy says chain ${ERC8183_CHAIN_ID}, but the wallet is on ` +
      `chain ${ALTANA_NETWORK.chainId}. A paid hire must settle on the chain the wallet holds funds on.`,
  );
}

/**
 * The ERC-8183 deployment for this chain, resolved from the SDK rather than
 * written down here - same rule as ALTANA_NETWORK above and the same reason:
 * an address a human typed is an address a human can mistype, and this one
 * decides where a user's money goes.
 */
const ERC8183 = erc8183Addresses(ALTANA_NETWORK.chainId);

/**
 * A plain read client for the two KeyStore calls recoverability needs.
 *
 * Separate from the SDK's own client because the SDK does not expose its
 * `readActiveKeys` / `readRegistrationFee` helpers (they live in `internal/`).
 * Both the RPC URL and the contract addresses come from the SDK's NetworkConfig,
 * so nothing here is a hand-typed address.
 */
const keystoreReader = createPublicClient({
  chain: ALTANA_NETWORK.chain,
  transport: http(ALTANA_NETWORK.publicRpcUrl),
});

let cachedClient: Client | null = null;

function altanaClient(): Client {
  cachedClient ??= createClient({
    chains: [ALTANA_NETWORK],
    defaultChainId: ALTANA_NETWORK.chainId,
  });
  return cachedClient;
}

/**
 * WebAuthn is the only signer this SDK version offers a person, so a runtime
 * without navigator.credentials genuinely cannot hold a Dolphin wallet.
 * Verified this session: React Native's global navigator is
 * `{product: 'ReactNative'}`, and Node's has no credentials either.
 */
function passkeysAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.credentials) &&
    typeof navigator.credentials.create === "function"
  );
}

const UNSUPPORTED_REASON =
  "This browser has no WebAuthn support, so it cannot hold a Dolphin Wallet. " +
  "Altana's SDK offers no other signer a person can safely use - see altana-policy.ts.";

/* ------------------------------------------------------------------------- */

export type AltanaWalletStatus =
  | "unsupported"
  | "loading"
  | "no-wallet"
  | "connected";

export type GrantSessionInput = {
  tokenId: string;
  agentName: string;
  category: AgentCategory;
  spendCapWei: bigint;
  durationDays: number;
  /** The wagmi address on the matching agentHires row, when connected. */
  hirerWalletAddress: string | null;
};

export type PayForAgentInput = {
  tokenId: string;
  category: AgentCategory;
  /** The already-negotiated quote. Never re-derived on the client. */
  quote: AgentQuote;
  /** The wagmi address on the matching agentHires row, when connected. */
  hirerWalletAddress: string | null;
};

export type PaidJob = {
  jobId: string;
  transactionHash: string | null;
  jobStatus: string;
  budgetRaw: string;
  /** What the seller said when told its escrow was funded. */
  sellerAccepted: boolean;
  sellerReply: string;
};

/** One ERC-20 balance, read on-chain. Decimals and symbol come from the token. */
export type TokenHolding = {
  address: string;
  raw: bigint;
  decimals: number;
  symbol: string;
};

export type AltanaWalletValue = Readonly<{
  status: AltanaWalletStatus;
  /** Why a wallet cannot exist here. Null unless status is "unsupported". */
  unsupportedReason: string | null;
  address: Address | null;
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

  /** Native balance in wei. Null while unread - never shown as zero. */
  balanceWei: bigint | null;
  balanceError: string | null;
  isReadingBalance: boolean;
  refreshBalance: () => void;

  /**
   * Sessions as Convex holds them - the single source of truth, so this list
   * and any hire record cannot disagree. `undefined` while loading, and while
   * Convex is unconfigured (in which case grants are refused rather than
   * recorded nowhere).
   */
  sessions: AgentSessionRow[] | undefined;
  /** Sessions whose signing key is held in THIS tab. A reload empties it. */
  liveSessionKeys: readonly string[];
  /** True when session state cannot be recorded, so grants are refused. */
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
   * Signed here, in the browser, by the passkey - never on a server.
   */
  payForAgent: (input: PayForAgentInput) => Promise<PaidJob>;
}>;

const AltanaContext = createContext<AltanaWalletValue | null>(null);

function subscribeNoop() {
  return () => {};
}

export function AltanaWalletProvider({ children }: PropsWithChildren) {
  // Server render and first client render both see false, so the markup
  // agrees; the real value lands on the post-hydration pass.
  const isClient = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );

  const stored = useSyncExternalStore(
    subscribeToAltanaStorage,
    getAltanaSnapshot,
    getAltanaServerSnapshot,
  );

  const now = useNow();
  const queryClient = useQueryClient();

  // The admin signer, rebuilt from the stored credential on demand. A ref, not
  // state: it is a cache, never something a render should depend on.
  const signerRef = useRef<Signer | null>(null);
  // Session signers, keyed by public key. Memory-only and deliberately never
  // persisted - see altana-storage.ts.
  const [liveSessions, setLiveSessions] = useState<Record<string, Session>>({});
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supported = isClient && passkeysAvailable();
  const address = stored?.address ?? null;

  // Convex is the source of truth for grants. When it is unconfigured these
  // hooks are skipped and grantSession refuses outright, rather than handing
  // out authority nothing would have a record of.
  const sessionsUnavailable = convexClient === null;
  const sessions = useConvexQuery(
    agentSessionsApi.agentSessions.getSessionsForAltanaWallet,
    address && !sessionsUnavailable ? { altanaWalletAddress: address } : "skip",
  );
  const recordGrant = useMutation(agentSessionsApi.agentSessions.recordSessionGrant);
  const markRevoked = useMutation(agentSessionsApi.agentSessions.markSessionRevoked);
  // Actions, not mutations: both reach outside Convex - one to read the escrow
  // kernel on BSC, one to POST to the seller's endpoint past the CORS wall a
  // browser cannot get through.
  const recordPayment = useAction(agentPaymentsApi.agentPayments.recordJobPayment);
  const notifyFunded = useAction(agentPaymentsApi.agentPayments.notifyJobFunded);

  const balanceQuery = useTanstackQuery({
    queryKey: ["altana-balance", ALTANA_NETWORK.chainId, address],
    enabled: Boolean(address),
    // A balance is a live on-chain fact, not cacheable identity data. Same
    // reasoning as the 30-60s refetch project-scope.md §5 sets for live stats.
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const result = await altanaClient().balances({
        wallet: { address: address as Address },
        chainId: ALTANA_NETWORK.chainId,
      });
      return result.native;
    },
  });

  /**
   * The recoverability read. A wallet's KeyStore entry changes at most once in
   * its life (registration is one-way), so unlike the balance this does not
   * need polling - but it MUST be re-read after any admin action, which is why
   * every such path below invalidates it.
   */
  const recoverabilityQuery = useTanstackQuery({
    queryKey: ["altana-recoverability", ALTANA_NETWORK.chainId, address],
    enabled: Boolean(address),
    staleTime: 60_000,
    queryFn: async () => {
      const keys = await keystoreReader.readContract({
        address: ALTANA_NETWORK.keyStore,
        abi: KEYSTORE_GET_KEYS_ABI,
        functionName: "getKeys",
        args: [address as Address],
      });
      // The SDK's own rule, quoted in internal/keystore.d.ts: "Empty array =
      // not yet registered." Nothing is inferred beyond that.
      return keys.length > 0;
    },
  });

  const registrationFeeQuery = useTanstackQuery({
    queryKey: ["altana-registration-fee", ALTANA_NETWORK.chainId],
    // Read regardless of wallet, so the price can be shown before a user
    // commits. Short staleTime because the fee is oracle-priced and was
    // observed moving between two reads minutes apart.
    staleTime: 60_000,
    queryFn: () =>
      keystoreReader.readContract({
        address: ALTANA_NETWORK.keyStoreController,
        abi: KEYSTORE_REGISTRATION_FEE_ABI,
        functionName: "getRegistrationFeeInWei",
      }),
  });

  const refreshRecoverability = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ["altana-recoverability", ALTANA_NETWORK.chainId, address],
    });
  }, [address, queryClient]);

  const refreshBalance = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ["altana-balance", ALTANA_NETWORK.chainId, address],
    });
  }, [address, queryClient]);

  /**
   * Creates a new Dolphin Wallet behind one platform passkey prompt.
   *
   * The address that comes back is COUNTERFACTUAL: no transaction has happened,
   * the account is not deployed, and `balances` reads it as zero until someone
   * funds it. That is why the wallet screen's funding banner is not an error
   * state - it is the normal condition of a wallet that has just been made.
   *
   * Only the public credential handle is persisted (see altana-storage.ts). The
   * private half never leaves the device's secure element, so this app is never
   * in a position to lose or leak it.
   */
  const createWallet = useCallback(async () => {
    setIsBusy(true);
    setError(null);
    try {
      const result = await altanaClient().createPasskeyWallet({
        name: ALTANA_WALLET_LABEL,
      });
      signerRef.current = result.signer;
      saveWallet({ address: result.address, credential: result.signer.credential });
    } catch (cause) {
      setError(toUserMessage(cause, "Your wallet could not complete that action. Try again."));
    } finally {
      setIsBusy(false);
    }
  }, []);

  /**
   * Rebuilds an existing wallet from its passkey alone - no seed phrase, no
   * export, nothing for the user to have kept.
   *
   * Only works for a wallet whose admin key is already in Altana's on-chain
   * KeyStore, which happens on its FIRST admin-signed transaction and not at
   * creation. A wallet created and never used cannot be recovered, which is the
   * entire reason the recoverability panel exists and reads `getKeys` live
   * rather than reassuring by default.
   */
  const recoverWallet = useCallback(async () => {
    setIsBusy(true);
    setError(null);
    try {
      const result = await altanaClient().recoverFromPasskey({
        chainId: ALTANA_NETWORK.chainId,
      });
      signerRef.current = result.signer;
      saveWallet({ address: result.address, credential: result.signer.credential });
    } catch (cause) {
      setError(toUserMessage(cause, "Your wallet could not complete that action. Try again."));
    } finally {
      setIsBusy(false);
    }
  }, []);

  /**
   * Forgets this BROWSER's record of the wallet. Nothing else.
   *
   * The wallet still exists on-chain, the passkey still exists on the device,
   * its balance is untouched, and every session granted from it stays exactly
   * as active as it was. This clears local state only - the in-memory signer,
   * any session keys held for this tab, and the stored credential handle. The
   * UI must never imply that it destroys anything, because it cannot.
   */
  const forgetWallet = useCallback(() => {
    signerRef.current = null;
    setLiveSessions({});
    setError(null);
    forgetLocalWallet();
  }, []);

  /** Rebuilds the admin signer from the stored credential when not in memory. */
  const adminSigner = useCallback((): Signer => {
    if (signerRef.current) return signerRef.current;
    const wallet = getAltanaSnapshot();
    if (!wallet) throw new Error("No Dolphin Wallet on this device.");
    const rebuilt = signerFromPasskey(wallet.credential);
    signerRef.current = rebuilt;
    return rebuilt;
  }, []);

  const grantSession = useCallback(
    async (input: GrantSessionInput): Promise<void> => {
      const wallet = getAltanaSnapshot();
      if (!wallet) {
        throw new Error("Create a Dolphin Wallet before granting a session.");
      }
      if (sessionsUnavailable) {
        // Refuse rather than grant real spend authority that nothing would
        // have a durable record of. A permission a user cannot later find is
        // a permission they cannot knowingly revoke.
        throw new Error(
          "Dolphin's backend is not configured, so a session grant could not be " +
            "recorded anywhere. Refusing to grant spend authority that would not " +
            "show up on your wallet screen.",
        );
      }

      const policy = sessionPolicyFor(input.category);
      if (policy.kind !== "scoped-session") {
        // Fails closed: a caller cannot talk this provider into granting spend
        // authority for a category the policy holds to be information-only.
        throw new Error(policy.reason);
      }

      // Throws rather than ever emitting permissions without `calls`.
      const permissions = buildSessionPermissions(policy, input.spendCapWei);
      const expiry = expiryFromNow(input.durationDays);

      setIsBusy(true);
      setError(null);
      try {
        const granted = await altanaClient().grantSession({
          wallet: { address: wallet.address },
          signer: adminSigner(),
          chainId: ALTANA_NETWORK.chainId,
          permissions,
          expiry,
          register: true,
        });

        // Recorded only AFTER the grant actually landed. Convex cannot sign,
        // so a row written first would be a claim about something that had not
        // happened - exactly the shape AGENTS.md §5 rules out.
        await recordGrant({
          tokenId: input.tokenId,
          agentName: input.agentName,
          category: input.category,
          altanaWalletAddress: wallet.address,
          hirerWalletAddress: input.hirerWalletAddress,
          sessionPublicKey: granted.publicKey,
          allowlist: policy.allowlist.map((c) => ({
            address: c.address,
            label: c.label,
          })),
          spendCapWei: input.spendCapWei.toString(),
          spendPeriod: permissions.spend[0].period,
          expiry,
          grantTransactionHash: granted.transactionHash ?? null,
        });

        setLiveSessions((current) => ({ ...current, [granted.publicKey]: granted }));
        // An admin intent registers the wallet's key as a side effect (see
        // registerWallet), so this may have just become recoverable. Re-read
        // rather than let the screen go on showing a now-stale "not yet".
        refreshRecoverability();
      } catch (cause) {
        setError(toUserMessage(cause, "Your wallet could not complete that action. Try again."));
        throw cause;
      } finally {
        setIsBusy(false);
      }
    },
    [adminSigner, recordGrant, refreshRecoverability, sessionsUnavailable],
  );

  const revokeSession = useCallback(
    async (publicKey: string) => {
      const wallet = getAltanaSnapshot();
      if (!wallet) throw new Error("No Dolphin Wallet on this device.");

      setIsBusy(true);
      setError(null);
      try {
        // revokeSession accepts a bare public key, which is exactly why a
        // session granted before a page reload is still revocable.
        await altanaClient().revokeSession({
          wallet: { address: wallet.address },
          signer: adminSigner(),
          session: publicKey as Hex,
          chainId: ALTANA_NETWORK.chainId,
        });

        if (!sessionsUnavailable) {
          await markRevoked({ sessionPublicKey: publicKey });
        }
        setLiveSessions((current) => {
          const next = { ...current };
          delete next[publicKey];
          return next;
        });
      } catch (cause) {
        setError(toUserMessage(cause, "Your wallet could not complete that action. Try again."));
        throw cause;
      } finally {
        setIsBusy(false);
      }
    },
    [adminSigner, markRevoked, sessionsUnavailable],
  );

  const registerWallet = useCallback(async (): Promise<void> => {
    const wallet = getAltanaSnapshot();
    if (!wallet) throw new Error("No Dolphin Wallet on this device.");

    setIsBusy(true);
    setError(null);
    try {
      // An admin-signed intent with NO calls of its own. submitCalls prepends
      // the KeyStore registration to any admin intent whose wallet is not yet
      // registered, so the whole intent becomes exactly that one call - the
      // smallest thing that makes a wallet recoverable, and no side effects.
      //
      // Deliberately NOT a contrived transfer or self-call: those would move
      // value or burn extra gas to achieve the same registration.
      await altanaClient().execute({
        wallet: { address: wallet.address },
        signer: adminSigner(),
        calls: [],
        chainId: ALTANA_NETWORK.chainId,
      });

      // Re-read rather than assume it worked. The whole point of this feature
      // is that the screen states a checked fact, and that has to keep being
      // true immediately after the action that changed it.
      refreshRecoverability();
      refreshBalance();
    } catch (cause) {
      setError(toUserMessage(cause, "Your wallet could not complete that action. Try again."));
      throw cause;
    } finally {
      setIsBusy(false);
    }
  }, [adminSigner, refreshBalance, refreshRecoverability]);

  const readTokenBalance = useCallback(async (token: string): Promise<TokenHolding> => {
    const wallet = getAltanaSnapshot();
    if (!wallet) throw new Error("No Dolphin Wallet on this device.");

    const result = await altanaClient().balances({
      wallet: { address: wallet.address },
      chainId: ALTANA_NETWORK.chainId,
      tokens: [token as Address],
    });
    const holding = result.tokens?.[0];
    if (!holding) {
      throw new Error(`Could not read a balance for token ${token} on this wallet.`);
    }
    if (!holding.ok) {
      // An unreadable balance reads as unreadable, never as zero - the same
      // rule the native balance already follows. "Could not read" and "is
      // empty" are different claims and only one of them permits a payment.
      throw new Error(`Could not read the token balance: ${holding.error}`);
    }
    return {
      address: holding.address,
      raw: holding.raw,
      decimals: holding.decimals,
      symbol: holding.symbol,
    };
  }, []);

  const payForAgent = useCallback(
    async (input: PayForAgentInput): Promise<PaidJob> => {
      const wallet = getAltanaSnapshot();
      if (!wallet) {
        throw new Error("Create a Dolphin Wallet before paying for a hire.");
      }
      if (sessionsUnavailable) {
        // Same refusal as grantSession, for the same reason and with more at
        // stake: a payment nothing would have a record of is a payment the
        // user could never point at afterwards.
        throw new Error(
          "Dolphin's backend is not configured, so a payment could not be verified or recorded " +
            "anywhere. Refusing to spend from your wallet with no record of what it bought.",
        );
      }

      const { quote } = input;

      // Cross-check the seller's named escrow against the SDK's own deployment
      // record. The seller tells Dolphin which contract to put money into;
      // agreeing with it blindly would let a compromised endpoint name any
      // contract at all. Both sides must say the same thing or nothing moves.
      if (quote.verifyingContract.toLowerCase() !== ERC8183.commerce.toLowerCase()) {
        throw new Error(
          `This agent asked for payment into ${quote.verifyingContract}, but the ERC-8183 escrow ` +
            `kernel on this chain is ${ERC8183.commerce}. Dolphin will not fund an escrow contract ` +
            "the SDK's own deployment record does not recognise.",
        );
      }
      if (quote.paymentToken.toLowerCase() !== ERC8183.paymentToken.toLowerCase()) {
        throw new Error(
          `This agent quoted in token ${quote.paymentToken}, but the ERC-8183 kernel settles in ` +
            `${ERC8183.paymentToken}. A job funded in a different token would not pay this agent.`,
        );
      }
      if (quote.chainId !== ALTANA_NETWORK.chainId) {
        throw new Error(
          `This agent quoted on chain ${quote.chainId}; your Dolphin Wallet holds funds on chain ` +
            `${ALTANA_NETWORK.chainId}.`,
        );
      }

      // Balance is checked before signing rather than after failing. A user
      // should be told what they are short of, not watch a transaction revert.
      const holding = await readTokenBalance(quote.paymentToken);
      const price = BigInt(quote.priceRaw);
      if (holding.raw < price) {
        throw new Error(
          `This agent charges ${quote.priceRaw} atomic units of ${holding.symbol} and this Dolphin ` +
            `Wallet holds ${holding.raw.toString()}. Fund the wallet before paying.`,
        );
      }

      setIsBusy(true);
      setError(null);
      try {
        // THE PAYMENT. Five calls - createJob, registerJob, setBudget, approve
        // and fund - batched into one atomic relay intent and signed by the
        // passkey. Note there is no separate Permit2 approval step to walk the
        // user through: this rail batches its own token approval, unlike x402.
        const funded = await hireErc8183Agent(
          { address: wallet.address },
          adminSigner(),
          {
            provider: quote.provider as Address,
            task: quote.taskDescription,
            budget: price,
            deadlineSeconds: JOB_DEADLINE_SECONDS,
          },
          { network: ALTANA_NETWORK },
        );

        // Recorded only AFTER the escrow is funded, and even then Convex does
        // not take this result's word for it - recordJobPayment reads the job
        // back off the kernel itself and refuses if anything disagrees. Same
        // principle as recordSessionGrant, one notch stricter because this one
        // is about money.
        const verified = await recordPayment({
          tokenId: input.tokenId,
          category: input.category,
          altanaWalletAddress: wallet.address,
          hirerWalletAddress: input.hirerWalletAddress,
          escrowContract: quote.verifyingContract,
          jobId: funded.jobId.toString(),
          transactionHash: funded.transactionHash ?? null,
          paymentToken: quote.paymentToken,
          paymentTokenSymbol: quote.paymentTokenSymbol,
          paymentTokenDecimals: quote.paymentTokenDecimals,
        });

        // Only now does the seller get told to start work. Notifying earlier
        // would ask an agent to work against an escrow Dolphin had not
        // confirmed. A failure here does not undo the payment, so it is
        // reported rather than thrown - the escrow exists either way and the
        // user needs to see what the seller said.
        let sellerAccepted = false;
        let sellerReply = "";
        try {
          const notified = await notifyFunded({
            tokenId: input.tokenId,
            jobId: funded.jobId.toString(),
          });
          sellerAccepted = notified.accepted;
          sellerReply = notified.detail;
        } catch (cause) {
          sellerReply = toUserMessage(cause, "Your wallet could not complete that action. Try again.");
        }

        refreshBalance();
        // Paying is an admin intent too, so it also registers the key. Same
        // reasoning as grantSession above.
        refreshRecoverability();
        return {
          jobId: funded.jobId.toString(),
          transactionHash: funded.transactionHash ?? null,
          jobStatus: verified.jobStatus,
          budgetRaw: verified.budgetRaw,
          sellerAccepted,
          sellerReply,
        };
      } catch (cause) {
        setError(toUserMessage(cause, "Your wallet could not complete that action. Try again."));
        throw cause;
      } finally {
        setIsBusy(false);
      }
    },
    [
      adminSigner,
      notifyFunded,
      readTokenBalance,
      recordPayment,
      refreshBalance,
      refreshRecoverability,
      sessionsUnavailable,
    ],
  );

  const value = useMemo<AltanaWalletValue>(() => {
    const status: AltanaWalletStatus = !isClient
      ? "loading"
      : !supported
        ? "unsupported"
        : stored
          ? "connected"
          : "no-wallet";

    // The backend already derives "expired" from the clock on read; `now` here
    // just makes the view re-render as an expiry passes rather than sitting on
    // a stale answer until something else re-renders the tree.
    void now;

    return {
      status,
      unsupportedReason: status === "unsupported" ? UNSUPPORTED_REASON : null,
      address: stored?.address ?? null,
      chainId: ALTANA_NETWORK.chainId,
      networkLabel: ALTANA_NETWORK.chain.name,
      // Three states, and "we could not read it" is its own. A failed read
      // must never render as either a reassurance or a warning.
      recoverability:
        recoverabilityQuery.data === undefined
          ? "unknown"
          : recoverabilityQuery.data
            ? "registered"
            : "unregistered",
      recoverabilityError:
        recoverabilityQuery.error instanceof Error
          ? recoverabilityQuery.error.message
          : recoverabilityQuery.error
            ? String(recoverabilityQuery.error)
            : null,
      isCheckingRecoverability: recoverabilityQuery.isFetching,
      refreshRecoverability,
      registrationFeeWei: registrationFeeQuery.data ?? null,
      registerWallet,
      balanceWei: balanceQuery.data ?? null,
      balanceError:
        balanceQuery.error instanceof Error
          ? balanceQuery.error.message
          : balanceQuery.error
            ? String(balanceQuery.error)
            : null,
      isReadingBalance: balanceQuery.isFetching,
      refreshBalance,
      sessions: sessionsUnavailable ? [] : sessions,
      liveSessionKeys: Object.keys(liveSessions),
      sessionsUnavailable,
      isBusy,
      error,
      createWallet,
      recoverWallet,
      forgetWallet,
      grantSession,
      revokeSession,
      readTokenBalance,
      payForAgent,
    };
  }, [
    balanceQuery.data,
    balanceQuery.error,
    balanceQuery.isFetching,
    createWallet,
    error,
    forgetWallet,
    grantSession,
    isBusy,
    isClient,
    liveSessions,
    now,
    payForAgent,
    readTokenBalance,
    recoverWallet,
    recoverabilityQuery.data,
    recoverabilityQuery.error,
    recoverabilityQuery.isFetching,
    refreshBalance,
    refreshRecoverability,
    registerWallet,
    registrationFeeQuery.data,
    revokeSession,
    sessions,
    sessionsUnavailable,
    stored,
    supported,
  ]);

  return <AltanaContext.Provider value={value}>{children}</AltanaContext.Provider>;
}

export function useAltanaWallet(): AltanaWalletValue {
  const value = useContext(AltanaContext);
  if (!value) {
    throw new Error("useAltanaWallet must be used inside AltanaWalletProvider.");
  }
  return value;
}
