/**
 * THE BUILDER SETS UP BLOCKS (owner, 2026-09-29: Dolphin should understand
 * "what a trading agent should have"). The builder model proposes blocks in a
 * small, flat shape; this turns them into real blocks, and decides.
 *
 * What the model may add: Schedule, Price, Market, Safety, Risk limits, Swap.
 * What it may NOT, because each needs the person: Wallet (funding and
 * custody), Memory (their own server), Hire (a paid agent), Wallet watch (an
 * address it would have to invent). The builder tells them to add those.
 *
 * The model never supplies an address. A Market is a SYMBOL from Dolphin's
 * verified token list, resolved here to its contract and deepest pool. The
 * builder only adds or updates; it never removes a block the person made.
 */

import { getAddress } from "viem";

import { bscPairFor, SCHEDULE_CHOICES, validateBlocks, type AgentBlock } from "./agentBlocks";
import { verifiedTokenBySymbol } from "./tradeTokens";

export type BuilderBlock = {
  type: string;
  symbol: string | null;
  everyMinutes: number | null;
  direction: string | null;
  priceUsd: number | null;
  maxTradeUsd: number | null;
  maxTradesPerDay: number | null;
};

export const BUILDER_BLOCK_TYPES = ["schedule", "price", "market", "safety", "risk", "swap"] as const;

const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";

function newId(type: string): string {
  return `${type.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nearestSchedule(minutes: number): number {
  return [...SCHEDULE_CHOICES].sort((a, b) => Math.abs(a - minutes) - Math.abs(b - minutes))[0];
}

/**
 * The draft's blocks with the builder's proposals merged in, and what
 * happened, in words for the reply. Never throws: a proposal that cannot be
 * made safe is skipped and named.
 */
export async function mergeBuilderBlocks(
  current: readonly AgentBlock[],
  proposed: readonly BuilderBlock[],
): Promise<{ blocks: AgentBlock[]; added: string[]; skipped: string[] }> {
  const next: AgentBlock[] = [...current];
  const added: string[] = [];
  const skipped: string[] = [];
  const put = (block: AgentBlock, label: string) => {
    const at = next.findIndex((existing) => existing.type === block.type);
    if (at >= 0) next[at] = { ...block, id: next[at].id } as AgentBlock;
    else next.push(block);
    added.push(label);
  };

  for (const raw of proposed.slice(0, 8)) {
    const type = String(raw.type ?? "").toLowerCase();
    if (!(BUILDER_BLOCK_TYPES as readonly string[]).includes(type)) continue;
    switch (type) {
      case "schedule": {
        const everyMinutes = nearestSchedule(Number(raw.everyMinutes) > 0 ? Number(raw.everyMinutes) : 60);
        put({ id: newId(type), type: "schedule", config: { everyMinutes } }, `a schedule every ${everyMinutes >= 60 ? `${everyMinutes / 60} hour${everyMinutes === 60 ? "" : "s"}` : `${everyMinutes} minutes`}`);
        break;
      }
      case "market": {
        const token = raw.symbol ? verifiedTokenBySymbol(raw.symbol) : null;
        if (!token || ["USDT", "USDC", "U"].includes(token.symbol)) {
          skipped.push(`a Market for ${raw.symbol ?? "an unnamed token"} (only Dolphin's verified, non-stablecoin tokens)`);
          break;
        }
        const address = getAddress(token.address ?? WBNB);
        const pair = await bscPairFor(address).catch(() => null);
        put(
          { id: newId(type), type: "market", config: { tokenAddress: address, symbol: token.symbol, name: token.symbol, poolAddress: pair ? getAddress(pair.pairAddress) : null } },
          `the ${token.symbol} Market`,
        );
        break;
      }
      case "price": {
        const direction = raw.direction === "above" || raw.direction === "below" ? raw.direction : null;
        const priceUsd = Number(raw.priceUsd);
        if (!direction || !(priceUsd > 0)) {
          skipped.push("a Price trigger (it needs a direction and a level)");
          break;
        }
        put({ id: newId(type), type: "price", config: { direction, priceUsd } }, `a Price trigger ${direction} $${priceUsd}`);
        break;
      }
      case "risk": {
        const maxTradeUsd = Math.min(100_000, Math.max(1, Number(raw.maxTradeUsd) || 5));
        const maxTradesPerDay = Math.min(50, Math.max(1, Math.round(Number(raw.maxTradesPerDay) || 2)));
        put({ id: newId(type), type: "risk", config: { maxTradeUsd, maxTradesPerDay } }, `Risk limits of $${maxTradeUsd} a trade, ${maxTradesPerDay} a day`);
        break;
      }
      case "safety":
        put({ id: newId(type), type: "safety", config: {} }, "Safety");
        break;
      case "swap":
        put({ id: newId(type), type: "swap", config: {} }, "Swap");
        break;
    }
  }

  // The rules canvas edits follow: a Price trigger needs a Market; a Swap needs Risk limits.
  if (next.some((block) => block.type === "price") && !next.some((block) => block.type === "market")) {
    next.splice(next.findIndex((block) => block.type === "price"), 1);
    skipped.push("the Price trigger (it needs a Market)");
  }
  if (next.some((block) => block.type === "swap") && !next.some((block) => block.type === "risk")) {
    put({ id: newId("risk"), type: "risk", config: { maxTradeUsd: 5, maxTradesPerDay: 2 } }, "Risk limits of $5 a trade, 2 a day (a Swap always has limits)");
  }
  try {
    return { blocks: validateBlocks(next), added, skipped };
  } catch (cause) {
    console.warn("[builderBlocks] merged blocks failed validation; keeping the old ones:", cause);
    return { blocks: [...current], added: [], skipped: [...skipped, "the blocks it proposed (they did not fit together)"] };
  }
}
