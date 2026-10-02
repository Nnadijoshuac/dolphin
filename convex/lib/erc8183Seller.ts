/**
 * A BUILT AGENT AS AN ERC-8183 SELLER - the pure part (2026-10-02).
 *
 * Owner, 2026-10-02: an agent built on Dolphin should accept payment the way
 * BNB Chain agents do, so any buyer - Dolphin's Hire button, BNB Agent Studio,
 * another marketplace - can hire it. ERC-8183 is the escrow BNB Agent Studio
 * runs on BSC (kernel 0xEa4D…EBA6); the formats here are copied from BNB
 * Chain's own reference seller, github.com/bnb-chain/bnbagent-sdk
 * (python/bnbagent/erc8183/negotiation.py, schema.py), and checked against a
 * real delivered job (#56872) in tests/erc8183-seller.test.ts.
 *
 *   negotiate   -> a quote signed by the agent's wallet (EIP-191 over the
 *                  negotiation_hash string), returned as the SDK's nested
 *                  envelope {request, request_hash, response, response_hash,
 *                  negotiation_hash, provider_sig, chain_id, verifying_contract}
 *   funded job  -> the buyer anchors the signed quote in job.description
 *   deliver     -> submit(jobId, keccak(manifest), {"deliverable_url"})
 *   collect     -> router.settle after the policy's dispute window
 */

import { getAddress, keccak256, toHex } from "viem";

export const KERNEL = getAddress("0xEa4DAa3100A767e86FDed867729ae7446476EBA6");
export const ROUTER = getAddress("0x51895229E12F9876011789B04f8698af06cCD6DA");
export const POLICY = getAddress("0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5");
export const SELLER_CHAIN_ID = 56;
/** The SDK's MAX_QUOTE_TTL_SECONDS: a signed quote is never valid longer. */
export const QUOTE_TTL_SECONDS = 900;
/** The SDK's MAX_DESCRIPTION_BYTES: the anchored quote must fit job.description. */
export const MAX_DESCRIPTION_BYTES = 4096;

/** The skills a seller answers. "negotiate" and "notify_funded" are what Dolphin's own Hire button sends. */
export const NEGOTIATE_SKILLS = new Set(["negotiate", "negotiate-erc8183-job"]);
export const NOTIFY_SKILLS = new Set(["notify_funded", "notify-funded"]);
export const STATUS_SKILLS = new Set(["erc8183-job-status", "job_status"]);

/**
 * Python's json.dumps(value, sort_keys=True, separators=(",", ":")) - the
 * canonical form every hash in the SDK is taken over. It differs from
 * JSON.stringify in one way that matters: ensure_ascii escapes every
 * character above U+007F as \uXXXX (lowercase hex, surrogate pairs).
 */
export function pyJson(value: unknown): string {
  const sorted = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sorted);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])]));
    }
    return v;
  };
  return JSON.stringify(sorted(value)).replace(/[\u0080-￿]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** The SDK's _sanitize_for_claim: [ ] become ( ), and control characters except tab and newline go. */
export function sanitizeForClaim(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\[/g, "(").replace(/\]/g, ")").replace(/[\u0000-\u0008\u000b-\u001f]/g, "");
}

export type QuoteInput = {
  task: string;
  deliverables: string;
  qualityStandards: string;
  priceRaw: string;
  currency: string;
  negotiatedAt: number;
};

/** The signed content (the flat on-chain description minus hash and signature). */
export function quoteContent(input: QuoteInput) {
  return {
    version: 1,
    negotiated_at: input.negotiatedAt,
    task: sanitizeForClaim(input.task),
    terms: { deliverables: sanitizeForClaim(input.deliverables), quality_standards: sanitizeForClaim(input.qualityStandards) },
    price: input.priceRaw,
    currency: input.currency,
    quote_expires_at: input.negotiatedAt + QUOTE_TTL_SECONDS,
    chain_id: SELLER_CHAIN_ID,
    verifying_contract: KERNEL,
  };
}

export function negotiationHash(content: ReturnType<typeof quoteContent>): `0x${string}` {
  return keccak256(toHex(pyJson(content)));
}

/**
 * The full envelope a buyer receives, as the SDK's NegotiationResult.to_dict()
 * plus provider_address. Dolphin's own buyer (convex/lib/erc8183.ts
 * flatSignedQuote) rebuilds the flat description from exactly these fields.
 */
export function quoteEnvelope(input: QuoteInput, signature: string, provider: string) {
  const content = quoteContent(input);
  const terms = {
    deliverables: input.deliverables,
    quality_standards: input.qualityStandards,
    evaluation_required: true,
    evaluator_type: "uma_oov3",
    price: input.priceRaw,
    currency: input.currency,
  };
  const request = {
    task_description: input.task,
    terms: { deliverables: input.deliverables, quality_standards: input.qualityStandards, evaluation_required: true, evaluator_type: "uma_oov3" },
  };
  const responseCore = { accepted: true, terms, estimated_completion_seconds: 120, quote_expires_at: content.quote_expires_at };
  return {
    request,
    request_hash: keccak256(toHex(pyJson(request))),
    response: { ...responseCore, negotiated_at: input.negotiatedAt },
    response_hash: keccak256(toHex(pyJson(responseCore))),
    negotiation_hash: negotiationHash(content),
    provider_sig: signature,
    chain_id: SELLER_CHAIN_ID,
    verifying_contract: KERNEL,
    provider_address: provider,
  };
}

/** A refusal in the SDK's shape, so any buyer reads why. */
export function quoteRefusal(reasonCode: string, reason: string) {
  return { request: {}, request_hash: "", response: { accepted: false, reason_code: reasonCode, reason }, response_hash: "" };
}

/**
 * The negotiation_hash a funded job claims, from job.description in either
 * form a buyer anchors: the flat signed quote (what Dolphin and Studio
 * anchor) or the nested envelope. Null when there is none.
 */
export function anchoredNegotiationHash(description: string): string | null {
  try {
    const parsed = JSON.parse(description) as { negotiation_hash?: unknown };
    return typeof parsed.negotiation_hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(parsed.negotiation_hash)
      ? parsed.negotiation_hash.toLowerCase()
      : null;
  } catch {
    return null;
  }
}

/** The SDK's DeliverableManifest v1; its keccak over pyJson is the on-chain deliverable. */
export function deliverableManifest(jobId: number, content: string) {
  return {
    version: 1,
    job_id: jobId,
    chain_id: SELLER_CHAIN_ID,
    contracts: { commerce: KERNEL, router: ROUTER, policy: POLICY },
    response: { content, content_type: "text/plain" },
    metadata: { built_with: "Dolphin" },
  };
}

export function manifestHash(manifest: ReturnType<typeof deliverableManifest>): `0x${string}` {
  return keccak256(toHex(pyJson(manifest)));
}
