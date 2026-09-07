/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentHires from "../agentHires.js";
import type * as agentPayments from "../agentPayments.js";
import type * as agentRetention from "../agentRetention.js";
import type * as agentReviews from "../agentReviews.js";
import type * as agentSessions from "../agentSessions.js";
import type * as agents from "../agents.js";
import type * as categoryStats from "../categoryStats.js";
import type * as categoryStatsValidators from "../categoryStatsValidators.js";
import type * as crons from "../crons.js";
import type * as discovery from "../discovery.js";
import type * as facets from "../facets.js";
import type * as lib_bscClient from "../lib/bscClient.js";
import type * as lib_categorize from "../lib/categorize.js";
import type * as lib_dataSources from "../lib/dataSources.js";
import type * as lib_erc8183 from "../lib/erc8183.js";
import type * as lib_liveMetric from "../lib/liveMetric.js";
import type * as lib_manualExclusions from "../lib/manualExclusions.js";
import type * as lib_probe from "../lib/probe.js";
import type * as lib_publicAgent from "../lib/publicAgent.js";
import type * as lib_rank from "../lib/rank.js";
import type * as lib_reputationRegistry from "../lib/reputationRegistry.js";
import type * as lib_safeFetch from "../lib/safeFetch.js";
import type * as lib_screen from "../lib/screen.js";
import type * as lib_statsCategory from "../lib/statsCategory.js";
import type * as lib_statsHistory from "../lib/statsHistory.js";
import type * as lib_walletAuth from "../lib/walletAuth.js";
import type * as model_agent from "../model/agent.js";
import type * as protocols_aave from "../protocols/aave.js";
import type * as protocols_pancakeswap from "../protocols/pancakeswap.js";
import type * as protocols_types from "../protocols/types.js";
import type * as protocols_unavailable from "../protocols/unavailable.js";
import type * as protocols_venus from "../protocols/venus.js";
import type * as sources_scan8004 from "../sources/scan8004.js";
import type * as verification from "../verification.js";
import type * as walletAuth from "../walletAuth.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentHires: typeof agentHires;
  agentPayments: typeof agentPayments;
  agentRetention: typeof agentRetention;
  agentReviews: typeof agentReviews;
  agentSessions: typeof agentSessions;
  agents: typeof agents;
  categoryStats: typeof categoryStats;
  categoryStatsValidators: typeof categoryStatsValidators;
  crons: typeof crons;
  discovery: typeof discovery;
  facets: typeof facets;
  "lib/bscClient": typeof lib_bscClient;
  "lib/categorize": typeof lib_categorize;
  "lib/dataSources": typeof lib_dataSources;
  "lib/erc8183": typeof lib_erc8183;
  "lib/liveMetric": typeof lib_liveMetric;
  "lib/manualExclusions": typeof lib_manualExclusions;
  "lib/probe": typeof lib_probe;
  "lib/publicAgent": typeof lib_publicAgent;
  "lib/rank": typeof lib_rank;
  "lib/reputationRegistry": typeof lib_reputationRegistry;
  "lib/safeFetch": typeof lib_safeFetch;
  "lib/screen": typeof lib_screen;
  "lib/statsCategory": typeof lib_statsCategory;
  "lib/statsHistory": typeof lib_statsHistory;
  "lib/walletAuth": typeof lib_walletAuth;
  "model/agent": typeof model_agent;
  "protocols/aave": typeof protocols_aave;
  "protocols/pancakeswap": typeof protocols_pancakeswap;
  "protocols/types": typeof protocols_types;
  "protocols/unavailable": typeof protocols_unavailable;
  "protocols/venus": typeof protocols_venus;
  "sources/scan8004": typeof sources_scan8004;
  verification: typeof verification;
  walletAuth: typeof walletAuth;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
