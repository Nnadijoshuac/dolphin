import { unavailableMetricValue } from "../lib/liveMetric";
import { CATEGORY_DATA_SOURCES } from "../lib/dataSources";
import type { MonitoringLiveStats, YieldLiveStats } from "./types";

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

// STUB: Aave-on-BSC and Lista reads are not yet implemented pending contract
// verification (project-scope.md SS10 step 7). Do not fabricate an APY/TVL
// number here - honest "unavailable" beats a plausible-looking guess.
export function unavailableYieldStats(checkedAt: string): YieldLiveStats {
  const reason =
    "Yield protocol reads (Aave/Venus/PancakeSwap/Lista) are not wired up yet.";
  return {
    category: "yield",
    currentApy: unavailableMetricValue(reason, CATEGORY_DATA_SOURCES.backend, checkedAt),
    tvlManagedUsd: unavailableMetricValue(reason, CATEGORY_DATA_SOURCES.backend, checkedAt),
    protocolsUsed: unavailableMetricValue(reason, CATEGORY_DATA_SOURCES.backend, checkedAt),
    rebalanceFrequency: unavailableMetricValue(reason, CATEGORY_DATA_SOURCES.backend, checkedAt),
  };
}
