import type { Address } from "viem";

import { bscPublicClient } from "../lib/bscClient";
import { CATEGORY_DATA_SOURCES } from "../lib/dataSources";
import { liveMetricValue, unavailableMetricValue } from "../lib/liveMetric";
import type { HealthFactorLiveStats } from "./types";

/**
 * Venus Core Pool Comptroller (Unitroller) on BSC mainnet. Verified against
 * the official VenusProtocol/venus-protocol deployments file
 * (deployments/bscmainnet.json, "Unitroller") and independently cross-checked
 * as BscScan's labeled "Venus: Core Pool Comptroller" with ~$35M tracked
 * balance - i.e. the real, live, high-TVL contract, not a decoy.
 */
const VENUS_COMPTROLLER_ADDRESS: Address = "0xfD36E2c2a6789Db23113685031d7F16329158384";

const COMPTROLLER_ABI = [
  {
    type: "function",
    name: "getAssetsIn",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "address[]" }],
  },
  {
    type: "function",
    name: "markets",
    stateMutability: "view",
    inputs: [{ name: "vToken", type: "address" }],
    outputs: [
      { name: "isListed", type: "bool" },
      { name: "collateralFactorMantissa", type: "uint256" },
      { name: "isVenus", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "oracle",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

const VTOKEN_ABI = [
  {
    type: "function",
    name: "getAccountSnapshot",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [
      { name: "error", type: "uint256" },
      { name: "vTokenBalance", type: "uint256" },
      { name: "borrowBalance", type: "uint256" },
      { name: "exchangeRateMantissa", type: "uint256" },
    ],
  },
] as const;

const PRICE_ORACLE_ABI = [
  {
    type: "function",
    name: "getUnderlyingPrice",
    stateMutability: "view",
    inputs: [{ name: "vToken", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const ONE_E18 = 10n ** 18n;

const METHODOLOGY =
  "Weighted collateral value divided by total borrow value across every Venus Core Pool market the wallet has entered - Comptroller.getAssetsIn, then per-market getAccountSnapshot x collateralFactorMantissa x oracle.getUnderlyingPrice, standard Compound-fork 1e18/1e36 scaling. Venus's Comptroller does not expose a single health-factor ratio directly (only weighted liquidity/shortfall), so this is derived, not read verbatim - spot-check against app.venus.io for a funded wallet before treating it as ground truth.";

/**
 * Reads a wallet's real Venus Core Pool position and derives a health-factor
 * ratio (collateralValue * collateralFactor / borrowValue, summed across
 * every entered market). Falls back to an honest "unavailable" reading -
 * never a fabricated number - if the wallet has no entered markets, no
 * borrow position, or any read fails.
 */
export async function readHealthFactorStats(
  agentWallet: string | null,
  checkedAt: string,
): Promise<HealthFactorLiveStats> {
  const source = CATEGORY_DATA_SOURCES.venus;

  if (!agentWallet) {
    const reason = "No verified on-chain agent wallet is available to read a Venus position for.";
    return {
      category: "health-factor",
      positionsMonitored: unavailableMetricValue(reason, source, checkedAt),
      averageHealthFactor: unavailableMetricValue(reason, source, checkedAt),
      liquidationsPrevented: unavailableMetricValue(
        "Dolphin has no historical liquidation-event feed for this agent yet.",
        source,
        checkedAt,
      ),
      responseLatencyMs: unavailableMetricValue(
        "Dolphin has no agent action-latency feed yet.",
        source,
        checkedAt,
      ),
    };
  }

  const account = agentWallet as Address;
  const noLatencyFeed = unavailableMetricValue(
    "Dolphin has no agent action-latency feed yet.",
    source,
    checkedAt,
  );
  const noLiquidationFeed = unavailableMetricValue(
    "Dolphin has no historical liquidation-event feed for this agent yet.",
    source,
    checkedAt,
  );

  try {
    const [assetsIn, oracleAddress] = await Promise.all([
      bscPublicClient.readContract({
        address: VENUS_COMPTROLLER_ADDRESS,
        abi: COMPTROLLER_ABI,
        functionName: "getAssetsIn",
        args: [account],
      }),
      bscPublicClient.readContract({
        address: VENUS_COMPTROLLER_ADDRESS,
        abi: COMPTROLLER_ABI,
        functionName: "oracle",
      }),
    ]);

    const positionsMonitored = liveMetricValue(assetsIn.length, checkedAt, source);

    if (assetsIn.length === 0) {
      const reason = "This wallet has not entered any Venus Core Pool market.";
      return {
        category: "health-factor",
        positionsMonitored,
        averageHealthFactor: unavailableMetricValue(reason, source, checkedAt),
        liquidationsPrevented: noLiquidationFeed,
        responseLatencyMs: noLatencyFeed,
      };
    }

    let weightedCollateral = 0n;
    let totalBorrow = 0n;

    for (const vToken of assetsIn) {
      const [snapshot, market, price] = await Promise.all([
        bscPublicClient.readContract({
          address: vToken,
          abi: VTOKEN_ABI,
          functionName: "getAccountSnapshot",
          args: [account],
        }),
        bscPublicClient.readContract({
          address: VENUS_COMPTROLLER_ADDRESS,
          abi: COMPTROLLER_ABI,
          functionName: "markets",
          args: [vToken],
        }),
        bscPublicClient.readContract({
          address: oracleAddress,
          abi: PRICE_ORACLE_ABI,
          functionName: "getUnderlyingPrice",
          args: [vToken],
        }),
      ]);

      const [errorCode, vTokenBalance, borrowBalance, exchangeRateMantissa] = snapshot;
      if (errorCode !== 0n) {
        continue;
      }

      const [, collateralFactorMantissa] = market;
      const underlyingSupply = (vTokenBalance * exchangeRateMantissa) / ONE_E18;
      const supplyValue = (underlyingSupply * price) / ONE_E18;
      const borrowValue = (borrowBalance * price) / ONE_E18;

      weightedCollateral += (supplyValue * collateralFactorMantissa) / ONE_E18;
      totalBorrow += borrowValue;
    }

    if (totalBorrow === 0n) {
      const reason = "This wallet has no active Venus borrow to compute a health factor against.";
      return {
        category: "health-factor",
        positionsMonitored,
        averageHealthFactor: unavailableMetricValue(reason, source, checkedAt),
        liquidationsPrevented: noLiquidationFeed,
        responseLatencyMs: noLatencyFeed,
      };
    }

    const healthFactor = Number((weightedCollateral * ONE_E18) / totalBorrow) / 1e18;

    return {
      category: "health-factor",
      positionsMonitored,
      averageHealthFactor: liveMetricValue(healthFactor, checkedAt, source, METHODOLOGY),
      liquidationsPrevented: noLiquidationFeed,
      responseLatencyMs: noLatencyFeed,
    };
  } catch (error) {
    const reason = `Venus Comptroller read failed: ${error instanceof Error ? error.message : String(error)}`;
    return {
      category: "health-factor",
      positionsMonitored: unavailableMetricValue(reason, source, checkedAt),
      averageHealthFactor: unavailableMetricValue(reason, source, checkedAt),
      liquidationsPrevented: noLiquidationFeed,
      responseLatencyMs: noLatencyFeed,
    };
  }
}
