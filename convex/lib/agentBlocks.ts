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
 *   (wallet   REMOVED 2026-09-29 - Dolphin holds no keys that move funds;
 *             a legacy "wallet" entry in an old draft is dropped on read.)
 *             plugged in, a swap within the Risk limits executes at once from
 *             that wallet - no ticket, no tap - and what it buys lands there.
 *   memory    the builder's OWN memory server (lib/agentMemory.ts). Recalled
 *             before every run, a record written after it, and the Brain gets
 *             `remember` and `recall`. Dolphin keeps none of it.
 *   hire      a paid A2A agent from the catalog. Gives the Brain
 *             `hire_agent`: Dolphin asks the agent for a price for the task,
 *             and the OWNER confirms paying it from their Dolphin Wallet.
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
import { activeQuietEvent, type AuthMode, type QuietEvent } from "./analyticalBlocks";
import { indicatorReport, SIGNAL_CONDITIONS, type SignalCondition } from "./indicators";
import { assertSafeUrl } from "./safeFetch";
import { verifiedTokenBySymbol, verifiedTokens, type TradeToken } from "./tradeTokens";

export const BLOCK_TYPES = ["market", "safety", "swap", "risk", "schedule", "price", "walletWatch", "hire", "memory", "indicators", "signal", "dataSource", "news", "quietHours"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export type MarketConfig = { tokenAddress: string; symbol: string; name: string; poolAddress: string | null };
export type RiskConfig = { maxTradeUsd: number; maxTradesPerDay: number };
export type ScheduleConfig = { everyMinutes: number };
export type PriceConfig = { direction: "above" | "below"; priceUsd: number };
export type WalletWatchConfig = { addresses: string[]; label: string | null };
export type HireConfig = { agentKey: string; agentName: string };
export type MemoryConfig = { url: string; keyName: string | null };
export type Timeframe = "1h" | "4h" | "1d";
export const TIMEFRAMES: readonly Timeframe[] = ["1h", "4h", "1d"];
export type IndicatorsConfig = { timeframe: Timeframe };
export type SignalConfig = { condition: SignalCondition; level: number | null; timeframe: Timeframe };
export type SourceAuth = { authMode: AuthMode; authParam: string | null; keyName: string | null };
export type DataSourceConfig = SourceAuth & { label: string; url: string };
export type NewsConfig = SourceAuth & { url: string; keywords: string[] };
export type QuietHoursConfig = { events: QuietEvent[]; marginHours: number };

export type AgentBlock =
  | { id: string; type: "market"; config: MarketConfig }
  | { id: string; type: "safety"; config: Record<string, never> }
  | { id: string; type: "swap"; config: Record<string, never> }
  | { id: string; type: "risk"; config: RiskConfig }
  | { id: string; type: "schedule"; config: ScheduleConfig }
  | { id: string; type: "price"; config: PriceConfig }
  | { id: string; type: "walletWatch"; config: WalletWatchConfig }
  | { id: string; type: "hire"; config: HireConfig }
  | { id: string; type: "memory"; config: MemoryConfig }
  | { id: string; type: "indicators"; config: IndicatorsConfig }
  | { id: string; type: "signal"; config: SignalConfig }
  | { id: string; type: "dataSource"; config: DataSourceConfig }
  | { id: string; type: "news"; config: NewsConfig }
  | { id: string; type: "quietHours"; config: QuietHoursConfig };

export const MAX_BLOCKS = 12;
/** Fastest schedule. Every run spends the builder's own model key. */
export const SCHEDULE_CHOICES = [15, 30, 60, 240, 1440] as const;
export const MAX_WATCHED_WALLETS = 10;
export const TRIGGER_TYPES: readonly BlockType[] = ["schedule", "price", "walletWatch", "signal"];

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
    // The Wallet block was removed (2026-09-29); an old draft's entry is dropped quietly.
    if (raw?.type === "wallet") continue;
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
      case "hire": {
        const agentKey = typeof config.agentKey === "string" ? config.agentKey.trim().toLowerCase() : "";
        if (!/^\d+:0x[0-9a-f]{40}:\d+$/.test(agentKey)) fail("Choose an agent from Dolphin's catalog to hire.");
        const agentName = typeof config.agentName === "string" && config.agentName.trim() ? config.agentName.trim().slice(0, 60) : "Agent";
        out.push({ id, type, config: { agentKey, agentName } });
        break;
      }
      case "indicators": {
        const timeframe = (TIMEFRAMES as readonly string[]).includes(String(config.timeframe)) ? (config.timeframe as Timeframe) : "1d";
        out.push({ id, type, config: { timeframe } });
        break;
      }
      case "signal": {
        const condition = String(config.condition) as SignalCondition;
        if (!SIGNAL_CONDITIONS.includes(condition)) fail("Choose what the Signal waits for.");
        const timeframe = (TIMEFRAMES as readonly string[]).includes(String(config.timeframe)) ? (config.timeframe as Timeframe) : "1h";
        const rawLevel = Number(config.level);
        const level = condition === "rsiBelow" || condition === "rsiAbove" ? (rawLevel > 0 && rawLevel < 100 ? rawLevel : condition === "rsiBelow" ? 30 : 70) : null;
        out.push({ id, type, config: { condition, level, timeframe } });
        break;
      }
      case "dataSource":
      case "news": {
        const url = typeof config.url === "string" ? config.url.trim() : "";
        if (!url.startsWith("https://") || url.length > 500) fail(type === "news" ? "The news feed needs an https:// address." : "The data source needs an https:// address.");
        try {
          assertSafeUrl(url);
        } catch {
          fail("That address is not reachable from the internet.");
        }
        const authMode = (["none", "bearer", "header", "query"] as const).includes(config.authMode as AuthMode) ? (config.authMode as AuthMode) : "none";
        const authParam =
          (authMode === "header" || authMode === "query") && typeof config.authParam === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(config.authParam)
            ? config.authParam
            : null;
        if ((authMode === "header" || authMode === "query") && !authParam) fail("Say which header or query parameter carries the key.");
        const keyName = typeof config.keyName === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(config.keyName) ? config.keyName : null;
        if (authMode !== "none" && !keyName) fail("Choose the key this source needs, from your Keys.");
        if (type === "dataSource") {
          const label = typeof config.label === "string" && config.label.trim() ? config.label.trim().slice(0, 40) : "Data source";
          out.push({ id, type, config: { label, url, authMode, authParam, keyName } });
        } else {
          const keywords = (Array.isArray(config.keywords) ? config.keywords : [])
            .filter((word): word is string => typeof word === "string")
            .map((word) => word.trim().slice(0, 30))
            .filter(Boolean)
            .slice(0, 8);
          out.push({ id, type, config: { url, keywords, authMode, authParam, keyName } });
        }
        break;
      }
      case "quietHours": {
        const events = (Array.isArray(config.events) ? config.events : [])
          .map((event) => event as { label?: unknown; at?: unknown })
          .filter((event) => typeof event.at === "string" && Number.isFinite(Date.parse(event.at)))
          .map((event) => ({ label: typeof event.label === "string" && event.label.trim() ? event.label.trim().slice(0, 60) : "Event", at: new Date(Date.parse(event.at as string)).toISOString() }))
          .slice(0, 30);
        if (events.length === 0) fail("Add at least one event to stand aside for, with its date and time.");
        const marginHours = Math.min(24, Math.max(0.5, Number(config.marginHours) || 2));
        out.push({ id, type, config: { events, marginHours } });
        break;
      }
      case "memory": {
        const url = typeof config.url === "string" ? config.url.trim().replace(/\/+$/, "") : "";
        if (!url.startsWith("https://") || url.length > 300) fail("The memory server needs an https:// address.");
        try {
          assertSafeUrl(url);
        } catch {
          fail("That memory server address is not reachable from the internet.");
        }
        const keyName = typeof config.keyName === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(config.keyName) ? config.keyName : null;
        out.push({ id, type, config: { url, keyName } });
        break;
      }
      case "safety":
      case "swap":
        out.push({ id, type, config: {} } as AgentBlock);
        break;
    }
  }

  if (seenTypes.has("price") && !seenTypes.has("market")) fail("A price trigger needs a Market block for its token.");
  if (seenTypes.has("indicators") && !seenTypes.has("market")) fail("Indicators need a Price feed block for their token.");
  if (seenTypes.has("signal") && !seenTypes.has("market")) fail("A Signal needs a Price feed block for its token.");
  if (seenTypes.has("swap") && !seenTypes.has("risk")) fail("A Swap block needs a Risk block to set its limits.");
  return out;
}

/** The canvas member id of a draft tool. Mirrors the web canvas. */
export function toolMemberId(tool: { agentKey: string; toolName: string }): string {
  return `tool:${tool.agentKey}:${tool.toolName}`;
}

export const MAX_DETACHED = 40;

/**
 * The blocks a run may use: those still plugged in. A cut `limits` link
 * removes the Risk block, and with it any Swap proposal (runBlockTool refuses
 * without Risk) - the canvas shows what the runtime does.
 */
export function activeBlocks(blocks: readonly AgentBlock[], detached: readonly string[] | undefined): AgentBlock[] {
  const cut = new Set(detached ?? []);
  return blocks.filter(
    (block) =>
      (block.type as string) !== "wallet" && !cut.has(`block:${block.id}`) && !(block.type === "risk" && cut.has("limits")),
  );
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

/**
 * The last `limit` candles for a BSC pool, oldest first, from GeckoTerminal -
 * in USD and for THIS token's side of the pool. Without `currency` and
 * `token` a pool's candles can come back in the other token's terms (the
 * web chart already asks this way; this did not until 2026-09-29).
 */
export async function poolCandles(
  poolAddress: string,
  tokenAddress: string,
  timeframe: "hour" | "4h" | "day",
  limit: number,
): Promise<Array<[number, number, number, number, number, number]>> {
  const path = timeframe === "4h" ? "hour?aggregate=4&" : `${timeframe}?`;
  const data = (await getJson(
    `https://api.geckoterminal.com/api/v2/networks/bsc/pools/${poolAddress}/ohlcv/${path}limit=${limit}&currency=usd&token=${tokenAddress}`,
  )) as { data?: { attributes?: { ohlcv_list?: number[][] } } };
  const period = timeframe === "day" ? 86_400 : timeframe === "4h" ? 14_400 : 3_600;
  const now = Date.now() / 1000;
  return (data.data?.attributes?.ohlcv_list ?? [])
    .map((row) => [row[0], row[1], row[2], row[3], row[4], row[5] ?? 0] as [number, number, number, number, number, number])
    .sort((a, b) => a[0] - b[0])
    /*
     * CLOSED CANDLES ONLY (mentor review, 2026-09-29: "computing indicators on
     * a candle that hasn't closed yet makes results look better than
     * reality"). The candle still forming is dropped; the live price is
     * reported on its own line.
     */
    .filter((candle) => candle[0] + period <= now);
}

/* ── indicators, computed here so the model never does the arithmetic ────── */

function sma(values: readonly number[], length: number): number | null {
  if (values.length < length) return null;
  const window = values.slice(-length);
  return window.reduce((sum, value) => sum + value, 0) / length;
}

/** Wilder's 14-period RSI. */
function rsi(closes: readonly number[], length = 14): number | null {
  if (closes.length <= length) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gain += change;
    else loss -= change;
  }
  gain /= length;
  loss /= length;
  for (let i = length + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gain = (gain * (length - 1) + Math.max(change, 0)) / length;
    loss = (loss * (length - 1) + Math.max(-change, 0)) / length;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

/** Annualised volatility of daily log returns over the last `days`. */
function volatility(closes: readonly number[], days = 30): number | null {
  const window = closes.slice(-(days + 1));
  if (window.length < 10) return null;
  const returns = window.slice(1).map((close, i) => Math.log(close / window[i]));
  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(365) * 100;
}

function round(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return "unknown";
  return value >= 1 ? value.toFixed(digits) : value.toPrecision(4);
}

/** The trend block of the snapshot: what the playbook's trend-following rule reads. */
function trendReport(daily: ReadonlyArray<readonly number[]>, price: number | null): string {
  const closes = daily.map((candle) => candle[4]);
  if (closes.length < 20) return `Daily trend: not enough history (${closes.length} daily candles).`;
  // Indicators compare CLOSED candles only; the live price is reported separately.
  const last = closes[closes.length - 1];
  const lastDay = new Date(daily[daily.length - 1][0] * 1000).toISOString().slice(0, 10);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const month = daily.slice(-30);
  const high30 = Math.max(...month.map((candle) => candle[2]));
  const low30 = Math.min(...month.map((candle) => candle[3]));
  const verdict =
    sma50 === null
      ? "unknown (fewer than 50 days of history)"
      : last > sma50 && sma20 !== null && sma20 > sma50
        ? "UPTREND (price above the 50-day average, 20-day above 50-day)"
        : last < sma50 && sma20 !== null && sma20 < sma50
          ? "DOWNTREND (price below the 50-day average, 20-day below 50-day)"
          : "MIXED (price and averages disagree)";
  return (
    `Daily trend (computed from ${closes.length} CLOSED daily candles, the last closing ${lastDay}): ${verdict}. ` +
    `20-day average $${round(sma20, 4)}, 50-day average ${sma50 === null ? "unknown" : `$${round(sma50, 4)}`}, ` +
    `last close ${sma50 === null ? "" : `${(((last - sma50) / sma50) * 100).toFixed(1)}% vs the 50-day, `}` +
    `(live price now ${price === null ? "unknown" : `$${round(price, 4)}`}), ` +
    `14-day RSI ${round(rsi(closes), 1)}, 30-day volatility ${round(volatility(closes), 0)}% a year, ` +
    `30-day high $${round(high30, 4)} and low $${round(low30, 4)} (now ${(((last - high30) / high30) * 100).toFixed(1)}% from the high).`
  );
}

/* ── the Brain's built-in tools ─────────────────────────────────────────────── */

export type BlockToolResult = { text: string; isError: boolean; ticket?: unknown };

/** The built-in tools a draft's blocks give its Brain. Names are `block_*` so they cannot collide with MCP tools. */
export function blockToolDefinitions(blocks: readonly AgentBlock[], trades: "propose" | "execute" = "propose"): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  const market = blocks.find((block) => block.type === "market");
  if (market) {
    tools.push({
      type: "function",
      function: {
        name: "block_market_snapshot",
        description: `Live market data for ${market.config.symbol} on BNB Chain: price, liquidity, 24h volume, 1h and 24h change, the last 12 hourly candles, and the daily trend computed in code (20- and 50-day averages, 14-day RSI, 30-day volatility, high and low).`,
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
          (trades === "execute"
            ? "Make a PancakeSwap trade. Within your Risk limits it executes at once, and the tool reports whether it traded. "
            : "Propose a PancakeSwap trade for the owner to approve and sign from their Dolphin Wallet. You cannot sign or send it. ") +
          `Tokens must be one of: ${verifiedTokens().map((token) => token.symbol).join(", ")}.`,
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
  if (blocks.some((block) => block.type === "memory")) {
    tools.push(
      {
        type: "function",
        function: {
          name: "block_remember",
          description:
            "Save one short note to your memory, for your next runs: a position you opened, a price you are waiting for, a decision and why. Your runs are recorded automatically; use this for what you will need to know later.",
          parameters: {
            type: "object",
            properties: { text: { type: "string", description: "The note, in one or two sentences, with exact numbers." } },
            required: ["text"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "block_recall",
          description: "Search your memory for notes about something (a token, a trade, a wallet). Your latest memories are already in front of you.",
          parameters: {
            type: "object",
            properties: { query: { type: "string", description: "What to look for." } },
            required: ["query"],
            additionalProperties: false,
          },
        },
      },
    );
  }
  const hire = blocks.find((block) => block.type === "hire");
  if (hire) {
    tools.push({
      type: "function",
      function: {
        name: "block_hire_agent",
        description:
          `Ask ${hire.config.agentName}, a paid agent on Dolphin, to do a task. Dolphin gets its price; the owner then decides ` +
          "whether to pay it from their Dolphin Wallet. The work is delivered later, not in this conversation. Use it only when your instructions call for it.",
        parameters: {
          type: "object",
          properties: { task: { type: "string", description: "Exactly what the agent should do, in one or two sentences." } },
          required: ["task"],
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
      const pool = market.config.poolAddress ?? pair.pairAddress;
      const [candles, daily] = await Promise.all([
        poolCandles(pool, market.config.tokenAddress, "hour", 12).catch(() => []),
        poolCandles(pool, market.config.tokenAddress, "day", 60).catch(() => []),
      ]);
      const candleText = candles.length
        ? candles.map(([t, o, h, l, c]) => `${new Date(t * 1000).toISOString().slice(11, 16)}Z o${o.toPrecision(5)} h${h.toPrecision(5)} l${l.toPrecision(5)} c${c.toPrecision(5)}`).join("; ")
        : "unavailable";
      return {
        text:
          `${market.config.symbol} on ${pair.dex}: price ${money(pair.priceUsd)}, liquidity ${money(pair.liquidityUsd)}, ` +
          `24h volume ${money(pair.volume24hUsd)}, 1h change ${pair.change1hPct ?? "unknown"}%, 24h change ${pair.change24hPct ?? "unknown"}%. ` +
          `Hourly candles (UTC, oldest first): ${candleText}. ` +
          (daily.length ? trendReport(daily, pair.priceUsd) : "Daily trend: unavailable right now."),
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
      // QUIET HOURS, enforced here - not left to the Brain.
      const quiet = blocks.find((block) => block.type === "quietHours");
      if (quiet && quiet.type === "quietHours") {
        const standing = activeQuietEvent(quiet.config.events, quiet.config.marginHours);
        if (standing) {
          return { text: `Refused: quiet hours - standing aside within ${quiet.config.marginHours}h of "${standing.label}" (${standing.at}).`, isError: true };
        }
      }
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


/** The Indicators block's report: closed candles of its timeframe, computed in code. */
export async function readIndicators(market: MarketConfig, timeframe: Timeframe): Promise<string> {
  const pool = market.poolAddress ?? (await bscPairFor(market.tokenAddress))?.pairAddress;
  if (!pool) return `Indicators: ${market.symbol} has no BNB Chain pool with trading right now.`;
  const frame = timeframe === "1d" ? "day" : timeframe === "4h" ? "4h" : "hour";
  const candles = await poolCandles(pool, market.tokenAddress, frame, 200);
  const label = timeframe === "1d" ? "daily" : timeframe === "4h" ? "4-hour" : "1-hour";
  return `${market.symbol} ${indicatorReport(candles, label)}`;
}
