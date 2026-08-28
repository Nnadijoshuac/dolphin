import { unavailableMetricValue } from "../lib/liveMetric";
import { CATEGORY_DATA_SOURCES } from "../lib/dataSources";
import type { HealthFactorLiveStats } from "./types";

// STUB: pending a verified Venus Comptroller address + getAccountLiquidity
// ABI (see the BSC-protocol research task in the audit). Do not guess an
// address here - a wrong contract read is worse than an honest "unavailable"
// per AGENT.md SS5 / project-scope.md's Data Integrity Rule.
export async function readHealthFactorStats(
  agentWallet: string | null,
  checkedAt: string,
): Promise<HealthFactorLiveStats> {
  const reason = agentWallet
    ? "Venus health-factor reads are not wired up yet."
    : "No verified on-chain agent wallet is available to read a Venus position for.";

  return {
    category: "health-factor",
    positionsMonitored: unavailableMetricValue(reason, CATEGORY_DATA_SOURCES.venus, checkedAt),
    averageHealthFactor: unavailableMetricValue(reason, CATEGORY_DATA_SOURCES.venus, checkedAt),
    liquidationsPrevented: unavailableMetricValue(reason, CATEGORY_DATA_SOURCES.venus, checkedAt),
    responseLatencyMs: unavailableMetricValue(reason, CATEGORY_DATA_SOURCES.venus, checkedAt),
  };
}
