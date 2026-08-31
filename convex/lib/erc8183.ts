import { getAddress } from "viem";

import { BSC_CHAIN_ID } from "./bscClient";

/**
 * ERC-8183 quote handling — the seller-facing half of a paid hire.
 *
 * ---------------------------------------------------------------------------
 * DECISION (2026-08-31): paid hires settle over ERC-8183, not x402.
 * ---------------------------------------------------------------------------
 * The session brief that produced this file assumed x402. Task 0 measured the
 * catalog instead of assuming it, and found x402 has no counterparty here:
 * every service endpoint of all 17 catalog agents was fetched live and NOT ONE
 * answered HTTP 402. What the paid agents actually publish, in their own
 * descriptions and their own agent cards, is ERC-8183 — an on-chain job-escrow
 * kernel denominated in $U, negotiated over A2A.
 *
 * That was confirmed by pulling real wallet-signed quotes from three
 * independent sellers (Brain on BNB, chainhelix, bnb-lp), all of which named
 * the same kernel, the same token and the same chain. Full evidence, including
 * every response body, is in SESSION-LOG-2026-08-31-payments.md §0.4-0.5.
 *
 * TO REVERSE THIS, or to add x402 alongside it: the SDK ships x402 as
 * `client.fetchWithX402` / `signX402Payment` and it works as documented. The
 * only thing missing is a seller. When one appears in the catalog - i.e. when
 * some endpoint here actually returns a 402 - a second rail slots in beside
 * this one. Nothing below assumes it is the only rail; it assumes it is the
 * only rail with a counterparty today.
 *
 * ---------------------------------------------------------------------------
 * DECISION (2026-08-31): the seller is never trusted about who gets paid.
 * ---------------------------------------------------------------------------
 * A quote arrives over HTTP from a third party and names the address that
 * receives the money. Taking that at face value would mean a compromised or
 * dishonest seller endpoint could redirect a user's funds to any address it
 * liked, and Dolphin would render it as the agent's own price.
 *
 * So every quote is checked against what Dolphin independently knows: the
 * agent's registered ERC-8004 wallet, read from the catalog, is passed in and
 * the quote's provider MUST equal it. Verified against real data - Brain on
 * BNB's quote named 0x73809F69...a5963, byte-for-byte the agentWallet
 * listAgents already returns for tokens 302257/302258/304494.
 *
 * The chain is pinned too. A quote naming any chain but the one Dolphin reads
 * is refused rather than followed.
 */

/** How the seller expressed its quote. Both dialects are real and both are live. */
export type QuoteDialect =
  /** Brain on BNB: a flat result object with `instructions` prose. */
  | "instructions"
  /** chainhelix / bnb-lp: an A2A message part carrying a signed envelope. */
  | "signed-envelope";

/**
 * One seller's price, normalized. Every field is READ FROM THE SELLER'S LIVE
 * RESPONSE or from the agent's own record - nothing here is a constant, per
 * this session's ground rule that anything per-agent must be dynamic.
 */
export type NormalizedQuote = {
  dialect: QuoteDialect;
  /** Seller wallet, already checked to equal the agent's registered wallet. */
  provider: string;
  /** Price in the token's atomic units, as a decimal string (never a number). */
  priceRaw: string;
  /** ERC-20 the seller wants. Its decimals/symbol are read on-chain, not assumed. */
  paymentToken: string;
  /** The ERC-8183 kernel the seller says it will look for the job in. */
  verifyingContract: string;
  chainId: number;
  /** Seller's own estimate, when it gives one. Null when it does not. */
  estimatedCompletionSeconds: number | null;
  /** Unix seconds. Null when the seller sets no expiry. */
  quoteExpiresAt: number | null;
  /** Present only in the signed-envelope dialect. Anchored into the job. */
  negotiationHash: string | null;
  providerSignature: string | null;
  /** What the job description should say, so the seller can match it to this quote. */
  taskDescription: string;
  /** The seller's own words about what it will deliver. Shown before paying. */
  deliverables: string | null;
  /** The untouched response, kept so a disagreement is inspectable after the fact. */
  rawResponse: string;
};

/** A decimal string of atomic units, e.g. "100000000000000000". */
function isAtomicAmount(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]+$/.test(value) && value !== "0";
}

/**
 * Parses an address out of a seller's response, tolerating any casing.
 *
 * FOUND BY RUNNING IT, not by reading it: chainhelix returns the same $U token
 * as `0xCe24439F2D9C6a2289f741120FE202248B666666` while bnb-lp returns
 * `0xcE24439F2D9C6a2289F741120FE202248B666666`. Both name the identical 20
 * bytes; they disagree only on EIP-55 checksum casing. viem's `isAddress` is
 * checksum-strict by default and rejected the first outright, which would have
 * made a real, live, correctly-behaving seller permanently unpayable over a
 * capitalisation difference.
 *
 * Lowercasing before `getAddress` loses nothing - an address IS the 20 bytes,
 * and the casing is only a checksum over them - and `getAddress` then re-emits
 * the canonical checksummed form. So every comparison downstream is still made
 * between two canonical addresses, and this is not a weakening of the payee
 * check: it happens before it, and the check itself is unchanged.
 */
function parseAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) return null;
  return getAddress(value.toLowerCase());
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Digs the signed-envelope dialect's payload out of an A2A `message/send`
 * result. Shape observed live from chainhelix and bnb-lp:
 *
 *   result.parts[] -> { kind: "data", data: { response: { terms: {...} },
 *                       negotiation_hash, provider_sig, chain_id,
 *                       verifying_contract } }
 */
function findEnvelopePart(result: Record<string, unknown>): Record<string, unknown> | null {
  const parts = result.parts;
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    const record = asRecord(part);
    const data = record ? asRecord(record.data) : null;
    if (data && asRecord(data.response)) return data;
  }
  return null;
}

export class QuoteRejected extends Error {}

/**
 * Turns whatever a seller answered into one shape, or throws with a reason a
 * person can read. Throwing beats returning a partial quote: a price we could
 * not fully understand is one we must not put a "Pay" button behind.
 */
export function normalizeQuote(
  rpcResult: unknown,
  expected: { agentWallet: string; taskDescription: string },
): NormalizedQuote {
  const rawResponse = JSON.stringify(rpcResult);
  const result = asRecord(rpcResult);
  if (!result) {
    throw new QuoteRejected(
      "The agent's negotiate response was not a JSON object, so no price could be read from it.",
    );
  }

  const envelope = findEnvelopePart(result);
  let dialect: QuoteDialect;
  let priceRaw: unknown;
  let paymentToken: unknown;
  let provider: unknown;
  let verifyingContract: unknown;
  let chainId: unknown;
  let estimated: unknown;
  let expiresAt: unknown;
  let negotiationHash: string | null = null;
  let providerSignature: string | null = null;
  let deliverables: string | null = null;

  if (envelope) {
    dialect = "signed-envelope";
    const response = asRecord(envelope.response) ?? {};
    const terms = asRecord(response.terms) ?? {};
    priceRaw = terms.price;
    // This dialect puts the TOKEN ADDRESS in `currency`, where the other
    // dialect puts a symbol. Same key, different meaning - read per dialect.
    paymentToken = terms.currency;
    verifyingContract = envelope.verifying_contract;
    chainId = envelope.chain_id;
    estimated = response.estimated_completion_seconds;
    expiresAt = response.quote_expires_at;
    negotiationHash = asNonEmptyString(envelope.negotiation_hash);
    providerSignature = asNonEmptyString(envelope.provider_sig);
    deliverables = asNonEmptyString(terms.deliverables);
    // This dialect does not name a provider at all: the seller is identified
    // by the endpoint that signed the quote. Dolphin supplies the agent's own
    // registered wallet, which is the address the check below would compare
    // against anyway - so there is nothing weaker about this path, only less
    // said twice.
    provider = expected.agentWallet;
  } else {
    dialect = "instructions";
    if (result.accepted === false) {
      throw new QuoteRejected(
        "The agent declined to quote for this task. It answered `accepted: false`.",
      );
    }
    priceRaw = result.price;
    paymentToken = result.payment_token;
    provider = result.provider;
    verifyingContract = result.verifying_contract;
    chainId = result.chain_id;
    estimated = result.estimated_completion_seconds;
    expiresAt = result.quote_expires_at;
    deliverables = asNonEmptyString(result.deliverables);
  }

  if (!isAtomicAmount(priceRaw)) {
    throw new QuoteRejected(
      `The agent quoted a price Dolphin cannot read as atomic token units: ${JSON.stringify(priceRaw)}. ` +
        "A price is only honoured when it arrives as an exact integer amount.",
    );
  }
  const parsedToken = parseAddress(paymentToken);
  if (parsedToken === null) {
    throw new QuoteRejected(
      `The agent did not name a payment token address (got ${JSON.stringify(paymentToken)}). ` +
        "Dolphin will not guess which token a price is denominated in.",
    );
  }
  const parsedEscrow = parseAddress(verifyingContract);
  if (parsedEscrow === null) {
    throw new QuoteRejected(
      "The agent did not name the ERC-8183 escrow contract its job would live in.",
    );
  }
  const parsedProvider = parseAddress(provider);
  if (parsedProvider === null) {
    throw new QuoteRejected("The agent did not name a valid provider address to pay.");
  }

  const quotedChain = asFiniteNumber(chainId);
  if (quotedChain !== BSC_CHAIN_ID) {
    throw new QuoteRejected(
      `The agent quoted on chain ${String(chainId)}, but Dolphin's wallet and catalog are on ` +
        `chain ${BSC_CHAIN_ID}. Paying across chains is not something this flow can honestly do.`,
    );
  }

  // The check the whole trust model rests on. See the decision comment above.
  // Both sides are canonical checksummed addresses by this point, so this is a
  // comparison of 20 bytes against 20 bytes, not of two strings that happen to
  // be spelled the same way.
  const expectedWallet = parseAddress(expected.agentWallet);
  if (expectedWallet === null) {
    throw new QuoteRejected(
      "Dolphin holds no valid registered wallet for this agent, so it cannot check who a payment " +
        "would go to. Refusing to quote a price it could not verify the payee for.",
    );
  }
  if (parsedProvider !== expectedWallet) {
    throw new QuoteRejected(
      `The agent's endpoint asked to be paid at ${parsedProvider}, but this agent's ` +
        `registered ERC-8004 wallet is ${expectedWallet}. Dolphin refuses to ` +
        "pay an address the agent's own on-chain identity does not vouch for.",
    );
  }

  return {
    dialect,
    provider: parsedProvider,
    priceRaw,
    paymentToken: parsedToken,
    verifyingContract: parsedEscrow,
    chainId: quotedChain,
    estimatedCompletionSeconds: asFiniteNumber(estimated),
    quoteExpiresAt: asFiniteNumber(expiresAt),
    negotiationHash,
    providerSignature,
    taskDescription: expected.taskDescription,
    deliverables,
    rawResponse,
  };
}

/**
 * The A2A JSON-RPC envelope both dialects speak. `message/send` with one data
 * part is what every seller card in this catalog documents.
 */
export function buildA2ARequest(data: Record<string, unknown>) {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "message/send",
    params: {
      message: {
        role: "user",
        messageId: `dolphin-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        parts: [{ kind: "data", data }],
      },
    },
  };
}

/**
 * Picks the endpoint to negotiate against from the agent's own published
 * services. Prefers A2A, which is the transport every ERC-8183 seller card in
 * this catalog names; falls back to nothing rather than guessing at an MCP or
 * web URL, which speak a different protocol entirely.
 *
 * `{agentId}` templating appears in some 8004scan-published endpoints (the
 * termix.live ones). An un-substituted template is not a URL Dolphin can call,
 * so it is treated as no endpoint rather than fetched literally.
 */
export function selectNegotiationEndpoint(
  services: readonly { name: string; endpoint: string }[],
): string | null {
  for (const service of services) {
    if (service.name !== "a2a") continue;
    if (service.endpoint.includes("{")) continue;
    // A card URL is the discovery document, not the JSON-RPC endpoint. The
    // sellers here serve RPC at the card's directory.
    return service.endpoint.replace(/\/\.well-known\/agent-card\.json$/, "/");
  }
  return null;
}
