/**
 * Can this network reach WalletConnect's relay at all?
 *
 * ---------------------------------------------------------------------------
 * THE FAILURE THIS EXISTS TO NAME (2026-09-07)
 * ---------------------------------------------------------------------------
 * Every wallet connection in this app is brokered by a WebSocket to
 * `relay.walletconnect.org`. When that socket cannot open, WalletConnect does
 * not fail - it QUEUES the session proposal and waits out a sixty-second
 * publish timeout, then logs this and nothing else:
 *
 *     ERROR {"context":"core/relayer/publisher","level":50}   <- empty error
 *     ERROR {"context":"client"} Failed to publish custom payload, please try
 *                                again. id:… tag:undefined
 *
 * Both lines name the publisher, which is the wrong layer entirely: the
 * transport error underneath is swallowed by AppKit's default logger level.
 * The user sees a connect sheet that spins for a minute and then does nothing,
 * with no hint that their network is the problem. That has now cost this
 * project two separate debugging sessions - see
 * Agent/SESSION-LOG-2026-09-05-wallet-connect-and-ui.md §1, where the cause
 * turned out to be a router refusing DNS for the relay hosts specifically,
 * while every other host on the same resolver answered normally.
 *
 * A network that blocks WalletConnect is not rare and is not something the app
 * can route around. What the app CAN do is say so in one second instead of
 * failing silently in sixty, which is all this module is for.
 *
 * ---------------------------------------------------------------------------
 * WHY AN HTTP PROBE RATHER THAN A WEBSOCKET ONE
 * ---------------------------------------------------------------------------
 * The relay publishes a health endpoint that answers `204 No Content` over
 * plain HTTPS (verified by request, not assumed). A GET to it needs no project
 * id, carries no body, and reuses the same DNS, routing and TLS path the
 * WebSocket would - so a block anywhere along that path shows up here too.
 *
 * Opening a throwaway WebSocket would test one layer more, and would cost a
 * second connection that WalletConnect's own client then has to duplicate. The
 * blocks seen in the wild are at DNS or at the network edge, both of which this
 * catches.
 *
 * This is deliberately NOT a claim that a connection will succeed. It is only
 * a claim that the relay is not unreachable, which is the one failure mode the
 * library reports uselessly.
 *
 * ---------------------------------------------------------------------------
 * IT WARNS. IT MUST NEVER VETO. (2026-09-07)
 * ---------------------------------------------------------------------------
 * This briefly gated `connect()` outright, and was then deleted outright, and
 * both were wrong. The history is worth keeping because each mistake had a
 * different cause.
 *
 * Gating was wrong because a reachability probe is a HEURISTIC - an ad blocker,
 * a captive portal, a proxy, or a timeout tuned on a desktop can all make it
 * report a working network as dead, and a heuristic that vetoes the user's
 * primary action turns every false negative into an outage.
 *
 * Deleting it was wrong for the opposite reason: when a user reported the
 * warning firing, it was read as a false positive and the whole probe was
 * removed. It was not a false positive. `Resolve-DnsName` against the router in
 * question returns REFUSED for relay.walletconnect.org and
 * relay.walletconnect.com while resolving everything else normally, and the
 * device's own logs showed the socket failing in 34-130ms - the timing
 * signature of a DNS failure, not of a blocked route. The probe was right and
 * was deleted for being right.
 *
 * So: it tells the truth AND leaves the door open. The caller shows what it
 * found and still offers to try. Diagnose beside an action, never in front
 * of it.
 *
 * Hand-mirrored with `web/src/wallet/relay-reachability.ts`. The two products
 * are separate npm projects with no shared package, so when one changes the
 * other changes in the same commit.
 */

/**
 * Answers 204 with an empty body. Any HTTP status at all proves the host is
 * reachable, so the status is deliberately not checked - only whether a
 * response came back before the timeout.
 */
const RELAY_HEALTH_URL = "https://relay.walletconnect.org/health";

/**
 * Long enough for a slow mobile connection to answer, short enough that a
 * blocked network is reported while the user is still looking at the button.
 * A warm probe from a working network answers in about 250ms.
 */
const PROBE_TIMEOUT_MS = 6_000;

/**
 * What to tell someone whose network is swallowing the relay.
 *
 * It names the host and the two fixes that actually work, because the one this
 * was written for was a router refusing DNS for exactly these hostnames - so
 * "check your connection" would have been useless advice to someone whose
 * connection was otherwise perfect. Setting Private DNS is the fix that does
 * not require leaving the Wi-Fi.
 */
export const RELAY_UNREACHABLE_MESSAGE =
  "Dolphin connects wallets through WalletConnect, and this network is not " +
  "letting it reach relay.walletconnect.org — usually a router blocking that " +
  "hostname.\n\nFix it by setting Private DNS to one.one.one.one in Android " +
  "settings, or by turning Wi-Fi off and using mobile data.";

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

  // AbortController + setTimeout rather than AbortSignal.timeout(): Hermes has
  // the former (React Native polyfills it) and the latter is not guaranteed.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    // Cache-busted because a stale cached 204 would report a network as
    // working after it had started blocking the relay, which is the one wrong
    // answer this must not give.
    await fetch(`${RELAY_HEALTH_URL}?t=${Date.now()}`, {
      method: "GET",
      signal: controller.signal,
    });
    reachedRelayThisSession = true;
    return true;
  } catch {
    // fetch rejects only on a network-level failure - DNS, connection refused,
    // TLS, or our own abort. A 4xx/5xx resolves normally and is still proof
    // the host answered, which is exactly the distinction wanted here.
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
