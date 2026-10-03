import type { BinanceConfig } from "./agentBlocks";
import { emaSeries, macdSeries, rsiSeries, smaSeries } from "./indicators";

/**
 * THE RULE ENGINE: THE AI WRITES THE PLAN, CODE EXECUTES IT (owner, 2026-10-03).
 * Agent/PLAN-2026-10-03-fast-rules-binance-export.md, phase 1.
 *
 * "Trading is a millisecond thing... the AI makes the plan beforehand... the
 * checkers that don't need the AI just keep watching, and once anything
 * activates it, it goes off." A model takes 5-30 s; this takes microseconds.
 *
 * A rule is DATA in a bounded language, never code: a market and timeframe,
 * conditions on CLOSED candles, one action with a size, how to get out, and
 * limits. `decide` is pure - closed candles and the position in, one decision
 * out - so Dolphin's autopilot and an exported runner on the builder's own
 * server run the very same logic. Nothing here fetches, signs or sends.
 */

export const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

/** How long one candle of each timeframe lasts. */
export const TIMEFRAME_MS: Record<Timeframe, number> = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 };

/** Where it trades. Binance venues arrive in phase 3; a rule names its venue from the start. */
export type Venue = "dolphin-wallet" | "binance-wallet" | "binance-spot" | "binance-futures";

export type Condition =
  /** RSI(period) above or below a level. */
  | { kind: "rsi"; op: "above" | "below"; value: number; period?: number }
  /** The close above or below a moving average. */
  | { kind: "price_vs_ma"; op: "above" | "below"; ma: "sma" | "ema"; length: number }
  /** A fast moving average crossing a slow one on the last closed candle. */
  | { kind: "ma_cross"; direction: "up" | "down"; fast: number; slow: number; ma?: "sma" | "ema" }
  /** MACD (12, 26, 9) crossing its signal on the last closed candle. */
  | { kind: "macd_cross"; direction: "up" | "down" }
  /** N closes in a row each lower (down) or higher (up) than the one before: "the market is going down". */
  | { kind: "trend"; direction: "up" | "down"; candles: number }
  /** The close above or below a price. */
  | { kind: "price"; op: "above" | "below"; value: number }
  /** The % change over the last N candles above or below a value (negative for drops). */
  | { kind: "change_pct"; op: "above" | "below"; value: number; candles: number };

/**
 * How a rule ENTERS: buy (go long) or short (Binance Futures only). It always
 * leaves through its exits - "until" conditions, stop-loss, take-profit - so
 * a "sell" is simply the exit of a buy, never a separate, ambiguous entry.
 */
export type Action = "buy" | "short";

export type Rule = {
  id: string;
  /** In words, as the builder reads it on the canvas. */
  name: string;
  venue: Venue;
  /** "BNBUSDT" on a Binance venue; a token symbol or address for the Dolphin Wallet. */
  market: string;
  timeframe: Timeframe;
  /** All must hold on the same closed candle to act. */
  when: Condition[];
  action: Action;
  /** How much each entry spends, in US dollars (stablecoin terms). */
  sizeUsd: number;
  /** Get out when ALL of these hold ("hold until the trend turns"). Empty: only stop-loss / take-profit. */
  until: Condition[];
  /** Exit when the position is this % against it. Null: none. */
  stopLossPct: number | null;
  /** Exit when the position is this % in its favour. Null: none. */
  takeProfitPct: number | null;
  /** Futures only: the most leverage a short or long may use. 1 everywhere else. */
  leverage: number;
  maxTradesPerDay: number;
  /** After any trade, wait this long before the next entry. */
  cooldownMinutes: number;
};

export type Candle = { openTime: number; open: number; high: number; low: number; close: number };

/** What the rule holds right now, kept by whoever runs it. */
export type Position = { side: "long" | "short"; entryPrice: number; openedAt: number } | null;

export type RuleState = {
  position: Position;
  /** The candle the rule last judged (openTime), so one candle is never acted on twice. */
  lastCandle: number | null;
  /** Trades today, and which UTC day that count is for. */
  tradesToday: number;
  tradesDay: string | null;
  lastTradeAt: number | null;
};

export const EMPTY_STATE: RuleState = { position: null, lastCandle: null, tradesToday: 0, tradesDay: null, lastTradeAt: null };

export type Decision =
  | { type: "none"; reason: string }
  | { type: "enter"; side: "long" | "short"; action: Action; price: number; reason: string }
  | { type: "exit"; side: "long" | "short"; price: number; reason: string };

/* ── Bounds: a rule can never ask for more than these ── */
export const LIMITS = {
  maxConditions: 6,
  maxSizeUsd: 100_000,
  maxLeverage: 5,
  /** Owner, 2026-10-03: 1-3x is the normal range; up to 5x is allowed, with a warning. */
  comfortableLeverage: 3,
  maxTradesPerDay: 50,
  maxCooldownMinutes: 7 * 24 * 60,
  maxLength: 400,
  maxTrendCandles: 20,
} as const;

/* ── Evaluating one condition on the last CLOSED candle ── */

function last<T>(series: readonly (T | null)[]): T | null {
  return series.length ? series[series.length - 1] : null;
}

/** Whether `condition` holds on the last of these closed candles. Too little history: false, never a guess. */
export function holds(condition: Condition, candles: readonly Candle[]): boolean {
  const closes = candles.map((candle) => candle.close);
  const n = closes.length;
  if (n === 0) return false;
  const close = closes[n - 1];
  switch (condition.kind) {
    case "price":
      return condition.op === "above" ? close > condition.value : close < condition.value;
    case "rsi": {
      const rsi = last(rsiSeries(closes, condition.period ?? 14));
      if (rsi === null) return false;
      return condition.op === "above" ? rsi > condition.value : rsi < condition.value;
    }
    case "price_vs_ma": {
      const ma = last(condition.ma === "ema" ? emaSeries(closes, condition.length) : smaSeries(closes, condition.length));
      if (ma === null) return false;
      return condition.op === "above" ? close > ma : close < ma;
    }
    case "ma_cross": {
      const series = (length: number) => (condition.ma === "ema" ? emaSeries(closes, length) : smaSeries(closes, length));
      const fast = series(condition.fast);
      const slow = series(condition.slow);
      if (n < 2 || fast[n - 2] === null || slow[n - 2] === null || fast[n - 1] === null || slow[n - 1] === null) return false;
      const before = fast[n - 2]! - slow[n - 2]!;
      const now = fast[n - 1]! - slow[n - 1]!;
      return condition.direction === "up" ? before <= 0 && now > 0 : before >= 0 && now < 0;
    }
    case "macd_cross": {
      const { histogram } = macdSeries(closes);
      if (n < 2 || histogram[n - 2] === null || histogram[n - 1] === null) return false;
      return condition.direction === "up" ? histogram[n - 2]! <= 0 && histogram[n - 1]! > 0 : histogram[n - 2]! >= 0 && histogram[n - 1]! < 0;
    }
    case "trend": {
      if (n < condition.candles + 1) return false;
      for (let i = n - condition.candles; i < n; i++) {
        if (condition.direction === "down" ? !(closes[i] < closes[i - 1]) : !(closes[i] > closes[i - 1])) return false;
      }
      return true;
    }
    case "change_pct": {
      if (n < condition.candles + 1) return false;
      const from = closes[n - 1 - condition.candles];
      if (!(from > 0)) return false;
      const change = ((close - from) / from) * 100;
      return condition.op === "above" ? change > condition.value : change < condition.value;
    }
  }
}

/** A number as a trader reads it: 4 significant digits, no trailing noise. */
function fig(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 6;
  return String(Number(value.toFixed(digits)));
}

/**
 * WHY, WITH THE ACTUAL NUMBERS (owner, 2026-10-03; UI review point 11): what a condition saw
 * on the judged candle ("RSI was 28.4") and what it asks for ("below 30"). Read from the same
 * series `holds` uses, so an explanation cannot disagree with the decision it explains.
 */
function sawAndWants(condition: Condition, candles: readonly Candle[]): { saw: string; wants: string } | null {
  const closes = candles.map((candle) => candle.close);
  const n = closes.length;
  if (n === 0) return null;
  const close = closes[n - 1];
  switch (condition.kind) {
    case "price":
      return { saw: `the price was $${fig(close)}`, wants: `${condition.op} $${fig(condition.value)}` };
    case "rsi": {
      const rsi = last(rsiSeries(closes, condition.period ?? 14));
      return rsi === null ? null : { saw: `RSI was ${fig(Math.round(rsi * 10) / 10)}`, wants: `${condition.op} ${condition.value}` };
    }
    case "price_vs_ma": {
      const ma = last(condition.ma === "ema" ? emaSeries(closes, condition.length) : smaSeries(closes, condition.length));
      return ma === null
        ? null
        : { saw: `the price was $${fig(close)} and the ${condition.length} ${condition.ma.toUpperCase()} $${fig(ma)}`, wants: `${condition.op} the average` };
    }
    case "ma_cross": {
      const series = (length: number) => (condition.ma === "ema" ? emaSeries(closes, length) : smaSeries(closes, length));
      const fast = last(series(condition.fast));
      const slow = last(series(condition.slow));
      return fast === null || slow === null
        ? null
        : { saw: `the ${condition.fast} was $${fig(fast)} and the ${condition.slow} $${fig(slow)}`, wants: `a fresh cross ${condition.direction === "up" ? "above" : "below"}` };
    }
    case "macd_cross": {
      const { line, signal } = macdSeries(closes);
      const macd = last(line);
      const sig = last(signal);
      return macd === null || sig === null
        ? null
        : { saw: `MACD was ${fig(macd)} and its signal ${fig(sig)}`, wants: `a fresh cross ${condition.direction === "up" ? "above" : "below"}` };
    }
    case "trend":
      return {
        saw: `the last ${condition.candles} closes went ${closes
          .slice(Math.max(0, n - condition.candles - 1))
          .map((value) => `$${fig(value)}`)
          .join(" → ")}`,
        wants: `each ${condition.direction === "down" ? "lower" : "higher"}`,
      };
    case "change_pct": {
      const from = closes[n - 1 - condition.candles];
      return from > 0
        ? { saw: `the price moved ${fig(Math.round(((close - from) / from) * 10000) / 100)}% over ${condition.candles} candles`, wants: `${condition.op} ${condition.value}%` }
        : null;
    }
  }
}

/** What a condition saw, and whether that met it: "RSI was 28.4, below 30" or "RSI was 45.2, not below 30". */
export function observe(condition: Condition, candles: readonly Candle[]): string {
  const parts = sawAndWants(condition, candles);
  if (!parts) return `not enough candles yet to tell whether ${describe(condition)}`;
  return `${parts.saw}, ${holds(condition, candles) ? "" : "not "}${parts.wants}`;
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * THE DECISION for one newly closed candle. `candles` are CLOSED candles,
 * oldest first; the last one is the candle being judged. Exits are checked
 * before entries, so a position is never added to and a rule never flips in
 * one step. The caller executes the decision, then calls `afterTrade`.
 */
/**
 * THE DAILY LOSS LIMIT (owner, 2026-10-03: "once it's $50 you can't trade again" - against
 * revenge trading). Across ALL of an agent's rules: once today's realized losses reach the
 * limit, no rule opens anything new until midnight UTC. Exits still run, so an open
 * position can always close. Realized = closed trades only, in dollars of margin.
 */
export type LossGuard = { limitUsd: number | null; lossTodayUsd: number };

/** A closed trade's result in dollars: its % (leverage included) of the margin it put up. */
export function resultUsd(pnlPct: number, sizeUsd: number): number {
  return Math.round(((pnlPct * sizeUsd) / 100) * 100) / 100 + 0;
}

export function decide(rule: Rule, candles: readonly Candle[], state: RuleState, now: number, guard?: LossGuard): Decision {
  const judged = candles[candles.length - 1];
  if (!judged) return { type: "none", reason: "No closed candle yet." };
  if (state.lastCandle !== null && judged.openTime <= state.lastCandle) return { type: "none", reason: "Already judged this candle." };
  const price = judged.close;

  if (state.position) {
    const { side, entryPrice } = state.position;
    const movePct = ((price - entryPrice) / entryPrice) * 100 * (side === "long" ? 1 : -1);
    if (rule.stopLossPct !== null && movePct <= -rule.stopLossPct) {
      return { type: "exit", side, price, reason: `Stop-loss: in at $${fig(entryPrice)}, now $${fig(price)} - ${Math.abs(movePct).toFixed(2)}% against the position; your stop is ${rule.stopLossPct}%.` };
    }
    if (rule.takeProfitPct !== null && movePct >= rule.takeProfitPct) {
      return { type: "exit", side, price, reason: `Take-profit: in at $${fig(entryPrice)}, now $${fig(price)} - ${movePct.toFixed(2)}% in favour; your target is ${rule.takeProfitPct}%.` };
    }
    if (rule.until.length > 0 && rule.until.every((condition) => holds(condition, candles))) {
      return { type: "exit", side, price, reason: `Exit rule met: ${rule.until.map((condition) => observe(condition, candles)).join(" and ")}.` };
    }
    return { type: "none", reason: `Holding: in at $${fig(entryPrice)}, now $${fig(price)} (${movePct >= 0 ? "+" : ""}${movePct.toFixed(2)}%).` };
  }

  if (rule.when.length === 0 || !rule.when.every((condition) => holds(condition, candles))) {
    return { type: "none", reason: rule.when.length ? `No trade: ${rule.when.map((condition) => observe(condition, candles)).join("; ")}.` : "No trade: the rule has no entry condition." };
  }
  const today = utcDay(now);
  if (guard && guard.limitUsd !== null && guard.lossTodayUsd >= guard.limitUsd) {
    return { type: "none", reason: `Daily loss limit reached: $${guard.lossTodayUsd} lost today, limit $${guard.limitUsd}. No new trades until midnight UTC.` };
  }
  if (state.tradesDay === today && state.tradesToday >= rule.maxTradesPerDay) {
    return { type: "none", reason: `Daily cap of ${rule.maxTradesPerDay} trades reached.` };
  }
  if (state.lastTradeAt !== null && now - state.lastTradeAt < rule.cooldownMinutes * 60_000) {
    return { type: "none", reason: "Cooling down after the last trade." };
  }
  const side = rule.action === "short" ? "short" : "long";
  // cleanRule refuses this; checked again so a hand-made rule cannot slip through.
  if (side === "short" && rule.venue !== "binance-futures") {
    return { type: "none", reason: "Shorting needs Binance Futures; this venue only buys." };
  }
  return { type: "enter", side, action: rule.action, price, reason: `Entry rule met: ${rule.when.map((condition) => observe(condition, candles)).join(" and ")}.` };
}

/**
 * The state after a candle was judged and its decision carried out (or not).
 * `executed` is false when the venue refused or failed: then the position does
 * not change, and the next candle is judged again.
 */
export function afterCandle(state: RuleState, candleOpenTime: number, decision: Decision, executed: boolean, now: number): RuleState {
  const today = utcDay(now);
  const tradesToday = state.tradesDay === today ? state.tradesToday : 0;
  const next: RuleState = { ...state, lastCandle: candleOpenTime, tradesDay: today, tradesToday };
  if (!executed || decision.type === "none") return next;
  if (decision.type === "enter") {
    return { ...next, position: { side: decision.side, entryPrice: decision.price, openedAt: now }, tradesToday: tradesToday + 1, lastTradeAt: now };
  }
  return { ...next, position: null, lastTradeAt: now };
}

/** The result of a closed position, in %, leverage included (fees and funding are not). */
export function resultPct(side: "long" | "short", entry: number, exit: number, leverage: number): number {
  const move = ((exit - entry) / entry) * 100 * (side === "long" ? 1 : -1);
  // "+ 0" turns -0 into 0: a flat short is 0%, and Convex stores -0 as a special value (seen on dev, 2026-10-03).
  return Math.round(move * leverage * 100) / 100 + 0;
}

/* ── Words: what the builder reads on the canvas ── */

export function describe(condition: Condition): string {
  switch (condition.kind) {
    case "price":
      return `the price is ${condition.op} $${condition.value}`;
    case "rsi":
      return `RSI${condition.period && condition.period !== 14 ? `(${condition.period})` : ""} is ${condition.op} ${condition.value}`;
    case "price_vs_ma":
      return `the price is ${condition.op} the ${condition.length} ${condition.ma.toUpperCase()}`;
    case "ma_cross":
      return `the ${condition.fast} crosses ${condition.direction === "up" ? "above" : "below"} the ${condition.slow}${condition.ma === "ema" ? " EMA" : ""}`;
    case "macd_cross":
      return `MACD crosses ${condition.direction === "up" ? "above" : "below"} its signal`;
    case "trend":
      return `${condition.candles} candles in a row close ${condition.direction === "down" ? "lower" : "higher"}`;
    case "change_pct":
      return `the price moves ${condition.op} ${condition.value}% over ${condition.candles} candles`;
  }
}

export function describeRule(rule: Rule): string {
  const verb = rule.action === "short" ? "short" : "buy";
  const exits = [
    ...(rule.until.length ? [`when ${rule.until.map(describe).join(" and ")}`] : []),
    ...(rule.stopLossPct !== null ? [`at a ${rule.stopLossPct}% loss`] : []),
    ...(rule.takeProfitPct !== null ? [`at a ${rule.takeProfitPct}% gain`] : []),
  ];
  return (
    `On ${rule.market} ${rule.timeframe} candles: when ${rule.when.map(describe).join(" and ")}, ${verb} $${rule.sizeUsd}` +
    (rule.leverage > 1 ? ` at ${rule.leverage}x` : "") +
    (exits.length ? `; get out ${exits.join(", or ")}` : "") +
    `. At most ${rule.maxTradesPerDay} a day.`
  );
}

/* ── Checking a rule the AI wrote: data in a bounded language, or a reason why not ── */

const num = (value: unknown, min: number, max: number): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;

/**
 * The same meaning, written the ways models write it: "<", "lt", "less_than",
 * "falls below" -> below; "crosses_up", "bullish", "rising" -> up. A level may
 * come as `value` or `level`. Anything still unclear is refused, never guessed.
 */
function opOf(value: unknown): "above" | "below" | null {
  const text = String(value ?? "").toLowerCase().replace(/[\s_-]+/g, " ").trim();
  if (/^(above|>|>=|gt|gte|greater( than)?|over|rises above|crosses above|higher|up)$/.test(text)) return "above";
  if (/^(below|<|<=|lt|lte|less( than)?|under|drops below|falls below|crosses below|lower|down)$/.test(text)) return "below";
  return null;
}

function directionOf(value: unknown): "up" | "down" | null {
  const text = String(value ?? "").toLowerCase().replace(/[\s_-]+/g, " ").trim();
  if (/^(up|cross up|crosses up|bullish|rising|uptrend|higher|above)$/.test(text)) return "up";
  if (/^(down|cross down|crosses down|bearish|falling|downtrend|lower|below)$/.test(text)) return "down";
  return null;
}

function cleanCondition(raw: unknown): Condition | string {
  const c = { ...((raw ?? {}) as Record<string, unknown>) };
  if ((c.value === null || c.value === undefined) && typeof c.level === "number") c.value = c.level;
  const op = opOf(c.op) ?? opOf(c.direction);
  const direction = directionOf(c.direction) ?? directionOf(c.op);
  switch (c.kind) {
    case "price": {
      const value = num(c.value, 0, 1e12);
      return op && value !== null && value > 0 ? { kind: "price", op, value } : "a price condition needs above/below and a price";
    }
    case "rsi": {
      const value = num(c.value, 1, 99);
      const period = c.period === undefined || c.period === null ? 14 : num(c.period, 2, 100);
      return op && value !== null && period !== null ? { kind: "rsi", op, value, period } : "an RSI condition needs above/below and a level from 1 to 99";
    }
    case "price_vs_ma": {
      const length = num(c.length, 2, LIMITS.maxLength);
      const ma = c.ma === "ema" ? "ema" : "sma";
      return op && length !== null ? { kind: "price_vs_ma", op, ma, length: Math.round(length) } : "a moving-average condition needs above/below and a length";
    }
    case "ma_cross": {
      const fast = num(c.fast, 2, LIMITS.maxLength);
      const slow = num(c.slow, 3, LIMITS.maxLength);
      if (!direction || fast === null || slow === null || fast >= slow) return "a moving-average cross needs up/down and a fast length below the slow one";
      return { kind: "ma_cross", direction, fast: Math.round(fast), slow: Math.round(slow), ma: c.ma === "ema" ? "ema" : "sma" };
    }
    case "macd_cross":
      return direction ? { kind: "macd_cross", direction } : "a MACD cross needs up or down";
    case "trend": {
      const candles = num(c.candles, 1, LIMITS.maxTrendCandles);
      return direction && candles !== null ? { kind: "trend", direction, candles: Math.round(candles) } : `a trend needs up/down and 1 to ${LIMITS.maxTrendCandles} candles`;
    }
    case "change_pct": {
      const value = num(c.value, -99, 1000);
      const candles = num(c.candles, 1, 200);
      return op && value !== null && candles !== null ? { kind: "change_pct", op, value, candles: Math.round(candles) } : "a % change needs above/below, a % and a number of candles";
    }
    default:
      return `"${String(c.kind)}" is not a condition Dolphin knows`;
  }
}

/**
 * A rule as the AI proposed it, checked against the language and its bounds.
 * Problems come back in words for the builder; nothing out of bounds is
 * ever clamped into a rule silently.
 */
/**
 * Roughly how far the price must move against a leveraged position before the
 * exchange liquidates it: 1 / leverage, before fees and maintenance margin.
 * Said in the warning so the builder sees the risk as a price move.
 */
export function liquidationMovePct(leverage: number): number {
  return Math.round(100 / leverage);
}

export function cleanRule(raw: unknown, id: string): { rule: Rule; warnings: string[] } | { problems: string[] } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const problems: string[] = [];
  const venue: Venue = (["dolphin-wallet", "binance-wallet", "binance-spot", "binance-futures"] as const).includes(r.venue as Venue)
    ? (r.venue as Venue)
    : "dolphin-wallet";
  const timeframe = (TIMEFRAMES as readonly string[]).includes(String(r.timeframe)) ? (r.timeframe as Timeframe) : null;
  if (!timeframe) problems.push(`the timeframe must be one of ${TIMEFRAMES.join(", ")}`);
  const market = typeof r.market === "string" ? r.market.trim().slice(0, 64) : "";
  if (!market) problems.push("it needs a market, like BNBUSDT");
  const action = (["buy", "short"] as const).includes(r.action as Action) ? (r.action as Action) : null;
  if (!action) problems.push("the action must be buy or short (it sells through its exits)");
  if (action === "short" && venue !== "binance-futures") problems.push("shorting needs the Binance Futures venue");

  const conditions = (list: unknown, label: string): Condition[] => {
    const items = Array.isArray(list) ? list : [];
    if (items.length > LIMITS.maxConditions) problems.push(`${label}: at most ${LIMITS.maxConditions} conditions`);
    const out: Condition[] = [];
    for (const item of items.slice(0, LIMITS.maxConditions)) {
      const cleaned = cleanCondition(item);
      if (typeof cleaned === "string") problems.push(`${label}: ${cleaned}`);
      else out.push(cleaned);
    }
    return out;
  };
  const when = conditions(r.when, "when");
  if (when.length === 0) problems.push("it needs at least one condition to act on");
  const until = conditions(r.until, "until");

  const sizeUsd = num(r.sizeUsd, 1, LIMITS.maxSizeUsd);
  if (sizeUsd === null) problems.push(`the size must be $1 to $${LIMITS.maxSizeUsd.toLocaleString("en")}`);
  const pct = (value: unknown, label: string) => {
    if (value === null || value === undefined) return null;
    const p = num(value, 0.1, 100);
    if (p === null) problems.push(`${label} must be 0.1% to 100%`);
    return p;
  };
  const stopLossPct = pct(r.stopLossPct, "the stop-loss");
  const takeProfitPct = pct(r.takeProfitPct, "the take-profit");
  const leverage = venue === "binance-futures" ? num(r.leverage ?? 1, 1, LIMITS.maxLeverage) : 1;
  if (leverage === null) problems.push(`leverage must be 1x to ${LIMITS.maxLeverage}x`);
  // A short with no way out is refused: losses on a short have no ceiling.
  if (action === "short" && until.length === 0 && stopLossPct === null) problems.push("a short needs a stop-loss or an exit condition");
  const maxTradesPerDay = num(r.maxTradesPerDay ?? 2, 1, LIMITS.maxTradesPerDay);
  if (maxTradesPerDay === null) problems.push(`at most ${LIMITS.maxTradesPerDay} trades a day`);
  const cooldownMinutes = num(r.cooldownMinutes ?? 0, 0, LIMITS.maxCooldownMinutes);
  if (cooldownMinutes === null) problems.push("the cooldown must be 0 minutes to 7 days");

  if (problems.length > 0) return { problems };
  const warnings: string[] = [];
  if ((leverage as number) > LIMITS.comfortableLeverage) {
    warnings.push(
      `${leverage}x is above the usual 1-3x. A move of about ${liquidationMovePct(leverage as number)}% against the position would liquidate it, and everything in it would be lost.`,
    );
  }
  const rule: Rule = {
    id,
    name: "",
    venue,
    market,
    timeframe: timeframe as Timeframe,
    when,
    action: action as Action,
    sizeUsd: sizeUsd as number,
    until,
    stopLossPct,
    takeProfitPct,
    leverage: leverage as number,
    maxTradesPerDay: Math.round(maxTradesPerDay as number),
    cooldownMinutes: Math.round(cooldownMinutes as number),
  };
  rule.name = typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 80) : describeRule(rule).slice(0, 80);
  return { rule, warnings };
}

/**
 * Whether a rule fits the Binance block (phase 3). The block is where real
 * money would trade, so a rule may not reach past it: futures only when the
 * block allows futures, never more leverage than the block's maximum, and the
 * Agentic Wallet only for binance-wallet rules. Null: it fits (or needs no Binance).
 */
export function venueProblem(rule: Pick<Rule, "venue" | "leverage">, binance: BinanceConfig | null): string | null {
  if (rule.venue === "dolphin-wallet") return null;
  if (!binance) return "it trades on Binance, but the agent has no Binance block - add one from the toolbox";
  if (rule.venue === "binance-wallet") return binance.account === "wallet" ? null : "it trades from the Binance Wallet, but the Binance block is set to the Exchange";
  if (binance.account !== "exchange") return "it trades on the Binance Exchange, but the Binance block is set to the Binance Wallet";
  if (rule.venue === "binance-futures" && !binance.futures) return "it trades futures - switch on futures on the Binance block";
  if (rule.leverage > binance.maxLeverage) return `it uses ${rule.leverage}x, above the Binance block's ${binance.maxLeverage}x - raise the block's limit or lower the rule's`;
  return null;
}

/* ── Backtest: the same decisions, replayed over history (owner, 2026-10-03) ── */

export type SimTrade = {
  kind: "enter" | "exit";
  side: "long" | "short";
  /** The judged candle's open time, ms. */
  time: number;
  price: number;
  reason: string;
  /** On an exit: the result, leverage included, after fees. */
  pnlPct?: number;
  pnlUsd?: number;
};

export type SimResult = {
  trades: SimTrade[];
  /** Realised plus open result after each candle, in dollars. */
  equity: { time: number; usd: number }[];
  totalUsd: number;
  /** Total result against one trade's size. */
  returnPct: number;
  wins: number;
  losses: number;
  maxDrawdownUsd: number;
  feesUsd: number;
  /** The market's own move over the same candles (buy and hold), %. */
  buyHoldPct: number;
  open: { side: "long" | "short"; entryPrice: number; time: number } | null;
};

/**
 * Replays a rule over closed candles exactly as the engine runs it: `decide` on each newly closed
 * candle with the state `afterCandle` leaves, fills at that candle's close, the daily loss limit
 * per UTC day. On top, what paper trading leaves out: the venue's fee on every fill
 * (`feeBps` of the position's value). Funding and slippage are not modelled - said where shown.
 */
export function simulate(rule: Rule, candles: readonly Candle[], options: { feeBps: number; dailyLossLimitUsd: number | null; warmup?: number }): SimResult {
  const timeframeMs = TIMEFRAME_MS[rule.timeframe];
  const warmup = Math.min(options.warmup ?? 60, Math.max(0, candles.length - 1));
  let state: RuleState = { ...EMPTY_STATE, lastCandle: candles[warmup - 1]?.openTime ?? null };
  const trades: SimTrade[] = [];
  const equity: { time: number; usd: number }[] = [];
  let realised = 0;
  let fees = 0;
  let wins = 0;
  let losses = 0;
  const lossByDay = new Map<string, number>();
  const notional = rule.sizeUsd * rule.leverage;
  const fee = (notional * options.feeBps) / 10_000;
  for (let index = warmup; index < candles.length; index++) {
    const window = candles.slice(0, index + 1);
    const candle = candles[index];
    const now = candle.openTime + timeframeMs;
    const day = new Date(now).toISOString().slice(0, 10);
    const guard: LossGuard = { limitUsd: options.dailyLossLimitUsd, lossTodayUsd: lossByDay.get(day) ?? 0 };
    const held = state.position;
    const decision = decide(rule, window, state, now, guard);
    if (decision.type === "enter") {
      fees += fee;
      realised -= fee;
      trades.push({ kind: "enter", side: decision.side, time: candle.openTime, price: decision.price, reason: decision.reason });
    } else if (decision.type === "exit" && held) {
      const pct = resultPct(held.side, held.entryPrice, decision.price, rule.leverage);
      const usd = Math.round((resultUsd(pct, rule.sizeUsd) - fee * 2) * 100) / 100 + 0;
      fees += fee;
      realised += resultUsd(pct, rule.sizeUsd) - fee;
      if (usd >= 0) wins++;
      else {
        losses++;
        lossByDay.set(day, Math.round(((lossByDay.get(day) ?? 0) - usd) * 100) / 100);
      }
      trades.push({ kind: "exit", side: held.side, time: candle.openTime, price: decision.price, reason: decision.reason, pnlPct: pct, pnlUsd: usd });
    }
    state = afterCandle(state, candle.openTime, decision, true, now);
    const open = state.position ? resultUsd(resultPct(state.position.side, state.position.entryPrice, candle.close, rule.leverage), rule.sizeUsd) : 0;
    equity.push({ time: candle.openTime, usd: Math.round((realised + open) * 100) / 100 });
  }
  let peak = 0;
  let maxDrawdown = 0;
  for (const point of equity) {
    peak = Math.max(peak, point.usd);
    maxDrawdown = Math.max(maxDrawdown, peak - point.usd);
  }
  const first = candles[warmup]?.close ?? candles[0]?.close ?? 0;
  const last = candles[candles.length - 1]?.close ?? first;
  const totalUsd = equity.length ? equity[equity.length - 1].usd : 0;
  return {
    trades,
    equity,
    totalUsd,
    returnPct: rule.sizeUsd > 0 ? Math.round((totalUsd / rule.sizeUsd) * 10_000) / 100 + 0 : 0,
    wins,
    losses,
    maxDrawdownUsd: Math.round(maxDrawdown * 100) / 100,
    feesUsd: Math.round(fees * 100) / 100,
    buyHoldPct: first > 0 ? Math.round(((last - first) / first) * 10_000) / 100 + 0 : 0,
    open: state.position ? { side: state.position.side, entryPrice: state.position.entryPrice, time: state.position.openedAt } : null,
  };
}
