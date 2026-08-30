import type { PasskeyCredential } from "@altananetwork/sdk";
import type { Address, Hex } from "viem";

import type { AgentCategory } from "@/types/agent";

/**
 * localStorage, modelled as the external store it actually is.
 *
 * WHY NOT useState + useEffect. Reading persisted state into useState inside an
 * effect is the exact cascading-render pattern that produced React error #418
 * on this site before (HANDOVER.md, 2026-08-29 - the wallet provider read
 * window.ethereum that way and threw on every page carrying the wallet). The
 * fix applied then was useSyncExternalStore, and this module is the same fix
 * generalised: a subscribe/getSnapshot pair with a cached snapshot, so the
 * server render and the first client render agree and no effect is needed.
 *
 * getSnapshot MUST be referentially stable between real changes or React will
 * loop, which is why every read goes through the parsed cache below rather
 * than re-parsing JSON on each call.
 */

/* --- what is persisted, and what deliberately is not ----------------------
 *
 *   STORED   the PasskeyCredential handle (credential id, P256 public key,
 *            rpId) and the wallet address. All public. The SDK's own doc
 *            comment calls this shape JSON-safe and intended for exactly this.
 *   STORED   session METADATA - public key, permissions, expiry, which agent.
 *            Enough to show what was authorized and to revoke it.
 *   NEVER    key material of any kind. The passkey's private half never leaves
 *            the device's secure element, and a session's signing key is held
 *            in memory for the life of the tab only.
 *
 * The last line has a visible consequence, surfaced in the UI rather than
 * hidden: after a reload a granted session can still be seen and revoked
 * (revocation needs only its public key plus the admin passkey) but cannot
 * execute, because its signer is gone. Persisting a spend-capable key in
 * localStorage would fix that and is not a trade this app should make on a
 * user's behalf.
 * ------------------------------------------------------------------------ */

const CREDENTIAL_KEY = "dolphin.altana.credential.v1";
const SESSIONS_KEY = "dolphin.altana.sessions.v1";

export type StoredWallet = Readonly<{
  address: Address;
  credential: PasskeyCredential;
}>;

/** A granted session as shown to a user and persisted. No key material. */
export type StoredSession = Readonly<{
  /** On-chain identifier, and all revokeSession needs. */
  publicKey: Hex;
  tokenId: string;
  agentName: string;
  category: AgentCategory;
  /** Contracts this session may call. Never empty - see altana-policy.ts. */
  allowlist: readonly { address: Address; label: string }[];
  /** Decimal string: bigint is not JSON-safe. */
  spendCapWei: string;
  spendPeriod: string;
  /** Unix epoch seconds. */
  expiry: number;
  grantedAt: string;
  transactionHash: Hex | null;
}>;

type Snapshot = Readonly<{
  wallet: StoredWallet | null;
  sessions: readonly StoredSession[];
}>;

const EMPTY: Snapshot = { wallet: null, sessions: [] };

/**
 * The server has no localStorage, so it must return a stable, shared object -
 * a fresh literal each call would make React think the store changed on every
 * server render.
 */
const SERVER_SNAPSHOT: Snapshot = EMPTY;

let cache: Snapshot | null = null;
const listeners = new Set<() => void>();

function parse<T>(raw: string | null): T | null {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function readFromStorage(): Snapshot {
  if (typeof window === "undefined") return EMPTY;
  try {
    return {
      wallet: parse<StoredWallet>(window.localStorage.getItem(CREDENTIAL_KEY)),
      sessions: parse<StoredSession[]>(window.localStorage.getItem(SESSIONS_KEY)) ?? [],
    };
  } catch {
    // A private window with site data blocked throws on access. That is a real
    // state a wallet screen should survive, not crash on: the wallet still
    // works for this tab, it just will not be remembered.
    return EMPTY;
  }
}

function emit() {
  cache = readFromStorage();
  for (const listener of listeners) listener();
}

export function subscribeToAltanaStorage(listener: () => void): () => void {
  listeners.add(listener);

  // Another tab writing the same wallet should show up here too.
  const onStorage = (event: StorageEvent) => {
    if (event.key === CREDENTIAL_KEY || event.key === SESSIONS_KEY || event.key === null) {
      emit();
    }
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function getAltanaSnapshot(): Snapshot {
  cache ??= readFromStorage();
  return cache;
}

export function getAltanaServerSnapshot(): Snapshot {
  return SERVER_SNAPSHOT;
}

function write(key: string, value: unknown | null) {
  if (typeof window === "undefined") return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // See readFromStorage: storage being unavailable is survivable.
  }
  emit();
}

export function saveWallet(wallet: StoredWallet): void {
  write(CREDENTIAL_KEY, wallet);
}

export function saveSessions(sessions: readonly StoredSession[]): void {
  write(SESSIONS_KEY, sessions);
}

/**
 * Local only. The wallet still exists on-chain and the passkey still exists on
 * the device, so recoverFromPasskey brings it straight back. Nothing here
 * destroys anything and the UI must not imply that it does.
 */
export function forgetLocalWallet(): void {
  write(CREDENTIAL_KEY, null);
  write(SESSIONS_KEY, null);
}
