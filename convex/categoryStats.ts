import { v, type Infer } from "convex/values";

import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { BSC_CHAIN_ID } from "./lib/bscClient";
import { statsCategoryValidator, agentLiveStatsValidator } from "./categoryStatsValidators";
import {
  CHART_METRIC_LABELS,
  MAX_OBSERVATIONS,
  MIN_OBSERVATION_GAP_MS,
  STATS_FRESHNESS_MS,
  chartableObservation,
} from "./lib/statsHistory";
import { readYieldStats } from "./protocols/aave";
import { readRebalancingStats } from "./protocols/pancakeswap";
import {
  unavailableGridTradingStats,
  unavailableMonitoringStats,
  unavailableTradingStats,
} from "./protocols/unavailable";
import { readHealthFactorStats } from "./protocols/venus";

/** The stats union as the schema validator defines it - the one authority on its shape. */
type AgentLiveStats = Infer<typeof agentLiveStatsValidator>;

export const getAgentCategoryStats = query({
  args: {
    agentKey: v.string(),
    category: statsCategoryValidator,
  },
  handler: async (ctx, { agentKey, category }) => {
    const row = await ctx.db
      .query("agentLiveStats")
      .withIndex("by_agent_category", (q) =>
        q.eq("agentKey", agentKey).eq("category", category),
      )
      .unique();

    return row ?? null;
  },
});

export const upsertAgentCategoryStats = internalMutation({
  args: {
    agentKey: v.string(),
    category: statsCategoryValidator,
    agentWallet: v.union(v.string(), v.null()),
    stats: agentLiveStatsValidator,
    checkedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agentLiveStats")
      .withIndex("by_agent_category", (q) =>
        q.eq("agentKey", args.agentKey).eq("category", args.category),
      )
      .unique();

    const document = { ...args };

    if (existing) {
      await ctx.db.patch(existing._id, document);
    } else {
      await ctx.db.insert("agentLiveStats", document);
    }
  },
});

/**
 * The stored reading and its age, for the freshness gate below. Internal
 * because it exists only to let the action decide whether to hit the chain.
 */
export const peekAgentCategoryStats = internalQuery({
  args: { agentKey: v.string(), category: statsCategoryValidator },
  handler: async (ctx, { agentKey, category }) => {
    const row = await ctx.db
      .query("agentLiveStats")
      .withIndex("by_agent_category", (q) =>
        q.eq("agentKey", agentKey).eq("category", category),
      )
      .unique();

    return row ? { stats: row.stats, checkedAt: row.checkedAt } : null;
  },
});

/**
 * Reads real on-chain state for one agent's category and caches the result.
 * agentWallet must come from a live ERC-8004 registry read (chain.ts on the
 * client, or an equivalent server-side verification) - never trust an
 * unverified publisher-reported address for a financial read.
 *
 * ---------------------------------------------------------------------------
 * THIS ACTION IS PUBLIC AND UNAUTHENTICATED, AND IT SPENDS MONEY
 * ---------------------------------------------------------------------------
 * Every call performs live BSC RPC reads. Before the freshness gate below, its
 * call rate - and therefore Dolphin's RPC bill and Convex action budget - was
 * set entirely by whoever chose to call it, from anywhere, with no ceiling. The
 * client alone made it worse: use-category-stats.ts polls every 60s per mounted
 * screen and Expo Router keeps screens mounted.
 *
 * The gate makes N callers asking about one agent cost ONE read per minute
 * between them instead of N. It is deliberately not a per-caller rate limit:
 * there is no caller identity to key one on, and the thing worth protecting is
 * the upstream read, not the client.
 *
 * 60s matches the client's own polling interval, so no honest caller is ever
 * refused data it would otherwise have had.
 */
export const refreshAgentCategoryStats = action({
  args: {
    agentKey: v.string(),
    category: statsCategoryValidator,
    agentWallet: v.union(v.string(), v.null()),
  },
  // Annotated explicitly, for the reason recordJobPayment in
  // convex/agentPayments.ts carries the same annotation: this handler calls
  // ctx.runQuery/ctx.runMutation on functions in its OWN module, so inferring
  // its type needs the module's type, which needs this handler's type.
  // TS7022/7023. The annotation breaks the cycle.
  handler: async (ctx, { agentKey, category, agentWallet }): Promise<AgentLiveStats> => {
    const cached: { stats: AgentLiveStats; checkedAt: string } | null = await ctx.runQuery(
      internal.categoryStats.peekAgentCategoryStats,
      { agentKey, category },
    );

    if (cached) {
      const age = Date.now() - Date.parse(cached.checkedAt);
      // Number.isNaN guards an unparseable stored timestamp: treat it as stale
      // and re-read, rather than serving something of unknown age forever.
      if (!Number.isNaN(age) && age >= 0 && age < STATS_FRESHNESS_MS) {
        return cached.stats;
      }
    }

    const checkedAt = new Date().toISOString();

    const stats = await (async () => {
      switch (category) {
        case "health-factor":
          return readHealthFactorStats(agentWallet, checkedAt);
        case "rebalancing":
          return readRebalancingStats(agentWallet, checkedAt);
        case "grid-trading":
          return unavailableGridTradingStats(checkedAt);
        case "trading":
          return unavailableTradingStats(checkedAt);
        case "monitoring":
          return unavailableMonitoringStats(checkedAt);
        case "yield":
          return readYieldStats(agentWallet, checkedAt);
      }
    })();

    await ctx.runMutation(internal.categoryStats.upsertAgentCategoryStats, {
      agentKey,
      category,
      agentWallet,
      stats,
      checkedAt,
    });

    // The same reading, kept rather than overwritten, so the detail page's
    // chart has a real source. Null for a category with no wired metric, and
    // null for a reading that did not resolve - neither becomes a zero.
    const observation = chartableObservation(stats);
    if (observation) {
      await ctx.runMutation(internal.categoryStats.appendStatsObservation, {
        agentKey,
        category,
        metric: observation.metric,
        value: observation.value,
        observedAt: checkedAt,
        source: observation.source,
      });
    }

    return stats;
  },
});

/**
 * Appends one observation, at most one per MIN_OBSERVATION_GAP_MS, and prunes
 * to MAX_OBSERVATIONS.
 *
 * Internal for the same reason insertJobRecord is: a public writer here would
 * be a way to put a number of the caller's choosing onto a chart Dolphin
 * presents as read from BNB Chain.
 */
export const appendStatsObservation = internalMutation({
  args: {
    agentKey: v.string(),
    category: statsCategoryValidator,
    metric: v.string(),
    value: v.number(),
    observedAt: v.string(),
    source: v.object({
      id: v.string(),
      label: v.string(),
      url: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agentStatsHistory")
      .withIndex("by_agent_category", (q) =>
        q
          .eq("agentKey", args.agentKey)
          .eq("category", args.category),
      )
      .collect();

    const newestAt = existing.reduce((newest, row) => {
      const at = Date.parse(row.observedAt);
      return Number.isNaN(at) ? newest : Math.max(newest, at);
    }, 0);

    const observedAtMs = Date.parse(args.observedAt);
    if (
      newestAt > 0 &&
      !Number.isNaN(observedAtMs) &&
      observedAtMs - newestAt < MIN_OBSERVATION_GAP_MS
    ) {
      return null;
    }

    await ctx.db.insert("agentStatsHistory", { ...args });

    // Prune oldest-first. `existing` is the pre-insert set, so the ceiling is
    // MAX_OBSERVATIONS counting the row just written.
    const overflow = existing.length + 1 - MAX_OBSERVATIONS;
    if (overflow > 0) {
      const oldest = [...existing]
        .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt))
        .slice(0, overflow);
      for (const row of oldest) {
        await ctx.db.delete(row._id);
      }
    }

    return null;
  },
});

/**
 * The charted series for one agent-category, oldest first.
 *
 * Returns the metric name and its label alongside the points so the axis is
 * described by the same mapping that produced it, rather than by a second copy
 * of that mapping on the client.
 */
export const getAgentStatsHistory = query({
  args: { agentKey: v.string(), category: statsCategoryValidator },
  handler: async (ctx, { agentKey, category }) => {
    const rows = await ctx.db
      .query("agentStatsHistory")
      .withIndex("by_agent_category", (q) =>
        q.eq("agentKey", agentKey).eq("category", category),
      )
      .collect();

    const points = rows
      .map((row) => ({
        timestamp: row.observedAt,
        value: row.value,
        source: row.source,
      }))
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

    const metric = rows.length > 0 ? rows[rows.length - 1].metric : null;

    return {
      points,
      metric,
      metricLabel: metric ? (CHART_METRIC_LABELS[metric] ?? metric) : null,
    };
  },
});
