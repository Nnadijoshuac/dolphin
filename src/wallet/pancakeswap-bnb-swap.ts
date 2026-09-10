import {
  encodeFunctionData,
  getAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

/**
 * PancakeSwap V3 BNB -> payment-token conversion for paid hires.
 *
 * The user-facing payment rail remains ERC-8183 escrow. This module only
 * acquires the token that ERC-8183 requires, from BNB already held by the
 * Dolphin Wallet, so users do not have to leave Dolphin and perform a manual
 * swap.
 */

/**
 * Official PancakeSwap V3 addresses, verified against the PancakeSwap developer
 * docs page `contracts/v3/addresses` on 2026-09-10:
 * - SwapRouter (v3), BSC: 0x1b81...
 * - QuoterV2, BSC: 0xB048...
 *
 * WBNB was cross-checked against BNB Chain's WBNB explainer and BscScan.
 */
export const PANCAKE_V3_SWAP_ROUTER: Address =
  "0x1b81D678ffb9C0263b24A97847620C99d213eB14";
export const PANCAKE_V3_QUOTER_V2: Address =
  "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997";
export const WBNB_BSC: Address = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";

/** PancakeSwap V3 fee tiers: 0.01%, 0.05%, 0.25%, 1%. */
const PANCAKE_V3_FEES = [100, 500, 2500, 10000] as const;

/** Small enough for tight stable routes, large enough for thin hackathon pools. */
export const DEFAULT_SWAP_SLIPPAGE_BPS = 150;
export const SWAP_DEADLINE_SECONDS = 5 * 60;

type PaymentQuote = Readonly<{
  paymentToken: string;
  paymentTokenSymbol: string;
  paymentTokenDecimals: number;
}>;

export type BnbConversionQuote = Readonly<{
  paymentToken: string;
  paymentTokenSymbol: string;
  paymentTokenDecimals: number;
  tokenShortfallRaw: string;
  requiredBnbWei: string;
  maxBnbWei: string;
  poolFee: number;
  slippageBps: number;
  quoter: Address;
  router: Address;
  gasEstimate: string;
}>;

const QUOTER_V2_ABI = [
  {
    type: "function",
    name: "quoteExactOutputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountIn", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

const SWAP_ROUTER_ABI = [
  {
    type: "function",
    name: "exactOutputSingle",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
          { name: "amountOut", type: "uint256" },
          { name: "amountInMaximum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountIn", type: "uint256" }],
  },
  {
    type: "function",
    name: "refundETH",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "multicall",
    stateMutability: "payable",
    inputs: [{ name: "data", type: "bytes[]" }],
    outputs: [{ name: "results", type: "bytes[]" }],
  },
] as const;

function applySlippage(value: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 1000) {
    throw new Error("Swap slippage must be between 0 and 10%.");
  }
  return (value * BigInt(10_000 + slippageBps) + BigInt(9_999)) / BigInt(10_000);
}

export async function quoteBnbForExactTokenOutput({
  publicClient,
  account,
  quote,
  tokenShortfallRaw,
  slippageBps = DEFAULT_SWAP_SLIPPAGE_BPS,
}: {
  publicClient: PublicClient;
  account: Address;
  quote: PaymentQuote;
  tokenShortfallRaw: bigint;
  slippageBps?: number;
}): Promise<BnbConversionQuote> {
  if (tokenShortfallRaw <= BigInt(0)) {
    throw new Error("No token shortfall remains to convert.");
  }

  const tokenOut = getAddress(quote.paymentToken);
  if (tokenOut === WBNB_BSC) {
    throw new Error("This quote already asks for WBNB, so no PancakeSwap conversion is needed.");
  }

  const attempts = await Promise.allSettled(
    PANCAKE_V3_FEES.map(async (fee) => {
      const simulated = await publicClient.simulateContract({
        account,
        address: PANCAKE_V3_QUOTER_V2,
        abi: QUOTER_V2_ABI,
        functionName: "quoteExactOutputSingle",
        args: [
          {
            tokenIn: WBNB_BSC,
            tokenOut,
            amount: tokenShortfallRaw,
            fee,
            sqrtPriceLimitX96: BigInt(0),
          },
        ],
      });
      const [requiredBnbWei, , , gasEstimate] = simulated.result;
      return {
        fee,
        requiredBnbWei,
        maxBnbWei: applySlippage(requiredBnbWei, slippageBps),
        gasEstimate,
      };
    }),
  );

  const routes = attempts
    .filter((entry): entry is PromiseFulfilledResult<{
      fee: (typeof PANCAKE_V3_FEES)[number];
      requiredBnbWei: bigint;
      maxBnbWei: bigint;
      gasEstimate: bigint;
    }> => entry.status === "fulfilled")
    .map((entry) => entry.value)
    .sort((a, b) =>
      a.requiredBnbWei < b.requiredBnbWei
        ? -1
        : a.requiredBnbWei > b.requiredBnbWei
          ? 1
          : 0,
    );

  const best = routes[0];
  if (!best) {
    throw new Error(
      `PancakeSwap V3 has no direct BNB route to ${quote.paymentTokenSymbol} for this payment. ` +
        "Use a smaller task, try another agent, or fund the Dolphin Wallet with the quoted token directly.",
    );
  }

  return {
    paymentToken: tokenOut,
    paymentTokenSymbol: quote.paymentTokenSymbol,
    paymentTokenDecimals: quote.paymentTokenDecimals,
    tokenShortfallRaw: tokenShortfallRaw.toString(),
    requiredBnbWei: best.requiredBnbWei.toString(),
    maxBnbWei: best.maxBnbWei.toString(),
    poolFee: best.fee,
    slippageBps,
    quoter: PANCAKE_V3_QUOTER_V2,
    router: PANCAKE_V3_SWAP_ROUTER,
    gasEstimate: best.gasEstimate.toString(),
  };
}

export function buildBnbConversionCall({
  quote,
  conversion,
  recipient,
  nowSeconds = Math.floor(Date.now() / 1000),
}: {
  quote: PaymentQuote;
  conversion: BnbConversionQuote;
  recipient: Address;
  nowSeconds?: number;
}): { to: Address; data: Hex; value: bigint } {
  const amountOut = BigInt(conversion.tokenShortfallRaw);
  const amountInMaximum = BigInt(conversion.maxBnbWei);
  if (amountOut <= BigInt(0) || amountInMaximum <= BigInt(0)) {
    throw new Error("Cannot build a PancakeSwap conversion with a zero amount.");
  }

  const exactOutput = encodeFunctionData({
    abi: SWAP_ROUTER_ABI,
    functionName: "exactOutputSingle",
    args: [
      {
        tokenIn: WBNB_BSC,
        tokenOut: getAddress(quote.paymentToken),
        fee: conversion.poolFee,
        recipient,
        deadline: BigInt(nowSeconds + SWAP_DEADLINE_SECONDS),
        amountOut,
        amountInMaximum,
        sqrtPriceLimitX96: BigInt(0),
      },
    ],
  });
  const refund = encodeFunctionData({
    abi: SWAP_ROUTER_ABI,
    functionName: "refundETH",
    args: [],
  });

  return {
    to: PANCAKE_V3_SWAP_ROUTER,
    value: amountInMaximum,
    data: encodeFunctionData({
      abi: SWAP_ROUTER_ABI,
      functionName: "multicall",
      args: [[exactOutput, refund]],
    }),
  };
}
