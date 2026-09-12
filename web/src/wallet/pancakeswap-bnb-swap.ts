import {
  encodeFunctionData,
  formatUnits,
  getAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { assertIntentAffordable, displayBnb } from "./altana-policy";

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

/**
 * Smart-account overhead on top of the raw swap, as a MULTIPLE of the measured
 * cost of the swap itself.
 *
 * Measured 2026-09-12: this exact `multicall([exactOutputSingle, refundETH])`
 * costs ~215k gas called directly on BSC. Running it through the Dolphin Wallet
 * wraps it in an EIP-7702 account intent, which adds signature validation and
 * the account's own dispatch around that.
 *
 * 2x is a CEILING for the wrapper, not a measurement of it, and it is used only
 * to decide whether to refuse before asking for a signature. It is never shown
 * as a fee, never charged, and never presented as what the transaction will
 * cost - so erring high costs the user nothing except a refusal that arrives
 * earlier. At BSC's current 0.05 gwei the whole envelope is worth a fraction of
 * a cent; being generous with it is free and being tight with it is how a batch
 * fails after the user has already approved it.
 */
const SMART_ACCOUNT_GAS_HEADROOM = BigInt(2);

export type ConversionPreflight = Readonly<{
  /** Gas units the swap itself needs, measured against live chain state. */
  gasUnits: string;
  gasPriceWei: string;
  /** Gas ceiling including the smart-account wrapper. Never charged. */
  maxFeeWei: string;
  /** What the wallet must hold: the swap's own BNB plus that ceiling. */
  requiredTotalWei: string;
}>;

/**
 * Check the conversion can actually execute, BEFORE asking anyone to sign it.
 *
 * ---------------------------------------------------------------------------
 * WHY (2026-09-12)
 * ---------------------------------------------------------------------------
 * A paid hire failed at `client.execute()` with the relay's least useful
 * answer: "An error occurred while executing calls. Reason: 0x". Empty revert
 * data names nothing - not the contract, not the check, not the amount - and it
 * arrives AFTER the user has approved a passkey prompt, so the cost of finding
 * out is a signature and a wait.
 *
 * The swap itself was not the problem: the identical calldata succeeds when
 * called directly on BSC. What the old code did not verify is the two
 * preconditions the relay silently requires.
 *
 *  1. THE WALLET MUST COVER THE SWAP *AND* ITS GAS. The check this replaces
 *     read `native < maxBnbWei` - the swap's BNB alone, with nothing left for
 *     the fee. Its own error text already said "plus a little extra for network
 *     gas" while the condition beside it did not ask for any, so a wallet funded
 *     to exactly the quoted amount passed the check and then could not pay to
 *     execute.
 *
 *  2. THE CALL MUST NOT REVERT. `estimateGas` runs the real call against live
 *     state from the real account, so a pool that moved, a deadline that
 *     passed, or a token that refuses this account fails HERE, with the reason
 *     the chain gave, instead of as `0x` after a signature.
 *
 * Both numbers are read live - the gas price from the chain and the gas units
 * from the call itself. Nothing here is a constant standing in for a
 * measurement (AGENTS.md §5); the one judgement call is the headroom multiple
 * above, which only ever makes this stricter.
 */
export async function preflightBnbConversion({
  publicClient,
  account,
  call,
  conversion,
  nativeBalanceWei,
  firstActionSurchargeWei = BigInt(0),
}: {
  publicClient: PublicClient;
  account: Address;
  call: { to: Address; data: Hex; value: bigint };
  conversion: BnbConversionQuote;
  nativeBalanceWei: bigint;
  /**
   * BNB the relay will bundle AHEAD of this swap in the same intent - the
   * KeyStore registration the SDK prepends to a wallet's first admin action.
   * See readFirstActionSurcharge in altana-policy.ts. Zero once registered.
   */
  firstActionSurchargeWei?: bigint;
}): Promise<ConversionPreflight> {
  const priceLabel = `${formatUnits(
    BigInt(conversion.tokenShortfallRaw),
    conversion.paymentTokenDecimals,
  )} ${conversion.paymentTokenSymbol}`;

  /*
   * Checked before `estimateGas` because estimateGas on a call whose value the
   * account cannot cover fails as "insufficient funds" - technically true, and
   * useless next to a sentence naming the actual shortfall.
   */
  if (nativeBalanceWei < call.value) {
    throw new Error(
      [
        "Not enough BNB in your Dolphin Wallet.",
        `${displayBnb(call.value)} BNB — hire price (${priceLabel}, bought with BNB), plus network gas on top.`,
        `${displayBnb(nativeBalanceWei)} BNB — what it holds now.`,
        `Add at least ${displayBnb(call.value - nativeBalanceWei, true)} BNB and try again.`,
      ].join("\n"),
    );
  }

  const [gasUnits, gasPriceWei] = await Promise.all([
    publicClient.estimateGas({ account, to: call.to, data: call.data, value: call.value }),
    publicClient.getGasPrice(),
  ]);

  const maxFeeWei = gasUnits * SMART_ACCOUNT_GAS_HEADROOM * gasPriceWei;
  const requiredTotalWei = call.value + firstActionSurchargeWei + maxFeeWei;

  /*
   * ITEMISED AND SHARED. The message this produces is the same one every other
   * admin intent produces - see assertIntentAffordable - because a user should
   * not have to learn a second format depending on which step ran out of BNB.
   * This path passes its OWN measured gas units rather than the default
   * allowance: the swap is a single call and estimateGas above measured it
   * exactly, which beats a ceiling.
   */
  await assertIntentAffordable({
    publicClient,
    nativeBalanceWei,
    gasUnits: gasUnits * SMART_ACCOUNT_GAS_HEADROOM,
    items: [
      { label: `hire price (${priceLabel}, bought with BNB)`, wei: call.value },
      {
        label:
          "one-time wallet setup, charged once so this wallet is recoverable from your passkey",
        wei: firstActionSurchargeWei,
      },
    ],
  });

  return {
    gasUnits: gasUnits.toString(),
    gasPriceWei: gasPriceWei.toString(),
    maxFeeWei: maxFeeWei.toString(),
    requiredTotalWei: requiredTotalWei.toString(),
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
