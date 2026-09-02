/**
 * Turning library errors into something a person should read.
 *
 * MIRRORED BY HAND from web/src/wallet/wallet-errors.ts, byte-identical apart
 * from this note. Edit both in one change (AGENTS.md §9).
 *
 * MOBILE NOTE: `classifyConnectError` is unused on this platform and that is
 * correct, not dead code. Mobile's connect path is
 * `wallet-provider.native.tsx`'s `connect: async () => { open(); }` - it hands
 * off to Reown AppKit's modal and never awaits a connection, so no connect
 * error can cross back into Dolphin's code. `WalletContextValue` has no error
 * field at all. The twin stays whole so the two files can be diffed, and so a
 * future mobile connect path has it ready rather than reinventing it.
 * `toUserMessage` IS used here, by the Altana SDK and payment paths below.
 *
 * ---------------------------------------------------------------------------
 * THE BUG THIS EXISTS TO PREVENT (2026-09-01)
 * ---------------------------------------------------------------------------
 * `wallet-provider.tsx` used to do `setError(cause.message)` and render the
 * result. viem's BaseError builds `message` by concatenating a short message
 * with its own diagnostics (errors/base.js lines 27-32):
 *
 *     shortMessage
 *     Details: <rpc detail>
 *     Version: viem@2.56.0
 *
 * so dismissing a MetaMask popup put this on screen, verbatim:
 *
 *     "User rejected the request. Details: Connection request reset. Please
 *      try again. Version: viem@2.56.0"
 *
 * Three things wrong with that at once: it reads as a crash when the user
 * simply changed their mind, it leaks a dependency and its version to anyone
 * who cancels a dialog, and it is written for whoever is debugging viem rather
 * than for the person holding the wallet.
 *
 * ---------------------------------------------------------------------------
 * WHY CLASSIFY ON `name` AND `code`, NOT ON MESSAGE TEXT
 * ---------------------------------------------------------------------------
 * Matching substrings like "User rejected" is what turns one library upgrade
 * into a silently broken error path. viem sets a stable `name` on every error
 * class and an EIP-1193 `code` on the RPC ones (verified against viem 2.56.0's
 * errors/rpc.js), and wagmi does the same in errors/connector.js. Those are the
 * contract; the prose is not.
 */

/** What actually happened, as far as the person needs to care. */
export type ConnectFailureKind =
  /** Dismissed the popup, cancelled, or a second request reset the first. */
  | "cancelled"
  /** No injected wallet, and no other connector could take over. */
  | "no-wallet"
  /** A request is already open in the wallet - usually an unnoticed popup. */
  | "busy"
  /** Anything we did not recognise. Never shown verbatim. */
  | "unknown";

/** viem/wagmi BaseError subclasses all carry this; plain Errors do not. */
function isLibraryError(cause: unknown): cause is Error & {
  name: string;
  shortMessage?: string;
  code?: number;
} {
  return (
    cause instanceof Error &&
    ("shortMessage" in cause || "code" in cause || /Error$/.test(cause.name))
  );
}

function errorCode(cause: unknown): number | null {
  if (typeof cause !== "object" || cause === null) return null;
  const code = (cause as { code?: unknown }).code;
  return typeof code === "number" ? code : null;
}

/** Walks `cause` chains — wagmi wraps viem errors, which wrap provider errors. */
function* chain(cause: unknown): Generator<unknown> {
  let current = cause;
  for (let depth = 0; current && depth < 6; depth++) {
    yield current;
    current = (current as { cause?: unknown }).cause;
  }
}

export function classifyConnectError(cause: unknown): ConnectFailureKind {
  for (const link of chain(cause)) {
    const name = link instanceof Error ? link.name : "";
    const code = errorCode(link);

    // EIP-1193 4001, and viem's class for it. Covers "rejected" and the
    // "Connection request reset" case, which is the same class with a
    // different `Details` line - a second request superseding the first.
    if (name === "UserRejectedRequestError" || code === 4001) return "cancelled";

    // EIP-1193 -32002: a request is already pending in the wallet.
    if (name === "ResourceUnavailableRpcError" || code === -32002) return "busy";

    if (name === "ProviderNotFoundError" || name === "ConnectorNotFoundError") {
      return "no-wallet";
    }
  }
  return "unknown";
}

/**
 * What each failure says. Cancelling is NOT an error and is not dressed as one:
 * no alarm colour, no apology, no suggestion that anything broke.
 */
export function connectFailureCopy(kind: ConnectFailureKind): {
  title: string;
  body: string;
  tone: "calm" | "warn";
  retryable: boolean;
} {
  switch (kind) {
    /*
     * Deliberately covers TWO situations that arrive identically.
     *
     * wagmi's injected connector runs with `shimDisconnect` (its default), so
     * every connect calls `wallet_requestPermissions` before
     * `eth_requestAccounts` — confirmed by tracing the provider calls on the
     * live build. MetaMask answers that with code 4001 both when the user
     * dismisses the prompt AND when a stale request is already sitting in the
     * extension, in which case its `details` read "Connection request reset."
     *
     * Both are the same class and the same code, so no classifier can tell
     * them apart without matching prose. Rather than guess, the copy names
     * both: someone who did cancel reads the first line and stops, someone
     * stuck in a reset loop gets the one instruction that actually clears it.
     */
    case "cancelled":
      return {
        title: "Connection cancelled",
        body: "If you didn't cancel, your wallet may still have a request open from a previous attempt. Open the extension, dismiss anything pending there, then try again.",
        tone: "calm",
        retryable: true,
      };
    case "busy":
      return {
        title: "Your wallet is already asking",
        body: "There is an open request in your wallet extension. Approve or dismiss it there, then try again.",
        tone: "calm",
        retryable: true,
      };
    case "no-wallet":
      return {
        title: "No wallet found",
        body: "Install a browser wallet — MetaMask or OKX Wallet both work — then reload this page and try again.",
        tone: "warn",
        retryable: false,
      };
    case "unknown":
      return {
        title: "Couldn't connect right now",
        body: "Something went wrong reaching your wallet. Try again, and if it keeps happening, reload the page.",
        tone: "warn",
        retryable: true,
      };
  }
}

/**
 * A message safe to render, for the paths that surface a thrown error's text.
 *
 * Dolphin throws a lot of deliberately user-facing errors — hireReadOnlyAgent's
 * refusals, normalizeQuote's QuoteRejected, the wallet provider's own guards.
 * Those are good copy and are passed through unchanged. What must never reach
 * the screen is a LIBRARY error's message, so anything carrying viem/wagmi's
 * fingerprint is replaced by the caller's fallback.
 *
 * Belt and braces: even for a message that passes, the `Details:`/`Version:`
 * block is cut, so a library error wrapped in a plain Error somewhere upstream
 * still cannot leak a version string.
 */
export function toUserMessage(cause: unknown, fallback: string): string {
  if (!(cause instanceof Error)) return fallback;
  if (isLibraryError(cause) && "shortMessage" in cause) return fallback;

  const firstLine = cause.message.split(/\n\s*(?:Details|Version):/)[0]?.trim();
  if (!firstLine) return fallback;
  // A version string surviving the split means this was library output.
  if (/\b(viem|wagmi|@?wagmi\/core)@\d/.test(firstLine)) return fallback;
  return firstLine;
}
