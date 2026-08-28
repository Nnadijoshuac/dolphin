import { unavailableMetricValue } from "../lib/liveMetric";
import { CATEGORY_DATA_SOURCES } from "../lib/dataSources";
import type { MonitoringLiveStats } from "./types";

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
