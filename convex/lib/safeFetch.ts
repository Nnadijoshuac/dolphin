/**
 * THE OUTBOUND BOUNDARY.
 *
 * Every request Dolphin makes to a URL a stranger chose goes through this
 * module: agent card fetches, A2A and MCP calls, icon downloads, and the
 * registration file read - which is the worst of them, because its URL comes
 * from an on-chain `tokenURI` that anyone can set to anything for the price of
 * gas.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE PREVIOUS IMPLEMENTATION DID
 * ---------------------------------------------------------------------------
 * `probeLiveness`, `probeSellability`, `fetchIcon` and `fetchRegistrationFile`
 * each called `fetch()` directly on a publisher-supplied URL with default
 * redirect following and no validation of scheme, host or address. There was a
 * timeout on each, and that was the whole of the protection.
 *
 * Convex actions egress from Convex's infrastructure rather than from a network
 * holding Dolphin's own secrets, so the blast radius was never as bad as an
 * SSRF in a self-hosted backend. But "the platform makes it less bad" is not a
 * boundary, and two specific holes were real: a redirect to a link-local or
 * private address was followed without a second look, and `fetchIcon` followed
 * an entire redirect chain before it ever inspected a content type.
 *
 * ---------------------------------------------------------------------------
 * THE RULES, AND WHY EACH ONE IS HERE
 * ---------------------------------------------------------------------------
 *   scheme      https/http only. Blocks file:, data:, gopher:, ftp: - the
 *               classic SSRF payload shapes, and all of them are legal in a
 *               tokenURI.
 *   host        Rejects literal IPs and the private / loopback / link-local /
 *               CGNAT / IPv6-ULA ranges, plus localhost and .local / .internal.
 *   redirects   Followed MANUALLY, at most 3, each hop re-validated. This is
 *               the rule that matters most: a public hostname that 302s to
 *               169.254.169.254 defeats a check performed only on the URL you
 *               were given.
 *   size        Enforced while streaming, so a 4 GB body cannot be pulled into
 *               an action's memory before anyone checks its length. A
 *               content-length header is a claim, not a limit.
 *   timeout     Per call, always set by the caller.
 *   headers     Nothing of Dolphin's travels outbound. No cookies, no
 *               credentials, no session token, no API key.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS NOT
 * ---------------------------------------------------------------------------
 * It is not a DNS-rebinding defence. Resolving a hostname here and then handing
 * the URL to `fetch` leaves a window where the name can resolve differently on
 * the second lookup, and closing it properly needs connection-level control
 * that the Convex runtime does not expose. The honest mitigation is that the
 * runtime holds nothing worth reaching: no metadata service, no internal
 * network, no credentials on the egress path. Recorded here rather than left
 * for someone to discover.
 */

export class UnsafeUrlError extends Error {}

const MAX_REDIRECTS = 3;

/** Hostnames that never leave the machine, whatever they resolve to. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata",
  "metadata.google.internal",
  "instance-data",
]);

/** Suffixes that name a private namespace by convention. */
const BLOCKED_SUFFIXES = [".local", ".internal", ".localhost", ".home.arpa"];

function isPrivateIPv4(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const [a, b] = [Number(match[1]), Number(match[2])];
  if (match.slice(1).some((part) => Number(part) > 255)) return true; // malformed: refuse
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT, RFC6598
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a >= 224) return true; // multicast and reserved
  return false;
}

function isPrivateIPv6(host: string): boolean {
  // URL parsing leaves an IPv6 literal wrapped in brackets.
  const inner = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (!inner.includes(":")) return false;
  if (inner === "::" || inner === "::1") return true; // unspecified, loopback
  if (inner.startsWith("fc") || inner.startsWith("fd")) return true; // unique local
  if (inner.startsWith("fe80")) return true; // link-local
  if (inner.startsWith("ff")) return true; // multicast
  // ::ffff:169.254.169.254 and friends - an IPv4-mapped address in v6 clothing.
  const mapped = /::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(inner);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return true; // any other literal v6 address: not something an agent publishes
}

/**
 * Validates one URL and returns it parsed, or throws UnsafeUrlError.
 *
 * Exported because the probe needs to classify an unsafe URL as `invalid`
 * WITHOUT making a request - a publisher who registers `http://127.0.0.1:8080`
 * has published a broken registration, and saying so is more useful than
 * recording a connection error.
 */
export function assertSafeUrl(candidate: string): URL {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new UnsafeUrlError(`"${candidate.slice(0, 120)}" is not a parseable URL.`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UnsafeUrlError(
      `Refusing to fetch a "${url.protocol}" URL; only http and https are allowed.`,
    );
  }

  // An un-substituted template is not a URL anyone can call. Dolphin does not
  // guess at the intended value: filling in a token id for the TermiX-hosted
  // endpoints made 32 of them return HTTP 200 bodies that reported
  // `status: "UNBOUND"`, so substituting would manufacture "live" claims about
  // agents their own platform says are not bound.
  if (candidate.includes("{") || candidate.includes("}")) {
    throw new UnsafeUrlError(
      "The registered URL still carries an un-substituted template and cannot be called.",
    );
  }

  if (url.username !== "" || url.password !== "") {
    throw new UnsafeUrlError("Refusing to fetch a URL carrying embedded credentials.");
  }

  const host = url.hostname.toLowerCase();
  if (host.length === 0) throw new UnsafeUrlError("URL has no host.");
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new UnsafeUrlError(`Refusing to fetch the private host "${host}".`);
  }
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new UnsafeUrlError(`Refusing to fetch the private namespace "${host}".`);
  }
  if (isPrivateIPv4(host) || isPrivateIPv6(host)) {
    throw new UnsafeUrlError(`Refusing to fetch the private or reserved address "${host}".`);
  }

  return url;
}

export interface SafeFetchOptions {
  method?: "GET" | "POST";
  /** Merged over the defaults. Nothing of Dolphin's is ever added here. */
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
  /** Hard cap, enforced while streaming rather than from content-length. */
  maxBytes: number;
  /**
   * Response headers to copy onto the result, lowercased. Opt-in and named
   * one-by-one: a caller gets the headers it asked for and nothing else.
   *
   * ADDED 2026-09-08 for the MCP `tools/call` path. A Streamable HTTP MCP
   * server issues `Mcp-Session-Id` on `initialize` and a stateful one rejects
   * every later call that does not echo it back. `probe.ts` never needed this
   * because `initialize` + `tools/list` is answered without a session by all 26
   * MCP servers in the catalog - but that is evidence about those two calls,
   * not about `tools/call`, which nothing has ever sent them.
   *
   * Deliberately NOT a blanket `headers` field. A stranger's response headers
   * are attacker-controlled like the body is, and handing every caller the full
   * set invites someone to read `set-cookie` or an auth echo out of one. Naming
   * the header you want keeps the surface at exactly what the caller reasoned
   * about.
   */
  exposeHeaders?: readonly string[];
}

export interface SafeResponse {
  ok: boolean;
  status: number;
  contentType: string;
  /** Decoded as UTF-8 text, already length-capped. */
  text: string;
  /** The URL that actually answered, after redirects. */
  finalUrl: string;
  latencyMs: number;
  /**
   * Only the headers named in `exposeHeaders`, keyed lowercase. Empty when the
   * caller asked for none - which is every caller written before this existed.
   */
  headers: Record<string, string>;
}

/**
 * Reads at most `maxBytes` from a body and aborts the rest.
 *
 * Streaming rather than `await response.text()` because content-length is a
 * claim by the same party we are defending against, and a body with no
 * content-length at all is legal.
 */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const body = response.body;
  if (!body) return "";

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        chunks.push(value.slice(0, value.byteLength - (total - maxBytes)));
        break;
      }
      chunks.push(value);
    }
  } finally {
    // Releases the connection whether we finished or bailed at the cap.
    await reader.cancel().catch(() => {});
  }

  const joined = new Uint8Array(chunks.reduce((sum, c) => sum + c.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(joined);
}

/**
 * Fetches a stranger's URL under every rule in this module's header.
 *
 * Throws UnsafeUrlError for a URL that must not be requested at all; returns a
 * SafeResponse (with `ok: false`) for one that was requested and failed. That
 * split is what lets the prober record "structurally invalid, do not retry for
 * a month" separately from "somebody's server is down, try again in an hour".
 * A transport failure still throws, as a normal Error.
 */
export async function safeFetch(
  candidate: string,
  options: SafeFetchOptions,
): Promise<SafeResponse> {
  const startedAt = Date.now();
  let current = assertSafeUrl(candidate);
  const deadline = startedAt + options.timeoutMs;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`Timed out after ${options.timeoutMs}ms.`);

    const response = await fetch(current.toString(), {
      method: options.method ?? "GET",
      headers: { Accept: "application/json", ...options.headers },
      body: options.body,
      // Manual, so every hop is re-validated. This is the rule that makes the
      // host check meaningful: a public name that redirects to 169.254.169.254
      // defeats a check performed only on the URL we were handed.
      redirect: "manual",
      signal: AbortSignal.timeout(remaining),
    });

    const isRedirect = response.status >= 300 && response.status < 400;
    const location = response.headers.get("location");
    if (isRedirect && location) {
      if (hop === MAX_REDIRECTS) {
        throw new Error(`Exceeded ${MAX_REDIRECTS} redirects.`);
      }
      // Resolved against the current URL so a relative Location works, then
      // validated from scratch - a redirect target gets no more trust than the
      // URL we started with.
      current = assertSafeUrl(new URL(location, current).toString());
      continue;
    }

    const exposed: Record<string, string> = {};
    for (const name of options.exposeHeaders ?? []) {
      const key = name.toLowerCase();
      const value = response.headers.get(key);
      // Capped for the same reason the body is: a header is a stranger's bytes.
      if (value !== null) exposed[key] = value.slice(0, MAX_HEADER_CHARS);
    }

    return {
      ok: response.ok,
      status: response.status,
      contentType: (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase(),
      text: await readCapped(response, options.maxBytes),
      finalUrl: current.toString(),
      latencyMs: Date.now() - startedAt,
      headers: exposed,
    };
  }

  throw new Error(`Exceeded ${MAX_REDIRECTS} redirects.`);
}

/** Byte caps, by what is being fetched. A JSON API answer is small. */
export const MAX_JSON_BYTES = 256 * 1024;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/**
 * Cap on a single exposed response header. An MCP session id is a UUID; nothing
 * legitimate needs more than this, and an unbounded header would be a way to
 * push a stranger's bytes past the body cap that exists to stop exactly that.
 */
const MAX_HEADER_CHARS = 1024;
