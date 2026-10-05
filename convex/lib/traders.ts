import type { Condition, Timeframe } from "./strategy";

/**
 * DOLPHIN'S OWN TRADERS (owner + mentor, 2026-10-05: "trading agents that people can just hire and it
 * trades for them, two types: aggressive and analytical (risk-averse)"). The idea of one desk with
 * different risk temperaments comes from TradingAgents' risk team (Agent/research-tradingagents/NOTES.md).
 *
 * A trader is ONE rule run by the existing engine (lib/strategy.ts) from the hirer's own Dolphin Wallet:
 * no AI in the order path, the same order lock, trade key and trade log as every rule. Hiring copies it
 * into the hirer's agents with their amount as its size.
 *
 * CHOSEN BY BACKTEST, measured 2026-10-05 on BNBUSDT, $20 a trade, PancakeSwap's 0.25% fee each way plus
 * $0.02 gas per swap (tests/_trader-candidates.ts):
 *   Steady (trend pullback 4h)  180 d: +12.3%, 6 trades, 6 won, worst dip $1.06 | 365 d: +10.8%, 12 trades, worst dip $3.02
 *   Bold   (deep dip 4h)        180 d:  +5.6%, 9 trades, 78% won, worst dip $2.27 | 365 d: +6.5%, 26 trades, worst dip $7.24
 *   BNB itself                  180 d: +30.7%                                     | 365 d: -31.7%
 * Rejected for Bold: every fast design (15m/1h momentum, MACD, breakouts) lost 4-61% after fees and gas
 * at this size - small, frequent trades are eaten by costs. So Bold means wider swings and more trades
 * than Steady, not leverage and not "more profit". These numbers are recorded here, never shown as
 * a promise: the page runs its own backtest when it is opened.
 */

export type TraderDef = {
  id: "steady" | "bold";
  name: string;
  /** One line for the card. */
  tagline: string;
  risk: "Lower" | "Higher";
  /** How it decides, in four short plain steps - the "desk" a person reads. */
  desk: { watches: string; buys: string; sells: string; protects: string };
  timeframe: Timeframe;
  when: Condition[];
  until: Condition[];
  stopLossPct: number;
  takeProfitPct: number;
  maxTradesPerDay: number;
};

export const TRADER_MARKET = "BNBUSDT";
export const TRADER_MIN_USD = 20;
export const TRADER_MAX_USD = 5_000;

export const TRADERS: readonly TraderDef[] = [
  {
    id: "steady",
    name: "Steady",
    tagline: "Waits for a dip inside an uptrend. Few trades, small losses.",
    risk: "Lower",
    desk: {
      watches: "BNB on 4-hour candles, and whether it is above its 200-candle average.",
      buys: "Only when BNB is in an uptrend and has just pulled back (RSI under 40).",
      sells: "When it bounces back (RSI over 65) or is up 8%.",
      protects: "Sells if it falls 4% from where it bought.",
    },
    timeframe: "4h",
    when: [
      { kind: "price_vs_ma", op: "above", ma: "sma", length: 200 },
      { kind: "rsi", op: "below", value: 40, period: 14 },
    ],
    until: [{ kind: "rsi", op: "above", value: 65, period: 14 }],
    stopLossPct: 4,
    takeProfitPct: 8,
    maxTradesPerDay: 2,
  },
  {
    id: "bold",
    name: "Bold",
    tagline: "Buys hard drops in any market and holds through bigger swings.",
    risk: "Higher",
    desk: {
      watches: "BNB on 4-hour candles, looking for sharp sell-offs.",
      buys: "When BNB is deeply oversold (RSI under 35), even in a falling market.",
      sells: "When it recovers (RSI over 60) or is up 12%.",
      protects: "Sells if it falls 8% from where it bought.",
    },
    timeframe: "4h",
    when: [{ kind: "rsi", op: "below", value: 35, period: 14 }],
    until: [{ kind: "rsi", op: "above", value: 60, period: 14 }],
    stopLossPct: 8,
    takeProfitPct: 12,
    maxTradesPerDay: 2,
  },
];

export function traderById(id: string): TraderDef | null {
  return TRADERS.find((trader) => trader.id === id) ?? null;
}

/** The trader as a raw rule for cleanRule, at the hirer's size. */
export function traderRule(trader: TraderDef, sizeUsd: number): Record<string, unknown> {
  return {
    name: `${trader.name} trader`,
    venue: "dolphin-wallet",
    market: TRADER_MARKET,
    timeframe: trader.timeframe,
    action: "buy",
    sizeUsd,
    when: trader.when,
    until: trader.until,
    stopLossPct: trader.stopLossPct,
    takeProfitPct: trader.takeProfitPct,
    leverage: 1,
    maxTradesPerDay: trader.maxTradesPerDay,
    cooldownMinutes: 0,
  };
}
