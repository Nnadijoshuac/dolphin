import type { Condition, Timeframe } from "./strategy";

/**
 * STRATEGY TEMPLATES (owner, 2026-10-04: "go and search for this strategy so you can put it into a
 * box"). Well-known rule-based strategies, each with a target larger than its stop, written in the
 * rule language the engine runs. A template is a start, not a promise: it is added on paper, to the
 * market and venue the person picks, and its rule view backtests it on Binance's history there.
 *
 * KEPT BECAUSE THEY HELD UP, measured 2026-10-04 with backtest_rule (convex/lib/mcpMarket.ts) on
 * BNBUSDT, BTCUSDT and ETHUSDT, ~1,500 candles each, $100 a trade, Binance spot fees:
 *   Trend pullback 4h   +9.3% / +20.5% / +26.0% of stake, 80-86% of trades won
 *   Golden cross 1d     +78.5% / +57.1% / +60.6%           (3 trades each - a thin sample)
 *   EMA trend ride 1d   +44.1% / +40.4% / +6.3%
 *   Breakout 1h         +6.1% / +3.3% / +9.4%
 *   Dip in uptrend 1h   +2.4% / +5.6% / +8.8%              (worst drop $1.60-3.39)
 * DROPPED: MACD momentum 4h (-8.1% / -2.1% / -36.5%) and Oversold bounce 4h (-2.4% on ETH).
 * In that rising market simply holding beat every one (+26% to +322%); these trade for controlled
 * risk, not to beat a bull run. The numbers are recorded here, never shown as the template's own -
 * the person sees their own live backtest.
 */

export type RuleTemplate = {
  id: string;
  name: string;
  /** One line a trader reads. */
  idea: string;
  timeframe: Timeframe;
  when: Condition[];
  until: Condition[];
  stopLossPct: number;
  takeProfitPct: number;
};

export const RULE_TEMPLATES: readonly RuleTemplate[] = [
  {
    id: "trend-pullback",
    name: "Trend pullback",
    idea: "In an uptrend (above the 200 average), buy when RSI dips under 40; sell when it recovers above 65.",
    timeframe: "4h",
    when: [
      { kind: "price_vs_ma", op: "above", ma: "sma", length: 200 },
      { kind: "rsi", op: "below", value: 40, period: 14 },
    ],
    until: [{ kind: "rsi", op: "above", value: 65, period: 14 }],
    stopLossPct: 4,
    takeProfitPct: 8,
  },
  {
    id: "golden-cross",
    name: "Golden cross",
    idea: "Buy when the 50-day average crosses above the 200-day; sell when it crosses back. Few, long trades.",
    timeframe: "1d",
    when: [{ kind: "ma_cross", direction: "up", fast: 50, slow: 200, ma: "sma" }],
    until: [{ kind: "ma_cross", direction: "down", fast: 50, slow: 200, ma: "sma" }],
    stopLossPct: 10,
    takeProfitPct: 30,
  },
  {
    id: "ema-trend-ride",
    name: "EMA trend ride",
    idea: "Buy when the 20-day EMA crosses above the 50-day; ride the trend until it crosses back.",
    timeframe: "1d",
    when: [{ kind: "ma_cross", direction: "up", fast: 20, slow: 50, ma: "ema" }],
    until: [{ kind: "ma_cross", direction: "down", fast: 20, slow: 50, ma: "ema" }],
    stopLossPct: 8,
    takeProfitPct: 20,
  },
  {
    id: "breakout",
    name: "Breakout",
    idea: "Buy a 2% jump over 6 hours while above the 50 average; take 4%, cut at 2%.",
    timeframe: "1h",
    when: [
      { kind: "change_pct", op: "above", value: 2, candles: 6 },
      { kind: "price_vs_ma", op: "above", ma: "sma", length: 50 },
    ],
    until: [],
    stopLossPct: 2,
    takeProfitPct: 4,
  },
  {
    id: "dip-in-uptrend",
    name: "Dip in uptrend",
    idea: "Above the 200 EMA, buy hourly RSI dips under 35; sell above 60. Small, careful trades.",
    timeframe: "1h",
    when: [
      { kind: "price_vs_ma", op: "above", ma: "ema", length: 200 },
      { kind: "rsi", op: "below", value: 35, period: 14 },
    ],
    until: [{ kind: "rsi", op: "above", value: 60, period: 14 }],
    stopLossPct: 2,
    takeProfitPct: 4,
  },
];
