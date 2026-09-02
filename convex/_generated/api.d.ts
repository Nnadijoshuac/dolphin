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
import type * as agentSessions from "../agentSessions.js";
import type * as agentSubmissions from "../agentSubmissions.js";
import type * as agents from "../agents.js";
import type * as categoryStats from "../categoryStats.js";
import type * as categoryStatsValidators from "../categoryStatsValidators.js";
import type * as crons from "../crons.js";
import type * as discoveredAgents from "../discoveredAgents.js";
import type * as discoveryPipeline from "../discoveryPipeline.js";
import type * as lib_agentCatalog from "../lib/agentCatalog.js";
import type * as lib_agentIcons from "../lib/agentIcons.js";
import type * as lib_agentScoring from "../lib/agentScoring.js";
import type * as lib_bscClient from "../lib/bscClient.js";
import type * as lib_classification from "../lib/classification.js";
import type * as lib_dataSources from "../lib/dataSources.js";
import type * as lib_erc8183 from "../lib/erc8183.js";
import type * as lib_liveMetric from "../lib/liveMetric.js";
import type * as lib_liveness from "../lib/liveness.js";
import type * as lib_manualExclusions from "../lib/manualExclusions.js";
import type * as lib_pipelineStatus from "../lib/pipelineStatus.js";
import type * as lib_prefilter from "../lib/prefilter.js";
import type * as lib_registrationFile from "../lib/registrationFile.js";
import type * as protocols_aave from "../protocols/aave.js";
import type * as protocols_pancakeswap from "../protocols/pancakeswap.js";
import type * as protocols_types from "../protocols/types.js";
import type * as protocols_unavailable from "../protocols/unavailable.js";
import type * as protocols_venus from "../protocols/venus.js";
import type * as zz_diagDryRun from "../zz_diagDryRun.js";
import type * as zz_diagRowSize from "../zz_diagRowSize.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentHires: typeof agentHires;
  agentPayments: typeof agentPayments;
  agentSessions: typeof agentSessions;
  agentSubmissions: typeof agentSubmissions;
  agents: typeof agents;
  categoryStats: typeof categoryStats;
  categoryStatsValidators: typeof categoryStatsValidators;
  crons: typeof crons;
  discoveredAgents: typeof discoveredAgents;
  discoveryPipeline: typeof discoveryPipeline;
  "lib/agentCatalog": typeof lib_agentCatalog;
  "lib/agentIcons": typeof lib_agentIcons;
  "lib/agentScoring": typeof lib_agentScoring;
  "lib/bscClient": typeof lib_bscClient;
  "lib/classification": typeof lib_classification;
  "lib/dataSources": typeof lib_dataSources;
  "lib/erc8183": typeof lib_erc8183;
  "lib/liveMetric": typeof lib_liveMetric;
  "lib/liveness": typeof lib_liveness;
  "lib/manualExclusions": typeof lib_manualExclusions;
  "lib/pipelineStatus": typeof lib_pipelineStatus;
  "lib/prefilter": typeof lib_prefilter;
  "lib/registrationFile": typeof lib_registrationFile;
  "protocols/aave": typeof protocols_aave;
  "protocols/pancakeswap": typeof protocols_pancakeswap;
  "protocols/types": typeof protocols_types;
  "protocols/unavailable": typeof protocols_unavailable;
  "protocols/venus": typeof protocols_venus;
  zz_diagDryRun: typeof zz_diagDryRun;
  zz_diagRowSize: typeof zz_diagRowSize;
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
