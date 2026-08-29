import { getAddress, isAddress } from "viem";
import type { Address } from "viem";

import { unavailableLiveStats, unavailableMetric, unverifiedRegistry } from "@/data/editorial-agents";
import {
  AGENT_DATA_SOURCES,
  ERC8004_REGISTRY_ADDRESSES,
  defaultReadOnlyPriceMetric,
} from "@/constants/agents";
import type { Agent } from "@/types/agent";

// Mirrors the discoveredAgents table in convex/discoveredAgents.ts -
// Convex validators aren't generated as TS types, so keep this in sync by
// hand if that schema changes.
export interface DiscoveredAgentRecord {
  tokenId: string;
  name: string;
  description: string;
  iconUrl: string | null;
  ownerAddress: string;
  category: Agent["category"];
  confidence: "confirmed" | "likely";
  matchedTerms: string[];
  x402Supported: boolean;
  registeredAt: string | null;
  syncedAt: string;
}

function deriveTagline(description: string): string {
  const trimmed = description.trim();
  const firstSentence = trimmed.split(/(?<=[.!?])\s/)[0] ?? trimmed;
  return firstSentence.length > 140 ? `${firstSentence.slice(0, 137)}...` : firstSentence;
}

function liveMetric<T>(value: T, asOf: string): { status: "live"; value: T; asOf: string; source: typeof AGENT_DATA_SOURCES.scan } {
  return { status: "live", value, asOf, source: AGENT_DATA_SOURCES.scan };
}

/**
 * Maps one convex discoveredAgents row (real 8004scan data, category
 * assigned by convex/lib/classification.ts's keyword heuristic - not a
 * human) into the normalized Agent shape the rest of the app renders.
 * classificationSource/classificationConfidence carry that provenance
 * through so a future UI could visibly distinguish these from the
 * hand-vetted editorial agents, per the "looser, labeled by confidence"
 * decision.
 */
export function discoveredAgentToAgent(row: DiscoveredAgentRecord): Agent {
  const identityAddress = ERC8004_REGISTRY_ADDRESSES.identity.toLowerCase();
  const ownerAddress: Address | null = isAddress(row.ownerAddress) ? getAddress(row.ownerAddress) : null;

  return {
    id: `56:${identityAddress}:${row.tokenId}`,
    tokenId: row.tokenId,
    chain: "bsc",
    chainId: 56,
    registryAddress: ERC8004_REGISTRY_ADDRESSES.identity,
    name: row.name,
    publisher: row.ownerAddress,
    publisherAddress: ownerAddress,
    category: row.category,
    classificationSource: "heuristic-keyword-match",
    classificationConfidence: row.confidence,
    tagline: deriveTagline(row.description),
    description: row.description,
    iconUrl: row.iconUrl,
    registeredAt: row.registeredAt,
    agentWallet: null,
    skills: row.matchedTerms.map((term) => ({ name: term, evidence: "publisher-reported" as const })),
    verifiedSkills: [],
    services: [],
    x402Supported: liveMetric(row.x402Supported, row.syncedAt),
    isActive: unavailableMetric<boolean>(
      "Registry activity has not been refreshed from the indexer.",
      AGENT_DATA_SOURCES.scan,
    ),
    reputationScore: unavailableMetric<number>(
      "No reviewer-filtered reputation score is available.",
      AGENT_DATA_SOURCES.registry,
    ),
    feedbackCount: unavailableMetric<number>(
      "Feedback count has not been refreshed from the indexer.",
      AGENT_DATA_SOURCES.scan,
    ),
    endpointStatus: unavailableMetric(
      "No recent endpoint health check is available.",
      AGENT_DATA_SOURCES.scan,
    ),
    liveStats: unavailableLiveStats(row.category),
    performanceSeries: [],
    recentActivity: [],
    // Dolphin's own hire price, not a publisher-published one - see
    // DEFAULT_READ_ONLY_PRICE_MODEL for the full decision and how to reverse it.
    priceModel: defaultReadOnlyPriceMetric(),
    registryVerification: unverifiedRegistry(),
    sourceLabels: [AGENT_DATA_SOURCES.scan, AGENT_DATA_SOURCES.publisher, AGENT_DATA_SOURCES.heuristicDiscovery],
    recordStatus: "indexed",
  };
}
