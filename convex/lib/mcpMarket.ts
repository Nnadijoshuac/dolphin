import { formatUnits, getAddress, parseAbi } from "viem";

import { bscPublicClient } from "./bscClient";
import { closedCandles, historyCandles, isBinanceSymbol, MarketDataError } from "./binanceMarket";
import { KERNEL } from "./erc8183Seller";
import { emaSeries, macdSeries, rsiSeries, smaSeries } from "./indicators";
import { cleanRule, describeRule, LIMITS, simulate, TIMEFRAMES, VENUE_FEE_BPS, type Candle, type Timeframe, type Venue } from "./strategy";
import { U_TOKEN } from "./x402";

/**
 * THE MCP'S OTHER TOOL GROUPS (owner, 2026-10-03: "one address with several groups of tools...
 * so the person is not copying each of them"). convex/marketplaceMcp.ts serves them beside the
 * marketplace tools at the same /api/v1/mcp.
 *
 *   market   get_price, get_candles, get_indicators   Binance's public market data, closed candles
 *   rules    check_rule, backtest_rule                  the live engine's own validator and simulator
 *   proof    get_escrow_job                             an ERC-8183 job read from BNB Chain
 *
 * All read-only: nothing here signs, trades or pays. Numbers come from Binance or the chain at call
 * time, or the tool says why it has none - never a stand-in (AGENTS.md §5).
 */

export type ToolResult = { content: { type: "text"; text: string }[]; isError: boolean };

export const text = (value: unknown, isError = false): ToolResult => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
  isError,
});

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

const SYMBOL = { type: "string", description: "A Binance pair, e.g. \"BNBUSDT\", \"BTCUSDT\", \"CAKEUSDT\"." } as const;
const MARKET_VENUE = { type: "string", enum: ["spot", "futures"], description: "Binance spot (default) or USDⓈ-M futures." } as const;
const TIMEFRAME = { type: "string", enum: [...TIMEFRAMES], description: "Candle length. Default 1h." } as const;

/** The rule language, as a JSON Schema an assistant can fill in. Mirrors lib/strategy.ts Rule and cleanCondition. */
const CONDITION_SCHEMA = {
  type: "object",
  description:
    "One condition, judged on the last CLOSED candle. Kinds: " +
    "rsi {op: above|below, value 1-99, period?=14}; " +
    "price {op, value}; " +
    "price_vs_ma {op, ma: sma|ema, length}; " +
    "ma_cross {direction: up|down, fast, slow, ma?: sma|ema}; " +
    "macd_cross {direction: up|down} (12/26/9); " +
    `trend {direction: up|down, candles 1-${LIMITS.maxTrendCandles}} (that many closes in a row each higher/lower); ` +
    "change_pct {op, value (% , negative for drops), candles}.",
  properties: {
    kind: { type: "string", enum: ["rsi", "price", "price_vs_ma", "ma_cross", "macd_cross", "trend", "change_pct"] },
    op: { type: "string", enum: ["above", "below"] },
    direction: { type: "string", enum: ["up", "down"] },
    value: { type: "number" },
    period: { type: "number" },
    ma: { type: "string", enum: ["sma", "ema"] },
    length: { type: "number" },
    fast: { type: "number" },
    slow: { type: "number" },
    candles: { type: "number" },
  },
  required: ["kind"],
} as const;

const RULE_SCHEMA = {
  type: "object",
  description: "A trading rule in Dolphin's rule language - the same one the build chat writes and the live engine runs.",
  properties: {
    venue: { type: "string", enum: ["binance-spot", "binance-futures", "binance-wallet", "dolphin-wallet"], description: "Where it trades. Shorts and leverage need binance-futures." },
    market: SYMBOL,
    timeframe: { type: "string", enum: [...TIMEFRAMES] },
    action: { type: "string", enum: ["buy", "short"], description: "How it enters. It sells through its exits." },
    when: { type: "array", items: CONDITION_SCHEMA, description: `Enter when ALL hold (1-${LIMITS.maxConditions}).` },
    until: { type: "array", items: CONDITION_SCHEMA, description: "Exit when ALL hold. May be empty if a stop-loss or take-profit is set." },
    sizeUsd: { type: "number", description: `Dollars per entry, 1-${LIMITS.maxSizeUsd}.` },
    stopLossPct: { type: ["number", "null"], description: "Exit at this % price move against the position." },
    takeProfitPct: { type: ["number", "null"], description: "Exit at this % price move in favour." },
    leverage: { type: "number", description: `Futures only, 1-${LIMITS.maxLeverage}. Above ${LIMITS.comfortableLeverage}x comes with a liquidation warning.` },
    maxTradesPerDay: { type: "number", description: "Default 2." },
    cooldownMinutes: { type: "number", description: "Wait after any trade before the next entry. Default 0." },
  },
  required: ["venue", "market", "timeframe", "action", "when", "sizeUsd"],
} as const;

export const MARKET_TOOLS = [
  {
    name: "get_price",
    title: "Live price of a Binance pair",
    description: "The last traded price and the 24-hour change, high, low and volume of a Binance pair, read from Binance when called.",
    inputSchema: { type: "object", properties: { symbol: SYMBOL, venue: MARKET_VENUE }, required: ["symbol"], additionalProperties: false },
    annotations: READ_ONLY,
  },
  {
    name: "get_candles",
    title: "Closed candles of a Binance pair",
    description: "Recent CLOSED candles (the one still forming is left out) as [openTime ms, open, high, low, close].",
    inputSchema: {
      type: "object",
      properties: { symbol: SYMBOL, timeframe: TIMEFRAME, limit: { type: "number", description: "How many, up to 500. Default 100." }, venue: MARKET_VENUE },
      required: ["symbol"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "get_indicators",
    title: "Technical indicators on closed candles",
    description:
      "RSI(14), SMA 20/50/200, EMA 20, MACD (12, 26, 9), Bollinger bands (20, 2) and recent change for a Binance pair, computed by Dolphin on closed candles - the same maths its trading rules use.",
    inputSchema: { type: "object", properties: { symbol: SYMBOL, timeframe: TIMEFRAME, venue: MARKET_VENUE }, required: ["symbol"], additionalProperties: false },
    annotations: READ_ONLY,
  },
] as const;

export const RULE_TOOLS = [
  {
    name: "check_rule",
    title: "Check a trading rule",
    description:
      "Validates a rule in Dolphin's rule language and returns it cleaned, in plain words, with any warnings (e.g. leverage) - or exactly what is wrong. Use before backtest_rule, or to help someone write a rule for their Dolphin agent.",
    inputSchema: { type: "object", properties: { rule: RULE_SCHEMA }, required: ["rule"], additionalProperties: false },
    annotations: { ...READ_ONLY, openWorldHint: false },
  },
  {
    name: "backtest_rule",
    title: "Backtest a trading rule on Binance history",
    description:
      "Replays a rule over Binance's real closed-candle history with the live engine's own decisions: fees each way, stop-loss, take-profit, leverage, daily limits. Returns the result against the stake, just holding, win rate, worst drop, fees and the latest trades with the engine's reason for each. Fills at candle close; slippage and funding are not modelled. Past results do not predict future ones.",
    inputSchema: {
      type: "object",
      properties: { rule: RULE_SCHEMA, candles: { type: "number", description: "How much history, 100-1500 candles. Default 1000." } },
      required: ["rule"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
] as const;

export const PROOF_TOOLS = [
  {
    name: "get_escrow_job",
    title: "Read an escrow job on BNB Chain",
    description:
      "Reads one ERC-8183 job from the escrow contract Dolphin hires through: who paid (client), who works (provider), the amount held, its status (open, funded, submitted, completed, rejected, expired), its deadline and the delivered hash. Read from BNB Chain when called, so it is proof rather than Dolphin's word.",
    inputSchema: { type: "object", properties: { jobId: { type: "string", description: "The job id, e.g. \"56882\"." } }, required: ["jobId"], additionalProperties: false },
    annotations: READ_ONLY,
  },
] as const;

/* ── market ── */

const SPOT_API = "https://api.binance.com/api/v3";
const FUTURES_API = "https://fapi.binance.com/fapi/v1";

function symbolOf(args: Record<string, unknown>): string {
  const symbol = typeof args.symbol === "string" ? args.symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
  if (!isBinanceSymbol(symbol)) throw new MarketDataError(`"${String(args.symbol ?? "")}" is not a Binance pair. Use one like BNBUSDT.`);
  return symbol;
}
const venueOf = (args: Record<string, unknown>): Venue => (args.venue === "futures" ? "binance-futures" : "binance-spot");
const timeframeOf = (args: Record<string, unknown>): Timeframe => ((TIMEFRAMES as readonly string[]).includes(String(args.timeframe)) ? (args.timeframe as Timeframe) : "1h");
const round = (value: number | null | undefined, digits = 6) => (value === null || value === undefined || !Number.isFinite(value) ? null : Number(value.toPrecision(digits)));

export async function getPrice(args: Record<string, unknown>): Promise<ToolResult> {
  const symbol = symbolOf(args);
  const venue = venueOf(args);
  const response = await fetch(`${venue === "binance-futures" ? FUTURES_API : SPOT_API}/ticker/24hr?symbol=${symbol}`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return text(/Invalid symbol/i.test(body) ? `Binance has no ${venue === "binance-futures" ? "futures" : "spot"} market ${symbol}.` : `Binance answered ${response.status}.`, true);
  }
  const t = (await response.json()) as Record<string, string | number>;
  return text({
    symbol,
    market: venue === "binance-futures" ? "Binance USDⓈ-M futures" : "Binance spot",
    price: Number(t.lastPrice),
    change24hPct: Number(t.priceChangePercent),
    high24h: Number(t.highPrice),
    low24h: Number(t.lowPrice),
    volume24hQuote: Number(t.quoteVolume),
    at: new Date(Number(t.closeTime)).toISOString(),
  });
}

export async function getCandles(args: Record<string, unknown>): Promise<ToolResult> {
  const symbol = symbolOf(args);
  const timeframe = timeframeOf(args);
  const limit = Math.max(1, Math.min(500, typeof args.limit === "number" ? Math.floor(args.limit) : 100));
  const candles = await closedCandles(venueOf(args), symbol, timeframe, limit);
  return text({
    symbol,
    timeframe,
    count: candles.length,
    columns: ["openTime", "open", "high", "low", "close"],
    candles: candles.map((candle) => [candle.openTime, candle.open, candle.high, candle.low, candle.close]),
  });
}

export async function getIndicators(args: Record<string, unknown>): Promise<ToolResult> {
  const symbol = symbolOf(args);
  const timeframe = timeframeOf(args);
  const candles = await closedCandles(venueOf(args), symbol, timeframe, 300);
  if (candles.length < 30) return text(`Only ${candles.length} closed ${timeframe} candles of ${symbol} so far - too few for indicators.`, true);
  const closes = candles.map((candle) => candle.close);
  const last = closes.length - 1;
  const at = (series: (number | null)[]) => round(series[last]);
  const macd = macdSeries(closes);
  const sma20 = smaSeries(closes, 20)[last];
  const window = closes.slice(-20);
  const sd = sma20 === null ? null : Math.sqrt(window.reduce((sum, value) => sum + (value - sma20) ** 2, 0) / window.length);
  const change = (n: number) => (closes.length > n ? round(((closes[last] - closes[last - n]) / closes[last - n]) * 100, 4) : null);
  return text({
    symbol,
    timeframe,
    lastClosedCandle: new Date(candles[last].openTime).toISOString(),
    close: closes[last],
    rsi14: at(rsiSeries(closes)),
    sma20: round(sma20),
    sma50: at(smaSeries(closes, 50)),
    sma200: closes.length >= 200 ? at(smaSeries(closes, 200)) : null,
    ema20: at(emaSeries(closes, 20)),
    macd: { line: at(macd.line), signal: at(macd.signal), histogram: at(macd.histogram) },
    bollinger: sma20 === null || sd === null ? null : { upper: round(sma20 + 2 * sd), middle: round(sma20), lower: round(sma20 - 2 * sd) },
    changePct: { lastCandle: change(1), last24Candles: change(24) },
    note: "Computed on closed candles only. Not financial advice.",
  });
}

/* ── rules ── */

export function checkRule(args: Record<string, unknown>): ToolResult {
  const cleaned = cleanRule(args.rule, "mcp");
  if ("problems" in cleaned) return text({ ok: false, problems: cleaned.problems }, true);
  const { id: _id, ...rule } = cleaned.rule;
  return text({ ok: true, inWords: describeRule(cleaned.rule), warnings: cleaned.warnings, rule });
}

export async function backtestRule(args: Record<string, unknown>): Promise<ToolResult> {
  const cleaned = cleanRule(args.rule, "mcp");
  if ("problems" in cleaned) return text({ ok: false, problems: cleaned.problems }, true);
  const { rule, warnings } = cleaned;
  const count = Math.max(100, Math.min(1_500, typeof args.candles === "number" ? Math.floor(args.candles) : 1_000));
  const candles: Candle[] = await historyCandles(rule.venue, rule.market, rule.timeframe, count);
  if (candles.length < 80) return text(`Only ${candles.length} closed candles of ${rule.market} ${rule.timeframe} history - too few to test on.`, true);
  const feeBps = VENUE_FEE_BPS[rule.venue];
  const result = simulate(rule, candles, { feeBps, dailyLossLimitUsd: null });
  const closed = result.wins + result.losses;
  return text({
    rule: describeRule(rule),
    warnings,
    period: { from: new Date(candles[0].openTime).toISOString(), to: new Date(candles[candles.length - 1].openTime).toISOString(), candles: candles.length },
    resultUsd: result.totalUsd,
    resultPctOfStake: result.returnPct,
    justHoldingPct: result.buyHoldPct,
    closedTrades: closed,
    winRatePct: closed ? Math.round((result.wins / closed) * 1000) / 10 : null,
    worstDropUsd: result.maxDrawdownUsd,
    feesUsd: result.feesUsd,
    feePerSidePct: feeBps / 100,
    openAtEnd: result.open,
    latestTrades: result.trades.slice(-20).map((trade) => ({
      at: new Date(trade.time).toISOString(),
      kind: trade.kind,
      side: trade.side,
      price: trade.price,
      ...(trade.pnlUsd !== undefined ? { pnlUsd: trade.pnlUsd, pnlPct: trade.pnlPct } : {}),
      reason: trade.reason,
    })),
    note: "Fills at each candle's close with the fee each way; slippage and funding are not modelled. Past results do not predict future ones. Not financial advice.",
  });
}

/* ── proof ── */

const JOB_ABI = parseAbi([
  "struct Job { uint256 id; address client; address provider; address evaluator; string description; uint256 budget; uint256 expiredAt; uint8 status; address hook; uint256 submittedAt; bytes32 deliverable; }",
  "function getJob(uint256 jobId) view returns (Job)",
  "function paymentToken() view returns (address)",
]);
const STATUS_WORDS = ["open", "funded", "submitted", "completed", "rejected", "expired"] as const;
const ZERO_HASH = `0x${"0".repeat(64)}`;

export async function getEscrowJob(args: Record<string, unknown>): Promise<ToolResult> {
  const raw = typeof args.jobId === "number" ? String(args.jobId) : typeof args.jobId === "string" ? args.jobId.trim() : "";
  if (!/^\d{1,20}$/.test(raw)) return text("Pass the job id as digits, e.g. \"56882\".", true);
  const [job, token] = await Promise.all([
    bscPublicClient.readContract({ address: KERNEL, abi: JOB_ABI, functionName: "getJob", args: [BigInt(raw)] }),
    bscPublicClient.readContract({ address: KERNEL, abi: JOB_ABI, functionName: "paymentToken" }),
  ]);
  if (job.id === BigInt(0) && /^0x0+$/.test(job.client)) return text(`There is no job ${raw} in the escrow contract.`, true);
  // Amounts in U when the escrow's token is U (18 decimals, read from the token itself in lib/x402.ts); raw otherwise.
  const isU = getAddress(token) === getAddress(U_TOKEN);
  const seconds = (value: bigint) => (value === BigInt(0) ? null : new Date(Number(value) * 1000).toISOString());
  return text({
    jobId: raw,
    status: STATUS_WORDS[job.status] ?? `unknown (${job.status})`,
    client: job.client,
    provider: job.provider,
    evaluator: job.evaluator,
    amount: isU ? `${formatUnits(job.budget, 18)} U` : null,
    amountRaw: job.budget.toString(),
    paymentToken: token,
    deadline: seconds(job.expiredAt),
    submittedAt: seconds(job.submittedAt),
    deliverableHash: job.deliverable === ZERO_HASH ? null : job.deliverable,
    contract: KERNEL,
    explorer: `https://bscscan.com/address/${KERNEL}#readContract`,
    note: "Read from BNB Chain just now.",
  });
}
