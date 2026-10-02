/**
 * x402 payments for agents built on Dolphin (convex/lib/x402.ts). Run from the
 * repo root:
 *
 *   npx tsx --test tests/x402.test.ts
 *
 * Payments are signed here with a throwaway key over U's real EIP-712 domain
 * (measured 2026-10-02), base64-encoded the way the Altana SDK's
 * encodeXPaymentHeader does, then pushed through decodePayment.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress, type Hex } from "viem";

import {
  PaymentRejected,
  U_EIP712,
  U_TOKEN,
  X402_CHAIN_ID,
  decodePayment,
  formatU,
  parsePriceU,
  paymentChallenge,
  priceInBounds,
  textToBase64,
} from "../convex/lib/x402";

const BUILDER = "0x442b37739E704094337C68977843E5DBE2a5d298";
const PRICE = "10000000000000000"; // 0.01 U
const NOW = 1_790_000_000;

const TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

async function signedHeader(over: Partial<{ to: string; value: string; validAfter: string; validBefore: string; network: string }> = {}) {
  const account = privateKeyToAccount(generatePrivateKey());
  const message = {
    from: account.address,
    to: (over.to ?? BUILDER) as `0x${string}`,
    value: BigInt(over.value ?? PRICE),
    validAfter: BigInt(over.validAfter ?? "0"),
    validBefore: BigInt(over.validBefore ?? String(NOW + 600)),
    nonce: `0x${"ab".repeat(32)}` as Hex,
  };
  const signature = await account.signTypedData({
    domain: { ...U_EIP712, chainId: X402_CHAIN_ID, verifyingContract: U_TOKEN },
    types: TYPES,
    primaryType: "TransferWithAuthorization",
    message,
  });
  const payload = {
    x402Version: 2,
    scheme: "exact",
    network: over.network ?? "eip155:56",
    accepted: { scheme: "exact", network: "eip155:56", asset: U_TOKEN, payTo: BUILDER, amount: PRICE },
    payload: {
      signature,
      authorization: { ...message, value: message.value.toString(), validAfter: message.validAfter.toString(), validBefore: message.validBefore.toString() },
    },
  };
  return { header: textToBase64(JSON.stringify(payload)), account, message, signature };
}

const expect = { priceRaw: PRICE, payTo: BUILDER, nowSeconds: NOW };

describe("prices", () => {
  it("reads decimal U into base units and back", () => {
    assert.equal(parsePriceU("0.01"), BigInt(PRICE));
    assert.equal(parsePriceU("1"), BigInt("1000000000000000000"));
    assert.equal(formatU(PRICE), "0.01");
    assert.equal(formatU("1500000000000000000"), "1.5");
  });
  it("refuses anything that is not a plain decimal", () => {
    for (const bad of ["", "-1", "1e3", "0x10", "1.0000000000000000001", "abc", " "]) assert.equal(parsePriceU(bad), null, bad);
  });
  it("keeps prices inside 0.001 to 1000 U", () => {
    assert.equal(priceInBounds(parsePriceU("0.001") as bigint), true);
    assert.equal(priceInBounds(parsePriceU("0.0009") as bigint), false);
    assert.equal(priceInBounds(parsePriceU("1000.5") as bigint), false);
  });
});

describe("the 402 challenge", () => {
  it("names U, its EIP-712 domain and the builder as payee", () => {
    const body = paymentChallenge({ priceRaw: PRICE, payTo: BUILDER.toLowerCase(), resourceUrl: "https://x/mcp", description: "d" });
    const [req] = body.accepts;
    assert.equal(body.x402Version, 2);
    assert.equal(req.asset, U_TOKEN);
    assert.equal(req.payTo, BUILDER);
    assert.equal(req.amount, PRICE);
    assert.equal(req.network, "eip155:56");
    assert.deepEqual([req.extra.name, req.extra.version, req.extra.assetTransferMethod], ["United Stables", "1", "eip3009"]);
  });
});

describe("decodePayment", () => {
  it("accepts a correctly signed payment and keeps the signer's address", async () => {
    const { header, account, signature } = await signedHeader();
    const decoded = decodePayment(header, expect);
    assert.equal(decoded.authorization.from, account.address);
    assert.equal(decoded.authorization.value, BigInt(PRICE));
    assert.equal(decoded.signature, signature);
    // The signature really is over U's domain: it recovers to the payer.
    const recovered = await recoverTypedDataAddress({
      domain: { ...U_EIP712, chainId: X402_CHAIN_ID, verifyingContract: U_TOKEN },
      types: TYPES,
      primaryType: "TransferWithAuthorization",
      message: decoded.authorization,
      signature: decoded.signature,
    });
    assert.equal(recovered, account.address);
  });

  const refusals: Array<[string, Parameters<typeof signedHeader>[0], RegExp]> = [
    ["pays someone else", { to: "0x0000000000000000000000000000000000000001" }, /wrong wallet/],
    ["pays too little", { value: "9999999999999999" }, /costs 0.01 U/],
    ["pays too much", { value: "20000000000000000" }, /exactly 0.01 U/],
    ["is not valid yet", { validAfter: String(NOW + 60) }, /not valid yet/],
    ["is about to expire", { validBefore: String(NOW + 10) }, /expired/],
    ["is valid for days", { validBefore: String(NOW + 864_000) }, /too long/],
    ["is on another chain", { network: "eip155:1" }, /BNB Chain/],
  ];
  for (const [label, over, message] of refusals) {
    it(`refuses a payment that ${label}`, async () => {
      const { header } = await signedHeader(over);
      assert.throws(() => decodePayment(header, expect), (error: unknown) => error instanceof PaymentRejected && message.test(error.message));
    });
  }

  it("refuses garbage headers without throwing anything else", () => {
    for (const bad of ["", "not base64 !!", textToBase64("[]"), textToBase64('{"scheme":"exact","network":"eip155:56"}')]) {
      assert.throws(() => decodePayment(bad, expect), PaymentRejected);
    }
  });
});
