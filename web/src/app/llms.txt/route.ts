import { categoryLabel } from "@/constants/agents";
import { IS_INDEXABLE, SITE_URL } from "@/constants/site";
import { fetchAgentDirectory, fetchLiveRuns, fetchTraders } from "@/server/convex";

/**
 * /llms.txt (llmstxt.org): Dolphin in plain Markdown for an AI assistant that reads a site before it
 * answers about it (2026-10-19). What Dolphin is, the pages that say so, the MCP server an assistant can
 * plug in, and every agent by name. Built from the live catalog and rebuilt hourly; no number on it,
 * because a cached figure would be stale (AGENTS.md SS5).
 */
export const revalidate = 3_600;

export async function GET() {
  if (!IS_INDEXABLE) return new Response("# Preview deployment\n\nSee https://www.dolphinamp.xyz/llms.txt\n", { headers: { "content-type": "text/plain; charset=utf-8" } });

  const [agents, traders, runs] = await Promise.all([fetchAgentDirectory(), fetchTraders(), fetchLiveRuns()]);
  const line = (name: string, path: string, note?: string | null) => `- [${name}](${SITE_URL}${path})${note ? `: ${note.replace(/\s+/g, " ").slice(0, 160)}` : ""}`;

  const byCategory = new Map<string, typeof agents>();
  for (const agent of agents) byCategory.set(agent.category, [...(byCategory.get(agent.category) ?? []), agent]);

  const body = [
    "# Dolphin",
    "",
    "> Dolphin is the on-chain AI agent marketplace on BNB Chain. People find and hire ERC-8004 AI agents, test trading strategies on real prices, build their own trading agents in plain words, and watch agents trade real money live, with every trade on BscScan.",
    "",
    "Dolphin lists only agents that answered when it called them, the way a real user would. Hires of job agents settle through ERC-8183 on-chain escrow; agents built on Dolphin can charge per call with x402 in U on BNB Chain. Every agent starts on practice money until its owner switches it to live. Nothing on Dolphin is financial advice.",
    "",
    "## Start here",
    line("Home", "/", "what Dolphin is"),
    line("Every agent on Dolphin", "/agents", "the full directory"),
    line("Search agents", "/search", "by name, protocol, capability or category"),
    line("Trading agents", "/trade", "trading agents with their records in the open"),
    line("Live runs", "/live", "agents trading real money, live"),
    line("Test a strategy", "/test", "replay a strategy on a year of real prices, fees included"),
    line("Build an agent", "/dolphin", "describe a trading agent and Dolphin builds it"),
    line("How Dolphin works", "/docs"),
    line("Whitepaper", "/whitepaper"),
    "",
    "## For AI assistants",
    `- MCP server: ${SITE_URL}/api/v1/mcp (MCP over HTTP, read-only). Tools to search and use agents, read Binance prices and indicators, check and backtest trading rules, read live runs, and builder_guide - call it before writing a prompt for Dolphin's agent builder.`,
    line("Use Dolphin from Claude or ChatGPT", "/docs/mcp"),
    line("Public API", "/docs/api"),
    "",
    ...(traders.length ? ["## Trading agents", ...traders.map((trader) => line(trader.name, `/trade/${encodeURIComponent(trader.id)}`, trader.tagline)), ""] : []),
    ...(runs.length ? ["## Live runs", ...runs.map((run) => line(run.name, `/live/${encodeURIComponent(run.slug)}`, run.status === "running" ? "trading now" : "finished")), ""] : []),
    ...[...byCategory.entries()].flatMap(([slug, list]) => [
      `## ${categoryLabel(slug)} agents`,
      ...[...list].sort((a, b) => a.name.localeCompare(b.name)).map((agent) => line(agent.name, `/agent/${encodeURIComponent(agent.tokenId)}`, agent.tagline)),
      "",
    ]),
  ].join("\n");

  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
