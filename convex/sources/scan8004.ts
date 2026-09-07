/**
 * THE 8004SCAN BOUNDARY.
 *
 * This is the only module in the codebase that knows 8004scan's field names.
 * Everything downstream speaks convex/model/agent.ts. If 8004scan renames
 * `image_url`, exactly one file changes.
 *
 * ---------------------------------------------------------------------------
 * WHAT MEASURING THE API CHANGED (2026-09-07, authenticated, BSC mainnet)
 * ---------------------------------------------------------------------------
 * The previous pipeline walked the registry with a 78-term vocabulary search, a
 * descending tail and a resumable offset backfill - roughly 3,000 pages and
 * ~4.5 hours of wall clock for one full pass - because it treated 8004scan as a
 * list endpoint with a `search` parameter and nothing else.
 *
 * It has far more than that, and the numbers are decisive:
 *
 *     everything                    307,559
 *     has_a2a=true                   27,742     9.0%
 *     has_mcp=true                    5,474     1.8%
 *     is_endpoint_verified=true           5
 *     created_after=<24h ago>         1,348     per day
 *     min_score>=60                       0
 *
 * An agent with neither an A2A endpoint nor an MCP server publishes no door to
 * knock on and can never be hired through Dolphin. That is 89% of the registry,
 * and the old sweep read every one of them and then wrote a row saying it had.
 *
 * TWO MEASURED CAVEATS, both of which this module is built around:
 *
 *   1. `has_a2a` is SLOW (~35s) and returns HTTP 500 intermittently - at ~10.5s
 *      consistently, which is the signature of a server-side query timeout on an
 *      unindexed filter rather than an auth or rate-limit problem. Several other
 *      filters (`x402_supported`, `min_feedbacks`, `min_score=40`,
 *      `supported_protocol=A2A`) fail the same way every time. So the filtered
 *      query is treated as an OPTIMISATION that may be unavailable, never as a
 *      dependency: `fetchCandidatePage` reports the failure and the caller falls
 *      back to the unfiltered walk with a client-side protocol check.
 *
 *   2. `is_endpoint_verified` returns FIVE agents on the entire chain. It is
 *      real - it means a verified domain - but it is far too narrow to gate on,
 *      and an agent that demonstrably sells (token 302257) is not among them.
 *
 * ---------------------------------------------------------------------------
 * 8004SCAN'S OWN HEALTH DATA IS NOT A GATE
 * ---------------------------------------------------------------------------
 * Re-verified today, and it is the same finding the 2026-08-29 work recorded:
 * token 302257 - one of the agents that returns live, payable quotes - has
 * `health_score: 50` and a `health_status` reading
 *
 *     "status": "unhealthy",
 *     "message": "Not a valid AgentCard (missing name) (cached)"
 *
 * The "(cached)" is the tell. These values are read and stored for display, and
 * nothing is ever admitted to or excluded from the catalog because of them.
 * Dolphin makes its own check.
 */

import { MAX_JSON_BYTES, safeFetch } from "../lib/safeFetch";

const AGENTS_URL =
  process.env.SCAN8004_API_URL?.trim() || "https://api.8004scan.io/api/v1/agents";

/** 8004scan caps `limit` at 100; 200/500/1000 all return HTTP 422. */
export const PAGE_SIZE = 100;

/**
 * Generous, because the filtered queries genuinely take 35 seconds. A shorter
 * timeout here does not make the API faster, it just converts a slow success
 * into a failure we then retry, which is strictly worse.
 */
const LIST_TIMEOUT_MS = 60_000;
const DETAIL_TIMEOUT_MS = 20_000;

/**
 * Concurrency 4, measured against the live API in the 2026-08-29 work and not
 * revisited because the bottleneck has not moved: concurrency 8 doubled p50
 * latency for a 24% throughput gain and started timing out; concurrency 2 was
 * slower AND had more timeouts. The limit is 8004scan's server-side offset
 * scanning, not our request rate.
 */
export const REQUEST_CONCURRENCY = 4;

function headers(): Record<string, string> {
  const apiKey = process.env.SCAN8004_API_KEY;
  // Authenticated raises the limit from 30/min to 600/min and is what makes
  // `has_a2a` return at all rather than 500 on the anonymous tier. NEVER
  // EXPO_PUBLIC_/NEXT_PUBLIC_ prefixed - that would ship it in a client bundle.
  return apiKey ? { Accept: "application/json", "X-API-Key": apiKey } : { Accept: "application/json" };
}

/* ---------------------------------------------------------------------------
 * UNTRUSTED READERS
 *
 * Every field arrives as `unknown` and leaves as `T | null`. There is no cast
 * anywhere in this file and no `any`: a value that is not the shape we expect
 * is absent, not coerced. A publisher controls `name` and `description`, and an
 * indexer bug controls the rest.
 * ------------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readDate(record: Record<string, unknown>, key: string): string | null {
  const value = readString(record, key);
  return value !== null && Number.isFinite(Date.parse(value)) ? value : null;
}

/** A URL that survives the outbound boundary's rules, or null. */
function readSafeUrl(record: Record<string, unknown>, key: string): string | null {
  const value = readString(record, key);
  if (value === null) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return value;
  } catch {
    return null;
  }
}

/**
 * 8004scan sometimes double-encodes array fields as a JSON string. Observed on
 * `services`, `tags` and `supported_protocols` in the 2026-08-29 decode work
 * and preserved here because it is still true.
 */
function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const candidate = value.trim();
  if (candidate.length === 0) return value;
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return value;
  }
}

function readStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = parseMaybeJson(record[key]);
  if (typeof value === "string" && value.trim().length > 0) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

/* ---------------------------------------------------------------------------
 * THE INTERNAL SHAPES this module produces
 * ------------------------------------------------------------------------ */

/** What the LIST endpoint gives, which is enough to screen a candidate. */
export interface ScanListItem {
  /** 8004scan's own composite id: "56:0x8004…:302257". Our canonical key. */
  agentKey: string;
  chainId: number;
  registryAddress: string;
  tokenId: string;
  name: string;
  description: string;
  iconUrl: string | null;
  ownerAddress: string;
  publisher: string | null;
  /** "A2A", "MCP", "OASF", "Web", "Email". Verified present and correct today. */
  supportedProtocols: string[];
  x402Supported: boolean;
  totalScore: number;
  feedbackCount: number;
  createdAt: string | null;
  updatedAt: string | null;
}

/** What the DETAIL endpoint adds: the endpoint URL and the payee. */
export interface ScanDetail extends ScanListItem {
  agentWallet: string | null;
  isActive: boolean | null;
  isEndpointVerified: boolean | null;
  tags: string[];
  categories: string[];
  /** Every declared service, as {label -> url}. The probe decides what to call. */
  services: { name: string; endpoint: string; version: string | null }[];
  a2aEndpoint: string | null;
  mcpServer: string | null;
}

export class ScanError extends Error {
  constructor(
    message: string,
    /** True when retrying could plausibly help: 5xx, 429, timeout. */
    readonly retryable: boolean,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

/* ---------------------------------------------------------------------------
 * NORMALIZATION
 * ------------------------------------------------------------------------ */

/**
 * Turns one raw list record into a ScanListItem, or null if it is unusable.
 *
 * Returns null rather than throwing, and the caller COUNTS the nulls. A
 * malformed record from an indexer is an ordinary event at this volume, not an
 * error worth failing a page over.
 */
export function normalizeListItem(raw: unknown): ScanListItem | null {
  if (!isRecord(raw)) return null;

  const tokenId = readString(raw, "token_id");
  const chainId = readNumber(raw, "chain_id");
  const registryAddress = readString(raw, "contract_address");
  const ownerAddress = readString(raw, "owner_address");
  if (!tokenId || chainId === null || !registryAddress || !ownerAddress) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(registryAddress)) return null;

  // Prefer 8004scan's own composite id when it publishes one - it IS the key we
  // want - but rebuild it when absent rather than depending on the field.
  const published = readString(raw, "agent_id");
  const agentKey =
    published && published.split(":").length === 3
      ? published.toLowerCase()
      : `${chainId}:${registryAddress.toLowerCase()}:${tokenId}`;

  return {
    agentKey,
    chainId,
    registryAddress: registryAddress.toLowerCase(),
    tokenId,
    name: readString(raw, "name") ?? "",
    description: readString(raw, "description") ?? "",
    iconUrl: readSafeUrl(raw, "image_url"),
    ownerAddress: ownerAddress.toLowerCase(),
    publisher:
      readString(raw, "owner_certified_name") ??
      readString(raw, "owner_username") ??
      readString(raw, "owner_ens"),
    supportedProtocols: readStringArray(raw, "supported_protocols").map((p) => p.toUpperCase()),
    x402Supported: readBoolean(raw, "x402_supported") ?? false,
    totalScore: readNumber(raw, "total_score") ?? 0,
    feedbackCount: readNumber(raw, "total_feedbacks") ?? 0,
    createdAt: readDate(raw, "created_at"),
    updatedAt: readDate(raw, "updated_at"),
  };
}

/**
 * Decodes the `services` object into a flat list.
 *
 * 8004scan publishes it as `{a2a: {endpoint, skills}, mcp: {...}}` (verified
 * today against token 302257), and historically also as an array. Both are
 * handled; a service with no fetchable endpoint is dropped rather than kept as
 * a half-record.
 */
function decodeServices(value: unknown): { name: string; endpoint: string; version: string | null }[] {
  const services: { name: string; endpoint: string; version: string | null }[] = [];
  const decoded = parseMaybeJson(value);

  const append = (name: string, candidate: unknown) => {
    if (!isRecord(candidate)) return;
    const endpoint = readSafeUrl(candidate, "endpoint");
    if (endpoint === null) return;
    services.push({ name: name.toLowerCase(), endpoint, version: readString(candidate, "version") });
  };

  if (Array.isArray(decoded)) {
    for (const candidate of decoded) {
      if (!isRecord(candidate)) continue;
      append(readString(candidate, "name") ?? "service", candidate);
    }
  } else if (isRecord(decoded)) {
    for (const [name, candidate] of Object.entries(decoded)) append(name, candidate);
  }

  return services;
}

export function normalizeDetail(raw: unknown): ScanDetail | null {
  const base = normalizeListItem(raw);
  if (!base || !isRecord(raw)) return null;

  const services = decodeServices(raw.services);
  const a2aEndpoint = readSafeUrl(raw, "a2a_endpoint");
  const mcpServer = readSafeUrl(raw, "mcp_server");

  // The flat `a2a_endpoint` / `mcp_server` fields and the nested `services`
  // object are two views of the same data and they do not always agree - which
  // one is populated varies by how the agent registered. Merged, deduplicated
  // by URL, so a probe sees every door the record knows about.
  const known = new Set(services.map((s) => s.endpoint));
  if (a2aEndpoint && !known.has(a2aEndpoint)) {
    services.push({ name: "a2a", endpoint: a2aEndpoint, version: readString(raw, "a2a_version") });
    known.add(a2aEndpoint);
  }
  if (mcpServer && !known.has(mcpServer)) {
    services.push({ name: "mcp", endpoint: mcpServer, version: readString(raw, "mcp_version") });
  }

  return {
    ...base,
    agentWallet: readString(raw, "agent_wallet"),
    isActive: readBoolean(raw, "is_active"),
    isEndpointVerified: readBoolean(raw, "is_endpoint_verified"),
    tags: readStringArray(raw, "tags"),
    categories: readStringArray(raw, "categories"),
    services,
    a2aEndpoint,
    mcpServer,
  };
}

/* ---------------------------------------------------------------------------
 * FETCHING
 * ------------------------------------------------------------------------ */

async function getJson(url: string, timeoutMs: number): Promise<unknown> {
  let response;
  try {
    response = await safeFetch(url, { headers: headers(), timeoutMs, maxBytes: MAX_JSON_BYTES });
  } catch (cause) {
    throw new ScanError(
      `8004scan request failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      true,
    );
  }

  if (!response.ok) {
    // 5xx and 429 are worth retrying; 4xx means we asked wrongly and will keep
    // asking wrongly. 422 in particular is a bad parameter, not a bad moment.
    const retryable = response.status >= 500 || response.status === 429;
    throw new ScanError(`8004scan returned HTTP ${response.status}`, retryable, response.status);
  }

  try {
    return JSON.parse(response.text) as unknown;
  } catch {
    throw new ScanError("8004scan returned a body that is not JSON", true, response.status);
  }
}

export interface ScanPage {
  items: ScanListItem[];
  /** 8004scan's reported total for the query, when it gives one. */
  total: number | null;
  /** Records that arrived but could not be decoded. Counted, never stored. */
  malformed: number;
}

/**
 * One page of the agents list. `params` is appended verbatim after the chain
 * filters, so callers compose their own query.
 */
export async function fetchAgentPage(params: string): Promise<ScanPage> {
  const url = `${AGENTS_URL}?chain_id=56&is_testnet=false&${params}`;
  const payload = await getJson(url, LIST_TIMEOUT_MS);
  if (!isRecord(payload)) throw new ScanError("8004scan returned a non-object page", true);

  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const items: ScanListItem[] = [];
  let malformed = 0;
  for (const raw of rawItems) {
    const item = normalizeListItem(raw);
    if (item) items.push(item);
    else malformed++;
  }

  return {
    items,
    total: typeof payload.total === "number" ? payload.total : null,
    malformed,
  };
}

/**
 * One agent's full record.
 *
 * `is_active=any` is not a parameter here - the detail endpoint takes none. Note
 * that a 500 from this endpoint is NOT evidence about the agent: measured today,
 * five sequential detail fetches returned 500 at ~10.8s immediately after a
 * heavy filtered scan, and every one of them returned 200 in 400-1400ms when
 * retried a minute later. The caller must treat a failure here as "ask again",
 * never as "this agent is dead".
 */
export async function fetchAgentDetail(
  chainId: number,
  tokenId: string,
): Promise<ScanDetail | null> {
  const url = `${AGENTS_URL}/${chainId}/${encodeURIComponent(tokenId)}`;
  const payload = await getJson(url, DETAIL_TIMEOUT_MS);
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : payload;
  return normalizeDetail(data);
}

/**
 * Retries a retryable ScanError with exponential backoff.
 *
 * Three attempts, because the measured failure is a ~10.5s server-side query
 * timeout that clears on its own - one retry is often enough and three is
 * generous without turning a bad minute into a stalled cycle.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation();
    } catch (cause) {
      lastError = cause;
      if (cause instanceof ScanError && !cause.retryable) throw cause;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
      }
    }
  }
  throw lastError;
}

/** Runs tasks with bounded concurrency, never throwing for an individual failure. */
export async function withConcurrency<T>(
  tasks: readonly (() => Promise<T>)[],
  limit: number,
  onError: (error: unknown) => void,
): Promise<T[]> {
  const results: T[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= tasks.length) return;
      try {
        results.push(await tasks[index]());
      } catch (error) {
        onError(error);
      }
    }
  });
  await Promise.all(workers);
  return results;
}

/** Whether a list item advertises a protocol Dolphin can actually speak to. */
export function hasCallableProtocol(item: ScanListItem): boolean {
  return item.supportedProtocols.includes("A2A") || item.supportedProtocols.includes("MCP");
}
