import type { PasskeyCredential } from "@altananetwork/sdk";
import type { Address } from "viem";

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

/* --- what is persisted here, and what deliberately is not -----------------
 *
 *   HERE     the PasskeyCredential handle (credential id, P256 public key,
 *            rpId) and the wallet address. All public. The SDK's own doc
 *            comment calls this shape JSON-safe and intended for exactly this.
 *            It is device-local because the passkey it points at is.
 *   CONVEX   session metadata. Deliberately NOT here - see
 *            convex/agentSessions.ts. Keeping grants only in the granting
 *            browser would make the wallet screen and the hire record two
 *            independent stories about the same authority, and the first time
 *            they disagreed a user would be told an agent cannot spend when
 *            it can.
 *   NOWHERE  key material of any kind. The passkey's private half never leaves
 *            the device's secure element, and a session's signing key is held
 *            in memory for the life of the tab only.
 *
 * That last line has a visible consequence, surfaced in the UI rather than
 * hidden: after a reload a granted session can still be seen and revoked
 * (revocation needs only its public key plus the admin passkey) but cannot
 * execute, because its signer is gone. Persisting a spend-capable key in
 * localStorage would fix that and is not a trade this app should make on a
 * user's behalf.
 * ------------------------------------------------------------------------ */

const CREDENTIAL_KEY = "dolphin.altana.credential.v1";

export type StoredWallet = Readonly<{
  address: Address;
  credential: PasskeyCredential;
}>;

const EMPTY: StoredWallet | null = null;

let cache: StoredWallet | null = EMPTY;
let cacheLoaded = false;
const listeners = new Set<() => void>();

function readFromStorage(): StoredWallet | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CREDENTIAL_KEY);
    return raw ? (JSON.parse(raw) as StoredWallet) : null;
  } catch {
    // A private window with site data blocked throws on access. That is a real
    // state a wallet screen should survive, not crash on: the wallet still
    // works for this tab, it just will not be remembered.
    return null;
  }
}

function emit() {
  cache = readFromStorage();
  cacheLoaded = true;
  for (const listener of listeners) listener();
}

export function subscribeToAltanaStorage(listener: () => void): () => void {
  listeners.add(listener);

  // Another tab creating or forgetting the wallet should show up here too.
  const onStorage = (event: StorageEvent) => {
    if (event.key === CREDENTIAL_KEY || event.key === null) emit();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function getAltanaSnapshot(): StoredWallet | null {
  if (!cacheLoaded) {
    cache = readFromStorage();
    cacheLoaded = true;
  }
  return cache;
}

/** The server has no localStorage, and must return a stable value. */
export function getAltanaServerSnapshot(): StoredWallet | null {
  return EMPTY;
}

export function saveWallet(wallet: StoredWallet): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CREDENTIAL_KEY, JSON.stringify(wallet));
  } catch {
    // See readFromStorage: storage being unavailable is survivable.
  }
  emit();
}

/**
 * Local only. The wallet still exists on-chain, the passkey still exists on the
 * device, and every session granted from it stays exactly as active as it was.
 * Nothing here destroys anything and the UI must not imply that it does.
 */
export function forgetLocalWallet(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CREDENTIAL_KEY);
  } catch {
    // See readFromStorage.
  }
  emit();
}
