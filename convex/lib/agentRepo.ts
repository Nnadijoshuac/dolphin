import { describeLocked, describeRule, type Rule } from "./strategy";

/**
 * EVERY BUILT AGENT GETS A PUBLIC REPOSITORY (owner, 2026-10-04: "push each built agent to a public
 * GitHub repo automatically"). Set and Earn asks for the agent's repository to be public, with its
 * registry id and chain visible on GitHub. A Dolphin-built agent is a spec run by Dolphin's open-source
 * engine, so its repository holds that spec and says plainly where the engine is.
 *
 * Pure: builds the files from a listing. convex/agentRepos.ts sends them to GitHub.
 *
 * What is NEVER written: keys, session tokens, report tokens, the payout key, or a copied setup's
 * locked conditions (describeLocked). Everything else here is already public in the agent's
 * registration file or on its Dolphin page.
 */

export const ENGINE_REPO = "https://github.com/Nnadijoshuac/dolphin";

export type RepoListing = {
  hash: string;
  name: string;
  description: string;
  instructions: string;
  category: string;
  protocol: "mcp" | "a2a";
  priceRaw: string | null;
  chainId: number;
  registry: string;
  tokenId: string;
  agentKey: string;
  ownerAddress: string;
  registerTxHash: string | null;
  registeredAt: string | null;
  blocks: { type: string; config: unknown }[];
  tools: { agentName: string; toolName: string }[];
};

export type RepoContext = { registrationUrl: string; agentPageUrl: string; mcpUrl: string };

/** A repository name GitHub accepts, unique per agent: "<name>-<chain>-<token id>". */
export function repoName(listing: Pick<RepoListing, "name" | "chainId" | "tokenId">): string {
  const slug = listing.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return `${slug || "agent"}-${listing.chainId}-${listing.tokenId}`;
}

function chainName(chainId: number): string {
  return chainId === 56 ? "BNB Smart Chain mainnet (56)" : chainId === 97 ? "BNB Smart Chain testnet (97)" : `chain ${chainId}`;
}

function explorer(chainId: number): string {
  return chainId === 97 ? "https://testnet.bscscan.com" : "https://bscscan.com";
}

function priceWords(listing: RepoListing): string {
  if (!listing.priceRaw || /^0+$/.test(listing.priceRaw)) return "Free";
  const u = Number(BigInt(listing.priceRaw)) / 1e18;
  return `${u.toLocaleString("en", { maximumFractionDigits: 6 })} U per ${listing.protocol === "mcp" ? "call" : "job"}, paid with x402`;
}

/** The rules in words: a locked rule keeps its conditions hidden; a grid is one line. */
export function rulesInWords(rules: readonly Rule[]): string[] {
  const out: string[] = [];
  const grids = new Set<string>();
  for (const rule of rules) {
    if (rule.grid) {
      if (grids.has(rule.grid.id)) continue;
      grids.add(rule.grid.id);
      const levels = rules.filter((candidate) => candidate.grid?.id === rule.grid!.id);
      out.push(
        `Grid on ${rule.market}: ${rule.grid.of} levels from $${rule.grid.lower} to $${rule.grid.upper}, $${rule.sizeUsd} each. Each level buys when a 5-minute candle closes under it and sells one step higher.${
          levels[0].stopLossPct !== null ? " A stop below the range closes every level." : ""
        }`,
      );
      continue;
    }
    out.push(rule.locked ? describeLocked(rule) : describeRule(rule));
  }
  return out;
}

/** The public spec, as JSON. Rules go in as words and, unless locked, as data. */
export function agentJson(listing: RepoListing, rules: readonly Rule[], context: RepoContext): string {
  const spec = {
    name: listing.name,
    description: listing.description,
    category: listing.category,
    erc8004: {
      chainId: listing.chainId,
      registry: listing.registry,
      agentId: listing.tokenId,
      agentKey: listing.agentKey,
      owner: listing.ownerAddress,
      registrationTx: listing.registerTxHash,
      registeredAt: listing.registeredAt,
      registrationFile: context.registrationUrl,
    },
    protocol: listing.protocol,
    endpoint: context.mcpUrl,
    price: priceWords(listing),
    instructions: listing.instructions,
    blocks: listing.blocks.map(({ type, config }) => ({ type, config })),
    tools: listing.tools.map(({ agentName, toolName }) => ({ agent: agentName, tool: toolName })),
    rules: rules.map((rule) =>
      rule.locked
        ? { locked: true, words: describeLocked(rule), market: rule.market, timeframe: rule.timeframe, sizeUsd: rule.sizeUsd, stopLossPct: rule.stopLossPct, takeProfitPct: rule.takeProfitPct }
        : { ...rule, words: describeRule(rule) },
    ),
    engine: ENGINE_REPO,
  };
  return `${JSON.stringify(spec, null, 2)}\n`;
}

export function readme(listing: RepoListing, rules: readonly Rule[], context: RepoContext): string {
  const tx = listing.registerTxHash ? `[${listing.registerTxHash.slice(0, 10)}…](${explorer(listing.chainId)}/tx/${listing.registerTxHash})` : "pending";
  const words = rulesInWords(rules);
  return [
    `# ${listing.name}`,
    "",
    listing.description,
    "",
    "## On-chain identity",
    "",
    "| | |",
    "|---|---|",
    `| Standard | ERC-8004 |`,
    `| Chain | ${chainName(listing.chainId)} |`,
    `| Registry | [${listing.registry}](${explorer(listing.chainId)}/address/${listing.registry}) |`,
    `| Agent ID | **${listing.tokenId}** |`,
    `| Agent key | \`${listing.agentKey}\` |`,
    `| Owner | [${listing.ownerAddress}](${explorer(listing.chainId)}/address/${listing.ownerAddress}) |`,
    `| Registration tx | ${tx} |`,
    `| Category | ${listing.category} |`,
    "",
    "## Use it",
    "",
    `- Agent page: ${context.agentPageUrl}`,
    `- Endpoint (${listing.protocol.toUpperCase()}): ${context.mcpUrl}`,
    `- Registration file: ${context.registrationUrl}`,
    `- Price: ${priceWords(listing)}`,
    "",
    ...(words.length > 0 ? ["## What it does on its own", "", ...words.map((line) => `- ${line}`), ""] : []),
    "## How it runs",
    "",
    `This agent was built on [Dolphin](https://www.dolphinamp.xyz) and runs on Dolphin's engine, which is open source: ${ENGINE_REPO}. The whole agent - its instructions, blocks, tools and rules - is in [agent.json](agent.json). Trading rules are judged on closed candles with no AI model in the loop (\`convex/lib/strategy.ts\` and \`convex/lib/grid.ts\` in the engine repository).`,
    "",
    "Built with Dolphin. Not financial advice.",
    "",
  ].join("\n");
}
