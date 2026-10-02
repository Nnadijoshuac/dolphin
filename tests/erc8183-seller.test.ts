/**
 * A built agent as an ERC-8183 seller (convex/lib/erc8183Seller.ts). Run from
 * the repo root:
 *
 *   npx tsx --test tests/erc8183-seller.test.ts
 *
 * The anchor of these tests is a REAL delivered job: #56872 on the BSC kernel,
 * sold by recurringmonitoringserviceagent (0xC97c…C950, built with BNB Agent
 * Studio), bought by Dolphin on 2026-10-02. If Dolphin's hashing reproduces
 * that seller's negotiation_hash byte for byte, and its signature recovers to
 * that seller, then a quote Dolphin's agents sign verifies the same way.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recoverMessageAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { flatSignedQuote } from "../convex/lib/erc8183";
import {
  KERNEL,
  anchoredNegotiationHash,
  deliverableManifest,
  manifestHash,
  negotiationHash,
  pyJson,
  quoteContent,
  quoteEnvelope,
  sanitizeForClaim,
} from "../convex/lib/erc8183Seller";

/** job.description of #56872, read from the chain. */
const JOB_56872 =
  '{"chain_id":56,"currency":"0xcE24439F2D9C6a2289F741120FE202248B666666","negotiated_at":1790924742,"negotiation_hash":"0xc606e61d207fafc3663b002c6b3d09df87976580fbec2a9a32c6df9f43d01898","price":"100000000000000","provider_sig":"0xd64ef6e8bd9ed285dd3b412ff9033066284938cda888c0fe3aa23bbfcd379099299637f82fcdcacd76bdf126b598fcd1be453c0c6095b6a277155d45ec86ebc71b","quote_expires_at":1790925642,"task":"Report the current on-chain activity and notable changes for 0x13450a106568D011D25D8AC222b489B098Df9196 on BNB Chain.","terms":{"deliverables":"Report the current on-chain activity and notable changes for 0x13450a106568D011D25D8AC222b489B098Df9196 on BNB Chain.","quality_standards":"Figures read from BNB Chain at request time, with any disagreement between sources stated rather than resolved silently."},"verifying_contract":"0xEa4DAa3100A767e86FDed867729ae7446476EBA6","version":1}';
const SELLER_56872 = "0xC97cEc6bD1934Ba507F4786047c9bC269639C950";

describe("matches a real BNB Agent Studio seller", () => {
  const anchored = JSON.parse(JOB_56872);

  it("reproduces job 56872's negotiation_hash from its own fields", () => {
    const content = quoteContent({
      task: anchored.task,
      deliverables: anchored.terms.deliverables,
      qualityStandards: anchored.terms.quality_standards,
      priceRaw: anchored.price,
      currency: anchored.currency,
      negotiatedAt: anchored.negotiated_at,
    });
    assert.equal(content.quote_expires_at, anchored.quote_expires_at);
    assert.equal(negotiationHash(content), anchored.negotiation_hash);
  });

  it("signs the way that seller signed: EIP-191 over the hash string", async () => {
    assert.equal(await recoverMessageAddress({ message: anchored.negotiation_hash, signature: anchored.provider_sig }), SELLER_56872);
  });

  it("reads the hash a funded job claims", () => {
    assert.equal(anchoredNegotiationHash(JOB_56872), anchored.negotiation_hash);
    assert.equal(anchoredNegotiationHash("plain prose task"), null);
  });
});

describe("our own quotes", () => {
  const input = {
    task: "Rank the yield venues for 0x13450a106568D011D25D8AC222b489B098Df9196 [BSC].",
    deliverables: "A ranked list.",
    qualityStandards: "Figures read from BNB Chain at request time.",
    priceRaw: "10000000000000000",
    currency: "0xcE24439F2D9C6a2289F741120FE202248B666666",
    negotiatedAt: 1_790_000_000,
  };

  it("round-trip through Dolphin's own buyer into the same flat form and hash", async () => {
    const agent = privateKeyToAccount(generatePrivateKey());
    const hash = negotiationHash(quoteContent(input));
    const envelope = quoteEnvelope(input, await agent.signMessage({ message: hash }), agent.address);
    const flat = flatSignedQuote(envelope);
    // The task carries [ ], which the SDK sanitises into the signed content. Dolphin's
    // buyer rebuilds from the raw request text, so it falls back to the nested envelope:
    // the hash is still found by the seller either way.
    const anchored = flat ?? JSON.stringify(envelope);
    assert.equal(anchoredNegotiationHash(anchored), hash);
    assert.equal(await recoverMessageAddress({ message: hash, signature: envelope.provider_sig as `0x${string}` }), agent.address);
  });

  it("produce the flat form Dolphin anchors when the text needs no sanitising", async () => {
    const agent = privateKeyToAccount(generatePrivateKey());
    const plain = { ...input, task: "Rank the yield venues for my wallet." };
    const hash = negotiationHash(quoteContent(plain));
    const flat = flatSignedQuote(quoteEnvelope(plain, await agent.signMessage({ message: hash }), agent.address));
    assert.ok(flat, "Dolphin's buyer accepts the envelope and lays it out flat");
    assert.equal(JSON.parse(flat as string).negotiation_hash, hash);
    assert.equal(JSON.parse(flat as string).verifying_contract, KERNEL);
  });
});

describe("canonical JSON", () => {
  it("escapes non-ASCII like Python's json.dumps", () => {
    assert.equal(pyJson({ b: "é", a: "币" }), '{"a":"\\u5e01","b":"\\u00e9"}');
  });
  it("sanitises claims like the SDK", () => {
    assert.equal(sanitizeForClaim("a[b]\u0001c\td\n"), "a(b)c\td\n");
  });
  it("hashes the deliverable manifest deterministically", () => {
    const one = manifestHash(deliverableManifest(7, "result"));
    assert.equal(one, manifestHash(deliverableManifest(7, "result")));
    assert.notEqual(one, manifestHash(deliverableManifest(8, "result")));
  });
});
