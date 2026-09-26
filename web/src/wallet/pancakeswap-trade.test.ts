import { decodeFunctionData, encodeFunctionData, erc20Abi, getAddress, parseAbi, type Address } from "viem";
import { describe, expect, it } from "vitest";

import { PANCAKE_V3_SWAP_ROUTER, WBNB_BSC } from "./pancakeswap-bnb-swap";
import {
  PANCAKE_V2_ROUTER,
  assertTradeCallsAllowed,
  buildTradeCalls,
  describeRoute,
  encodeV3Path,
  minimumOut,
  type TradeRoute,
  type TradeSide,
} from "./pancakeswap-trade";

const U: TradeSide = { address: "0xcE24439F2D9C6a2289F741120FE202248B666666", symbol: "U", decimals: 18 };
const CAKE: TradeSide = { address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", symbol: "CAKE", decimals: 18 };
const BNB: TradeSide = { address: null, symbol: "BNB", decimals: 18 };
const WALLET = getAddress("0x17bd000000000000000000000000000000006fff");
const ONE = BigInt(10) ** BigInt(18);

const v3Route = (tokens: Address[], fees: number[]): TradeRoute => ({
  venue: "v3",
  path: tokens,
  fees,
  amountInRaw: BigInt(50) * ONE,
  amountOutRaw: BigInt(20) * ONE,
});

const ROUTER_ABI = parseAbi([
  "function exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
  "function refundETH() payable",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
]);

describe("encodeV3Path", () => {
  it("packs token, 3-byte fee, token", () => {
    const path = encodeV3Path([U.address as Address, CAKE.address as Address], [2500]);
    expect(path).toBe(`0x${"ce24439f2d9c6a2289f741120fe202248b666666"}0009c4${"0e09fabb73bd3ade0a17ecc321fd13a19e81ce82"}`);
  });

  it("refuses a path whose fees do not fit its tokens", () => {
    expect(() => encodeV3Path([WBNB_BSC], [])).toThrow();
    expect(() => encodeV3Path([WBNB_BSC, U.address as Address], [500, 500])).toThrow();
  });
});

describe("minimumOut", () => {
  it("takes the slippage off and rounds down", () => {
    expect(minimumOut(BigInt(1000), 100)).toBe(BigInt(990));
    expect(minimumOut(BigInt(999), 100)).toBe(BigInt(989));
  });

  it("refuses nonsense slippage", () => {
    expect(() => minimumOut(BigInt(1), -1)).toThrow();
    expect(() => minimumOut(BigInt(1), 6000)).toThrow();
  });
});

describe("buildTradeCalls", () => {
  it("token to token on V3: an exact approval, then the swap to the wallet", () => {
    const route = v3Route([U.address as Address, CAKE.address as Address], [2500]);
    const calls = buildTradeCalls({ route, tokenIn: U, tokenOut: CAKE, recipient: WALLET, nowSeconds: 1000 });
    expect(calls).toHaveLength(2);

    const approve = decodeFunctionData({ abi: erc20Abi, data: calls[0].data });
    expect(approve.functionName).toBe("approve");
    expect(approve.args).toEqual([PANCAKE_V3_SWAP_ROUTER, route.amountInRaw]);

    const multicall = decodeFunctionData({ abi: ROUTER_ABI, data: calls[1].data });
    const inner = (multicall.args[0] as readonly `0x${string}`[]).map((data) => decodeFunctionData({ abi: ROUTER_ABI, data }));
    expect(inner.map((call) => call.functionName)).toEqual(["exactInput"]);
    const params = inner[0].args[0] as { recipient: string; amountOutMinimum: bigint; deadline: bigint };
    expect(params.recipient).toBe(WALLET);
    expect(params.amountOutMinimum).toBe(minimumOut(route.amountOutRaw));
    expect(params.deadline).toBe(BigInt(1300));
    expect(calls[1].value).toBeUndefined();
  });

  it("buying with BNB: no approval, the value rides on the call, refundETH after", () => {
    const route = v3Route([WBNB_BSC, CAKE.address as Address], [2500]);
    const calls = buildTradeCalls({ route, tokenIn: BNB, tokenOut: CAKE, recipient: WALLET });
    expect(calls).toHaveLength(1);
    expect(calls[0].value).toBe(route.amountInRaw);
    const multicall = decodeFunctionData({ abi: ROUTER_ABI, data: calls[0].data });
    const names = (multicall.args[0] as readonly `0x${string}`[]).map((data) => decodeFunctionData({ abi: ROUTER_ABI, data }).functionName);
    expect(names).toEqual(["exactInput", "refundETH"]);
  });

  it("selling for BNB on V3: the router receives WBNB and unwraps it to the wallet", () => {
    const route = v3Route([CAKE.address as Address, WBNB_BSC], [2500]);
    const calls = buildTradeCalls({ route, tokenIn: CAKE, tokenOut: BNB, recipient: WALLET });
    const multicall = decodeFunctionData({ abi: ROUTER_ABI, data: calls[1].data });
    const inner = (multicall.args[0] as readonly `0x${string}`[]).map((data) => decodeFunctionData({ abi: ROUTER_ABI, data }));
    expect(inner.map((call) => call.functionName)).toEqual(["exactInput", "unwrapWETH9"]);
    expect((inner[0].args[0] as { recipient: string }).recipient).toBe(PANCAKE_V3_SWAP_ROUTER);
    expect(inner[1].args).toEqual([minimumOut(route.amountOutRaw), WALLET]);
  });

  it("V2 uses the fee-on-transfer-safe functions and approves the V2 router", () => {
    const route: TradeRoute = { ...v3Route([U.address as Address, WBNB_BSC, CAKE.address as Address], []), venue: "v2" };
    const calls = buildTradeCalls({ route, tokenIn: U, tokenOut: CAKE, recipient: WALLET });
    expect(decodeFunctionData({ abi: erc20Abi, data: calls[0].data }).args?.[0]).toBe(PANCAKE_V2_ROUTER);
    expect(calls[1].to).toBe(PANCAKE_V2_ROUTER);
    expect(calls[1].data.startsWith("0x5c11d795")).toBe(true); // swapExactTokensForTokensSupportingFeeOnTransferTokens
    expect(describeRoute(route)).toBe("PancakeSwap v2 via WBNB");
  });
});

describe("assertTradeCallsAllowed", () => {
  const route = v3Route([U.address as Address, CAKE.address as Address], [2500]);

  it("accepts what buildTradeCalls builds", () => {
    const calls = buildTradeCalls({ route, tokenIn: U, tokenOut: CAKE, recipient: WALLET });
    expect(() => assertTradeCallsAllowed(calls, U)).not.toThrow();
  });

  it("refuses a transfer dressed up as part of the trade", () => {
    const transfer = {
      to: U.address as Address,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [WALLET, ONE] }),
    };
    expect(() => assertTradeCallsAllowed([transfer], U)).toThrow();
  });

  it("refuses an approval to anyone but PancakeSwap", () => {
    const approve = {
      to: U.address as Address,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [WALLET, ONE] }),
    };
    expect(() => assertTradeCallsAllowed([approve], U)).toThrow();
  });
});
