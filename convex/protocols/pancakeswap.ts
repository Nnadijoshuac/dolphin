import type { Address } from "viem";

import { bscPublicClient } from "../lib/bscClient";
import { CATEGORY_DATA_SOURCES } from "../lib/dataSources";
import { liveMetricValue, unavailableMetricValue } from "../lib/liveMetric";
import type { RebalancingLiveStats } from "./types";

/**
 * PancakeSwap V3 NonfungiblePositionManager on BSC mainnet. Verified against
 * the official pancakeswap/pancake-v3-contracts deployments file
 * (deployments/bscMainnet.json) and cross-checked as BscScan's labeled
 * "PancakeSwap: Nonfungible Position Manager V3".
 */
const PANCAKE_V3_POSITION_MANAGER_ADDRESS: Address = "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364";

const POSITION_MANAGER_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "tokenOfOwnerByIndex",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "index", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "positions",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "nonce", type: "uint96" },
      { name: "operator", type: "address" },
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "tickLower", type: "int24" },
      { name: "tickUpper", type: "int24" },
      { name: "liquidity", type: "uint128" },
      { name: "feeGrowthInside0LastX128", type: "uint256" },
      { name: "feeGrowthInside1LastX128", type: "uint256" },
      { name: "tokensOwed0", type: "uint128" },
      { name: "tokensOwed1", type: "uint128" },
    ],
  },
] as const;

const ERC20_SYMBOL_ABI = [
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

async function readTokenSymbol(token: Address): Promise<string> {
  try {
    return await bscPublicClient.readContract({
      address: token,
      abi: ERC20_SYMBOL_ABI,
      functionName: "symbol",
    });
  } catch {
    return `${token.slice(0, 6)}…${token.slice(-4)}`;
  }
}

const NO_TRACK_RECORD_REASON =
  "PancakeSwap V3 position reads give the current tick range and liquidity, not historical fee income or holding duration - there is no on-chain feed for those yet.";

/**
 * Reads a wallet's real PancakeSwap V3 LP positions. positionCount and
 * activeRange are genuine on-chain reads; winRate/currentPnl/
 * trackRecordPeriod require historical fee-accrual and cost-basis data this
 * backend does not compute yet, so they stay honestly unavailable rather
 * than being estimated from a single snapshot.
 */
export async function readRebalancingStats(
  agentWallet: string | null,
  checkedAt: string,
): Promise<RebalancingLiveStats> {
  const source = CATEGORY_DATA_SOURCES.pancakeswapV3;
  const noTrackRecord = unavailableMetricValue(NO_TRACK_RECORD_REASON, source, checkedAt);

  if (!agentWallet) {
    const reason = "No verified on-chain agent wallet is available to read LP positions for.";
    return {
      category: "rebalancing",
      winRate: unavailableMetricValue(reason, source, checkedAt),
      activeRange: unavailableMetricValue(reason, source, checkedAt),
      currentPnl: unavailableMetricValue(reason, source, checkedAt),
      positionCount: unavailableMetricValue(reason, source, checkedAt),
      trackRecordPeriod: unavailableMetricValue(reason, source, checkedAt),
    };
  }

  const account = agentWallet as Address;

  try {
    const balance = await bscPublicClient.readContract({
      address: PANCAKE_V3_POSITION_MANAGER_ADDRESS,
      abi: POSITION_MANAGER_ABI,
      functionName: "balanceOf",
      args: [account],
    });

    const positionCount = Number(balance);

    if (positionCount === 0) {
      const reason = "This wallet holds no PancakeSwap V3 liquidity position NFTs.";
      return {
        category: "rebalancing",
        winRate: unavailableMetricValue(reason, source, checkedAt),
        activeRange: unavailableMetricValue(reason, source, checkedAt),
        currentPnl: unavailableMetricValue(reason, source, checkedAt),
        positionCount: liveMetricValue(0, checkedAt, source),
        trackRecordPeriod: unavailableMetricValue(reason, source, checkedAt),
      };
    }

    const tokenIds = await Promise.all(
      Array.from({ length: positionCount }, (_, index) =>
        bscPublicClient.readContract({
          address: PANCAKE_V3_POSITION_MANAGER_ADDRESS,
          abi: POSITION_MANAGER_ABI,
          functionName: "tokenOfOwnerByIndex",
          args: [account, BigInt(index)],
        }),
      ),
    );

    const positions = await Promise.all(
      tokenIds.map((tokenId) =>
        bscPublicClient.readContract({
          address: PANCAKE_V3_POSITION_MANAGER_ADDRESS,
          abi: POSITION_MANAGER_ABI,
          functionName: "positions",
          args: [tokenId],
        }),
      ),
    );

    const largest = positions.reduce((best, current) =>
      current[7] > best[7] ? current : best,
    );
    const [, , token0, token1, fee, tickLower, tickUpper] = largest;
    const [symbol0, symbol1] = await Promise.all([
      readTokenSymbol(token0),
      readTokenSymbol(token1),
    ]);

    const activeRange = liveMetricValue(
      `${symbol0}/${symbol1} ${fee / 10_000}% · ticks ${tickLower} to ${tickUpper}`,
      checkedAt,
      source,
      positionCount > 1
        ? `Largest of ${positionCount} open positions by liquidity, by tick range (not converted to a price range).`
        : "By tick range, not converted to a price range.",
    );

    return {
      category: "rebalancing",
      winRate: noTrackRecord,
      activeRange,
      currentPnl: noTrackRecord,
      positionCount: liveMetricValue(positionCount, checkedAt, source),
      trackRecordPeriod: noTrackRecord,
    };
  } catch (error) {
    const reason = `PancakeSwap V3 position read failed: ${error instanceof Error ? error.message : String(error)}`;
    return {
      category: "rebalancing",
      winRate: unavailableMetricValue(reason, source, checkedAt),
      activeRange: unavailableMetricValue(reason, source, checkedAt),
      currentPnl: unavailableMetricValue(reason, source, checkedAt),
      positionCount: unavailableMetricValue(reason, source, checkedAt),
      trackRecordPeriod: unavailableMetricValue(reason, source, checkedAt),
    };
  }
}
