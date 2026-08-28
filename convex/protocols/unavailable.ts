import { unavailableMetricValue } from "../lib/liveMetric";
import { CATEGORY_DATA_SOURCES } from "../lib/dataSources";
import type { GridTradingLiveStats, MonitoringLiveStats } from "./types";

const NO_GENERIC_SOURCE =
  "Monitoring stats describe one agent's own alerting behavior, not a shared protocol's state - there is no generic on-chain feed for this yet. It needs the agent's own published service endpoint.";

// STUB: monitoring has no generic protocol-level data source (see project-scope.md SS5).
// Wire this to an agent's `services[].endpoint` once a structured stats contract exists.
export function unavailableMonitoringStats(checkedAt: string): MonitoringLiveStats {
  return {
    category: "monitoring",
    alertFrequency: unavailableMetricValue(NO_GENERIC_SOURCE, CATEGORY_DATA_SOURCES.backend, checkedAt),
    assetsWatched: unavailableMetricValue(NO_GENERIC_SOURCE, CATEGORY_DATA_SOURCES.backend, checkedAt),
    lastAlertAt: unavailableMetricValue(NO_GENERIC_SOURCE, CATEGORY_DATA_SOURCES.backend, checkedAt),
    falsePositiveRate: unavailableMetricValue(NO_GENERIC_SOURCE, CATEGORY_DATA_SOURCES.backend, checkedAt),
  };
}

const NO_GRID_TRADING_SOURCE =
  "True price-ladder grid trading (buy/sell orders placed across a fixed range) has no wired protocol read yet - this backend only reads PancakeSwap V3 LP-range positions (see protocols/pancakeswap.ts, used for the Rebalancing category), which is a different on-chain footprint than a grid bot's order book.";

// STUB: grid-trading (the true, price-ladder definition) has no wired
// protocol-level data source yet, same pattern as unavailableMonitoringStats.
export function unavailableGridTradingStats(checkedAt: string): GridTradingLiveStats {
  return {
    category: "grid-trading",
    winRate: unavailableMetricValue(NO_GRID_TRADING_SOURCE, CATEGORY_DATA_SOURCES.backend, checkedAt),
    activeRange: unavailableMetricValue(NO_GRID_TRADING_SOURCE, CATEGORY_DATA_SOURCES.backend, checkedAt),
    currentPnl: unavailableMetricValue(NO_GRID_TRADING_SOURCE, CATEGORY_DATA_SOURCES.backend, checkedAt),
    positionCount: unavailableMetricValue(NO_GRID_TRADING_SOURCE, CATEGORY_DATA_SOURCES.backend, checkedAt),
    trackRecordPeriod: unavailableMetricValue(NO_GRID_TRADING_SOURCE, CATEGORY_DATA_SOURCES.backend, checkedAt),
  };
}
