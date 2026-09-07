/**
 * Can this network reach WalletConnect's relay at all?
 *
 * ---------------------------------------------------------------------------
 * THE FAILURE THIS EXISTS TO NAME (2026-09-07)
 * ---------------------------------------------------------------------------
 * The QR path in `wallet-provider.tsx` is brokered by a WebSocket to
 * `relay.walletconnect.org`. When that socket cannot open, WalletConnect does
 * not fail - it QUEUES the session proposal and waits. On the website the
 * visible result is worse than on mobile: `EthereumProvider.connect` opens its
 * modal and the promise never settles, so the button sits on "Connecting..."
 * indefinitely with nothing on screen explaining why.
 *
 * The same block took down the mobile app twice - see
 * Agent/SESSION-LOG-2026-09-05-wallet-connect-and-ui.md §1, where the cause was
 * a router refusing DNS for the relay hosts specifically while every other host
 * on the same resolver answered normally.
 *
 * A network that blocks WalletConnect is not rare and is not something the site
 * can route around. What it CAN do is say so in one second, and point at the
 * browser extension, which does not touch the relay at all.
 *
 * ---------------------------------------------------------------------------
 * WHY AN HTTP PROBE RATHER THAN A WEBSOCKET ONE
 * ---------------------------------------------------------------------------
 * The relay publishes a health endpoint that answers `204 No Content` over
 * plain HTTPS (verified by request, not assumed). A GET to it needs no project
 * id, carries no body, and reuses the same DNS, routing and TLS path the
 * WebSocket would - so a block anywhere along that path shows up here too.
 *
 * This is deliberately NOT a claim that a connection will succeed. It is only
 * a claim that the relay is not unreachable, which is the one failure mode the
 * library reports uselessly.
 *
 * Hand-mirrored with `src/wallet/relay-reachability.ts` in the Expo app. The
 * two products are separate npm projects with no shared package, so when one
 * changes the other changes in the same commit. One thing deliberately does not
 * mirror: the app exports its user-facing message from that file, whereas here
 * the copy belongs in `wallet-errors.ts` with every other failure this site can
 * render, as a `ConnectFailureKind` the UI cannot print verbatim.
 */

/**
 * Answers 204 with an empty body. Any HTTP status at all proves the host is
 * reachable, so the status is deliberately not checked - only whether a
 * response came back before the timeout.
 *
 * Sent with `mode: "no-cors"`: the relay serves no CORS headers on this
 * endpoint, so a normal request would be rejected by the browser before the
 * response could be read. An opaque response cannot be inspected, which is
 * fine - the only thing being asked is whether one came back at all.
 */
const RELAY_HEALTH_URL = "https://relay.walletconnect.org/health";

/**
 * Long enough for a slow connection to answer, short enough that a blocked
 * network is reported while the user is still looking at the button. A warm
 * probe from a working network answers in about 250ms.
 */
const PROBE_TIMEOUT_MS = 6_000;

/**
 * Memoises only the SUCCESS.
 *
 * A relay that answered once is reachable on this network, and re-probing
 * before every connect would put a needless round trip in front of a modal the
 * user is waiting on. A failure is never cached: the usual fix is for the user
 * to change networks and immediately retry, and a cached "no" would tell them
 * it is still broken when it is not.
 */
let reachedRelayThisSession = false;

export async function isRelayReachable(): Promise<boolean> {
  if (reachedRelayThisSession) {
    return true;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    // Cache-busted because a stale cached response would report a network as
    // working after it had started blocking the relay, which is the one wrong
    // answer this must not give.
    await fetch(`${RELAY_HEALTH_URL}?t=${Date.now()}`, {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
      signal: controller.signal,
    });
    reachedRelayThisSession = true;
    return true;
  } catch {
    // fetch rejects only on a network-level failure - DNS, connection refused,
    // TLS, or our own abort. Under `no-cors` an opaque response still resolves,
    // which is exactly the distinction wanted here.
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
