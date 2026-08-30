"use client";

import {
  createClient,
  signerFromPasskey,
  type Client,
  type Session,
  type Signer,
} from "@altananetwork/sdk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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

import { useNow } from "@/hooks/use-now";
import type { AgentCategory } from "@/types/agent";
import {
  ALTANA_NETWORK,
  ALTANA_WALLET_LABEL,
  buildSessionPermissions,
  expiryFromNow,
  sessionPolicyFor,
} from "./altana-policy";
import {
  forgetLocalWallet,
  getAltanaServerSnapshot,
  getAltanaSnapshot,
  saveSessions,
  saveWallet,
  subscribeToAltanaStorage,
  type StoredSession,
} from "./altana-storage";

export type { StoredSession } from "./altana-storage";

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
 * browser-only API during the server pass. Persisted state arrives through
 * useSyncExternalStore (see altana-storage.ts) and the balance through
 * TanStack Query - deliberately no useState+useEffect pair, which is the exact
 * shape that threw React error #418 on this site once already.
 */

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

  /** Unexpired granted sessions. */
  sessions: readonly StoredSession[];
  /** Sessions usable from this tab. A reload empties this by design. */
  liveSessionKeys: readonly Hex[];

  isBusy: boolean;
  error: string | null;

  createWallet: () => Promise<void>;
  recoverWallet: () => Promise<void>;
  forgetWallet: () => void;

  grantSession: (input: GrantSessionInput) => Promise<StoredSession>;
  revokeSession: (publicKey: Hex) => Promise<void>;
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

  const persisted = useSyncExternalStore(
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
  const [liveSessions, setLiveSessions] = useState<Record<Hex, Session>>({});
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supported = isClient && passkeysAvailable();
  const address = persisted.wallet?.address ?? null;

  const balanceQuery = useQuery({
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
    const wallet = getAltanaSnapshot().wallet;
    if (!wallet) throw new Error("No Dolphin Wallet on this device.");
    const rebuilt = signerFromPasskey(wallet.credential);
    signerRef.current = rebuilt;
    return rebuilt;
  }, []);

  const grantSession = useCallback(
    async (input: GrantSessionInput): Promise<StoredSession> => {
      const snapshot = getAltanaSnapshot();
      const wallet = snapshot.wallet;
      if (!wallet) {
        throw new Error("Create a Dolphin Wallet before granting a session.");
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

        const record: StoredSession = {
          publicKey: granted.publicKey,
          tokenId: input.tokenId,
          agentName: input.agentName,
          category: input.category,
          allowlist: policy.allowlist.map((c) => ({ address: c.address, label: c.label })),
          spendCapWei: input.spendCapWei.toString(),
          spendPeriod: permissions.spend[0].period,
          expiry,
          grantedAt: new Date().toISOString(),
          transactionHash: granted.transactionHash ?? null,
        };

        saveSessions([
          ...snapshot.sessions.filter((s) => s.publicKey !== record.publicKey),
          record,
        ]);
        setLiveSessions((current) => ({ ...current, [granted.publicKey]: granted }));
        return record;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        throw cause;
      } finally {
        setIsBusy(false);
      }
    },
    [adminSigner],
  );

  const revokeSession = useCallback(
    async (publicKey: Hex) => {
      const snapshot = getAltanaSnapshot();
      const wallet = snapshot.wallet;
      if (!wallet) throw new Error("No Dolphin Wallet on this device.");

      setIsBusy(true);
      setError(null);
      try {
        // revokeSession accepts a bare public key, which is exactly why a
        // session granted before a page reload is still revocable.
        await altanaClient().revokeSession({
          wallet: { address: wallet.address },
          signer: adminSigner(),
          session: publicKey,
          chainId: ALTANA_NETWORK.chainId,
        });
        saveSessions(snapshot.sessions.filter((s) => s.publicKey !== publicKey));
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
    [adminSigner],
  );

  const value = useMemo<AltanaWalletValue>(() => {
    const status: AltanaWalletStatus = !isClient
      ? "loading"
      : !supported
        ? "unsupported"
        : persisted.wallet
          ? "connected"
          : "no-wallet";

    // Expired sessions are dropped rather than shown as authority still held.
    // `now` is 0 during SSR ("time not known"), where nothing is filtered out.
    const sessions =
      now === 0
        ? persisted.sessions
        : persisted.sessions.filter((s) => s.expiry * 1000 > now);

    return {
      status,
      unsupportedReason: status === "unsupported" ? UNSUPPORTED_REASON : null,
      address: persisted.wallet?.address ?? null,
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
      sessions,
      liveSessionKeys: Object.keys(liveSessions) as Hex[],
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
    persisted,
    recoverWallet,
    refreshBalance,
    revokeSession,
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
