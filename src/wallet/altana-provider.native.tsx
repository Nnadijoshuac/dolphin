import {
  BNB,
  createClient,
  erc8183Addresses,
  hireErc8183Agent,
  signerFromPasskey,
  type Client,
  type PasskeyCredential,
  type Session,
  type Signer,
} from "@altananetwork/sdk";
import { useAction, useMutation, useQuery as useConvexQuery } from "convex/react";
import * as SecureStore from "expo-secure-store";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from "react";
import { createPublicClient, http } from "viem";

import { api } from "../../convex/_generated/api";
import { convexClient } from "@/providers/convex-provider";

import { nativePasskeysSupported, nativeWebAuthn } from "./altana-passkey-native";
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
import { ALTANA_RP_ID } from "./altana-rp-id";
import { ERC8183_CHAIN_ID, JOB_DEADLINE_SECONDS } from "./erc8183-policy";
import { toUserMessage } from "./wallet-errors";
import {
  NATIVE_PASSKEY_UNAVAILABLE_MESSAGE,
  type AltanaSession,
  type AltanaWalletStatus,
  type AltanaWalletValue,
  type GrantSessionInput,
  type PaidJob,
  type PayForAgentInput,
  type TokenHolding,
} from "./altana-types";

/**
 * The Altana wallet on a native Expo target - a real one, as of
 * @altananetwork/sdk 0.9.0.
 *
 * WHAT THIS FILE USED TO SAY. Every method here threw
 * NATIVE_PASSKEY_UNAVAILABLE_MESSAGE, and the file imported nothing from the
 * SDK on purpose. The reasoning was correct at the time and is worth keeping
 * on the record: React Native's global navigator is `{product: 'ReactNative'}`,
 * so there was no `navigator.credentials` for the SDK to reach, and the only
 * other signer it offered was a raw private key this app declines to take
 * custody of. Native users were pointed at the web build instead.
 *
 * WHAT CHANGED. 0.9.0 added `webAuthn: { createFn, getFn }` to createPasskey,
 * createPasskeyWallet, recoverFromPasskey and signerFromPasskey, and forwards
 * those functions into porto everywhere WebAuthn is touched - creation,
 * recovery, and every signature. altana-passkey-native.ts implements that
 * option against react-native-passkeys, which bridges to Apple's and Google's
 * platform passkey APIs. So the phone now gets a real Face ID / fingerprint
 * wallet, with the key in the device's secure hardware exactly as on the web.
 *
 * WHAT IS STILL REQUIRED OUTSIDE THIS CODE. The OS will only run the ceremony
 * for a domain the app has proved it owns - see altana-rp-id.ts for the two
 * files that have to be served and the app.json entry that points at them.
 * Until those exist the sheet does not open, and `createWallet` surfaces the
 * OS's refusal rather than pretending otherwise.
 *
 * Everything below the passkey layer is a deliberate mirror of
 * altana-provider.web.tsx: same policy, same guards, same refusals, same
 * copy. The differences are exactly three, and each is a platform fact:
 * the webAuthn bridge, the explicit rpId, and SecureStore instead of
 * localStorage. Anything else that diverges is a bug.
 */

/** See the identical assertion in altana-provider.web.tsx for why this exists. */
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

/** Resolved from the SDK, never hand-typed - this decides where money goes. */
const ERC8183 = erc8183Addresses(ALTANA_NETWORK.chainId);

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

/* --- device-local credential storage --------------------------------------
 * Only the passkey handle (a base64url credential id), its P256 PUBLIC key and
 * the wallet address. All three are public by construction; the private key
 * never leaves the Secure Enclave / StrongBox and is not ours to store.
 * Session grants go to Convex, which is their single source of truth.
 *
 * SecureStore rather than AsyncStorage even so. The data does not require it,
 * but expo-secure-store is already a dependency and a configured plugin here,
 * it keeps a wallet handle out of a plaintext file in the app sandbox, and the
 * size is nowhere near its 2048-byte practical limit. The cost is that reads
 * are async, which is why this provider has a real "loading" state where the
 * web twin does not.
 * ------------------------------------------------------------------------ */
const CREDENTIAL_KEY = "dolphin.altana.credential.v1";

type StoredWallet = { address: string; credential: PasskeyCredential };

let cache: StoredWallet | null = null;
let cacheLoaded = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribeStored(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Synchronous by contract - useSyncExternalStore requires it. Null until loaded. */
function getStoredSnapshot(): StoredWallet | null {
  return cache;
}

async function hydrateStored(): Promise<void> {
  if (cacheLoaded) return;
  try {
    const raw = await SecureStore.getItemAsync(CREDENTIAL_KEY);
    cache = raw ? (JSON.parse(raw) as StoredWallet) : null;
  } catch {
    // A keychain that will not open reads as "no wallet on this device", never
    // as a crash. The wallet itself is not lost: it is recoverable from the
    // passkey, which is what the recover button is for.
    cache = null;
  } finally {
    cacheLoaded = true;
    emit();
  }
}

async function writeStored(wallet: StoredWallet | null): Promise<void> {
  cache = wallet;
  cacheLoaded = true;
  emit();
  try {
    if (wallet === null) await SecureStore.deleteItemAsync(CREDENTIAL_KEY);
    else await SecureStore.setItemAsync(CREDENTIAL_KEY, JSON.stringify(wallet));
  } catch {
    // Survivable: the wallet works for this launch, it just will not be
    // remembered. Not surfaced as an error because nothing the user did failed.
  }
}

function subscribeLoaded(listener: () => void) {
  return subscribeStored(listener);
}

function getLoadedSnapshot(): boolean {
  return cacheLoaded;
}

/* ------------------------------------------------------------------------- */

const AltanaContext = createContext<AltanaWalletValue | null>(null);

export function AltanaWalletProvider({ children }: PropsWithChildren) {
  const stored = useSyncExternalStore(
    subscribeStored,
    getStoredSnapshot,
    getStoredSnapshot,
  );
  const isLoaded = useSyncExternalStore(
    subscribeLoaded,
    getLoadedSnapshot,
    getLoadedSnapshot,
  );

  const signerRef = useRef<Signer | null>(null);
  const [liveSessions, setLiveSessions] = useState<Record<string, Session>>({});
  const [balanceWei, setBalanceWei] = useState<bigint | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [isReadingBalance, setIsReadingBalance] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Read once per mount, not per render: the answer cannot change while the app
   * is running (it turns on whether the native module is linked and what the OS
   * version supports), and calling into a native module on every render would
   * be wasteful.
   */
  const [supported] = useState(nativePasskeysSupported);

  const address = stored?.address ?? null;

  useEffect(() => {
    if (supported) void hydrateStored();
  }, [supported]);

  const sessionsUnavailable = convexClient === null;
  const sessions = useConvexQuery(
    api.agentSessions.getSessionsForAltanaWallet,
    address && !sessionsUnavailable ? { altanaWalletAddress: address } : "skip",
  ) as AltanaSession[] | undefined;
  const recordGrant = useMutation(api.agentSessions.recordSessionGrant);
  const markRevoked = useMutation(api.agentSessions.markSessionRevoked);
  const recordPayment = useAction(api.agentPayments.recordJobPayment);
  const notifyFunded = useAction(api.agentPayments.notifyJobFunded);

  const [recoverability, setRecoverability] = useState<RecoverabilityState>("unknown");
  const [recoverabilityError, setRecoverabilityError] = useState<string | null>(null);
  const [isCheckingRecoverability, setIsCheckingRecoverability] = useState(false);
  const [registrationFeeWei, setRegistrationFeeWei] = useState<bigint | null>(null);

  /** The SDK's own rule, quoted from internal/keystore: "Empty array = not yet registered." */
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
          setRecoverabilityError(
            toUserMessage(cause, "Your wallet could not complete that action. Try again."),
          );
        },
      )
      .finally(() => setIsCheckingRecoverability(false));

    // Oracle-priced and observed to move between reads, so never cached.
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
          // An unreadable balance reads as unreadable, never as zero.
          setBalanceWei(null);
          setBalanceError(
            toUserMessage(cause, "Your wallet could not complete that action. Try again."),
          );
        },
      )
      .finally(() => setIsReadingBalance(false));
  }, []);

  const createWallet = useCallback(async () => {
    setIsBusy(true);
    setError(null);
    try {
      // rpId and webAuthn are BOTH required off-browser. The SDK enforces the
      // first with its own error; the second is what makes the OS sheet open
      // at all. See altana-rp-id.ts and altana-passkey-native.ts.
      const result = await altanaClient().createPasskeyWallet({
        name: ALTANA_WALLET_LABEL,
        rpId: ALTANA_RP_ID,
        webAuthn: nativeWebAuthn,
      });
      signerRef.current = result.signer;
      await writeStored({ address: result.address, credential: result.signer.credential });
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
        rpId: ALTANA_RP_ID,
        webAuthn: nativeWebAuthn,
      });
      signerRef.current = result.signer;
      await writeStored({ address: result.address, credential: result.signer.credential });
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
    void writeStored(null);
  }, []);

  const adminSigner = useCallback((): Signer => {
    if (signerRef.current) return signerRef.current;
    const current = getStoredSnapshot();
    if (!current) throw new Error("No Dolphin Wallet on this device.");
    // The bridge is function-valued, so it never survives being persisted -
    // re-attach it here or every later signature would look for a browser API
    // that does not exist. This is the exact case the SDK's own docs call out.
    const rebuilt = signerFromPasskey(current.credential, { webAuthn: nativeWebAuthn });
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
      // registered, so the whole intent becomes exactly that one call.
      await altanaClient().execute({
        wallet: { address: current.address as `0x${string}` },
        signer: adminSigner(),
        calls: [],
        chainId: ALTANA_NETWORK.chainId,
      });

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
      // "Could not read" and "is empty" are different claims, and only one of
      // them permits a payment.
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
        throw new Error(
          "Dolphin's backend is not configured, so a payment could not be verified or recorded " +
            "anywhere. Refusing to spend from your wallet with no record of what it bought.",
        );
      }

      const { quote } = input;

      // Cross-check the seller's named escrow against the SDK's own deployment
      // record. Agreeing blindly would let a compromised endpoint name any
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

      // Checked before signing rather than after failing. A user should be told
      // what they are short of, not watch a transaction revert.
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
        // passkey, which on this target means one Face ID / fingerprint prompt.
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

        // Convex does not take this result's word for it - recordJobPayment
        // reads the job back off the kernel itself and refuses on disagreement.
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
        // not undo the payment, so it is reported rather than thrown.
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
          sellerReply = toUserMessage(
            cause,
            "Your wallet could not complete that action. Try again.",
          );
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
      : !isLoaded
        ? // Not "no-wallet". Telling someone they have no wallet before the
          // keychain has answered is a claim, not a placeholder - and it would
          // invite them to create a second one over the top of the first.
          "loading"
        : stored
          ? "connected"
          : "no-wallet";

    return {
      status,
      unsupportedReason:
        status === "unsupported" ? NATIVE_PASSKEY_UNAVAILABLE_MESSAGE : null,
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
    isLoaded,
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
