import {
  BNB,
  createClient,
  signerFromPasskey,
  type Client,
  type Session,
  type Signer,
} from "@altananetwork/sdk";
import { useMutation, useQuery as useConvexQuery } from "convex/react";
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
import {
  ALTANA_CHAIN_ID,
  ALTANA_WALLET_LABEL,
  buildSessionPermissions,
  expiryFromNow,
  sessionPolicyFor,
} from "./altana-policy";
import type {
  AltanaSession,
  AltanaWalletStatus,
  AltanaWalletValue,
  GrantSessionInput,
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
          setBalanceError(cause instanceof Error ? cause.message : String(cause));
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsBusy(false);
    }
  }, [refreshBalance]);

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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsBusy(false);
    }
  }, [refreshBalance]);

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
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        throw cause;
      } finally {
        setIsBusy(false);
      }
    },
    [adminSigner, recordGrant, sessionsUnavailable],
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
        setError(cause instanceof Error ? cause.message : String(cause));
        throw cause;
      } finally {
        setIsBusy(false);
      }
    },
    [adminSigner, markRevoked, sessionsUnavailable],
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
    isReadingBalance,
    liveSessions,
    recoverWallet,
    refreshBalance,
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
