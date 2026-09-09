/**
 * Registry of verified live marketplace agents and name resolution for Dolphin (mobile).
 *
 * Provides instant client-side resolution of agent names (e.g. "The PancakeSwap Grid Trader",
 * "Venus Liquidation Guard") to their on-chain agentKey, so that any mention in Dolphin's
 * responses can become an interactive hyperlink even if not consulted as a tool in that turn.
 */

export interface AgentDescriptor {
  name: string;
  agentKey: string;
  aliases?: string[];
}

export const KNOWN_LIVE_AGENTS: AgentDescriptor[] = [
  {
    name: "PancakeSwap Grid Trader",
    agentKey: "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:338477",
    aliases: ["PancakeSwap Grid Trading Bot", "Grid Trader Bot"],
  },
  {
    name: "Venus Liquidation Guard",
    agentKey: "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:338480",
    aliases: ["Venus Health Monitor", "Venus Guard"],
  },
  {
    name: "BNB Chain Yield Router",
    agentKey: "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:338478",
    aliases: ["Yield Router"],
  },
  {
    name: "BNB Chain Token Safety",
    agentKey: "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:338481",
    aliases: ["Token Safety Agent"],
  },
  {
    name: "PancakeSwap v3 Range Keeper",
    agentKey: "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:338475",
    aliases: ["Range Keeper"],
  },
  {
    name: "Brain on BNB — Venus Health Factor Monitor",
    agentKey: "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:302257",
    aliases: ["Venus Health Factor Monitor"],
  },
  {
    name: "Brain on BNB — Venus Yield Ranking",
    agentKey: "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:304493",
    aliases: ["Venus Yield Ranking"],
  },
  {
    name: "Brain on BNB — PancakeSwap Fee Tier Placement",
    agentKey: "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:310460",
    aliases: ["PancakeSwap Fee Tier Placement"],
  },
  {
    name: "yieldrouter — capacity-aware yield optimisation",
    agentKey: "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:341225",
  },
  {
    name: "Hevo Grid",
    agentKey: "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:340527",
  },
  {
    name: "Hevo Sentinel",
    agentKey: "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:340533",
  },
  {
    name: "Hevo Yield",
    agentKey: "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:340532",
  },
  {
    name: "Hevo Rebalance",
    agentKey: "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:340471",
  },
  {
    name: "V3 Pools powered by HeyAnon",
    agentKey: "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:45650",
  },
  {
    name: "Beefy powered by HeyAnon",
    agentKey: "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:45422",
  },
  {
    name: "Aave powered by HeyAnon",
    agentKey: "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:45381",
  },
  {
    name: "OpenOdds.Ai",
    agentKey: "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:49637",
  },
  {
    name: "ClawdMint",
    agentKey: "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:2468",
  },
  {
    name: "Topaz Agent",
    agentKey: "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:113284",
  },
  {
    name: "Brain On BNB AI ($BOBAI)",
    agentKey: "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:49467",
  },
  {
    name: "Kawal",
    agentKey: "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:320164",
  },
  {
    name: "StellarVoyager",
    agentKey: "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:120028",
  },
  {
    name: "SilentEcho",
    agentKey: "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:116972",
  },
  {
    name: "SLY",
    agentKey: "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:116170",
  },
  {
    name: "Fly Marketing Agent",
    agentKey: "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:91852",
  },
  {
    name: "Pretium",
    agentKey: "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:126728",
  },
  {
    name: "Sentinels Trading Analyst",
    agentKey: "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:320743",
  },
  {
    name: "HyperliquidVault",
    agentKey: "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:338253",
  },
  {
    name: "SwapGod",
    agentKey: "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:338265",
  },
  {
    name: "AlphaTrack",
    agentKey: "56:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:338165",
  },
];

/**
 * Builds a search dictionary mapping phrase variations to agentKey.
 */
export function buildAgentNameMap(
  dynamicAgents?: Array<{ name: string; agentKey: string }>,
  toolCalls?: Array<{ agentName: string; agentKey: string }>,
): Map<string, string> {
  const map = new Map<string, string>();

  const register = (phrase: string, key: string) => {
    const trimmed = phrase.trim();
    if (!trimmed || map.has(trimmed)) return;
    map.set(trimmed, key);

    // Also register "The " prefix if not present
    if (!trimmed.toLowerCase().startsWith("the ")) {
      const withThe = `The ${trimmed}`;
      if (!map.has(withThe)) map.set(withThe, key);
    } else {
      const withoutThe = trimmed.slice(4).trim();
      if (withoutThe && !map.has(withoutThe)) map.set(withoutThe, key);
    }
  };

  // 1. Tool calls have highest specificity for current context
  if (toolCalls) {
    for (const call of toolCalls) {
      if (call.agentName && call.agentKey) {
        register(call.agentName, call.agentKey);
      }
    }
  }

  // 2. Dynamic directory from Convex
  if (dynamicAgents) {
    for (const agent of dynamicAgents) {
      if (agent.name && agent.agentKey) {
        register(agent.name, agent.agentKey);
      }
    }
  }

  // 3. Known live marketplace agents
  for (const agent of KNOWN_LIVE_AGENTS) {
    register(agent.name, agent.agentKey);
    if (agent.aliases) {
      for (const alias of agent.aliases) {
        register(alias, agent.agentKey);
      }
    }
  }

  return map;
}
