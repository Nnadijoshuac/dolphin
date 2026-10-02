/**
 * x402 FOR AGENTS BUILT ON DOLPHIN - the pure part (2026-10-02).
 *
 * Owner, 2026-10-02: a builder publishes an agent as an MCP tool server or an
 * A2A agent, and callers pay per call with x402 in U. This supersedes the
 * "no new x402 code" note in AGENTS.md section 1: that note was a measurement
 * (no seller answered 402), and SwapGod has since answered 402 in U on BNB
 * Chain - the challenge below copies the shape it sends.
 *
 * Nothing here touches the network. lib/x402Settle.ts holds the on-chain
 * half (simulate, submit, receipt) and convex/x402.ts the records.
 *
 * MEASURED 2026-10-02 against U on BNB Chain
 * (0xcE24439F2D9C6a2289F741120FE202248B666666, implementation
 * 0xbef21313c69c009fd7d9510a8d3a481a32473dfc):
 *   name() "United Stables", decimals 18, DOMAIN_SEPARATOR equals the
 *   EIP-712 hash of {name "United Stables", version "1", chainId 56,
 *   verifyingContract U}. transferWithAuthorization exists in BOTH the v,r,s
 *   form (e3ee160e) and the bytes form (cf092995, ERC-1271 for smart
 *   wallets); authorizationState(address,bytes32) exists (e94a0102).
 *
 * Money moves payer -> builder directly. Dolphin only submits the payer's
 * signed authorization and pays the gas; it never holds the U.
 */

import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";

export const U_TOKEN: Address = "0xcE24439F2D9C6a2289F741120FE202248B666666";
export const U_DECIMALS = 18;
export const U_EIP712 = { name: "United Stables", version: "1" } as const;
export const X402_NETWORK = "eip155:56";
export const X402_CHAIN_ID = 56;

/** How long a signed payment stays usable, as advertised in the challenge. */
export const MAX_TIMEOUT_SECONDS = 600;
/** A payment must still be valid this long after it arrives: settling takes a few blocks. */
const SETTLE_MARGIN_SECONDS = 30;

/** Builder-set price bounds, in whole U. */
export const MIN_PRICE_U = "0.001";
export const MAX_PRICE_U = "1000";

/** "0.01" -> "10000000000000000". Rejects anything that is not a plain decimal with at most 18 places. */
export function parsePriceU(text: string): bigint | null {
  const trimmed = text.trim();
  const match = /^(\d{1,7})(?:\.(\d{1,18}))?$/.exec(trimmed);
  if (!match) return null;
  const whole = BigInt(match[1]);
  const fraction = (match[2] ?? "").padEnd(U_DECIMALS, "0");
  return whole * BigInt(10) ** BigInt(U_DECIMALS) + BigInt(fraction || "0");
}

export function priceInBounds(raw: bigint): boolean {
  return raw >= (parsePriceU(MIN_PRICE_U) as bigint) && raw <= (parsePriceU(MAX_PRICE_U) as bigint);
}

/** "10000000000000000" -> "0.01". */
export function formatU(raw: bigint | string): string {
  const value = typeof raw === "bigint" ? raw : BigInt(raw);
  const scale = BigInt(10) ** BigInt(U_DECIMALS);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(U_DECIMALS, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export type PaymentRequirement = {
  scheme: "exact";
  network: typeof X402_NETWORK;
  amount: string;
  /** x402 v1 name for the same thing; both are sent so either kind of client reads it. */
  maxAmountRequired: string;
  asset: Address;
  payTo: Address;
  maxTimeoutSeconds: number;
  resource: string;
  description: string;
  mimeType: "application/json";
  extra: { assetTransferMethod: "eip3009"; name: string; version: string; decimals: number; symbol: "U" };
};

/** The 402 body: x402 v2, the same shape SwapGod answers with. */
export function paymentChallenge(input: { priceRaw: string; payTo: string; resourceUrl: string; description: string; error?: string }) {
  const requirement: PaymentRequirement = {
    scheme: "exact",
    network: X402_NETWORK,
    amount: input.priceRaw,
    maxAmountRequired: input.priceRaw,
    asset: U_TOKEN,
    payTo: getAddress(input.payTo),
    maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    resource: input.resourceUrl,
    description: input.description,
    mimeType: "application/json",
    extra: { assetTransferMethod: "eip3009", name: U_EIP712.name, version: U_EIP712.version, decimals: U_DECIMALS, symbol: "U" },
  };
  return {
    x402Version: 2,
    ...(input.error ? { error: input.error } : {}),
    resource: { url: input.resourceUrl, description: input.description, mimeType: "application/json" },
    accepts: [requirement],
  };
}

export type Authorization = {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
};

export type DecodedPayment = { authorization: Authorization; signature: Hex };

export class PaymentRejected extends Error {}

function base64ToText(value: string): string {
  // Standard and URL-safe base64 both arrive in the wild.
  const normal = value.trim().replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normal + "=".repeat((4 - (normal.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function uint(value: unknown, what: string): bigint {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d{1,78}$/.test(value)) return BigInt(value);
  throw new PaymentRejected(`The payment's ${what} is not a whole number.`);
}

/**
 * The X-PAYMENT / PAYMENT-SIGNATURE header -> a checked authorization.
 *
 * Every check that needs no network runs here, so a malformed or mismatched
 * payment is refused before Dolphin spends an RPC call or a reservation on it.
 */
export function decodePayment(
  header: string,
  expect: { priceRaw: string; payTo: string; nowSeconds: number },
): DecodedPayment {
  if (header.length > 16_000) throw new PaymentRejected("The payment header is too large.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(base64ToText(header));
  } catch {
    throw new PaymentRejected("The payment header is not base64 JSON.");
  }
  if (!parsed || typeof parsed !== "object") throw new PaymentRejected("The payment header is not an object.");
  const body = parsed as Record<string, unknown>;
  const accepted = (body.accepted && typeof body.accepted === "object" ? body.accepted : {}) as Record<string, unknown>;

  const scheme = body.scheme ?? accepted.scheme;
  if (scheme !== "exact") throw new PaymentRejected('Only the "exact" scheme is accepted.');
  const network = String(body.network ?? accepted.network ?? "");
  if (network !== X402_NETWORK && network !== "bsc") throw new PaymentRejected(`This agent is paid on ${X402_NETWORK} (BNB Chain).`);
  if (accepted.asset !== undefined && (typeof accepted.asset !== "string" || accepted.asset.toLowerCase() !== U_TOKEN.toLowerCase())) {
    throw new PaymentRejected("This agent is paid in U.");
  }

  const inner = (body.payload && typeof body.payload === "object" ? body.payload : {}) as Record<string, unknown>;
  const auth = (inner.authorization && typeof inner.authorization === "object" ? inner.authorization : null) as Record<string, unknown> | null;
  if (!auth) throw new PaymentRejected("The payment has no EIP-3009 authorization.");
  const signature = inner.signature;
  if (typeof signature !== "string" || !isHex(signature) || signature.length < 132 || signature.length > 4_000) {
    throw new PaymentRejected("The payment signature is missing or malformed.");
  }

  if (typeof auth.from !== "string" || !isAddress(auth.from)) throw new PaymentRejected("The payer address is invalid.");
  if (typeof auth.to !== "string" || !isAddress(auth.to)) throw new PaymentRejected("The pay-to address is invalid.");
  if (typeof auth.nonce !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(auth.nonce)) throw new PaymentRejected("The nonce must be 32 bytes.");

  const authorization: Authorization = {
    from: getAddress(auth.from),
    to: getAddress(auth.to),
    value: uint(auth.value, "value"),
    validAfter: uint(auth.validAfter, "validAfter"),
    validBefore: uint(auth.validBefore, "validBefore"),
    nonce: auth.nonce.toLowerCase() as Hex,
  };

  if (authorization.to !== getAddress(expect.payTo)) throw new PaymentRejected("The payment goes to the wrong wallet.");
  if (authorization.value < BigInt(expect.priceRaw)) {
    throw new PaymentRejected(`The payment is ${formatU(authorization.value)} U; this call costs ${formatU(expect.priceRaw)} U.`);
  }
  // Never take more than asked: an over-signed authorization is refused, not silently pocketed.
  if (authorization.value > BigInt(expect.priceRaw)) {
    throw new PaymentRejected(`The payment is for ${formatU(authorization.value)} U; this call costs exactly ${formatU(expect.priceRaw)} U.`);
  }
  if (authorization.from === authorization.to) throw new PaymentRejected("A wallet cannot pay itself.");
  const now = BigInt(expect.nowSeconds);
  if (authorization.validAfter > now) throw new PaymentRejected("The payment is not valid yet.");
  if (authorization.validBefore <= now + BigInt(SETTLE_MARGIN_SECONDS)) throw new PaymentRejected("The payment has expired or is about to.");
  if (authorization.validBefore > now + BigInt(MAX_TIMEOUT_SECONDS * 24)) throw new PaymentRejected("The payment's validity window is too long.");

  return { authorization, signature: signature as Hex };
}

/** The x402 settlement receipt sent back in X-PAYMENT-RESPONSE / PAYMENT-RESPONSE. */
export function paymentResponseHeader(input: { transaction: string; payer: string }): string {
  return textToBase64(JSON.stringify({ success: true, transaction: input.transaction, network: X402_NETWORK, payer: input.payer }));
}
