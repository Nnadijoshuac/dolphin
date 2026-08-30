"use client";

import {
  BNB,
  createClient,
  signerFromPasskey,
  type Client,
  type Session,
  type Signer,
} from "@altananetwork/sdk";
import { useQuery as useTanstackQuery, useQueryClient } from "@tanstack/react-query";
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
import type { Address, Hex } from "viem";

import { agentSessionsApi, type AgentSessionRow } from "@/convex/api";
import { useNow } from "@/hooks/use-now";
import { convexClient } from "@/providers/convex-provider";
import type { AgentCategory } from "@/types/agent";
import {
  ALTANA_CHAIN_ID,
  ALTANA_WALLET_LABEL,
  buildSessionPermissions,
  expiryFromNow,
  sessionPolicyFor,
} from "./altana-policy";
import {
  forgetLocalWallet,
  getAltanaServerSnapshot,
  getAltanaSnapshot,
  saveWallet,
  subscribeToAltanaStorage,
} from "./altana-storage";

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

export type AltanaWalletValue = Readonly<{
  status: AltanaWalletStatus;
  /** Why a wallet cannot exist here. Null unless status is "unsupported". */
  unsupportedReason: string | null;
  address: Address | null;
  chainId: number;
  networkLabel: string;

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

  const refreshBalance = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ["altana-balance", ALTANA_NETWORK.chainId, address],
    });
  }, [address, queryClient]);

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
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsBusy(false);
    }
  }, []);

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
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsBusy(false);
    }
  }, []);

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
        setError(cause instanceof Error ? cause.message : String(cause));
        throw cause;
      } finally {
        setIsBusy(false);
      }
    },
    [adminSigner, markRevoked, sessionsUnavailable],
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
