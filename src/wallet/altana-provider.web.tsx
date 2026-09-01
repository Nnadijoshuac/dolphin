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

import { api } from "../../convex/_generated/api";
import { convexClient } from "@/providers/convex-provider";
import { createPublicClient, http } from "viem";

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
import { toUserMessage } from "./wallet-errors";
import type {
  AltanaSession,
  AltanaWalletStatus,
  AltanaWalletValue,
  GrantSessionInput,
  PaidJob,
  PayForAgentInput,
  TokenHolding,
} from "./altana-types";

/**
 * The Altana wallet on the Expo WEB target.
 *
 * WHY THIS EXISTS AT ALL, given native cannot host one. The Expo app's
 * publicly reachable build is its web export
 * (https://nnadijoshuac.github.io/dolphin/, built by
 * .github/workflows/deploy-web.yml). That runs in a real browser, on a real
 * HTTPS origin, where navigator.credentials IS available and the origin host
 * is a perfectly good WebAuthn relying-party id. So the surface a judge
 * actually opens can hold a real Dolphin Wallet, and only a native dev build
 * cannot. Shipping a stub on both targets would have given up a working
 * feature on the one that is reachable.
 *
 * Deliberately narrower than web/src/wallet/altana-provider.tsx in one place:
 * there is no useSyncExternalStore-vs-SSR problem here because Expo's web
 * export is client-rendered, so the loading state is simpler. Everything about
 * WHAT is authorized (altana-policy.ts) is identical by hand-mirroring.
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
  "Altana's SDK offers no other signer a person can safely use.";

/* --- device-local credential storage --------------------------------------
 * Only the passkey handle and wallet address, both public. Session grants go
 * to Convex (the single source of truth); key material goes nowhere. See
 * web/src/wallet/altana-storage.ts for the full reasoning - this is the same
 * decision, applied to the same product's other frontend.
 * ------------------------------------------------------------------------ */
const CREDENTIAL_KEY = "dolphin.altana.credential.v1";

type StoredWallet = { address: string; credential: Parameters<typeof signerFromPasskey>[0] };

let cache: StoredWallet | null = null;
let cacheLoaded = false;
const listeners = new Set<() => void>();

function readStored(): StoredWallet | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CREDENTIAL_KEY);
    return raw ? (JSON.parse(raw) as StoredWallet) : null;
  } catch {
    return null;
  }
}

function emit() {
  cache = readStored();
  cacheLoaded = true;
  for (const listener of listeners) listener();
}

function subscribeStored(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getStoredSnapshot(): StoredWallet | null {
  if (!cacheLoaded) {
    cache = readStored();
    cacheLoaded = true;
  }
  return cache;
}

function writeStored(wallet: StoredWallet | null) {
  if (typeof window === "undefined") return;
  try {
    if (wallet === null) window.localStorage.removeItem(CREDENTIAL_KEY);
    else window.localStorage.setItem(CREDENTIAL_KEY, JSON.stringify(wallet));
  } catch {
    // Storage blocked (private window). Survivable: the wallet works for this
    // session, it just will not be remembered.
  }
  emit();
}

/* ------------------------------------------------------------------------- */

const AltanaContext = createContext<AltanaWalletValue | null>(null);

export function AltanaWalletProvider({ children }: PropsWithChildren) {
  const stored = useSyncExternalStore(
    subscribeStored,
    getStoredSnapshot,
    () => null,
  );

  const signerRef = useRef<Signer | null>(null);
  const [liveSessions, setLiveSessions] = useState<Record<string, Session>>({});
  const [balanceWei, setBalanceWei] = useState<bigint | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [isReadingBalance, setIsReadingBalance] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supported = passkeysAvailable();
  const address = stored?.address ?? null;

  const sessionsUnavailable = convexClient === null;
  const sessions = useConvexQuery(
    api.agentSessions.getSessionsForAltanaWallet,
    address && !sessionsUnavailable ? { altanaWalletAddress: address } : "skip",
  ) as AltanaSession[] | undefined;
  const recordGrant = useMutation(api.agentSessions.recordSessionGrant);
  const markRevoked = useMutation(api.agentSessions.markSessionRevoked);
  // Actions, not mutations: both reach outside Convex - one to read the escrow
  // kernel on BSC, one to POST to the seller's endpoint past the CORS wall a
  // browser cannot get through.
  const recordPayment = useAction(api.agentPayments.recordJobPayment);
  const notifyFunded = useAction(api.agentPayments.notifyJobFunded);

  const [recoverability, setRecoverability] = useState<RecoverabilityState>("unknown");
  const [recoverabilityError, setRecoverabilityError] = useState<string | null>(null);
  const [isCheckingRecoverability, setIsCheckingRecoverability] = useState(false);
  const [registrationFeeWei, setRegistrationFeeWei] = useState<bigint | null>(null);

  /**
   * Reads whether this wallet's admin key is in KeyStore. The SDK's own rule,
   * quoted from internal/keystore.d.ts: "Empty array = not yet registered."
   * Nothing is inferred beyond that, and a failed read leaves the state
   * "unknown" rather than guessing in either direction.
   */
  const refreshRecoverability = useCallback(() => {
    const current = getStoredSnapshot();
    if (!current) return;
    setIsCheckingRecoverability(true);
    setRecoverabilityError(null);
    void keystoreReader
      .readContract({
        address: ALTANA_NETWORK.keyStore,
        abi: KEYSTORE_GET_KEYS_ABI,
        functionName: "getKeys",
        args: [current.address as `0x${string}`],
      })
      .then(
        (keys) => setRecoverability(keys.length > 0 ? "registered" : "unregistered"),
        (cause: unknown) => {
          setRecoverability("unknown");
          setRecoverabilityError(toUserMessage(cause, "Your wallet could not complete that action. Try again."));
        },
      )
      .finally(() => setIsCheckingRecoverability(false));

    // The fee is oracle-priced and was observed moving between two reads
    // minutes apart, so it is re-read here rather than cached anywhere.
    void keystoreReader
      .readContract({
        address: ALTANA_NETWORK.keyStoreController,
        abi: KEYSTORE_REGISTRATION_FEE_ABI,
        functionName: "getRegistrationFeeInWei",
      })
      .then(
        (fee) => setRegistrationFeeWei(fee),
        () => setRegistrationFeeWei(null),
      );
  }, []);

  const refreshBalance = useCallback(() => {
    const current = getStoredSnapshot();
    if (!current) return;
    setIsReadingBalance(true);
    setBalanceError(null);
    void altanaClient()
      .balances({
        wallet: { address: current.address as `0x${string}` },
        chainId: ALTANA_NETWORK.chainId,
      })
      .then(
        (result) => setBalanceWei(result.native),
        (cause: unknown) => {
          // An unreadable balance reads as unreadable. It is never shown as
          // zero: "could not read" and "is empty" are different claims.
          setBalanceWei(null);
          setBalanceError(toUserMessage(cause, "Your wallet could not complete that action. Try again."));
        },
      )
      .finally(() => setIsReadingBalance(false));
  }, []);

  const createWallet = useCallback(async () => {
    setIsBusy(true);
    setError(null);
    try {
      const result = await altanaClient().createPasskeyWallet({
        name: ALTANA_WALLET_LABEL,
      });
      signerRef.current = result.signer;
      writeStored({ address: result.address, credential: result.signer.credential });
      refreshBalance();
      refreshRecoverability();
    } catch (cause) {
      setError(toUserMessage(cause, "Your wallet could not complete that action. Try again."));
    } finally {
      setIsBusy(false);
    }
  }, [refreshBalance, refreshRecoverability]);

  const recoverWallet = useCallback(async () => {
    setIsBusy(true);
    setError(null);
    try {
      const result = await altanaClient().recoverFromPasskey({
        chainId: ALTANA_NETWORK.chainId,
      });
      signerRef.current = result.signer;
      writeStored({ address: result.address, credential: result.signer.credential });
      refreshBalance();
      refreshRecoverability();
    } catch (cause) {
      setError(toUserMessage(cause, "Your wallet could not complete that action. Try again."));
    } finally {
      setIsBusy(false);
    }
  }, [refreshBalance, refreshRecoverability]);

  const forgetWallet = useCallback(() => {
    signerRef.current = null;
    setLiveSessions({});
    setBalanceWei(null);
    setError(null);
    writeStored(null);
  }, []);

  const adminSigner = useCallback((): Signer => {
    if (signerRef.current) return signerRef.current;
    const current = getStoredSnapshot();
    if (!current) throw new Error("No Dolphin Wallet on this device.");
    const rebuilt = signerFromPasskey(current.credential);
    signerRef.current = rebuilt;
    return rebuilt;
  }, []);

  const grantSession = useCallback(
    async (input: GrantSessionInput) => {
      const current = getStoredSnapshot();
      if (!current) throw new Error("Create a Dolphin Wallet before granting a session.");
      if (sessionsUnavailable) {
        throw new Error(
          "Dolphin's backend is not configured, so a session grant could not be " +
            "recorded anywhere. Refusing to grant spend authority that would not " +
            "show up on your wallet screen.",
        );
      }

      const policy = sessionPolicyFor(input.category);
      if (policy.kind !== "scoped-session") {
        // Fails closed, exactly as on the website.
        throw new Error(policy.reason);
      }

      const permissions = buildSessionPermissions(policy, input.spendCapWei);
      const expiry = expiryFromNow(input.durationDays);

      setIsBusy(true);
      setError(null);
      try {
        const granted = await altanaClient().grantSession({
          wallet: { address: current.address as `0x${string}` },
          signer: adminSigner(),
          chainId: ALTANA_NETWORK.chainId,
          permissions,
          expiry,
          register: true,
        });

        // Recorded only after the grant landed - Convex cannot sign, so a row
        // written first would claim something that had not happened.
        await recordGrant({
          tokenId: input.tokenId,
          agentName: input.agentName,
          category: input.category,
          altanaWalletAddress: current.address,
          hirerWalletAddress: input.hirerWalletAddress,
          sessionPublicKey: granted.publicKey,
          allowlist: policy.allowlist.map((c) => ({ address: c.address, label: c.label })),
          spendCapWei: input.spendCapWei.toString(),
          spendPeriod: permissions.spend[0].period,
          expiry,
          grantTransactionHash: granted.transactionHash ?? null,
        });

        setLiveSessions((live) => ({ ...live, [granted.publicKey]: granted }));
        // An admin intent registers the wallet's key as a side effect (see
        // registerWallet), so this may have just become recoverable.
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
      const current = getStoredSnapshot();
      if (!current) throw new Error("No Dolphin Wallet on this device.");

      setIsBusy(true);
      setError(null);
      try {
        await altanaClient().revokeSession({
          wallet: { address: current.address as `0x${string}` },
          signer: adminSigner(),
          session: publicKey as `0x${string}`,
          chainId: ALTANA_NETWORK.chainId,
        });
        if (!sessionsUnavailable) {
          await markRevoked({ sessionPublicKey: publicKey });
        }
        setLiveSessions((live) => {
          const next = { ...live };
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
    const current = getStoredSnapshot();
    if (!current) throw new Error("No Dolphin Wallet on this device.");

    setIsBusy(true);
    setError(null);
    try {
      // An admin-signed intent with NO calls of its own. submitCalls prepends
      // the KeyStore registration to any admin intent whose wallet is not yet
      // registered, so the whole intent becomes exactly that one call - the
      // smallest thing that makes a wallet recoverable, and no side effects.
      await altanaClient().execute({
        wallet: { address: current.address as `0x${string}` },
        signer: adminSigner(),
        calls: [],
        chainId: ALTANA_NETWORK.chainId,
      });

      // Re-read rather than assume it worked - the point of this feature is
      // that the screen states a checked fact.
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
    const current = getStoredSnapshot();
    if (!current) throw new Error("No Dolphin Wallet on this device.");

    const result = await altanaClient().balances({
      wallet: { address: current.address as `0x${string}` },
      chainId: ALTANA_NETWORK.chainId,
      tokens: [token as `0x${string}`],
    });
    const holding = result.tokens?.[0];
    if (!holding) {
      throw new Error(`Could not read a balance for token ${token} on this wallet.`);
    }
    if (!holding.ok) {
      // An unreadable balance reads as unreadable, never as zero - the same
      // rule refreshBalance already follows above. "Could not read" and "is
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
      const current = getStoredSnapshot();
      if (!current) throw new Error("Create a Dolphin Wallet before paying for a hire.");
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
          { address: current.address as `0x${string}` },
          adminSigner(),
          {
            provider: quote.provider as `0x${string}`,
            task: quote.taskDescription,
            budget: price,
            deadlineSeconds: JOB_DEADLINE_SECONDS,
          },
          { network: ALTANA_NETWORK },
        );

        // Recorded only AFTER the escrow is funded, and even then Convex does
        // not take this result's word for it - recordJobPayment reads the job
        // back off the kernel itself and refuses if anything disagrees.
        const verified = await recordPayment({
          tokenId: input.tokenId,
          category: input.category,
          altanaWalletAddress: current.address,
          hirerWalletAddress: input.hirerWalletAddress,
          escrowContract: quote.verifyingContract,
          jobId: funded.jobId.toString(),
          transactionHash: funded.transactionHash ?? null,
          paymentToken: quote.paymentToken,
          paymentTokenSymbol: quote.paymentTokenSymbol,
          paymentTokenDecimals: quote.paymentTokenDecimals,
        });

        // Only now does the seller get told to start work. A failure here does
        // not undo the payment, so it is reported rather than thrown - the
        // escrow exists either way and the user needs to see what was said.
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
        // Paying is an admin intent too, so it also registers the key.
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
    const status: AltanaWalletStatus = !supported
      ? "unsupported"
      : stored
        ? "connected"
        : "no-wallet";

    return {
      status,
      unsupportedReason: status === "unsupported" ? UNSUPPORTED_REASON : null,
      address,
      chainId: ALTANA_NETWORK.chainId,
      networkLabel: ALTANA_NETWORK.chain.name,
      recoverability,
      recoverabilityError,
      isCheckingRecoverability,
      refreshRecoverability,
      registrationFeeWei,
      registerWallet,
      balanceWei,
      balanceError,
      isReadingBalance,
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
    address,
    balanceError,
    balanceWei,
    createWallet,
    error,
    forgetWallet,
    grantSession,
    isBusy,
    isCheckingRecoverability,
    isReadingBalance,
    liveSessions,
    payForAgent,
    readTokenBalance,
    recoverWallet,
    recoverability,
    recoverabilityError,
    refreshBalance,
    refreshRecoverability,
    registerWallet,
    registrationFeeWei,
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
