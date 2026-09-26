import {
  concatHex,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  numberToHex,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { PANCAKE_V3_QUOTER_V2, PANCAKE_V3_SWAP_ROUTER, WBNB_BSC } from "./pancakeswap-bnb-swap";

/**
 * A SWAP FROM THE CHAT'S TRADE TICKET. (2026-09-26)
 *
 * "buy 50 U of CAKE" becomes a ticket (convex/trade.ts). This module prices it
 * on PancakeSwap and builds the calls the Dolphin Wallet signs. Exact-input
 * only: the person says what they spend.
 *
 * ---------------------------------------------------------------------------
 * ROUTES, ALL QUOTED, BEST ONE WINS
 * ---------------------------------------------------------------------------
 * - V3 direct, at each fee tier (0.01 / 0.05 / 0.25 / 1%)
 * - V3 through WBNB, at 0.05 / 0.25 / 1% on each leg
 * - V2 direct, and V2 through WBNB
 * A new token usually has only a V2 pool, a blue chip usually trades best on
 * V3, and nothing in between is worth guessing about when the quoter can be
 * asked. A route that fails to quote simply is not offered.
 *
 * V2 swaps use the `SupportingFeeOnTransferTokens` functions. They take a
 * minimum out and return nothing, so they work for ordinary tokens and for the
 * taxed tokens common among new launches, where the plain functions revert.
 *
 * ---------------------------------------------------------------------------
 * ADDRESSES (AGENTS.md §9)
 * ---------------------------------------------------------------------------
 * The V3 router, QuoterV2 and WBNB are the ones pancakeswap-bnb-swap.ts
 * already verified. The V2 router is PancakeSwap's documented BSC router
 * (developer.pancakeswap.finance/contracts/v2/addresses, read 2026-09-26), and
 * the chain confirms it: its factory() is 0xcA14…0c73 (PancakeSwap's
 * documented V2 factory) and its WETH() is WBNB. Confidence: high.
 */
export const PANCAKE_V2_ROUTER: Address = "0x10ED43C718714eb63d5aA57B78B54704E256024E";

const V3_FEES = [100, 500, 2500, 10000] as const;
const V3_HOP_FEES = [500, 2500, 10000] as const;

/** 1%. Shown on the ticket; the minimum received is computed from it. */
export const TRADE_SLIPPAGE_BPS = 100;
export const TRADE_DEADLINE_SECONDS = 5 * 60;

/** One side of a ticket. `address` null is native BNB. */
export type TradeSide = { address: string | null; symbol: string; decimals: number };

export type TradeRoute = {
  venue: "v3" | "v2";
  /** Token addresses in order, WBNB standing in for BNB. */
  path: Address[];
  /** V3 only: the fee tier of each leg. */
  fees: number[];
  amountInRaw: bigint;
  amountOutRaw: bigint;
};

const QUOTER_ABI = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
  "function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
]);

const V2_ROUTER_ABI = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
  "function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable",
  "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
]);

/*
 * PancakeSwap's v3 SwapRouter (the one at PANCAKE_V3_SWAP_ROUTER) is the
 * original periphery shape: ExactInputParams carries a deadline. The existing
 * BNB conversion already calls exactOutputSingle with a deadline on it.
 */
const V3_ROUTER_ABI = parseAbi([
  "function exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
  "function refundETH() payable",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
]);

function onChain(side: TradeSide): Address {
  return side.address ? getAddress(side.address) : WBNB_BSC;
}

/** V3's packed path: token (20 bytes), fee (3 bytes), token, ... */
export function encodeV3Path(tokens: readonly Address[], fees: readonly number[]): Hex {
  if (tokens.length !== fees.length + 1 || tokens.length < 2) {
    throw new Error("A V3 path needs one more token than fees.");
  }
  const parts: Hex[] = [];
  tokens.forEach((token, index) => {
    parts.push(getAddress(token).toLowerCase() as Hex);
    if (index < fees.length) parts.push(numberToHex(fees[index], { size: 3 }));
  });
  return concatHex(parts);
}

/** The least the swap may return: the quote less the slippage allowance, rounded down. */
export function minimumOut(amountOutRaw: bigint, slippageBps: number = TRADE_SLIPPAGE_BPS): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 5_000) {
    throw new Error("Slippage must be between 0 and 50%.");
  }
  return (amountOutRaw * BigInt(10_000 - slippageBps)) / BigInt(10_000);
}

/**
 * Every route PancakeSwap will price for this swap, best first. Empty when no
 * pool can take it, which the ticket says in words.
 */
export async function quoteTrade({
  publicClient,
  tokenIn,
  tokenOut,
  amountInRaw,
}: {
  publicClient: PublicClient;
  tokenIn: TradeSide;
  tokenOut: TradeSide;
  amountInRaw: bigint;
}): Promise<TradeRoute[]> {
  if (amountInRaw <= BigInt(0)) return [];
  const a = onChain(tokenIn);
  const b = onChain(tokenOut);
  if (a === b) return [];

  const attempts: Array<Promise<TradeRoute>> = [];

  for (const fee of V3_FEES) {
    attempts.push(
      publicClient
        .simulateContract({
          address: PANCAKE_V3_QUOTER_V2,
          abi: QUOTER_ABI,
          functionName: "quoteExactInputSingle",
          args: [{ tokenIn: a, tokenOut: b, amountIn: amountInRaw, fee, sqrtPriceLimitX96: BigInt(0) }],
        })
        .then(({ result }) => ({ venue: "v3", path: [a, b], fees: [fee], amountInRaw, amountOutRaw: result[0] })),
    );
  }

  const hops = a !== WBNB_BSC && b !== WBNB_BSC;
  if (hops) {
    for (const first of V3_HOP_FEES) {
      for (const second of V3_HOP_FEES) {
        const path = [a, WBNB_BSC, b];
        attempts.push(
          publicClient
            .simulateContract({
              address: PANCAKE_V3_QUOTER_V2,
              abi: QUOTER_ABI,
              functionName: "quoteExactInput",
              args: [encodeV3Path(path, [first, second]), amountInRaw],
            })
            .then(({ result }) => ({ venue: "v3", path, fees: [first, second], amountInRaw, amountOutRaw: result[0] })),
        );
      }
    }
  }

  for (const path of hops ? [[a, b], [a, WBNB_BSC, b]] : [[a, b]]) {
    attempts.push(
      publicClient
        .readContract({ address: PANCAKE_V2_ROUTER, abi: V2_ROUTER_ABI, functionName: "getAmountsOut", args: [amountInRaw, path] })
        .then((amounts) => ({
          venue: "v2",
          path,
          fees: [],
          amountInRaw,
          amountOutRaw: amounts[amounts.length - 1],
        })),
    );
  }

  const settled = await Promise.allSettled(attempts);
  return settled
    .filter((entry): entry is PromiseFulfilledResult<TradeRoute> => entry.status === "fulfilled")
    .map((entry) => entry.value)
    .filter((route) => route.amountOutRaw > BigInt(0))
    .sort((x, y) => (x.amountOutRaw > y.amountOutRaw ? -1 : x.amountOutRaw < y.amountOutRaw ? 1 : 0));
}

/** How a route reads on the ticket: "PancakeSwap v3 · 0.25% pool" or "PancakeSwap v2 via WBNB". */
export function describeRoute(route: TradeRoute): string {
  const via = route.path.length > 2 ? " via WBNB" : "";
  if (route.venue === "v2") return `PancakeSwap v2${via}`;
  const fees = route.fees.map((fee) => `${fee / 10_000}%`).join(" + ");
  return `PancakeSwap v3${via} · ${fees} ${route.fees.length > 1 ? "pools" : "pool"}`;
}

export type TradeCall = { to: Address; data: Hex; value?: bigint };

/**
 * The calls the Dolphin Wallet signs, in order, as one atomic batch.
 *
 * A token being sold is approved for EXACTLY the amount sold, to exactly the
 * router being used - never an unlimited allowance, which would outlive the
 * trade. Native BNB needs no approval: it rides as the call's value.
 */
export function buildTradeCalls({
  route,
  tokenIn,
  tokenOut,
  recipient,
  slippageBps = TRADE_SLIPPAGE_BPS,
  nowSeconds = Math.floor(Date.now() / 1000),
}: {
  route: TradeRoute;
  tokenIn: TradeSide;
  tokenOut: TradeSide;
  recipient: Address;
  slippageBps?: number;
  nowSeconds?: number;
}): TradeCall[] {
  const to = getAddress(recipient);
  const deadline = BigInt(nowSeconds + TRADE_DEADLINE_SECONDS);
  const minOut = minimumOut(route.amountOutRaw, slippageBps);
  const nativeIn = tokenIn.address === null;
  const nativeOut = tokenOut.address === null;
  const router = route.venue === "v2" ? PANCAKE_V2_ROUTER : PANCAKE_V3_SWAP_ROUTER;

  const calls: TradeCall[] = [];
  if (!nativeIn) {
    calls.push({
      to: getAddress(tokenIn.address as string),
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [router, route.amountInRaw] }),
    });
  }

  if (route.venue === "v2") {
    if (nativeIn) {
      calls.push({
        to: router,
        value: route.amountInRaw,
        data: encodeFunctionData({
          abi: V2_ROUTER_ABI,
          functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens",
          args: [minOut, route.path, to, deadline],
        }),
      });
    } else {
      calls.push({
        to: router,
        data: encodeFunctionData({
          abi: V2_ROUTER_ABI,
          functionName: nativeOut
            ? "swapExactTokensForETHSupportingFeeOnTransferTokens"
            : "swapExactTokensForTokensSupportingFeeOnTransferTokens",
          args: [route.amountInRaw, minOut, route.path, to, deadline],
        }),
      });
    }
    return calls;
  }

  /*
   * V3. Selling for native BNB: the router receives the WBNB itself, then
   * unwraps it to the wallet with the same minimum, in one multicall. Buying
   * with native BNB: the value is wrapped by the router; refundETH returns any
   * dust, harmless on an exact-input swap.
   */
  const exactInput = encodeFunctionData({
    abi: V3_ROUTER_ABI,
    functionName: "exactInput",
    args: [
      {
        path: encodeV3Path(route.path, route.fees),
        recipient: nativeOut ? router : to,
        deadline,
        amountIn: route.amountInRaw,
        amountOutMinimum: minOut,
      },
    ],
  });
  const inner: Hex[] = [exactInput];
  if (nativeOut) {
    inner.push(encodeFunctionData({ abi: V3_ROUTER_ABI, functionName: "unwrapWETH9", args: [minOut, to] }));
  }
  if (nativeIn) inner.push(encodeFunctionData({ abi: V3_ROUTER_ABI, functionName: "refundETH", args: [] }));

  calls.push({
    to: router,
    ...(nativeIn ? { value: route.amountInRaw } : {}),
    data: encodeFunctionData({ abi: V3_ROUTER_ABI, functionName: "multicall", args: [inner] }),
  });
  return calls;
}

/**
 * Refuses a batch that does anything but this trade. Checked again inside the
 * wallet before signing, so a bug upstream cannot turn the Sign button into
 * something else: only the two PancakeSwap routers, and an approval of the
 * token being sold to one of them.
 */
export function assertTradeCallsAllowed(calls: readonly TradeCall[], tokenIn: TradeSide): void {
  const routers = new Set<string>([PANCAKE_V2_ROUTER, PANCAKE_V3_SWAP_ROUTER]);
  if (calls.length === 0 || calls.length > 2) throw new Error("A trade is one swap, plus one approval at most.");
  for (const call of calls) {
    const target = getAddress(call.to);
    if (routers.has(target)) continue;
    const isApproval =
      tokenIn.address !== null &&
      target === getAddress(tokenIn.address) &&
      call.data.startsWith("0x095ea7b3") &&
      !call.value;
    if (!isApproval) throw new Error("This trade tried to call a contract other than PancakeSwap. Nothing was signed.");
    const spender = getAddress(`0x${call.data.slice(34, 74)}`);
    if (!routers.has(spender)) throw new Error("This trade tried to approve something other than PancakeSwap. Nothing was signed.");
  }
}
