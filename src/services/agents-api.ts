import { getAddress, isAddress } from "viem";
import type { Address } from "viem";

import {
  AGENT_DATA_SOURCES,
  AGENTS_API,
  BSC_CHAIN_ID,
  ERC8004_REGISTRY_ADDRESSES,
} from "@/constants/agents";
import {
  EDITORIAL_AGENTS,
  findEditorialAgent,
} from "@/data/editorial-agents";
import type {
  Agent,
  AgentEndpointStatus,
  AgentService,
  AgentSkill,
  LiveMetric,
} from "@/types/agent";

type UnknownRecord = Record<string, unknown>;

export class AgentsApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "AgentsApiError";
    this.status = status;
  }
}

export interface AgentsRequestOptions {
  signal?: AbortSignal;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const candidate = value.trim();
  if (candidate.length === 0) {
    return value;
  }

  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return value;
  }
}

function readString(record: UnknownRecord, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function readBoolean(record: UnknownRecord, key: string): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

function readNumber(record: UnknownRecord, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readDate(record: UnknownRecord, key: string): string | null {
  const value = readString(record, key);
  return value !== null && Number.isFinite(Date.parse(value)) ? value : null;
}

function readAddress(record: UnknownRecord, key: string): Address | null {
  const value = readString(record, key);

  if (value === null || !isAddress(value)) {
    return null;
  }

  return getAddress(value);
}

function readHttpUrl(record: UnknownRecord, key: string): string | null {
  const value = readString(record, key);

  if (value === null) {
    return null;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? value
      : null;
  } catch {
    return null;
  }
}

function readStringArray(record: UnknownRecord, key: string): string[] {
  const value = parseJsonValue(record[key]);

  if (typeof value === "string" && value.trim().length > 0) {
    return [value.trim()];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  );
}

function liveIndexedMetric<T>(
  value: T,
  asOf: string,
  methodology?: string,
): LiveMetric<T> {
  return {
    status: "live",
    value,
    asOf,
    source: AGENT_DATA_SOURCES.scan,
    methodology,
  };
}

function unavailableIndexedMetric<T>(
  reason: string,
  asOf: string | null,
): LiveMetric<T> {
  return {
    status: "unavailable",
    value: null,
    asOf,
    source: AGENT_DATA_SOURCES.scan,
    reason,
  };
}

function decodeServices(value: unknown): AgentService[] {
  const services: AgentService[] = [];
  const decodedValue = parseJsonValue(value);

  const append = (name: string, candidate: unknown) => {
    if (!isRecord(candidate)) {
      return;
    }

    const endpoint = readHttpUrl(candidate, "endpoint");
    if (endpoint === null) {
      return;
    }

    services.push({
      name,
      endpoint,
      version: readString(candidate, "version"),
    });
  };

  if (Array.isArray(decodedValue)) {
    for (const candidate of decodedValue) {
      if (!isRecord(candidate)) {
        continue;
      }

      append(readString(candidate, "name") ?? "Agent service", candidate);
    }
  } else if (isRecord(decodedValue)) {
    for (const [name, candidate] of Object.entries(decodedValue)) {
      append(name, candidate);
    }
  }

  return services;
}

function decodeEndpointStatus(
  record: UnknownRecord,
  indexedAt: string,
): LiveMetric<AgentEndpointStatus> {
  const healthStatus = record.health_status;

  if (!isRecord(healthStatus)) {
    return unavailableIndexedMetric(
      "8004scan has not published a recent endpoint health check.",
      indexedAt,
    );
  }

  const value = readString(healthStatus, "overall_status");
  if (
    value !== "healthy" &&
    value !== "degraded" &&
    value !== "unhealthy" &&
    value !== "unknown"
  ) {
    return unavailableIndexedMetric(
      "8004scan has not published a recognized endpoint health result.",
      readDate(healthStatus, "checked_at") ?? indexedAt,
    );
  }

  return liveIndexedMetric(
    value,
    readDate(healthStatus, "checked_at") ?? indexedAt,
    "Endpoint status checked by 8004scan; it is not an ERC-8004 capability guarantee.",
  );
}

function decodeSkills(record: UnknownRecord, fallback: Agent): AgentSkill[] {
  const indexedSkills = [
    ...readStringArray(record, "supported_protocols"),
    ...readStringArray(record, "tags"),
  ];
  const seen = new Set(fallback.skills.map(({ name }) => name.toLowerCase()));
  const skills = [...fallback.skills];

  for (const name of indexedSkills) {
    const key = name.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    skills.push({ name, evidence: "registry-metadata" });
  }

  return skills;
}

function selectPublisher(
  record: UnknownRecord,
  ownerAddress: Address | null,
  fallback: Agent,
): string {
  return (
    readString(record, "owner_certified_name") ??
    readString(record, "owner_username") ??
    readString(record, "owner_ens") ??
    ownerAddress ??
    fallback.publisher
  );
}

function decodeIndexedAgent(payload: unknown, fallback: Agent): Agent {
  if (!isRecord(payload)) {
    throw new AgentsApiError("8004scan returned a non-object agent record.");
  }

  const tokenId = readString(payload, "token_id");
  const chainId = readNumber(payload, "chain_id");
  const contractAddress = readString(payload, "contract_address");

  if (
    tokenId !== fallback.tokenId ||
    chainId !== BSC_CHAIN_ID ||
    contractAddress?.toLowerCase() !==
      ERC8004_REGISTRY_ADDRESSES.identity.toLowerCase()
  ) {
    throw new AgentsApiError(
      "8004scan returned an agent outside the requested BSC registry identity.",
    );
  }

  const fetchedAt = new Date().toISOString();
  const indexedAt = readDate(payload, "updated_at") ?? fetchedAt;
  const ownerAddress = readAddress(payload, "owner_address");
  const indexedWallet = readAddress(payload, "agent_wallet");
  const x402Supported = readBoolean(payload, "x402_supported");
  const isActive = readBoolean(payload, "is_active");
  const totalFeedbacks = readNumber(payload, "total_feedbacks");
  const averageScore = readNumber(payload, "average_score");

  const reputationScore =
    totalFeedbacks !== null && totalFeedbacks > 0 && averageScore !== null
      ? liveIndexedMetric(
          averageScore,
          indexedAt,
          "Unfiltered 8004scan feedback aggregate. Review count and reviewer trust must be considered separately.",
        )
      : unavailableIndexedMetric<number>(
          "No indexed ERC-8004 feedback is available for a reputation score.",
          indexedAt,
        );

  const feedbackCount =
    totalFeedbacks !== null && totalFeedbacks >= 0
      ? liveIndexedMetric(totalFeedbacks, indexedAt)
      : unavailableIndexedMetric<number>(
          "8004scan did not return a feedback count.",
          indexedAt,
        );

  // priceModel is deliberately absent from this decode and inherited from
  // `fallback` via the spread below: 8004scan's agent payload has no price
  // field of any kind (verified against a full raw response), so there is
  // nothing here to decode. Leaving it out is what keeps a live refresh from
  // regressing an agent back to an unresolved price and re-breaking the hire
  // button - see DEFAULT_READ_ONLY_PRICE_MODEL in src/constants/agents.ts.
  return {
    ...fallback,
    id: fallback.id,
    tokenId,
    name: readString(payload, "name") ?? fallback.name,
    publisher: selectPublisher(payload, ownerAddress, fallback),
    publisherAddress: ownerAddress ?? fallback.publisherAddress,
    description: readString(payload, "description") ?? fallback.description,
    iconUrl: readHttpUrl(payload, "image_url") ?? fallback.iconUrl,
    registeredAt: readDate(payload, "created_at") ?? fallback.registeredAt,
    agentWallet: indexedWallet,
    skills: decodeSkills(payload, fallback),
    verifiedSkills: [],
    services: decodeServices(payload.services),
    x402Supported:
      x402Supported === null
        ? unavailableIndexedMetric(
            "8004scan did not return x402 support metadata.",
            indexedAt,
          )
        : liveIndexedMetric(x402Supported, indexedAt),
    isActive:
      isActive === null
        ? unavailableIndexedMetric(
            "8004scan did not return an active-state value.",
            indexedAt,
          )
        : liveIndexedMetric(isActive, indexedAt),
    reputationScore,
    feedbackCount,
    endpointStatus: decodeEndpointStatus(payload, indexedAt),
    sourceLabels: [
      AGENT_DATA_SOURCES.editorial,
      AGENT_DATA_SOURCES.publisher,
      AGENT_DATA_SOURCES.scan,
    ],
    recordStatus: "indexed",
  };
}

async function fetchJson(
  path: string,
  options: AgentsRequestOptions,
): Promise<unknown> {
  const response = await fetch(`${AGENTS_API.baseUrl}${path}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: options.signal,
  });

  if (!response.ok) {
    throw new AgentsApiError(
      `8004scan request failed with status ${response.status}.`,
      response.status,
    );
  }

  try {
    return (await response.json()) as unknown;
  } catch {
    throw new AgentsApiError("8004scan returned invalid JSON.", response.status);
  }
}

async function fetchIndexedAgent(
  fallback: Agent,
  options: AgentsRequestOptions,
): Promise<Agent> {
  const response = await fetchJson(
    `/agents/${BSC_CHAIN_ID}/${encodeURIComponent(fallback.tokenId)}`,
    options,
  );

  if (!isRecord(response) || !isRecord(response.data)) {
    throw new AgentsApiError("8004scan returned an invalid response envelope.");
  }

  if (readBoolean(response, "success") === false) {
    throw new AgentsApiError("8004scan reported an unsuccessful agent request.");
  }

  return decodeIndexedAgent(response.data, fallback);
}

function fallbackCopy(agent: Agent): Agent {
  return {
    ...agent,
    skills: [...agent.skills],
    verifiedSkills: [...agent.verifiedSkills],
    services: [...agent.services],
    performanceSeries: [...agent.performanceSeries],
    recentActivity: [...agent.recentActivity],
    sourceLabels: [...agent.sourceLabels],
  };
}

export async function fetchAgents(
  options: AgentsRequestOptions = {},
): Promise<Agent[]> {
  return Promise.all(
    EDITORIAL_AGENTS.map(async (fallback) => {
      try {
        return await fetchIndexedAgent(fallback, options);
      } catch (error) {
        if (options.signal?.aborted) {
          throw error;
        }

        return fallbackCopy(fallback);
      }
    }),
  );
}

export async function fetchAgentById(
  reference: string,
  options: AgentsRequestOptions = {},
): Promise<Agent> {
  const fallback = findEditorialAgent(reference);

  if (fallback === undefined) {
    throw new AgentsApiError(
      "This agent is not in Dolphin's explicitly classified BSC discovery set.",
    );
  }

  try {
    return await fetchIndexedAgent(fallback, options);
  } catch (error) {
    if (options.signal?.aborted) {
      throw error;
    }

    return fallbackCopy(fallback);
  }
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function searchAgentsLocally(
  agents: readonly Agent[],
  query: string,
): Agent[] {
  const normalizedQuery = normalizeSearchText(query).trim();

  if (normalizedQuery.length === 0) {
    return [...agents];
  }

  const terms = normalizedQuery.split(/\s+/).filter(Boolean);

  return agents
    .map((agent, index) => {
      const name = normalizeSearchText(agent.name);
      const category = normalizeSearchText(agent.category.replace(/-/g, " "));
      const haystack = normalizeSearchText(
        [
          agent.name,
          agent.publisher,
          agent.category,
          agent.tagline,
          agent.description,
          ...agent.skills.map(({ name: skillName }) => skillName),
        ].join(" "),
      );

      if (!terms.every((term) => haystack.includes(term))) {
        return null;
      }

      const score =
        (name === normalizedQuery ? 100 : 0) +
        (name.startsWith(normalizedQuery) ? 40 : 0) +
        (category.includes(normalizedQuery) ? 20 : 0);

      return { agent, index, score };
    })
    .filter(
      (
        result,
      ): result is { agent: Agent; index: number; score: number } =>
        result !== null,
    )
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ agent }) => agent);
}
