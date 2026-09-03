import { unavailableMetricValue } from "../lib/liveMetric";
import { CATEGORY_DATA_SOURCES } from "../lib/dataSources";
import type { GridTradingLiveStats, MonitoringLiveStats, TradingLiveStats } from "./types";

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

const NO_TRADING_SOURCE =
  "A trading agent's record is its own order flow, and Dolphin cannot read it: a trade is a transfer out of the agent's wallet with no protocol-level position to query, and reconstructing a win rate or a realised P&L from raw BSC transfers needs a cost basis and a mark price that no feed wired into this backend publishes. It needs the agent's own published service endpoint, or an indexer that attributes fills to a wallet.";

// STUB: trading has no wired protocol-level data source yet, the same pattern
// as unavailableGridTradingStats above and for a sharper reason - the other
// four categories each read a specific protocol's stored position state
// (Venus, PancakeSwap V3, Aave), and a discretionary trader leaves no such
// state behind. Wire this to an agent's `services[].endpoint` once a
// structured stats contract exists; never to a derived guess.
export function unavailableTradingStats(checkedAt: string): TradingLiveStats {
  return {
    category: "trading",
    winRate: unavailableMetricValue(NO_TRADING_SOURCE, CATEGORY_DATA_SOURCES.backend, checkedAt),
    tradesExecuted: unavailableMetricValue(NO_TRADING_SOURCE, CATEGORY_DATA_SOURCES.backend, checkedAt),
    realizedPnl: unavailableMetricValue(NO_TRADING_SOURCE, CATEGORY_DATA_SOURCES.backend, checkedAt),
    marketsTraded: unavailableMetricValue(NO_TRADING_SOURCE, CATEGORY_DATA_SOURCES.backend, checkedAt),
    trackRecordPeriod: unavailableMetricValue(NO_TRADING_SOURCE, CATEGORY_DATA_SOURCES.backend, checkedAt),
  };
}
