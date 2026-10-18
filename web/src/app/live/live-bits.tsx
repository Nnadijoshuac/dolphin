"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import styles from "@/app/live/live.module.css";

/** A clock that ticks every second, for countdowns and "2m ago". Only on the live pages. */
export function useSecond(): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export function dayOf(startedAt: number, now: number): number {
  return Math.max(1, Math.floor((now - startedAt) / 86_400_000) + 1);
}

export const usd = (n: number) => `$${n.toFixed(2)}`;
export const pct = (from: number, to: number) => {
  const p = from > 0 ? ((to - from) / from) * 100 : 0;
  return `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
};

export function LiveBadge({ running }: { running: boolean }) {
  return (
    <span className={`${styles.live} ${running ? "" : styles.ended}`}>
      <span className={styles.dot} />
      {running ? "LIVE" : "ENDED"}
    </span>
  );
}

/* ── live market data, straight from Binance's public API, in the viewer's browser ── */

const BINANCE = "https://data-api.binance.vision/api/v3";

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

export function useCandles(symbol: string | null, interval: string | null, limit = 72) {
  return useQuery({
    queryKey: ["live-candles", symbol, interval, limit],
    enabled: Boolean(symbol && interval),
    refetchInterval: 15_000,
    staleTime: 10_000,
    placeholderData: (previous) => previous,
    queryFn: async (): Promise<Candle[]> => {
      const response = await fetch(`${BINANCE}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
      if (!response.ok) throw new Error(`Binance ${response.status}`);
      return ((await response.json()) as unknown[][]).map((row) => ({ t: Number(row[0]), o: +row[1]!, h: +row[2]!, l: +row[3]!, c: +row[4]!, v: +row[5]! }));
    },
  });
}

const TICKER_SYMBOLS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT", "CAKEUSDT", "XVSUSDT"];

export function useTickers() {
  return useQuery({
    queryKey: ["live-tickers"],
    refetchInterval: 10_000,
    staleTime: 8_000,
    placeholderData: (previous) => previous,
    queryFn: async () => {
      const response = await fetch(`${BINANCE}/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(TICKER_SYMBOLS))}`);
      if (!response.ok) throw new Error(`Binance ${response.status}`);
      return ((await response.json()) as { symbol: string; lastPrice: string; priceChangePercent: string }[]).map((row) => ({
        symbol: row.symbol.replace("USDT", "/USDT"),
        price: Number(row.lastPrice),
        change: Number(row.priceChangePercent),
      }));
    },
  });
}

export function price(n: number): string {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(2);
  return n.toPrecision(4);
}

/** The scrolling price strip across the top: real prices, every 10 seconds. */
export function Ticker() {
  const { data } = useTickers();
  if (!data?.length) return <div className={styles.ticker} style={{ height: 38 }} />;
  const items = [...data, ...data];
  return (
    <div className={styles.ticker}>
      <div className={styles.tickerTrack}>
        {items.map((item, index) => (
          <span className={styles.tickerItem} key={`${item.symbol}-${index}`}>
            <span className="font-semibold text-[#f2f3ee]">{item.symbol}</span>
            <span>{price(item.price)}</span>
            <span style={{ color: item.change >= 0 ? "#3ddc84" : "#ff5c5c" }}>
              {item.change >= 0 ? "+" : ""}
              {item.change.toFixed(2)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
