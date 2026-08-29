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
import type * as agents from "../agents.js";
import type * as categoryStats from "../categoryStats.js";
import type * as categoryStatsValidators from "../categoryStatsValidators.js";
import type * as crons from "../crons.js";
import type * as discoveredAgents from "../discoveredAgents.js";
import type * as lib_agentCatalog from "../lib/agentCatalog.js";
import type * as lib_bscClient from "../lib/bscClient.js";
import type * as lib_classification from "../lib/classification.js";
import type * as lib_dataSources from "../lib/dataSources.js";
import type * as lib_liveMetric from "../lib/liveMetric.js";
import type * as protocols_aave from "../protocols/aave.js";
import type * as protocols_pancakeswap from "../protocols/pancakeswap.js";
import type * as protocols_types from "../protocols/types.js";
import type * as protocols_unavailable from "../protocols/unavailable.js";
import type * as protocols_venus from "../protocols/venus.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentHires: typeof agentHires;
  agents: typeof agents;
  categoryStats: typeof categoryStats;
  categoryStatsValidators: typeof categoryStatsValidators;
  crons: typeof crons;
  discoveredAgents: typeof discoveredAgents;
  "lib/agentCatalog": typeof lib_agentCatalog;
  "lib/bscClient": typeof lib_bscClient;
  "lib/classification": typeof lib_classification;
  "lib/dataSources": typeof lib_dataSources;
  "lib/liveMetric": typeof lib_liveMetric;
  "protocols/aave": typeof protocols_aave;
  "protocols/pancakeswap": typeof protocols_pancakeswap;
  "protocols/types": typeof protocols_types;
  "protocols/unavailable": typeof protocols_unavailable;
  "protocols/venus": typeof protocols_venus;
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
