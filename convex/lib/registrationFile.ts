/**
 * The PRIMARY-SOURCE CROSS-CHECK: fetch what an agent currently says about
 * itself, straight from its own registration file, rather than trusting
 * 8004scan's cache of it.
 *
 * WHY THIS EXISTS (Task 2). 8004scan is a crawler with a cache. Its
 * `health_status` messages literally contain the string "(cached)" and its
 * `checked_at` was up to 12 hours stale on the agents inspected during this
 * session's Task 0 investigation - and on token 304494 it reported
 * `overall_status: "unhealthy"`, `health_score: 0` for an agent that answered
 * our own probe in 1217ms. An indexer being wrong about a real agent is not
 * hypothetical here; it was observed. So for the (small) set of candidates that
 * survive the cheap pre-filter, Dolphin reads the agent's own current claim
 * about itself and classifies on that as well.
 *
 * This is deliberately NOT a from-scratch indexer. It runs only on pre-filter
 * survivors - a few hundred per cycle at most, never the 289,938-record
 * registry - which is exactly the split project-scope.md §3 asks for: 8004scan
 * for bulk discovery, direct reads for per-agent verification.
 *
 * THE TOKENURI IS READ ON-CHAIN, NOT TAKEN FROM 8004SCAN. `tokenURI(tokenId)`
 * against the ERC-8004 identity registry is the actual primary source; using
 * 8004scan's `agent_url` instead would make the "cross-check" a check of the
 * cache against itself.
 *
 * FOUR TRANSPORTS, ALL OBSERVED LIVE. Task 0.5 walked the BRC8004 registry by
 * hand and found registration URIs arriving as `ipfs://`, `https://`,
 * `data:application/json;base64,` and raw `data:application/json,` (both
 * percent-encoded and not). The same four appear on the main registry. A parser
 * that handled only `https://` would silently lose every `data:` registration,
 * which includes at least one real yield agent (BRC8004 token 25).
 */

import { bscPublicClient, BSC_CHAIN_ID } from "./bscClient";
import { ERC8004_IDENTITY_REGISTRY } from "./agentCatalog";

/** Minimal ABI - only what the cross-check reads. */
const TOKEN_URI_ABI = [
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

/**
 * IPFS gateways, tried in order. Public HTTP gateways only - this project has no
 * IPFS node and adding one is well outside a discovery pipeline's remit. Both
 * are widely-used public gateways; if the first is rate-limiting, the second
 * usually answers.
 */
const IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
];

const FETCH_TIMEOUT_MS = 10_000;
/** A registration file is a small JSON document. Anything larger is not one. */
const MAX_REGISTRATION_BYTES = 512 * 1024;

export type RegistrationFetchState =
  /** The file was fetched and parsed as JSON. */
  | "fetched"
  /** The registry has no tokenURI for this id, or it is empty. */
  | "no-token-uri"
  /** A tokenURI exists but the document could not be retrieved or parsed. */
  | "unreachable"
  /** The tokenURI uses a transport this parser does not implement. */
  | "unsupported-transport";

export interface RegistrationFile {
  state: RegistrationFetchState;
  /** The raw tokenURI as the registry returned it, for auditability. */
  tokenUri: string | null;
  /** Where the document was actually fetched from (gateway-resolved for ipfs://). */
  resolvedUrl: string | null;
  name: string | null;
  description: string | null;
  /** Skill/capability names, however the publisher spelled the field. */
  skills: string[];
  /** An icon/logo the publisher supplies in their own file (Task 4, item 2). */
  iconUrl: string | null;
  /** Endpoints the agent advertises for itself, by protocol. */
  endpoints: { protocol: string; url: string }[];
  /** Set whenever `state` is not "fetched". */
  error: string | null;
}

function empty(
  state: RegistrationFetchState,
  tokenUri: string | null,
  error: string | null,
): RegistrationFile {
  return {
    state,
    tokenUri,
    resolvedUrl: null,
    name: null,
    description: null,
    skills: [],
    iconUrl: null,
    endpoints: [],
    error,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

/**
 * Publishers spell the skills field half a dozen ways and nest it inconsistently
 * (`skills: ["a"]`, `skills: [{name: "a"}]`, `capabilities`, `services[].name`).
 * All observed shapes are flattened to plain names, because the scorer only
 * wants the words.
 */
function readSkills(record: Record<string, unknown>): string[] {
  const names: string[] = [];
  for (const key of ["skills", "capabilities", "tags", "supportedProtocols", "supported_protocols"]) {
    const value = record[key];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (typeof item === "string" && item.trim().length > 0) {
        names.push(item.trim());
      } else if (isRecord(item)) {
        const name = readString(item, ["name", "id", "title"]);
        const description = readString(item, ["description"]);
        if (name) names.push(name);
        if (description) names.push(description);
      }
    }
  }
  return [...new Set(names)];
}

/**
 * Endpoint discovery for the liveness probe (Task 3). A registration file names
 * its endpoints in whatever shape the publisher chose; the probe only needs a
 * protocol hint and a URL, so every observed shape is normalised to that.
 */
function readEndpoints(record: Record<string, unknown>): { protocol: string; url: string }[] {
  const endpoints: { protocol: string; url: string }[] = [];

  const push = (protocol: string, candidate: unknown) => {
    if (typeof candidate !== "string") return;
    const url = candidate.trim();
    if (!/^https?:\/\//i.test(url)) return;
    if (endpoints.some((e) => e.url === url)) return;
    endpoints.push({ protocol, url });
  };

  push("a2a", record["a2aEndpoint"] ?? record["a2a_endpoint"]);
  push("mcp", record["mcpServer"] ?? record["mcp_server"]);
  push("http", record["agentUrl"] ?? record["agent_url"] ?? record["url"] ?? record["endpoint"]);

  const services = record["services"];
  if (Array.isArray(services)) {
    for (const service of services) {
      if (!isRecord(service)) continue;
      const name = (readString(service, ["name", "type", "protocol"]) ?? "service").toLowerCase();
      push(name, service["endpoint"] ?? service["url"]);
    }
  } else if (isRecord(services)) {
    for (const [name, service] of Object.entries(services)) {
      if (isRecord(service)) push(name.toLowerCase(), service["endpoint"] ?? service["url"]);
      else push(name.toLowerCase(), service);
    }
  }

  return endpoints;
}

/**
 * Decodes a `data:` URI without a network call. Handles the four real shapes:
 * base64, percent-encoded, and plain-text bodies, with or without the media
 * type spelled out.
 */
function decodeDataUri(uri: string): string | null {
  const comma = uri.indexOf(",");
  if (comma < 0) return null;
  const meta = uri.slice(5, comma).toLowerCase();
  const body = uri.slice(comma + 1);

  if (meta.includes(";base64")) {
    try {
      return atob(body);
    } catch {
      return null;
    }
  }

  try {
    return decodeURIComponent(body);
  } catch {
    // A raw `data:application/json,{...}` body containing an unescaped `%` is
    // not valid percent-encoding but is still readable as-is - observed in the
    // wild, so it is worth not throwing the document away over.
    return body;
  }
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { Accept: "application/json, text/plain, */*" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const text = await response.text();
  if (text.length > MAX_REGISTRATION_BYTES) {
    throw new Error(`document is ${text.length} bytes, over the ${MAX_REGISTRATION_BYTES} cap`);
  }
  return text;
}

/** Reads `tokenURI(tokenId)` from the ERC-8004 identity registry on BSC. */
export async function readTokenUri(tokenId: string): Promise<string | null> {
  try {
    const uri = await bscPublicClient.readContract({
      address: ERC8004_IDENTITY_REGISTRY as `0x${string}`,
      abi: TOKEN_URI_ABI,
      functionName: "tokenURI",
      args: [BigInt(tokenId)],
    });
    const trimmed = typeof uri === "string" ? uri.trim() : "";
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * Fetches and parses one agent's own registration file.
 *
 * `tokenUri` may be passed in when it is already known (the submission path
 * reads it once); otherwise it is read on-chain here.
 */
export async function fetchRegistrationFile(
  tokenId: string,
  knownTokenUri?: string | null,
): Promise<RegistrationFile> {
  const tokenUri = knownTokenUri ?? (await readTokenUri(tokenId));
  if (tokenUri === null) {
    return empty("no-token-uri", null, `The registry returned no tokenURI for token ${tokenId}.`);
  }

  let text: string | null = null;
  let resolvedUrl: string | null = null;

  if (tokenUri.startsWith("data:")) {
    text = decodeDataUri(tokenUri);
    resolvedUrl = "data: URI (decoded in place, no network fetch)";
    if (text === null) {
      return empty("unreachable", tokenUri, "The data: URI body could not be decoded.");
    }
  } else if (tokenUri.startsWith("ipfs://")) {
    const path = tokenUri.slice("ipfs://".length).replace(/^ipfs\//, "");
    const errors: string[] = [];
    for (const gateway of IPFS_GATEWAYS) {
      try {
        resolvedUrl = `${gateway}${path}`;
        text = await fetchText(resolvedUrl);
        break;
      } catch (error) {
        errors.push(`${gateway}: ${error instanceof Error ? error.message : String(error)}`);
        text = null;
      }
    }
    if (text === null) {
      return empty("unreachable", tokenUri, `No IPFS gateway served the document (${errors.join("; ")}).`);
    }
  } else if (/^https?:\/\//i.test(tokenUri)) {
    try {
      resolvedUrl = tokenUri;
      text = await fetchText(tokenUri);
    } catch (error) {
      return empty(
        "unreachable",
        tokenUri,
        `Could not fetch the registration file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    return empty(
      "unsupported-transport",
      tokenUri,
      `tokenURI uses an unsupported transport (${tokenUri.slice(0, 40)}).`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return empty("unreachable", tokenUri, "The registration document is not valid JSON.");
  }

  if (!isRecord(parsed)) {
    return empty("unreachable", tokenUri, "The registration document is not a JSON object.");
  }

  // ERC-8004 registration files and A2A agent cards both appear; some publishers
  // nest the real payload one level down under `agent` or `registration`.
  const inner = isRecord(parsed["agent"])
    ? (parsed["agent"] as Record<string, unknown>)
    : isRecord(parsed["registration"])
      ? (parsed["registration"] as Record<string, unknown>)
      : parsed;

  return {
    state: "fetched",
    tokenUri,
    resolvedUrl,
    name: readString(inner, ["name", "agentName", "title"]) ?? readString(parsed, ["name"]),
    description:
      readString(inner, ["description", "summary", "bio", "strategy"]) ??
      readString(parsed, ["description"]),
    skills: [...new Set([...readSkills(inner), ...readSkills(parsed)])],
    iconUrl:
      readString(inner, ["iconUrl", "icon_url", "icon", "image", "image_url", "imageUrl", "logo", "avatar"]) ??
      readString(parsed, ["iconUrl", "icon_url", "icon", "image", "image_url", "imageUrl", "logo", "avatar"]),
    endpoints: [...readEndpoints(inner), ...readEndpoints(parsed)].filter(
      (endpoint, index, all) => all.findIndex((e) => e.url === endpoint.url) === index,
    ),
    error: null,
  };
}

/** Exported for the session log's own reporting. */
export const REGISTRATION_REGISTRY_ADDRESS = ERC8004_IDENTITY_REGISTRY;
export const REGISTRATION_CHAIN_ID = BSC_CHAIN_ID;
