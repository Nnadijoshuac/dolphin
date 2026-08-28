import { unavailableMetricValue } from "../lib/liveMetric";
import { CATEGORY_DATA_SOURCES } from "../lib/dataSources";
import type { GridTradingLiveStats } from "./types";

// STUB: pending a verified PancakeSwap V3 NonfungiblePositionManager address
// and position-enumeration ABI. Do not guess an address here - see
// convex/protocols/venus.ts for why.
export async function readGridTradingStats(
  agentWallet: string | null,
  checkedAt: string,
): Promise<GridTradingLiveStats> {
  const reason = agentWallet
    ? "PancakeSwap V3 position reads are not wired up yet."
    : "No verified on-chain agent wallet is available to read LP positions for.";

  return {
    category: "grid-trading",
    winRate: unavailableMetricValue(reason, CATEGORY_DATA_SOURCES.pancakeswapV3, checkedAt),
    activeRange: unavailableMetricValue(reason, CATEGORY_DATA_SOURCES.pancakeswapV3, checkedAt),
    currentPnl: unavailableMetricValue(reason, CATEGORY_DATA_SOURCES.pancakeswapV3, checkedAt),
    gridCount: unavailableMetricValue(reason, CATEGORY_DATA_SOURCES.pancakeswapV3, checkedAt),
    trackRecordPeriod: unavailableMetricValue(reason, CATEGORY_DATA_SOURCES.pancakeswapV3, checkedAt),
  };
}
