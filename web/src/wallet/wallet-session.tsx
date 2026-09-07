"use client";

import { useAction, useMutation, useQuery } from "convex/react";
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

import { walletAuthApi } from "@/convex/api";
import { convexClient } from "@/providers/convex-provider";
import { toUserMessage } from "@/wallet/wallet-errors";
import { useWallet } from "@/wallet/wallet-provider";

/**
 * The signed-in session: proof that the person using the site controls the
 * address they are connected as.
 *
 * Hand-mirrored with `src/wallet/wallet-session.tsx` in the Expo app. The
 * decision record lives there and in convex/lib/walletAuth.ts; what follows is
 * only what is different about a browser.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS DID NOT EXIST HERE UNTIL 2026-09-07
 * ---------------------------------------------------------------------------
 * Oversight, not design. Authentication landed on 2026-09-06 across Convex and
 * the mobile app; the website was left sending the `walletAddress` string the
 * backend had stopped accepting, so hiring on the site was broken from that
 * commit until this one. See the note on `walletAuthApi` in convex/api.ts.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE TOKEN LIVES, AND WHY THAT IS A WEAKER PROMISE THAN THE APP'S
 * ---------------------------------------------------------------------------
 * The app keeps its token in the OS keychain (expo-secure-store). A browser has
 * no equivalent, so this uses localStorage, and the difference is worth stating
 * plainly rather than glossing: anything that can run script on this origin can
 * read it. That is the same exposure every bearer token in every web app has,
 * and it is bounded by what the token can do - authorise hire and review writes
 * for 30 days as this address. It is not key material, it cannot move funds,
 * and it cannot sign anything.
 *
 * Read through useSyncExternalStore rather than an effect, for the reason
 * altana-storage.ts documents at length: reading persisted state into useState
 * inside an effect is what produced React error #418 on this site before. The
 * server render and the first client render must agree.
 *
 * A session belongs to ONE address. If the connected wallet switches accounts,
 * the stored token is discarded rather than carried over - signing in as one
 * address must never leave the next address authenticated.
 */

export type WalletSessionStatus =
  /** No backend configured; sign-in cannot exist. */
  | "unavailable"
  /** No wallet connected, so there is no address to prove. */
  | "wallet-disconnected"
  /** Have a token, waiting for the backend to say whether it is still good. */
  | "checking"
  /** Wallet connected, but this address has not proved itself. */
  | "signed-out"
  | "signed-in";

export type WalletSessionValue = Readonly<{
  status: WalletSessionStatus;
  /** The address the backend has verified, or null. Never the merely-connected one. */
  address: string | null;
  /** Pass to any authenticated Convex function. Null unless status is "signed-in". */
  sessionToken: string | null;
  isSignedIn: boolean;
  /** True while a signature is being requested and exchanged. */
  isSigningIn: boolean;
  /** Last sign-in failure, already phrased for a person. */
  error: string | null;
  /**
   * Signs in, and RETURNS THE TOKEN rather than only storing it.
   *
   * Same reason `connect` returns an address (wallet-provider.tsx): a caller
   * that awaits this and then reads `session.sessionToken` reads its own
   * closure, which has not re-rendered. Returning the token is what lets one
   * click connect, sign in and hire in sequence.
   *
   * `addressOverride` exists for exactly that chain: immediately after
   * `connect()` the hook's `wallet.address` is still null, so the address has
   * to be passed in rather than read. Null means sign-in did not happen; the
   * reason is in `error`.
   */
  signIn: (addressOverride?: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}>;

const STORAGE_KEY = "dolphin.wallet-session.v1";

/* ── the token, modelled as the external store it is ────────────────────── */

let cache: string | null = null;
let cacheLoaded = false;
const listeners = new Set<() => void>();

function readStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // A private window with site data blocked throws on access. Survivable:
    // the session stays live in memory for this tab and is not remembered.
    return null;
  }
}

function emit() {
  cache = readStoredToken();
  cacheLoaded = true;
  for (const listener of listeners) listener();
}

function subscribeToToken(listener: () => void): () => void {
  listeners.add(listener);

  // Signing in or out in another tab should be reflected here too.
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) emit();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function getTokenSnapshot(): string | null {
  if (!cacheLoaded) {
    cache = readStoredToken();
    cacheLoaded = true;
  }
  return cache;
}

/** The server has no localStorage, and must return a stable value. */
function getTokenServerSnapshot(): string | null {
  return null;
}

function writeStoredToken(token: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (token === null) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, token);
    }
  } catch {
    // See readStoredToken. Losing the whole sign-in over a refusal to persist
    // would be the worse trade.
  }
  emit();
}

/* ── the provider ────────────────────────────────────────────────────────── */

const unavailableSession: WalletSessionValue = {
  status: "unavailable",
  address: null,
  sessionToken: null,
  isSignedIn: false,
  isSigningIn: false,
  error: null,
  signIn: async () => null,
  signOut: async () => undefined,
};

const WalletSessionContext = createContext<WalletSessionValue | null>(null);

export function WalletSessionProvider({ children }: PropsWithChildren) {
  // Mirrors ConvexClientProvider's own branch: convex/react's hooks throw
  // without a provider, so a deployment with no NEXT_PUBLIC_CONVEX_URL must not
  // mount the component that uses them. `convexClient` is module scope and
  // cannot change at runtime, so this branch is stable for the page's lifetime.
  if (!convexClient) {
    return (
      <WalletSessionContext.Provider value={unavailableSession}>
        {children}
      </WalletSessionContext.Provider>
    );
  }

  return <BackendWalletSession>{children}</BackendWalletSession>;
}

function BackendWalletSession({ children }: PropsWithChildren) {
  const wallet = useWallet();
  const requestNonce = useAction(walletAuthApi.walletAuth.requestNonce);
  const verifySignature = useAction(walletAuthApi.walletAuth.verifySignature);
  const revokeSession = useMutation(walletAuthApi.walletAuth.signOut);

  const token = useSyncExternalStore(
    subscribeToToken,
    getTokenSnapshot,
    getTokenServerSnapshot,
  );

  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The backend's own verdict on the token. undefined while in flight, null
  // when the token is unknown or expired - so an expired session signs the user
  // out on its own without anything having to poll for it.
  const session = useQuery(walletAuthApi.walletAuth.currentSession, {
    sessionToken: token,
  });

  const connectedAddress = wallet.address?.toLowerCase() ?? null;
  const sessionAddress = session?.address.toLowerCase() ?? null;

  /*
   * A session is only usable while it matches the connected account. Switching
   * accounts in the extension is a normal thing to do, and carrying the
   * previous account's session across would authenticate the next address as
   * the previous one - hires would land on the wrong wallet.
   *
   * DERIVED rather than stored, so it cannot go stale the way a copy in state
   * can.
   */
  const isSessionUsable =
    token !== null &&
    session !== undefined &&
    session !== null &&
    connectedAddress !== null &&
    sessionAddress === connectedAddress;

  /*
   * Evicting a dead token from localStorage IS effect work - it updates an
   * external system to match what React already knows - so it belongs here, and
   * it is the only thing here. The ref makes it happen once per token rather
   * than on every render that observes the same mismatch.
   */
  const evictedTokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (token === null || session === undefined) return;

    const isDead =
      session === null ||
      (connectedAddress !== null && sessionAddress !== connectedAddress);

    if (isDead && evictedTokenRef.current !== token) {
      evictedTokenRef.current = token;
      writeStoredToken(null);
    }
  }, [connectedAddress, session, sessionAddress, token]);

  const signIn = useCallback(
    async (addressOverride?: string): Promise<string | null> => {
      const address = addressOverride ?? wallet.address;
      if (!address) {
        setError("Connect a wallet before signing in.");
        return null;
      }

      setIsSigningIn(true);
      setError(null);
      try {
        // The backend chooses the message. Signing something this client made
        // up would prove key control and nothing about what was agreed to.
        const challenge = await requestNonce({ address });
        const signature = await wallet.signMessage(challenge.message);
        const issued = await verifySignature({
          nonce: challenge.nonce,
          signature,
        });

        writeStoredToken(issued.token);
        return issued.token;
      } catch (cause) {
        setError(toUserMessage(cause, "Could not complete sign-in."));
        return null;
      } finally {
        setIsSigningIn(false);
      }
    },
    [requestNonce, verifySignature, wallet],
  );

  const signOut = useCallback(async () => {
    const current = token;
    setError(null);
    writeStoredToken(null);
    if (current) {
      try {
        // Best effort: the local token is already gone, so a failure here
        // leaves a row that expires on its own rather than a live session the
        // user believes they ended.
        await revokeSession({ sessionToken: current });
      } catch {
        /* nothing the user can act on */
      }
    }
  }, [revokeSession, token]);

  const status: WalletSessionStatus = (() => {
    if (!wallet.isConnected || connectedAddress === null) return "wallet-disconnected";
    if (token !== null && session === undefined) return "checking";
    return isSessionUsable ? "signed-in" : "signed-out";
  })();

  const value = useMemo<WalletSessionValue>(
    () => ({
      status,
      address: status === "signed-in" ? (session?.address ?? null) : null,
      sessionToken: status === "signed-in" ? token : null,
      isSignedIn: status === "signed-in",
      isSigningIn,
      error,
      signIn,
      signOut,
    }),
    [error, isSigningIn, session, signIn, signOut, status, token],
  );

  return (
    <WalletSessionContext.Provider value={value}>
      {children}
    </WalletSessionContext.Provider>
  );
}

export function useWalletSession(): WalletSessionValue {
  const session = useContext(WalletSessionContext);

  // Unlike the app's, this returns a stable "unavailable" value rather than
  // throwing when the provider is absent. Every page on this site is
  // prerendered by Next, and a throw during that pass fails the build instead
  // of the request - see app-providers.tsx for where it is mounted.
  return session ?? unavailableSession;
}

/**
 * The token, or a thrown error naming what to do about it.
 *
 * For call sites that are about to perform an authenticated write - it turns
 * "this should not happen" into a sentence rather than into `null` reaching the
 * backend and being rejected there with a less specific message.
 */
export function requireSessionToken(session: WalletSessionValue): string {
  if (!session.sessionToken) {
    throw new Error(
      session.status === "wallet-disconnected"
        ? "Connect a wallet first."
        : "Sign in with your wallet first — this proves you own the address.",
    );
  }
  return session.sessionToken;
}
