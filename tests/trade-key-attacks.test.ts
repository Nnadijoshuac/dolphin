/**
 * THE ATTACKS THE MENTOR REVIEW NAMED (2026-09-29), each tried against what
 * Dolphin grants and what it signs. Run from the repo root:
 *
 *   npx tsx --test tests/trade-key-attacks.test.ts
 *
 * Two layers are tested:
 *   1. The on-chain policy a trade key is granted (lib/tradeKeyPolicy.ts) -
 *      what the Altana wallet contract itself will refuse.
 *   2. The argument checks Dolphin runs before signing
 *      (assertTradeCallsAllowed) - the chain cannot see arguments, so these
 *      are the backstop for recipient and minimum output until the swap guard
 *      contract is deployed.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeFunctionData, getAddress, parseAbi, parseUnits, type Address } from "viem";

import {
  assertTradeCallsAllowed,
  buildTradeCalls,
  encodeV3Path,
  PANCAKE_V2_ROUTER,
  PANCAKE_V3_SWAP_ROUTER,
  WBNB_BSC,
  type TradeRoute,
} from "../convex/lib/pancakeswapTrade";
import { SESSION_SWAP_SIGNATURES, tradeKeyPolicy } from "../convex/lib/tradeKeyPolicy";
import { verifiedTokens } from "../convex/lib/tradeTokens";

const WALLET = getAddress("0x1111111111111111111111111111111111111111");
const ATTACKER = getAddress("0xbad0000000000000000000000000000000000bad");
const USDT = getAddress("0x55d398326f99059fF775485246999027B3197955");
const CAKE = getAddress("0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82");
const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

const V2 = parseAbi([
  "function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable",
]);
const V3 = parseAbi([
  "function exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
  "function sweepToken(address token, uint256 amountMinimum, address recipient) payable",
]);

const usdtIn = { address: USDT as string, symbol: "USDT", decimals: 18 };
const cakeOut = { address: CAKE as string, symbol: "CAKE", decimals: 18 };

function policy() {
  return tradeKeyPolicy({
    dailyUsd: 10,
    durationDays: 7,
    bnbPriceUsd: 600,
    tokens: verifiedTokens(),
    priceOf: (token) => (["USDT", "USDC", "U"].includes(token.symbol) ? 1 : token.symbol === "XVS" ? null : 5),
  });
}

describe("the on-chain policy a trade key is granted", () => {
  it("grants only the three V2 swap functions - no approve(), no V3, never a bare target", () => {
    const { calls } = policy();
    assert.equal(calls.length, 3);
    for (const call of calls) {
      assert.equal(getAddress(call.to), PANCAKE_V2_ROUTER);
      assert.ok(call.signature, "a call without a signature would allow every function on the router");
      assert.ok((SESSION_SWAP_SIGNATURES as readonly string[]).includes(call.signature!));
    }
    assert.ok(!calls.some((call) => call.signature?.startsWith("approve")), "the key must not approve anything");
    assert.ok(!calls.some((call) => getAddress(call.to) === PANCAKE_V3_SWAP_ROUTER), "V3 multicall could carry any inner call");
  });

  it("sets allowances only to the V2 router, capped at daily limit x days", () => {
    const { approvals } = policy();
    assert.ok(approvals.length > 0);
    for (const approval of approvals) assert.equal(getAddress(approval.spender), PANCAKE_V2_ROUTER);
    const usdt = approvals.find((approval) => approval.symbol === "USDT")!;
    assert.equal(usdt.amount, parseUnits("87.5", 18).toString(), "$10 a day x 7 days at $1, x1.25 room to sell after a price move");
  });

  it("leaves room to sell a full day's buys after a price move, plus gas in BNB (BNB Pulse, 2026-10-04)", () => {
    const { spend } = policy();
    const native = spend.find((cap) => !cap.token)!;
    // $10 a day: what a day of rules can buy, sold back 20% higher, still fits, with gas on top.
    const boughtBnb = 10 / 600;
    assert.ok(BigInt(native.limit) > parseUnits((boughtBnb * 1.2).toFixed(18), 18) + BigInt(30_000_000_000_000));
  });

  it("leaves out a token it cannot price, rather than leaving it uncapped", () => {
    const { approvals, spend } = policy();
    const xvs = verifiedTokens().find((token) => token.symbol === "XVS")!;
    assert.ok(!approvals.some((approval) => approval.symbol === "XVS"));
    assert.ok(!spend.some((cap) => cap.token && getAddress(cap.token) === getAddress(xvs.address!)));
  });

  it("caps BNB and every token it allows, per day", () => {
    const { spend, approvals } = policy();
    assert.ok(spend.some((cap) => !cap.token), "native BNB must have a daily cap");
    for (const approval of approvals) {
      assert.ok(spend.some((cap) => cap.token && getAddress(cap.token) === getAddress(approval.token)), `${approval.symbol} has no daily cap`);
    }
  });
});

describe("the argument checks before signing (the chain cannot see arguments)", () => {
  it("ATTACK: a V2 swap that sends the proceeds to another address is refused", () => {
    const data = encodeFunctionData({ abi: V2, functionName: "swapExactTokensForTokensSupportingFeeOnTransferTokens", args: [BigInt(1e18), BigInt(1), [USDT, CAKE], ATTACKER, deadline] });
    assert.throws(() => assertTradeCallsAllowed([{ to: PANCAKE_V2_ROUTER, data }], usdtIn, WALLET), /another address/);
  });

  it("ATTACK: a BNB-in V2 swap to another address is refused", () => {
    const data = encodeFunctionData({ abi: V2, functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens", args: [BigInt(1), [WBNB_BSC, CAKE], ATTACKER, deadline] });
    assert.throws(() => assertTradeCallsAllowed([{ to: PANCAKE_V2_ROUTER, data, value: BigInt(1e16) }], { address: null, symbol: "BNB", decimals: 18 }, WALLET), /another address/);
  });

  it("ATTACK: a zero minimum output (a self-sandwich) is refused", () => {
    const data = encodeFunctionData({ abi: V2, functionName: "swapExactTokensForTokensSupportingFeeOnTransferTokens", args: [BigInt(1e18), BigInt(0), [USDT, CAKE], WALLET, deadline] });
    assert.throws(() => assertTradeCallsAllowed([{ to: PANCAKE_V2_ROUTER, data }], usdtIn, WALLET), /minimum output/);
  });

  it("ATTACK: a V3 exactInput to another address is refused", () => {
    const data = encodeFunctionData({
      abi: V3,
      functionName: "exactInput",
      args: [{ path: encodeV3Path([USDT, CAKE], [2500]), recipient: ATTACKER, deadline, amountIn: BigInt(1e18), amountOutMinimum: BigInt(1) }],
    });
    assert.throws(() => assertTradeCallsAllowed([{ to: PANCAKE_V3_SWAP_ROUTER, data }], usdtIn, WALLET), /another address/);
  });

  it("ATTACK: a V3 multicall that unwraps BNB to another address is refused", () => {
    const swap = encodeFunctionData({
      abi: V3,
      functionName: "exactInput",
      args: [{ path: encodeV3Path([USDT, WBNB_BSC], [500]), recipient: PANCAKE_V3_SWAP_ROUTER, deadline, amountIn: BigInt(1e18), amountOutMinimum: BigInt(1) }],
    });
    const unwrap = encodeFunctionData({ abi: V3, functionName: "unwrapWETH9", args: [BigInt(1), ATTACKER] });
    const data = encodeFunctionData({ abi: V3, functionName: "multicall", args: [[swap, unwrap]] });
    assert.throws(() => assertTradeCallsAllowed([{ to: PANCAKE_V3_SWAP_ROUTER, data }], usdtIn, WALLET), /another address/);
  });

  it("ATTACK: a V3 multicall smuggling sweepToken is refused", () => {
    const sweep = encodeFunctionData({ abi: V3, functionName: "sweepToken", args: [CAKE, BigInt(0), ATTACKER] });
    const data = encodeFunctionData({ abi: V3, functionName: "multicall", args: [[sweep]] });
    assert.throws(() => assertTradeCallsAllowed([{ to: PANCAKE_V3_SWAP_ROUTER, data }], usdtIn, WALLET), /does not use/);
  });

  it("ATTACK: approving an attacker as spender is refused", () => {
    const data = encodeFunctionData({ abi: parseAbi(["function approve(address spender, uint256 amount)"]), functionName: "approve", args: [ATTACKER, BigInt(2) ** BigInt(255)] });
    assert.throws(() => assertTradeCallsAllowed([{ to: USDT, data }], usdtIn, WALLET), /approve something other than PancakeSwap/);
  });

  it("a real trade built by Dolphin still passes, V2 and V3, BNB in and out", () => {
    const routes: Array<[TradeRoute, { address: string | null; symbol: string; decimals: number }, { address: string | null; symbol: string; decimals: number }]> = [
      [{ venue: "v2", path: [USDT, CAKE], fees: [], amountInRaw: BigInt(1e18), amountOutRaw: BigInt(3e17) }, usdtIn, cakeOut],
      [{ venue: "v2", path: [WBNB_BSC, CAKE], fees: [], amountInRaw: BigInt(1e16), amountOutRaw: BigInt(2e18) }, { address: null, symbol: "BNB", decimals: 18 }, cakeOut],
      [{ venue: "v3", path: [USDT, WBNB_BSC], fees: [500], amountInRaw: BigInt(1e18), amountOutRaw: BigInt(1e15) }, usdtIn, { address: null, symbol: "BNB", decimals: 18 }],
      [{ venue: "v3", path: [USDT, CAKE], fees: [2500], amountInRaw: BigInt(1e18), amountOutRaw: BigInt(3e17) }, usdtIn, cakeOut],
    ];
    for (const [route, tokenIn, tokenOut] of routes) {
      const calls = buildTradeCalls({ route, tokenIn, tokenOut, recipient: WALLET as Address });
      assert.doesNotThrow(() => assertTradeCallsAllowed(calls, tokenIn, WALLET), `${route.venue} ${tokenIn.symbol}->${tokenOut.symbol}`);
    }
  });
});
