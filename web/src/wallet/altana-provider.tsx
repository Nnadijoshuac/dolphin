"use client";

import {
  createClient,
  signerFromPasskey,
  type Client,
  type PasskeyCredential,
  type Session,
  type Signer,
} from "@altananetwork/sdk";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from "react";
import type { Address, Hex } from "viem";

import type { AgentCategory } from "@/types/agent";
import {
  ALTANA_NETWORK,
  ALTANA_WALLET_LABEL,
  buildSessionPermissions,
  expiryFromNow,
  sessionPolicyFor,
} from "./altana-policy";

/**
 * Dolphin's Altana wallet — a passkey-backed smart account, separate from the
 * wagmi/injected wallet in wallet-provider.tsx. See altana-policy.ts for why
 * it is a second wallet rather than an upgrade of the user's existing one.
 *
 * Mirrors the shape of convex-provider.tsx: a module-level client, and a
 * "degrade, don't crash" path when the environment cannot support it, so a
 * page that merely renders this provider never throws.
 *
 * SSR: Next prerenders every page under app/. Nothing here may touch a
 * browser-only API during the server pass. The client is created lazily on
 * first use and passkey availability is read through useSyncExternalStore,
 * which is the same fix this project already applied to the wagmi provider
 * after React error #418 (see HANDOVER.md, 2026-08-29). Do not reintroduce a
 * useState+useEffect probe here.
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
 * WebAuthn is the only user-facing signer this SDK version has, so a runtime
 * with no `navigator.credentials` genuinely cannot host a Dolphin wallet.
 * Verified this session: React Native's global navigator is
 * `{product: 'ReactNative'}` and Node's has no `credentials` either.
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
  "This browser has no WebAuthn support, so it cannot hold a Dolphin wallet. " +
  "Altana's SDK offers no other signer a person can safely use — see altana-policy.ts.";

/* ---------------------------------------------------------------------------
 * Persistence.
 * ---------------------------------------------------------------------------
 * What is stored, and what deliberately is not:
 *
 *   STORED   the PasskeyCredential handle (credential id, P256 public key,
 *            rpId) and the wallet address. All of it public. The SDK's own
 *            doc comment calls this shape JSON-safe and made for exactly this.
 *   STORED   session *metadata* — public key, permissions, expiry, the agent
 *            it was granted to. Enough to show a user what they authorized and
 *            to revoke it by public key.
 *   NEVER    key material of any kind. The passkey's private half never leaves
 *            the device's secure element, and a session signer is held in
 *            memory for the life of the tab only.
 *
 * The consequence of that last line is real and is surfaced in the UI rather
 * than hidden: after a reload, a granted session can still be seen and revoked
 * (revocation needs only the public key and the admin passkey) but cannot be
 * used to execute, because its signer is gone. A session that outlives a tab
 * would mean persisting a spend-capable key in localStorage, which is not a
 * trade this app should make on the user's behalf.
 */
const CREDENTIAL_KEY = "dolphin.altana.credential.v1";
const SESSIONS_KEY = "dolphin.altana.sessions.v1";

type StoredWallet = { address: Address; credential: PasskeyCredential };

/** A granted session as it is shown to a user and persisted. No key material. */
export type StoredSession = {
  /** On-chain identifier, and what revokeSession needs. */
  publicKey: Hex;
  tokenId: string;
  agentName: string;
  category: AgentCategory;
  /** Contract addresses this session may call. Never empty. */
  allowlist: { address: Address; label: string }[];
  spendCapWei: string;
  spendPeriod: string;
  expiry: number;
  grantedAt: string;
  transactionHash: Hex | null;
};

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A private window with storage disabled is a real state, not an error
    // worth crashing a wallet screen over. The wallet still works for this
    // tab; it just will not be remembered.
  }
}

/* ------------------------------------------------------------------------- */

export type AltanaWalletStatus =
  | "unsupported"
  | "loading"
  | "no-wallet"
  | "connected";

export type AltanaWalletValue = Readonly<{
  status: AltanaWalletStatus;
  /** Why the wallet cannot exist here. Null unless status is "unsupported". */
  unsupportedReason: string | null;
  address: Address | null;
  chainId: number;
  networkLabel: string;

  /** Native balance in wei. Null until read, or if the read failed. */
  balanceWei: bigint | null;
  balanceError: string | null;
  isReadingBalance: boolean;
  refreshBalance: () => Promise<void>;

  sessions: StoredSession[];
  /** Sessions usable this tab. A reload empties this; see the note above. */
  liveSessionKeys: Hex[];

  isBusy: boolean;
  error: string | null;

  createWallet: () => Promise<void>;
  recoverWallet: () => Promise<void>;
  forgetWallet: () => void;

  grantSession: (input: GrantSessionInput) => Promise<StoredSession>;
  revokeSession: (publicKey: Hex) => Promise<void>;
}>;

export type GrantSessionInput = {
  tokenId: string;
  agentName: string;
  category: AgentCategory;
  spendCapWei: bigint;
  durationDays: number;
};

const AltanaContext = createContext<AltanaWalletValue | null>(null);

function subscribeNoop() {
  return () => {};
}

export function AltanaWalletProvider({ children }: PropsWithChildren) {
  // Server render and first client render both return false, so the markup
  // matches; the real value arrives on the post-hydration pass.
  const isClient = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );

  const [stored, setStored] = useState<StoredWallet | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [signer, setSigner] = useState<Signer | null>(null);
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  // Session signers, keyed by public key. Memory-only and intentionally not
  // persisted — see the persistence note above.
  const [liveSessions, setLiveSessions] = useState<Record<Hex, Session>>({});

  const [balanceWei, setBalanceWei] = useState<bigint | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [isReadingBalance, setIsReadingBalance] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rehydrate after mount only. Reading localStorage during render would be
  // the same hydration fault this provider's header warns about.
  useEffect(() => {
    setStored(readJson<StoredWallet>(CREDENTIAL_KEY));
    setSessions(readJson<StoredSession[]>(SESSIONS_KEY) ?? []);
    setHydrated(true);
  }, []);

  const supported = isClient && passkeysAvailable();

  const persistSessions = useCallback((next: StoredSession[]) => {
    setSessions(next);
    writeJson(SESSIONS_KEY, next);
  }, []);

  const refreshBalance = useCallback(async () => {
    if (!stored) return;
    setIsReadingBalance(true);
    setBalanceError(null);
    try {
      const result = await altanaClient().balances({
        wallet: { address: stored.address },
        chainId: ALTANA_NETWORK.chainId,
      });
      setBalanceWei(result.native);
    } catch (cause) {
      // An unreadable balance is reported as unreadable. It is never shown as
      // zero — "we could not read this" and "this is empty" are different
      // claims, and conflating them is exactly what AGENTS.md §5 rules out.
      setBalanceWei(null);
      setBalanceError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsReadingBalance(false);
    }
  }, [stored]);

  useEffect(() => {
    if (stored) void refreshBalance();
  }, [stored, refreshBalance]);

  const createWallet = useCallback(async () => {
    setIsBusy(true);
    setError(null);
    try {
      const result = await altanaClient().createPasskeyWallet({
        name: ALTANA_WALLET_LABEL,
      });
      const next: StoredWallet = {
        address: result.address,
        credential: result.signer.credential,
      };
      writeJson(CREDENTIAL_KEY, next);
      setStored(next);
      setSigner(result.signer);
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
      const next: StoredWallet = {
        address: result.address,
        credential: result.signer.credential,
      };
      writeJson(CREDENTIAL_KEY, next);
      setStored(next);
      setSigner(result.signer);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsBusy(false);
    }
  }, []);

  const forgetWallet = useCallback(() => {
    // Local only. The wallet still exists on-chain and the passkey still
    // exists on the device — recoverWallet brings it straight back. Nothing
    // here destroys anything, and the UI must not imply that it does.
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(CREDENTIAL_KEY);
      window.localStorage.removeItem(SESSIONS_KEY);
    }
    setStored(null);
    setSigner(null);
    setSessions([]);
    setLiveSessions({});
    setBalanceWei(null);
  }, []);

  /**
   * Rebuilds the admin signer from the stored credential when it is not
   * already in memory. Costs one biometric prompt; the SDK does the rest.
   */
  const adminSigner = useCallback((): Signer => {
    if (signer) return signer;
    if (!stored) throw new Error("No Dolphin wallet on this device.");
    const rebuilt = signerFromPasskey(stored.credential);
    setSigner(rebuilt);
    return rebuilt;
  }, [signer, stored]);

  const grantSession = useCallback(
    async (input: GrantSessionInput): Promise<StoredSession> => {
      if (!stored) throw new Error("Create a Dolphin wallet before granting a session.");

      const policy = sessionPolicyFor(input.category);
      if (policy.kind !== "scoped-session") {
        // Fails closed. A caller cannot talk this provider into granting a
        // session for a category the policy says is information-only.
        throw new Error(policy.reason);
      }

      // Throws rather than ever emitting permissions without `calls`.
      const permissions = buildSessionPermissions(policy, input.spendCapWei);
      const expiry = expiryFromNow(input.durationDays);

      setIsBusy(true);
      setError(null);
      try {
        const granted = await altanaClient().grantSession({
          wallet: { address: stored.address },
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

        persistSessions([...sessions.filter((s) => s.publicKey !== record.publicKey), record]);
        setLiveSessions((current) => ({ ...current, [granted.publicKey]: granted }));
        return record;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        throw cause;
      } finally {
        setIsBusy(false);
      }
    },
    [adminSigner, persistSessions, sessions, stored],
  );

  const revokeSession = useCallback(
    async (publicKey: Hex) => {
      if (!stored) throw new Error("No Dolphin wallet on this device.");
      setIsBusy(true);
      setError(null);
      try {
        // revokeSession accepts a bare public key, which is why a session
        // granted before a page reload is still revocable.
        await altanaClient().revokeSession({
          wallet: { address: stored.address },
          signer: adminSigner(),
          session: publicKey,
          chainId: ALTANA_NETWORK.chainId,
        });
        persistSessions(sessions.filter((s) => s.publicKey !== publicKey));
        setLiveSessions((current) => {
          const next = { ...current };
          delete next[publicKey];
          return next;
        });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        throw cause;
      } finally {
        setIsBusy(false);
      }
    },
    [adminSigner, persistSessions, sessions, stored],
  );

  const value = useMemo<AltanaWalletValue>(() => {
    const status: AltanaWalletStatus = !isClient || !hydrated
      ? "loading"
      : !supported
        ? "unsupported"
        : stored
          ? "connected"
          : "no-wallet";

    return {
      status,
      unsupportedReason: status === "unsupported" ? UNSUPPORTED_REASON : null,
      address: stored?.address ?? null,
      chainId: ALTANA_NETWORK.chainId,
      networkLabel: ALTANA_NETWORK.chain.name,
      balanceWei,
      balanceError,
      isReadingBalance,
      refreshBalance,
      // Expired sessions are dropped from the view rather than shown as live
      // authority the user still holds.
      sessions: sessions.filter((s) => s.expiry * 1000 > Date.now()),
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
    balanceError,
    balanceWei,
    createWallet,
    error,
    forgetWallet,
    grantSession,
    hydrated,
    isBusy,
    isClient,
    isReadingBalance,
    liveSessions,
    recoverWallet,
    refreshBalance,
    revokeSession,
    sessions,
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
