import { useAction, useMutation, useQuery } from "convex/react";
import * as SecureStore from "expo-secure-store";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { Platform } from "react-native";

import { api } from "../../convex/_generated/api";
import { convexClient } from "@/providers/convex-provider";
import { toUserMessage } from "@/wallet/wallet-errors";
import { useWallet } from "@/wallet/wallet-provider";

/**
 * The signed-in session: proof that the person using the app controls the
 * address they are connected as.
 *
 * ---------------------------------------------------------------------------
 * WHY A CONNECTED WALLET IS NOT ENOUGH
 * ---------------------------------------------------------------------------
 * `useWallet().address` is what the wallet app says the user's address is. That
 * is fine for reading - a balance, a hire list, an explorer link - and it is not
 * fine for writing, because nothing about it is checkable by the backend. Until
 * 2026-09-06 every write in this app sent that string to Convex and Convex
 * believed it, so anyone with the deployment URL could write a hire record for
 * any address on earth.
 *
 * Signing in fixes that once: the backend hands over a message it chose, the
 * wallet signs it, and the backend recovers the signer and issues a session
 * token. From then on the token is what identifies the user, and it is a
 * credential only the backend can mint.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE USER IS ASKED TO APPROVE
 * ---------------------------------------------------------------------------
 * One `personal_sign`. It moves nothing, approves no spending, and grants no
 * allowance - the message says so in the wallet's own signing sheet, because
 * SIWE_STATEMENT in convex/lib/walletAuth.ts is part of the signed text rather
 * than a reassurance printed next to it in this app.
 *
 * ---------------------------------------------------------------------------
 * THE TOKEN IS A CREDENTIAL, SO IT LIVES IN THE KEYCHAIN
 * ---------------------------------------------------------------------------
 * expo-secure-store, not AsyncStorage: AsyncStorage is plain unencrypted files,
 * and this token authorises writes on someone's behalf for 30 days. It is not
 * key material and cannot move funds, but it is the difference between "someone
 * read my hire list" and "someone wrote to it as me".
 *
 * A session belongs to ONE address. If the connected wallet changes to a
 * different account, the stored token is discarded rather than carried over -
 * signing in as one address must never leave the next address authenticated.
 */

export type WalletSessionStatus =
  /** Reading the keychain. Nothing is known yet. */
  | "restoring"
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
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}>;

const STORAGE_KEY = "dolphin.wallet-session.v1";

/**
 * SecureStore has no web implementation. Web has no wallet either
 * (wallet-provider.web.tsx), so sign-in cannot begin there and these are only
 * ever reached as no-ops - but they are guarded rather than assumed, because an
 * unguarded SecureStore call on web throws at import-adjacent time and would
 * take the static export down with it.
 */
async function readStoredToken(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    return await SecureStore.getItemAsync(STORAGE_KEY);
  } catch {
    return null;
  }
}

async function writeStoredToken(token: string | null): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    if (token === null) {
      await SecureStore.deleteItemAsync(STORAGE_KEY);
    } else {
      await SecureStore.setItemAsync(STORAGE_KEY, token);
    }
  } catch {
    // A keychain that refuses to persist is survivable: the session stays live
    // in memory for this run and the user signs in again next launch. Losing
    // the whole sign-in over it would be the worse trade.
  }
}

const unavailableSession: WalletSessionValue = {
  status: "unavailable",
  address: null,
  sessionToken: null,
  isSignedIn: false,
  isSigningIn: false,
  error: null,
  signIn: async () => undefined,
  signOut: async () => undefined,
};

const WalletSessionContext = createContext<WalletSessionValue | null>(null);

export function WalletSessionProvider({ children }: PropsWithChildren) {
  // Mirrors ConvexClientProvider's own branch: convex/react's hooks throw
  // without a provider, so a build with no EXPO_PUBLIC_CONVEX_URL must not
  // mount the component that uses them. `convexClient` is module scope and
  // cannot change at runtime, so this branch is stable for the app's lifetime.
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
  const requestNonce = useAction(api.walletAuth.requestNonce);
  const verifySignature = useAction(api.walletAuth.verifySignature);
  const revokeSession = useMutation(api.walletAuth.signOut);

  const [token, setToken] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readStoredToken().then((stored) => {
      if (cancelled) return;
      setToken(stored);
      setIsRestoring(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The backend's own verdict on the token. undefined while in flight, null
  // when the token is unknown or expired - so an expired session signs the user
  // out on its own without anything having to poll for it.
  const session = useQuery(
    api.walletAuth.currentSession,
    isRestoring ? "skip" : { sessionToken: token },
  );

  const connectedAddress = wallet.address?.toLowerCase() ?? null;
  const sessionAddress = session?.address.toLowerCase() ?? null;

  /*
   * A session is only usable while it matches the connected account.
   *
   * Switching accounts in the wallet app is a normal thing to do, and carrying
   * the previous account's session across would mean the next address is
   * authenticated as the previous one - hires and reviews would land on the
   * wrong wallet.
   *
   * This is DERIVED rather than stored. The obvious implementation clears the
   * token from state inside an effect, which eslint-plugin-react-hooks 7
   * (SDK 57) reports as react-hooks/set-state-in-effect - the same rule the
   * root layout's hydration read was rewritten for. Deriving it is also simply
   * more correct: usability is a function of the current session and the
   * current address, so recomputing it cannot go stale the way a copy in state
   * can.
   */
  const isSessionUsable =
    !isRestoring &&
    token !== null &&
    session !== undefined &&
    session !== null &&
    connectedAddress !== null &&
    sessionAddress === connectedAddress;

  /*
   * Evicting the dead token from the keychain IS effect work - it updates an
   * external system to match what React already knows - so it belongs here,
   * and it is the only thing here.
   *
   * The ref makes it happen once per token rather than on every render that
   * observes the same mismatch. React state is deliberately not touched: the
   * stale token staying in memory changes nothing, because every consumer of
   * this context reads the derived status above.
   */
  const evictedTokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (isRestoring || token === null || session === undefined) return;

    const isDead =
      session === null ||
      (connectedAddress !== null && sessionAddress !== connectedAddress);

    if (isDead && evictedTokenRef.current !== token) {
      evictedTokenRef.current = token;
      void writeStoredToken(null);
    }
  }, [connectedAddress, isRestoring, session, sessionAddress, token]);

  const signIn = useCallback(async () => {
    const address = wallet.address;
    if (!address) {
      setError("Connect a wallet before signing in.");
      return;
    }

    setIsSigningIn(true);
    setError(null);
    try {
      // The backend chooses the message. Signing something this client made up
      // would prove key control and nothing about what was agreed to.
      const challenge = await requestNonce({ address });
      const signature = await wallet.signMessage(challenge.message);
      const issued = await verifySignature({
        nonce: challenge.nonce,
        signature,
      });

      setToken(issued.token);
      await writeStoredToken(issued.token);
    } catch (cause) {
      setError(toUserMessage(cause, "Could not complete sign-in."));
    } finally {
      setIsSigningIn(false);
    }
  }, [requestNonce, verifySignature, wallet]);

  const signOut = useCallback(async () => {
    const current = token;
    setToken(null);
    setError(null);
    await writeStoredToken(null);
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
    if (isRestoring) return "restoring";
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

  if (!session) {
    throw new Error("useWalletSession must be used inside WalletSessionProvider.");
  }

  return session;
}

/**
 * The token, or a thrown error naming what to do about it.
 *
 * For call sites that are about to perform an authenticated write and have
 * already gated their UI on `isSignedIn` - it turns "this should not happen"
 * into a sentence rather than into `null` being sent to the backend and
 * rejected there with a less specific message.
 */
export function requireSessionToken(session: WalletSessionValue): string {
  if (!session.sessionToken) {
    throw new Error(
      session.status === "wallet-disconnected"
        ? "Connect a wallet first."
        : "Sign in with your wallet first - this proves you own the address.",
    );
  }
  return session.sessionToken;
}
