/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as agentBuilder from "../agentBuilder.js";
import type * as agentHires from "../agentHires.js";
import type * as agentMemoryCheck from "../agentMemoryCheck.js";
import type * as agentPayments from "../agentPayments.js";
import type * as agentRetention from "../agentRetention.js";
import type * as agentReviews from "../agentReviews.js";
import type * as agentSessions from "../agentSessions.js";
import type * as agentTools from "../agentTools.js";
import type * as agentTrials from "../agentTrials.js";
import type * as agents from "../agents.js";
import type * as autopilot from "../autopilot.js";
import type * as autotrade from "../autotrade.js";
import type * as balance from "../balance.js";
import type * as brainModels from "../brainModels.js";
import type * as builtAgentMoves from "../builtAgentMoves.js";
import type * as builtAgentServer from "../builtAgentServer.js";
import type * as builtAgents from "../builtAgents.js";
import type * as catalogQuality from "../catalogQuality.js";
import type * as categoryStats from "../categoryStats.js";
import type * as categoryStatsValidators from "../categoryStatsValidators.js";
import type * as census from "../census.js";
import type * as chatDeletion from "../chatDeletion.js";
import type * as chatTitles from "../chatTitles.js";
import type * as crons from "../crons.js";
import type * as discovery from "../discovery.js";
import type * as dolphin from "../dolphin.js";
import type * as engagement from "../engagement.js";
import type * as envVars from "../envVars.js";
import type * as erc8183Seller from "../erc8183Seller.js";
import type * as facets from "../facets.js";
import type * as favorites from "../favorites.js";
import type * as freeCalls from "../freeCalls.js";
import type * as healthAlerts from "../healthAlerts.js";
import type * as http from "../http.js";
import type * as iconProcessing from "../iconProcessing.js";
import type * as knowledge from "../knowledge.js";
import type * as lib_agentBlocks from "../lib/agentBlocks.js";
import type * as lib_agentMemory from "../lib/agentMemory.js";
import type * as lib_agentSpec from "../lib/agentSpec.js";
import type * as lib_agentTransaction from "../lib/agentTransaction.js";
import type * as lib_analyticalBlocks from "../lib/analyticalBlocks.js";
import type * as lib_answerHygiene from "../lib/answerHygiene.js";
import type * as lib_balanceIntent from "../lib/balanceIntent.js";
import type * as lib_binanceMarket from "../lib/binanceMarket.js";
import type * as lib_bscClient from "../lib/bscClient.js";
import type * as lib_builderBlocks from "../lib/builderBlocks.js";
import type * as lib_categorize from "../lib/categorize.js";
import type * as lib_dataSources from "../lib/dataSources.js";
import type * as lib_decisionTools from "../lib/decisionTools.js";
import type * as lib_dedupe from "../lib/dedupe.js";
import type * as lib_email from "../lib/email.js";
import type * as lib_erc8183 from "../lib/erc8183.js";
import type * as lib_erc8183Seller from "../lib/erc8183Seller.js";
import type * as lib_firstParty from "../lib/firstParty.js";
import type * as lib_iconPolicy from "../lib/iconPolicy.js";
import type * as lib_indicators from "../lib/indicators.js";
import type * as lib_knowledge from "../lib/knowledge.js";
import type * as lib_knowledgeServe from "../lib/knowledgeServe.js";
import type * as lib_knowledgeTools from "../lib/knowledgeTools.js";
import type * as lib_knowledgeValidators from "../lib/knowledgeValidators.js";
import type * as lib_leakedReasoning from "../lib/leakedReasoning.js";
import type * as lib_liveMetric from "../lib/liveMetric.js";
import type * as lib_manualExclusions from "../lib/manualExclusions.js";
import type * as lib_mcpClient from "../lib/mcpClient.js";
import type * as lib_openrouter from "../lib/openrouter.js";
import type * as lib_pancakeswapTrade from "../lib/pancakeswapTrade.js";
import type * as lib_probe from "../lib/probe.js";
import type * as lib_publicAgent from "../lib/publicAgent.js";
import type * as lib_rank from "../lib/rank.js";
import type * as lib_reputationRegistry from "../lib/reputationRegistry.js";
import type * as lib_safeFetch from "../lib/safeFetch.js";
import type * as lib_screen from "../lib/screen.js";
import type * as lib_searchRank from "../lib/searchRank.js";
import type * as lib_secretBox from "../lib/secretBox.js";
import type * as lib_shelves from "../lib/shelves.js";
import type * as lib_statsCategory from "../lib/statsCategory.js";
import type * as lib_statsHistory from "../lib/statsHistory.js";
import type * as lib_strategy from "../lib/strategy.js";
import type * as lib_toolCapability from "../lib/toolCapability.js";
import type * as lib_tradeIntent from "../lib/tradeIntent.js";
import type * as lib_tradeKeyPolicy from "../lib/tradeKeyPolicy.js";
import type * as lib_tradeTokens from "../lib/tradeTokens.js";
import type * as lib_tradingPlaybook from "../lib/tradingPlaybook.js";
import type * as lib_triggerSync from "../lib/triggerSync.js";
import type * as lib_usageRank from "../lib/usageRank.js";
import type * as lib_walletActionLogs from "../lib/walletActionLogs.js";
import type * as lib_walletAuth from "../lib/walletAuth.js";
import type * as lib_x402 from "../lib/x402.js";
import type * as liveness from "../liveness.js";
import type * as model_agent from "../model/agent.js";
import type * as modelKeys from "../modelKeys.js";
import type * as myAgents from "../myAgents.js";
import type * as paperTrading from "../paperTrading.js";
import type * as protocols_aave from "../protocols/aave.js";
import type * as protocols_pancakeswap from "../protocols/pancakeswap.js";
import type * as protocols_types from "../protocols/types.js";
import type * as protocols_unavailable from "../protocols/unavailable.js";
import type * as protocols_venus from "../protocols/venus.js";
import type * as ranking from "../ranking.js";
import type * as setAndQuest from "../setAndQuest.js";
import type * as shelves from "../shelves.js";
import type * as sources_scan8004 from "../sources/scan8004.js";
import type * as strategy from "../strategy.js";
import type * as tracking from "../tracking.js";
import type * as trade from "../trade.js";
import type * as verification from "../verification.js";
import type * as walletActions from "../walletActions.js";
import type * as walletAuth from "../walletAuth.js";
import type * as walletHistory from "../walletHistory.js";
import type * as x402 from "../x402.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  agentBuilder: typeof agentBuilder;
  agentHires: typeof agentHires;
  agentMemoryCheck: typeof agentMemoryCheck;
  agentPayments: typeof agentPayments;
  agentRetention: typeof agentRetention;
  agentReviews: typeof agentReviews;
  agentSessions: typeof agentSessions;
  agentTools: typeof agentTools;
  agentTrials: typeof agentTrials;
  agents: typeof agents;
  autopilot: typeof autopilot;
  autotrade: typeof autotrade;
  balance: typeof balance;
  brainModels: typeof brainModels;
  builtAgentMoves: typeof builtAgentMoves;
  builtAgentServer: typeof builtAgentServer;
  builtAgents: typeof builtAgents;
  catalogQuality: typeof catalogQuality;
  categoryStats: typeof categoryStats;
  categoryStatsValidators: typeof categoryStatsValidators;
  census: typeof census;
  chatDeletion: typeof chatDeletion;
  chatTitles: typeof chatTitles;
  crons: typeof crons;
  discovery: typeof discovery;
  dolphin: typeof dolphin;
  engagement: typeof engagement;
  envVars: typeof envVars;
  erc8183Seller: typeof erc8183Seller;
  facets: typeof facets;
  favorites: typeof favorites;
  freeCalls: typeof freeCalls;
  healthAlerts: typeof healthAlerts;
  http: typeof http;
  iconProcessing: typeof iconProcessing;
  knowledge: typeof knowledge;
  "lib/agentBlocks": typeof lib_agentBlocks;
  "lib/agentMemory": typeof lib_agentMemory;
  "lib/agentSpec": typeof lib_agentSpec;
  "lib/agentTransaction": typeof lib_agentTransaction;
  "lib/analyticalBlocks": typeof lib_analyticalBlocks;
  "lib/answerHygiene": typeof lib_answerHygiene;
  "lib/balanceIntent": typeof lib_balanceIntent;
  "lib/binanceMarket": typeof lib_binanceMarket;
  "lib/bscClient": typeof lib_bscClient;
  "lib/builderBlocks": typeof lib_builderBlocks;
  "lib/categorize": typeof lib_categorize;
  "lib/dataSources": typeof lib_dataSources;
  "lib/decisionTools": typeof lib_decisionTools;
  "lib/dedupe": typeof lib_dedupe;
  "lib/email": typeof lib_email;
  "lib/erc8183": typeof lib_erc8183;
  "lib/erc8183Seller": typeof lib_erc8183Seller;
  "lib/firstParty": typeof lib_firstParty;
  "lib/iconPolicy": typeof lib_iconPolicy;
  "lib/indicators": typeof lib_indicators;
  "lib/knowledge": typeof lib_knowledge;
  "lib/knowledgeServe": typeof lib_knowledgeServe;
  "lib/knowledgeTools": typeof lib_knowledgeTools;
  "lib/knowledgeValidators": typeof lib_knowledgeValidators;
  "lib/leakedReasoning": typeof lib_leakedReasoning;
  "lib/liveMetric": typeof lib_liveMetric;
  "lib/manualExclusions": typeof lib_manualExclusions;
  "lib/mcpClient": typeof lib_mcpClient;
  "lib/openrouter": typeof lib_openrouter;
  "lib/pancakeswapTrade": typeof lib_pancakeswapTrade;
  "lib/probe": typeof lib_probe;
  "lib/publicAgent": typeof lib_publicAgent;
  "lib/rank": typeof lib_rank;
  "lib/reputationRegistry": typeof lib_reputationRegistry;
  "lib/safeFetch": typeof lib_safeFetch;
  "lib/screen": typeof lib_screen;
  "lib/searchRank": typeof lib_searchRank;
  "lib/secretBox": typeof lib_secretBox;
  "lib/shelves": typeof lib_shelves;
  "lib/statsCategory": typeof lib_statsCategory;
  "lib/statsHistory": typeof lib_statsHistory;
  "lib/strategy": typeof lib_strategy;
  "lib/toolCapability": typeof lib_toolCapability;
  "lib/tradeIntent": typeof lib_tradeIntent;
  "lib/tradeKeyPolicy": typeof lib_tradeKeyPolicy;
  "lib/tradeTokens": typeof lib_tradeTokens;
  "lib/tradingPlaybook": typeof lib_tradingPlaybook;
  "lib/triggerSync": typeof lib_triggerSync;
  "lib/usageRank": typeof lib_usageRank;
  "lib/walletActionLogs": typeof lib_walletActionLogs;
  "lib/walletAuth": typeof lib_walletAuth;
  "lib/x402": typeof lib_x402;
  liveness: typeof liveness;
  "model/agent": typeof model_agent;
  modelKeys: typeof modelKeys;
  myAgents: typeof myAgents;
  paperTrading: typeof paperTrading;
  "protocols/aave": typeof protocols_aave;
  "protocols/pancakeswap": typeof protocols_pancakeswap;
  "protocols/types": typeof protocols_types;
  "protocols/unavailable": typeof protocols_unavailable;
  "protocols/venus": typeof protocols_venus;
  ranking: typeof ranking;
  setAndQuest: typeof setAndQuest;
  shelves: typeof shelves;
  "sources/scan8004": typeof sources_scan8004;
  strategy: typeof strategy;
  tracking: typeof tracking;
  trade: typeof trade;
  verification: typeof verification;
  walletActions: typeof walletActions;
  walletAuth: typeof walletAuth;
  walletHistory: typeof walletHistory;
  x402: typeof x402;
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
