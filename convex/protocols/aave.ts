import type { Address } from "viem";

import { bscPublicClient } from "../lib/bscClient";
import { CATEGORY_DATA_SOURCES } from "../lib/dataSources";
import { liveMetricValue, unavailableMetricValue } from "../lib/liveMetric";
import type { YieldLiveStats } from "./types";

/**
 * Aave V3 BNB Chain market. Verified against the official Aave Address Book
 * (bgd-labs/aave-address-book, src/AaveV3BNB.sol) - the repo Aave's own docs
 * point integrators to for per-chain addresses.
 */
const AAVE_POOL_ADDRESS: Address = "0x6807dc923806fE8Fd134338EABCA509979a7e0cB";
const AAVE_POOL_ADDRESSES_PROVIDER: Address = "0xff75B6da14FfbbfD355Daf7a2731456b3562Ba6D";

const POOL_ABI = [
  {
    type: "function",
    name: "getUserAccountData",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "totalCollateralBase", type: "uint256" },
      { name: "totalDebtBase", type: "uint256" },
      { name: "availableBorrowsBase", type: "uint256" },
      { name: "currentLiquidationThreshold", type: "uint256" },
      { name: "ltv", type: "uint256" },
      { name: "healthFactor", type: "uint256" },
    ],
  },
] as const;

const POOL_ADDRESSES_PROVIDER_ABI = [
  {
    type: "function",
    name: "getPriceOracle",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

const PRICE_ORACLE_BASE_UNIT_ABI = [
  {
    type: "function",
    name: "BASE_CURRENCY_UNIT",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

const NOT_WIRED_REASONS = {
  apy: "Aave's per-reserve currentLiquidityRate needs a ray-to-APY conversion this backend hasn't implemented yet - not reporting an estimate rather than risk a wrong compounding calculation.",
  rebalance:
    "Rebalance frequency needs a transaction-history pattern analysis this backend doesn't do yet.",
} as const;

/**
 * Reads a wallet's real Aave V3 (BNB Chain market) supplied-collateral value
 * in USD. Aave doesn't expose deposit APY as one field - that needs a
 * ray-to-APY conversion per supplied reserve this backend doesn't implement
 * yet (see NOT_WIRED_REASONS.apy), so currentApy stays honestly unavailable
 * rather than an unverified estimate. Lista DAO reads are not wired up yet
 * either (needs its full collateral-token list); protocolsUsed only ever
 * reports "Aave" for now.
 */
export async function readYieldStats(
  agentWallet: string | null,
  checkedAt: string,
): Promise<YieldLiveStats> {
  const source = CATEGORY_DATA_SOURCES.aaveV3;

  if (!agentWallet) {
    const reason = "No verified on-chain agent wallet is available to read a yield position for.";
    return {
      category: "yield",
      currentApy: unavailableMetricValue(reason, source, checkedAt),
      tvlManagedUsd: unavailableMetricValue(reason, source, checkedAt),
      protocolsUsed: unavailableMetricValue(reason, source, checkedAt),
      rebalanceFrequency: unavailableMetricValue(reason, source, checkedAt),
    };
  }

  const account = agentWallet as Address;

  try {
    const [accountData, oracleAddress] = await Promise.all([
      bscPublicClient.readContract({
        address: AAVE_POOL_ADDRESS,
        abi: POOL_ABI,
        functionName: "getUserAccountData",
        args: [account],
      }),
      bscPublicClient.readContract({
        address: AAVE_POOL_ADDRESSES_PROVIDER,
        abi: POOL_ADDRESSES_PROVIDER_ABI,
        functionName: "getPriceOracle",
      }),
    ]);

    const baseCurrencyUnit = await bscPublicClient.readContract({
      address: oracleAddress,
      abi: PRICE_ORACLE_BASE_UNIT_ABI,
      functionName: "BASE_CURRENCY_UNIT",
    });

    const [totalCollateralBase] = accountData;
    const tvlUsd = baseCurrencyUnit > 0n ? Number(totalCollateralBase) / Number(baseCurrencyUnit) : 0;
    const hasAavePosition = totalCollateralBase > 0n;

    return {
      category: "yield",
      currentApy: unavailableMetricValue(NOT_WIRED_REASONS.apy, source, checkedAt),
      tvlManagedUsd: liveMetricValue(
        tvlUsd,
        checkedAt,
        source,
        "Pool.getUserAccountData().totalCollateralBase, scaled by the price oracle's BASE_CURRENCY_UNIT. Aave only - Venus/PancakeSwap/Lista TVL is not included here even if the wallet also holds positions there.",
      ),
      protocolsUsed: liveMetricValue(hasAavePosition ? ["Aave"] : [], checkedAt, source),
      rebalanceFrequency: unavailableMetricValue(NOT_WIRED_REASONS.rebalance, source, checkedAt),
    };
  } catch (error) {
    const reason = `Aave Pool read failed: ${error instanceof Error ? error.message : String(error)}`;
    return {
      category: "yield",
      currentApy: unavailableMetricValue(reason, source, checkedAt),
      tvlManagedUsd: unavailableMetricValue(reason, source, checkedAt),
      protocolsUsed: unavailableMetricValue(reason, source, checkedAt),
      rebalanceFrequency: unavailableMetricValue(reason, source, checkedAt),
    };
  }
}
