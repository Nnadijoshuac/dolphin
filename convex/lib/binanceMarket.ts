import type { Candle, Timeframe, Venue } from "./strategy";

/**
 * BINANCE'S PUBLIC CANDLES, for the rule engine (fast rules, phase 2).
 * No key: public market data. Measured from Convex (eu-west-1) on 2026-10-03:
 * spot klines 242 ms, futures klines 234 ms. (The owner's own network cannot
 * resolve Binance at all - so an exported runner must live on a server that can.)
 *
 * Only CLOSED candles are returned: the one still forming is dropped, so a rule
 * never acts on a candle that could still change.
 */

const SPOT = "https://api.binance.com/api/v3/klines";
const FUTURES = "https://fapi.binance.com/fapi/v1/klines";

/** "BNBUSDT"-style symbols only: letters and digits, quoted in a stablecoin Binance lists. */
export function isBinanceSymbol(symbol: string): boolean {
  return /^[A-Z0-9]{2,20}(USDT|USDC|FDUSD|BUSD|USD1)$/.test(symbol);
}

export class MarketDataError extends Error {}

/**
 * The last `limit` CLOSED candles for a symbol. Futures rules read futures
 * candles (the price they trade at); every other venue reads spot.
 */
export async function closedCandles(venue: Venue, symbol: string, timeframe: Timeframe, limit = 200, now = Date.now()): Promise<Candle[]> {
  if (!isBinanceSymbol(symbol)) throw new MarketDataError(`"${symbol}" is not a Binance market. Use a pair like BNBUSDT.`);
  const base = venue === "binance-futures" ? FUTURES : SPOT;
  const url = `${base}?symbol=${symbol}&interval=${timeframe}&limit=${Math.min(Math.max(limit, 2), 1000) + 1}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new MarketDataError(/Invalid symbol/i.test(body) ? `Binance has no ${venue === "binance-futures" ? "futures" : "spot"} market ${symbol}.` : `Binance answered ${response.status}.`);
  }
  const rows = (await response.json()) as unknown[][];
  return rows
    .map((row) => ({
      openTime: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      closeTime: Number(row[6]),
    }))
    .filter((candle) => Number.isFinite(candle.close) && candle.closeTime < now)
    .slice(-limit)
    .map(({ closeTime: _closeTime, ...candle }) => candle);
}
