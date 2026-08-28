import { v } from "convex/values";

/**
 * Mirrors `LiveMetric<T>` and `DataSourceLabel` from src/types/agent.ts so the
 * Convex schema and the client's normalized Agent type never drift apart.
 */
export const dataSourceLabelValidator = v.object({
  id: v.string(),
  label: v.string(),
  url: v.optional(v.string()),
});

export function liveMetric(valueValidator: Parameters<typeof v.union>[0]) {
  return v.union(
    v.object({
      status: v.union(v.literal("live"), v.literal("stale")),
      value: valueValidator,
      asOf: v.string(),
      source: dataSourceLabelValidator,
      methodology: v.optional(v.string()),
    }),
    v.object({
      status: v.union(v.literal("syncing"), v.literal("unavailable")),
      value: v.null(),
      asOf: v.union(v.string(), v.null()),
      source: dataSourceLabelValidator,
      reason: v.optional(v.string()),
    }),
  );
}

export type DataSourceLabelInput = {
  id: string;
  label: string;
  url?: string;
};

export function liveMetricValue<T>(
  value: T,
  asOf: string,
  source: DataSourceLabelInput,
  methodology?: string,
) {
  return {
    status: "live" as const,
    value,
    asOf,
    source,
    methodology,
  };
}

export function unavailableMetricValue(
  reason: string,
  source: DataSourceLabelInput,
  asOf: string | null = null,
) {
  return {
    status: "unavailable" as const,
    value: null,
    asOf,
    source,
    reason,
  };
}
