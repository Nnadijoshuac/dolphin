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
 * Convex reports a server-side throw as a three-part envelope:
 *
 *     [CONVEX M(agentHires:hireReadOnlyAgent)] [Request ID: …] Server Error
 *     Uncaught Error: <what the handler actually threw>
 *         at handler (../convex/agentHires.ts:171:8)
 *
 * The middle line is the only part written for a person — Dolphin's backend
 * throws deliberately user-facing refusals that name the exact check that
 * failed — and the function path, request id and stack frames must never reach
 * a screen. Unwrapping happens before anything else is decided about the text.
 */
const CONVEX_ENVELOPE = /^\s*Uncaught \w*Error:\s*([\s\S]*?)(?:\n\s+at\s|$)/m;

/**
 * One renderable line: no stack, no library diagnostics, no version string.
 *
 * viem builds `message` by concatenating its short message with its own
 * `Details:`/`Version:` block (errors/base.js lines 27-32), so the split is what
 * keeps a dependency's name and version off the screen.
 */
function readableLine(message: string): string | null {
  const unwrapped = CONVEX_ENVELOPE.exec(message)?.[1] ?? message;
  const line = (unwrapped.split(/\n\s*(?:Details|Version):/)[0] ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!line) return null;
  // A version string surviving the split means this was library output.
  if (/\b(viem|wagmi|@?wagmi\/core)@\d/.test(line)) return null;
  /*
   * Capped because not every string that reaches here was written by us. A
   * seller's A2A endpoint can put arbitrary prose in a JSON-RPC error and
   * agentPayments relays it verbatim; the longest message Dolphin itself throws
   * is hireReadOnlyAgent's paid-hire refusal at ~330 characters, so this leaves
   * every deliberate message intact and stops a stranger's from flooding a
   * one-line note.
   */
  return line.length > 400 ? `${line.slice(0, 399).trimEnd()}…` : line;
}

/**
 * A message safe to render, for the paths that surface a thrown error's text.
 *
 * Dolphin throws a lot of deliberately user-facing errors — hireReadOnlyAgent's
 * refusals, normalizeQuote's QuoteRejected, the wallet provider's own guards.
 * Those are good copy and are passed through unchanged.
 *
 * ---------------------------------------------------------------------------
 * CHANGED 2026-09-12: a library error's `shortMessage` is now SHOWN, not binned
 * ---------------------------------------------------------------------------
 * This used to return `fallback` for every error carrying viem/wagmi's
 * fingerprint. That over-corrected for the 2026-09-01 bug described at the top
 * of this file: the thing that leaked a version string was `message`, which
 * concatenates the short message with the diagnostics block. `shortMessage` is
 * the other half — the sentence viem writes FOR A PERSON, with no `Details:`
 * and no `Version:` in it at all.
 *
 * Discarding it cost real diagnosis on the paid-hire path. Every step of a paid
 * hire after the quote runs through viem or the Altana SDK — reading the token
 * balance, quoting the BNB conversion, signing with the passkey, funding the
 * escrow — so every one of those failures arrived here with a usable
 * description and left as the caller's generic fallback. "You do not have
 * enough BNB to fund this" became "Try again", which is advice that cannot
 * work: trying again does the identical thing.
 *
 * The version guard is unchanged and still runs over whatever is returned, so
 * the original leak stays closed from both directions.
 */
export function toUserMessage(cause: unknown, fallback: string): string {
  if (typeof cause !== "object" || cause === null) return fallback;

  /*
   * A dismissed wallet prompt reaches here identically whether it was a
   * connection, a sign-in signature or a payment being approved, so this copy
   * names none of them — and, as above, does not dress a change of mind as a
   * crash. It is checked before `shortMessage` because viem's own wording for
   * a rejection ("User rejected the request.") is worse than ours.
   */
  switch (classifyConnectError(cause)) {
    case "cancelled":
      return (
        "You dismissed the wallet prompt, so nothing was signed and nothing was spent. " +
        "If you didn't dismiss it, your wallet may still have an earlier request open — " +
        "clear it there, then try again."
      );
    case "busy":
      return connectFailureCopy("busy").body;
    case "no-wallet":
      return connectFailureCopy("no-wallet").body;
    default:
      break;
  }

  const shortMessage = (cause as { shortMessage?: unknown }).shortMessage;
  if (typeof shortMessage === "string") {
    return readableLine(shortMessage) ?? fallback;
  }

  const message = (cause as { message?: unknown }).message;
  if (typeof message !== "string") return fallback;
  return readableLine(message) ?? fallback;
}
