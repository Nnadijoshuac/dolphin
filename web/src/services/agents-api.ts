import type { Agent } from "@/types/agent";

/**
 * All that is left of this module is local search ranking over an agent list
 * this site has already been handed.
 *
 * It used to hold a full copy of the mobile app's 8004scan client: fetchAgents,
 * fetchAgentById, the indexed-record decode, the metric wrappers, all ~435
 * lines of it. Every one of those was a second implementation of rules that
 * now live once in convex/lib/agentCatalog.ts and reach both frontends through
 * agents.listAgents. Two copies of a decode is two ways to disagree about the
 * same agent, which is the drift this deletion exists to prevent.
 *
 * Searching stays client-side on purpose: it runs over a list already in
 * memory, needs no network, and ranks nothing that a judge reads as a claim
 * about the agent - it only decides display order.
 */
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
      (result): result is { agent: Agent; index: number; score: number } =>
        result !== null,
    )
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ agent }) => agent);
}
