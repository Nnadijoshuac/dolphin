/**
 * THE CANVAS TOOLBOX'S BLOCKS: what each one is, what settings it may have,
 * and - for the ones the Brain uses - the built-in tool it becomes at run
 * time. (2026-09-28, from Agent/RESEARCH-2026-09-28-trading-agents.md)
 *
 *   market    the token this agent trades. Gives the Brain `market_snapshot`
 *             and the canvas its live chart.
 *   safety    gives the Brain `token_safety` (GoPlus).
 *   swap      gives the Brain `propose_swap`: a trade ticket within the Risk
 *             block's limits, which the OWNER signs from the Dolphin Wallet.
 *             Nothing here signs anything.
 *   risk      limits a proposal: USD per trade, trades per day.
 *   schedule / price / walletWatch   triggers, run by convex/autopilot.ts.
 *
 * THE MODEL PROPOSES, THIS FILE DECIDES - the same rule as agentSpec.ts.
 * Every setting is validated here; a tool's arguments are validated before
 * anything is fetched; a swap names only tokens on Dolphin's verified list.
 *
 * Sources were each called live for BNB Chain on 2026-09-28 (research doc
 * §5): DexScreener, GeckoTerminal and GoPlus are keyless. They are fixed,
 * well-known APIs rather than publisher-chosen URLs, so plain fetch with a
 * timeout is used; safeFetch is for strangers' URLs (AGENTS.md §9).
 */

import { ConvexError } from "convex/values";
import { getAddress, isAddress } from "viem";

import type { ToolDefinition } from "./openrouter";
import { verifiedTokenBySymbol, verifiedTokens, type TradeToken } from "./tradeTokens";

export const BLOCK_TYPES = ["market", "safety", "swap", "risk", "schedule", "price", "walletWatch"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export type MarketConfig = { tokenAddress: string; symbol: string; name: string; poolAddress: string | null };
export type RiskConfig = { maxTradeUsd: number; maxTradesPerDay: number };
export type ScheduleConfig = { everyMinutes: number };
export type PriceConfig = { direction: "above" | "below"; priceUsd: number };
export type WalletWatchConfig = { addresses: string[]; label: string | null };

export type AgentBlock =
  | { id: string; type: "market"; config: MarketConfig }
  | { id: string; type: "safety"; config: Record<string, never> }
  | { id: string; type: "swap"; config: Record<string, never> }
  | { id: string; type: "risk"; config: RiskConfig }
  | { id: string; type: "schedule"; config: ScheduleConfig }
  | { id: string; type: "price"; config: PriceConfig }
  | { id: string; type: "walletWatch"; config: WalletWatchConfig };

export const MAX_BLOCKS = 12;
/** Fastest schedule. Every run spends the builder's own model key. */
export const SCHEDULE_CHOICES = [15, 30, 60, 240, 1440] as const;
export const MAX_WATCHED_WALLETS = 10;
export const TRIGGER_TYPES: readonly BlockType[] = ["schedule", "price", "walletWatch"];

const FETCH_TIMEOUT_MS = 8_000;

function fail(message: string): never {
  throw new ConvexError(message);
}

function checksum(value: unknown, what: string): string {
  if (typeof value !== "string" || !isAddress(value.trim())) fail(`${what} is not a valid address.`);
  return getAddress(value.trim());
}

/**
 * A block list as the client sent it, made safe - or a readable refusal.
 * Unknown fields are dropped; one of each type except none repeat.
 */
export function validateBlocks(input: unknown): AgentBlock[] {
  if (!Array.isArray(input)) fail("Blocks must be a list.");
  if (input.length > MAX_BLOCKS) fail(`An agent can have at most ${MAX_BLOCKS} blocks.`);
  const seenTypes = new Set<string>();
  const seenIds = new Set<string>();
  const out: AgentBlock[] = [];

  for (const raw of input as Array<Record<string, unknown>>) {
    const id = typeof raw?.id === "string" && /^[a-z0-9-]{1,24}$/.test(raw.id) ? raw.id : null;
    if (!id || seenIds.has(id)) fail("Each block needs a short, unique id.");
    seenIds.add(id);
    const type = raw.type as BlockType;
    if (!BLOCK_TYPES.includes(type)) fail(`Unknown block type.`);
    if (seenTypes.has(type)) fail("Each kind of block can be added once.");
    seenTypes.add(type);
    const config = (raw.config ?? {}) as Record<string, unknown>;

    switch (type) {
      case "market": {
        const tokenAddress = checksum(config.tokenAddress, "The token");
        const symbol = typeof config.symbol === "string" ? config.symbol.trim().slice(0, 16) : "";
        const name = typeof config.name === "string" ? config.name.trim().slice(0, 60) : symbol;
        if (!symbol) fail("The market needs the token's symbol.");
        const poolAddress =
          typeof config.poolAddress === "string" && isAddress(config.poolAddress) ? getAddress(config.poolAddress) : null;
        out.push({ id, type, config: { tokenAddress, symbol, name, poolAddress } });
        break;
      }
      case "risk": {
        const maxTradeUsd = Number(config.maxTradeUsd);
        const maxTradesPerDay = Math.round(Number(config.maxTradesPerDay));
        if (!(maxTradeUsd >= 1 && maxTradeUsd <= 100_000)) fail("Max per trade must be between $1 and $100,000.");
        if (!(maxTradesPerDay >= 1 && maxTradesPerDay <= 50)) fail("Trades per day must be between 1 and 50.");
        out.push({ id, type, config: { maxTradeUsd, maxTradesPerDay } });
        break;
      }
      case "schedule": {
        const everyMinutes = Number(config.everyMinutes);
        if (!(SCHEDULE_CHOICES as readonly number[]).includes(everyMinutes)) {
          fail(`Choose a schedule of ${SCHEDULE_CHOICES.join(", ")} minutes.`);
        }
        out.push({ id, type, config: { everyMinutes } });
        break;
      }
      case "price": {
        const direction = config.direction === "below" ? "below" : config.direction === "above" ? "above" : null;
        const priceUsd = Number(config.priceUsd);
        if (!direction) fail("Choose whether the price rises above or falls below.");
        if (!(priceUsd > 0 && priceUsd < 1e9)) fail("Enter a price above zero.");
        out.push({ id, type, config: { direction, priceUsd } });
        break;
      }
      case "walletWatch": {
        const list = Array.isArray(config.addresses) ? config.addresses : [];
        if (list.length === 0) fail("Add at least one wallet to watch.");
        if (list.length > MAX_WATCHED_WALLETS) fail(`Watch at most ${MAX_WATCHED_WALLETS} wallets.`);
        const addresses = [...new Set(list.map((value) => checksum(value, "A watched wallet")))];
        const label = typeof config.label === "string" && config.label.trim() ? config.label.trim().slice(0, 40) : null;
        out.push({ id, type, config: { addresses, label } });
        break;
      }
      case "safety":
      case "swap":
        out.push({ id, type, config: {} } as AgentBlock);
        break;
    }
  }

  if (seenTypes.has("price") && !seenTypes.has("market")) fail("A price trigger needs a Market block for its token.");
  if (seenTypes.has("swap") && !seenTypes.has("risk")) fail("A Swap block needs a Risk block to set its limits.");
  return out;
}

/* ── data sources (keyless, live-checked 2026-09-28) ──────────────────────── */

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export type PairSnapshot = {
  priceUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  change1hPct: number | null;
  change24hPct: number | null;
  pairAddress: string;
  dex: string;
};

/** The deepest BSC pair for a token, from DexScreener. Null when it has none. */
export async function bscPairFor(tokenAddress: string): Promise<PairSnapshot | null> {
  const data = (await getJson(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`)) as {
    pairs?: Array<Record<string, any>>;
  };
  const pairs = (data.pairs ?? []).filter((pair) => pair.chainId === "bsc");
  pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  const best = pairs[0];
  if (!best) return null;
  const num = (value: unknown) => (value === undefined || value === null || Number.isNaN(Number(value)) ? null : Number(value));
  /*
   * DexScreener's priceUsd is the BASE token's price. When the token asked
   * about is the pair's QUOTE (USDT in WBNB/USDT), its price is priceUsd /
   * priceNative. Found by test, 2026-09-28: "10 USDT is about $62.8".
   */
  const isBase = String(best.baseToken?.address ?? "").toLowerCase() === tokenAddress.toLowerCase();
  const baseUsd = num(best.priceUsd);
  const native = num(best.priceNative);
  const priceUsd = isBase ? baseUsd : baseUsd !== null && native ? baseUsd / native : null;
  // Change figures describe the base token; for a quote-side token they would be the other asset's.
  return {
    priceUsd,
    liquidityUsd: num(best.liquidity?.usd),
    volume24hUsd: num(best.volume?.h24),
    change1hPct: isBase ? num(best.priceChange?.h1) : null,
    change24hPct: isBase ? num(best.priceChange?.h24) : null,
    pairAddress: String(best.pairAddress),
    dex: String(best.dexId),
  };
}

/** The last `limit` hourly candles for a BSC pool, oldest first, from GeckoTerminal. */
async function hourlyCandles(poolAddress: string, limit: number): Promise<Array<[number, number, number, number, number]>> {
  const data = (await getJson(
    `https://api.geckoterminal.com/api/v2/networks/bsc/pools/${poolAddress}/ohlcv/hour?limit=${limit}`,
  )) as { data?: { attributes?: { ohlcv_list?: number[][] } } };
  return (data.data?.attributes?.ohlcv_list ?? [])
    .map((row) => [row[0], row[1], row[2], row[3], row[4]] as [number, number, number, number, number])
    .reverse();
}

/* ── the Brain's built-in tools ─────────────────────────────────────────────── */

export type BlockToolResult = { text: string; isError: boolean; ticket?: unknown };

/** The built-in tools a draft's blocks give its Brain. Names are `block_*` so they cannot collide with MCP tools. */
export function blockToolDefinitions(blocks: readonly AgentBlock[]): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  const market = blocks.find((block) => block.type === "market");
  if (market) {
    tools.push({
      type: "function",
      function: {
        name: "block_market_snapshot",
        description: `Live market data for ${market.config.symbol} on BNB Chain: price, liquidity, 24h volume, 1h and 24h change, and the last 12 hourly candles.`,
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    });
  }
  if (blocks.some((block) => block.type === "safety")) {
    tools.push({
      type: "function",
      function: {
        name: "block_token_safety",
        description: "Security check of a BNB Chain token contract: honeypot, buy/sell tax, owner powers, holder concentration, LP lock.",
        parameters: {
          type: "object",
          properties: { tokenAddress: { type: "string", description: "The token contract address (0x…)." } },
          required: ["tokenAddress"],
          additionalProperties: false,
        },
      },
    });
  }
  if (blocks.some((block) => block.type === "swap")) {
    tools.push({
      type: "function",
      function: {
        name: "block_propose_swap",
        description:
          `Propose a PancakeSwap trade for the owner to approve and sign from their Dolphin Wallet. ` +
          `You cannot sign or send it. Tokens must be one of: ${verifiedTokens().map((token) => token.symbol).join(", ")}.`,
        parameters: {
          type: "object",
          properties: {
            sellSymbol: { type: "string", description: "Symbol of the token to sell." },
            buySymbol: { type: "string", description: "Symbol of the token to buy." },
            sellAmount: { type: "string", description: "How much of the sell token, as a decimal number." },
            reason: { type: "string", description: "One sentence: why, citing the data." },
          },
          required: ["sellSymbol", "buySymbol", "sellAmount", "reason"],
          additionalProperties: false,
        },
      },
    });
  }
  return tools;
}

function money(value: number | null): string {
  if (value === null) return "unknown";
  return value >= 1 ? `$${value.toLocaleString("en", { maximumFractionDigits: 2 })}` : `$${value.toPrecision(4)}`;
}

/**
 * Runs one built-in tool. `tradesToday` is how many swaps this agent has
 * already proposed today, counted by the caller.
 */
export async function runBlockTool(
  blocks: readonly AgentBlock[],
  name: string,
  rawArgs: string,
  tradesToday: number,
): Promise<BlockToolResult> {
  let args: Record<string, unknown> = {};
  try {
    args = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
  } catch {
    return { text: "The arguments were not valid JSON.", isError: true };
  }

  try {
    if (name === "block_market_snapshot") {
      const market = blocks.find((block) => block.type === "market");
      if (!market) return { text: "This agent has no Market block.", isError: true };
      const pair = await bscPairFor(market.config.tokenAddress);
      if (!pair) return { text: `${market.config.symbol} has no BNB Chain pool with liquidity right now.`, isError: true };
      const candles = await hourlyCandles(market.config.poolAddress ?? pair.pairAddress, 12).catch(() => []);
      const candleText = candles.length
        ? candles.map(([t, o, h, l, c]) => `${new Date(t * 1000).toISOString().slice(11, 16)}Z o${o.toPrecision(5)} h${h.toPrecision(5)} l${l.toPrecision(5)} c${c.toPrecision(5)}`).join("; ")
        : "unavailable";
      return {
        text:
          `${market.config.symbol} on ${pair.dex}: price ${money(pair.priceUsd)}, liquidity ${money(pair.liquidityUsd)}, ` +
          `24h volume ${money(pair.volume24hUsd)}, 1h change ${pair.change1hPct ?? "unknown"}%, 24h change ${pair.change24hPct ?? "unknown"}%. ` +
          `Hourly candles (UTC, oldest first): ${candleText}.`,
        isError: false,
      };
    }

    if (name === "block_token_safety") {
      if (typeof args.tokenAddress !== "string" || !isAddress(args.tokenAddress)) {
        return { text: "tokenAddress must be a 0x address.", isError: true };
      }
      const address = args.tokenAddress.toLowerCase();
      const data = (await getJson(`https://api.gopluslabs.io/api/v1/token_security/56?contract_addresses=${address}`)) as {
        result?: Record<string, Record<string, any>>;
      };
      const report = data.result?.[address];
      if (!report) return { text: "The security service has no report for that token.", isError: true };
      const flag = (key: string) => report[key] === "1";
      const findings = [
        flag("is_honeypot") && "HONEYPOT: it cannot be sold",
        flag("cannot_sell_all") && "cannot sell all",
        flag("is_mintable") && "owner can mint more",
        flag("hidden_owner") && "hidden owner",
        flag("can_take_back_ownership") && "ownership can be taken back",
        flag("is_blacklisted") && "has a blacklist",
        flag("transfer_pausable") && "transfers can be paused",
        report.is_open_source === "0" && "source code not verified",
      ].filter(Boolean);
      return {
        text:
          `Buy tax ${report.buy_tax ?? "unknown"}, sell tax ${report.sell_tax ?? "unknown"}, holders ${report.holder_count ?? "unknown"}. ` +
          (findings.length ? `Warnings: ${findings.join("; ")}.` : "No critical flags."),
        isError: false,
      };
    }

    if (name === "block_propose_swap") {
      const risk = blocks.find((block) => block.type === "risk");
      if (!risk) return { text: "No Risk block, so no trade can be proposed.", isError: true };
      if (tradesToday >= risk.config.maxTradesPerDay) {
        return { text: `Refused: the Risk block allows ${risk.config.maxTradesPerDay} trades a day, and that many were proposed today.`, isError: true };
      }
      const sell = typeof args.sellSymbol === "string" ? verifiedTokenBySymbol(args.sellSymbol) : null;
      const buy = typeof args.buySymbol === "string" ? verifiedTokenBySymbol(args.buySymbol) : null;
      if (!sell || !buy) return { text: "Refused: both tokens must be on Dolphin's verified list.", isError: true };
      if (sell.symbol === buy.symbol) return { text: "Refused: selling and buying the same token.", isError: true };
      const amount = Number(args.sellAmount);
      if (!(amount > 0) || !Number.isFinite(amount)) return { text: "Refused: sellAmount must be a positive number.", isError: true };

      const priced = await bscPairFor(tokenAddressFor(sell));
      if (!priced?.priceUsd) return { text: `Refused: no live price for ${sell.symbol}, so the Risk limit cannot be checked.`, isError: true };
      const usd = amount * priced.priceUsd;
      if (usd > risk.config.maxTradeUsd) {
        return { text: `Refused: ${amount} ${sell.symbol} is about ${money(usd)}, over the Risk block's ${money(risk.config.maxTradeUsd)} per trade.`, isError: true };
      }
      const reason = typeof args.reason === "string" ? args.reason.slice(0, 280) : "";
      return {
        text: `Proposed: sell ${amount} ${sell.symbol} (about ${money(usd)}) for ${buy.symbol}. It is waiting for the owner to approve and sign. ${reason}`,
        isError: false,
        ticket: { kind: "swap", amountIn: String(amount), tokenIn: ticketToken(sell), tokenOut: ticketToken(buy), safety: null },
      };
    }
  } catch (cause) {
    return { text: `The data source did not answer: ${cause instanceof Error ? cause.message : String(cause)}`, isError: true };
  }

  return { text: `Unknown tool ${name}.`, isError: true };
}

const WBNB_ADDRESS = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";

function tokenAddressFor(token: TradeToken): string {
  return token.address ?? WBNB_ADDRESS;
}

/** The ticket's token shape (tradeTokenValidator in schema.ts). */
function ticketToken(token: TradeToken) {
  return { address: token.address, symbol: token.symbol, decimals: token.decimals, verified: token.verified };
}
