/**
 * THE BUILDER SETS UP BLOCKS (owner, 2026-09-29: Dolphin should understand
 * "what a trading agent should have"). The builder model proposes blocks in a
 * small, flat shape; this turns them into real blocks, and decides.
 *
 * What the model may add: Schedule, Price, Market, Safety, Risk limits, Swap,
 * Indicators, Signal, and Memory (owner, 2026-10-02: "it should be the wisest
 * agent in building workflows"). Memory is placed NOT CONNECTED: Dolphin keeps
 * no agent memory, so the person adds their server's address.
 * What it may NOT, because each needs something only the person has: Hire (a
 * paid agent they choose), Wallet watch (addresses it would have to invent),
 * Data source and News (their URLs and keys), Quiet hours (their event dates).
 *
 * The model never supplies an address. A Market is a SYMBOL from Dolphin's
 * verified token list, resolved here to its contract and deepest pool. The
 * builder only adds or updates; it never removes a block the person made.
 */

import { getAddress } from "viem";

import { bscPairFor, SCHEDULE_CHOICES, TIMEFRAMES, validateBlocks, type AgentBlock, type Timeframe } from "./agentBlocks";
import { SIGNAL_CONDITIONS, type SignalCondition } from "./indicators";
import { verifiedTokenBySymbol } from "./tradeTokens";

export type BuilderBlock = {
  type: string;
  symbol: string | null;
  everyMinutes: number | null;
  direction: string | null;
  priceUsd: number | null;
  maxTradeUsd: number | null;
  maxTradesPerDay: number | null;
  timeframe?: string | null;
  condition?: string | null;
  level?: number | null;
};

export const BUILDER_BLOCK_TYPES = ["schedule", "price", "market", "safety", "risk", "swap", "indicators", "signal", "memory"] as const;

const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";

/**
 * A TOKEN-VERDICT AGENT'S RULES, ENFORCED IN CODE (2026-10-02). Measured on
 * the free builder model: asked for a token checker, it wrote "apply these
 * verdict rules in order, using the exact numbers below" - and no rules; an
 * earlier draft said "mint -> Avoid", which condemns CAKE and USDT. When a
 * draft grades tokens Safe/Caution/Avoid and carries no Avoid conditions of
 * its own, these are written in. They survive real tokens (lib/agentBlocks.ts
 * safetyReport: burned supply set apart, trusted list, unknown is not bad).
 */
export const TOKEN_VERDICT_RULES =
  "Verdict rules, checked in this order. AVOID if any: honeypot or cannot sell; sell tax above 10%; owner can change balances, set a tax for specific wallets, or take back ownership; hidden owner; the contract can self-destruct; its creator has made honeypots before. " +
  "CAUTION if any (and nothing above): buy or sell tax above 5%; owner can mint, change taxes, pause transfers or blacklist (if the token is on GoPlus's trusted list, only mention these powers); upgradeable contract; source code not verified; wallets that can sell hold more than 30% in the top 10 (burned and locked supply does not count); liquidity under $50,000; less than half of the liquidity locked or burned, when known. " +
  "SAFE otherwise. Unknown figures are reported as unknown and are not bad on their own.";

/** Whether instructions describe an agent that grades tokens Safe / Caution / Avoid. */
export function gradesTokens(instructions: string | null | undefined): boolean {
  if (!instructions) return false;
  return /\bavoid\b/i.test(instructions) && /\bcaution\b/i.test(instructions) && /\b(tokens?|honeypots?|contracts?)\b/i.test(instructions);
}

/** The instructions with the verdict rules written in, or null when they already state Avoid conditions. */
export function withVerdictRules(instructions: string): string | null {
  if (!gradesTokens(instructions)) return null;
  if (/\bavoid\b[^.]{0,20}\b(if|when)\b|\bavoid\s*[:(]/i.test(instructions)) return null;
  return `${instructions.trim()}\n\n${TOKEN_VERDICT_RULES}`.slice(0, 4_000);
}

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
      case "indicators": {
        const timeframe = (TIMEFRAMES as readonly string[]).includes(String(raw.timeframe)) ? (raw.timeframe as Timeframe) : "1d";
        put({ id: newId(type), type: "indicators", config: { timeframe } }, `Indicators on ${timeframe} candles`);
        break;
      }
      case "signal": {
        const condition = String(raw.condition) as SignalCondition;
        if (!SIGNAL_CONDITIONS.includes(condition)) {
          skipped.push("a Signal (it needs what to wait for: an RSI level or a moving-average or MACD cross)");
          break;
        }
        const timeframe = (TIMEFRAMES as readonly string[]).includes(String(raw.timeframe)) ? (raw.timeframe as Timeframe) : "1h";
        const level = condition === "rsiBelow" || condition === "rsiAbove" ? (Number(raw.level) > 0 && Number(raw.level) < 100 ? Number(raw.level) : condition === "rsiBelow" ? 30 : 70) : null;
        put({ id: newId(type), type: "signal", config: { condition, level, timeframe } }, `a Signal (${condition}${level !== null ? ` ${level}` : ""}, ${timeframe})`);
        break;
      }
      case "memory":
        // Placed not connected; an existing, connected Memory is never replaced.
        if (next.some((block) => block.type === "memory")) break;
        put({ id: newId(type), type: "memory", config: { url: null, keyName: null } }, "Memory (add your memory server's address to connect it)");
        break;
    }
  }

  // The rules canvas edits follow: a Price trigger needs a Market; a Swap needs Risk limits.
  if (next.some((block) => block.type === "price") && !next.some((block) => block.type === "market")) {
    next.splice(next.findIndex((block) => block.type === "price"), 1);
    skipped.push("the Price trigger (it needs a Market)");
  }
  for (const needsMarket of ["indicators", "signal"] as const) {
    if (next.some((block) => block.type === needsMarket) && !next.some((block) => block.type === "market")) {
      next.splice(next.findIndex((block) => block.type === needsMarket), 1);
      skipped.push(`${needsMarket === "signal" ? "the Signal" : "Indicators"} (it needs a Price feed for a token)`);
    }
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
