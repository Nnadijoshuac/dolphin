"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { useBinancePush } from "@/app/live/binance-push";
import type { Candle } from "@/app/live/live-bits";
import type { LiveCondition } from "@/convex/api";
import { bscPublicClient } from "@/services/chain";

/*
 * THE DESK'S FEEDS (owner, 2026-10-18: "a lot of moving parts that can actually give information").
 * Everything here runs in the viewer's browser, so a thousand viewers cost the backend nothing:
 *   - Binance's public market stream: the order book every 100 ms, every trade, the 24h ticker
 *   - BNB Chain itself: the newest block and the gas price, every few seconds
 *   - the agent's own indicators, recomputed with the engine's math (mirrored from convex/lib/indicators.ts)
 * Nothing is simulated: a panel with no data says so.
 */

const STREAM = "wss://data-stream.binance.vision/stream";
const REST = "https://data-api.binance.vision/api/v3";

export type BookLevel = { price: number; qty: number };
export type Print = { id: number; t: number; price: number; qty: number; usd: number; sell: boolean };
export type Ticker24 = { last: number; changePct: number; high: number; low: number; quoteVolume: number; open: number };
export type WireEvent = { id: string; t: number; tone: "up" | "down" | "gold" | "plain"; label: string; text: string };

/** A trade this size or larger is a "large print" on the wire. */
const LARGE_PRINT_USD = 25_000;
/** A resting order this size or larger, near the price, is a "wall". */
const WALL_USD = 250_000;

export type MarketStream = {
  bids: BookLevel[];
  asks: BookLevel[];
  prints: Print[];
  ticker: Ticker24 | null;
  lastMessageAt: number;
  wire: WireEvent[];
  /** Taker buy and sell volume in USD over the last 60 seconds. */
  flow: { buyUsd: number; sellUsd: number };
};

const EMPTY: MarketStream = { bids: [], asks: [], prints: [], ticker: null, lastMessageAt: 0, wire: [], flow: { buyUsd: 0, sellUsd: 0 } };

/** One socket for the book, the trades and the ticker. React sees it four times a second, not 30. */
export function useMarketStream(symbol: string | null): MarketStream {
  const [state, setState] = useState<MarketStream>(EMPTY);
  const live = useRef<MarketStream>({ ...EMPTY });
  const seenWalls = useRef(new Set<string>());

  useEffect(() => {
    if (!symbol) return;
    const lower = symbol.toLowerCase();
    let socket: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    live.current = { ...EMPTY };
    seenWalls.current = new Set();

    const pushWire = (event: WireEvent) => {
      live.current.wire = [event, ...live.current.wire].slice(0, 40);
    };

    const connect = () => {
      socket = new WebSocket(`${STREAM}?streams=${lower}@depth20@100ms/${lower}@aggTrade/${lower}@ticker`);
      socket.onmessage = (message) => {
        const { stream, data } = JSON.parse(message.data as string) as { stream: string; data: Record<string, unknown> };
        const now = Date.now();
        live.current.lastMessageAt = now;
        if (stream.endsWith("@aggTrade")) {
          const price = Number(data.p);
          const qty = Number(data.q);
          const print: Print = { id: Number(data.a), t: Number(data.T), price, qty, usd: price * qty, sell: Boolean(data.m) };
          live.current.prints = [print, ...live.current.prints].slice(0, 60);
          if (print.usd >= LARGE_PRINT_USD) {
            pushWire({
              id: `p${print.id}`,
              t: print.t,
              tone: print.sell ? "down" : "up",
              label: print.sell ? "LARGE SELL" : "LARGE BUY",
              text: `${qty.toFixed(2)} ${symbol.replace("USDT", "")} ($${compact(print.usd)}) at ${price.toFixed(2)}`,
            });
          }
        } else if (stream.includes("@depth")) {
          const bids = (data.bids as string[][]).map(([p, q]) => ({ price: Number(p), qty: Number(q) }));
          const asks = (data.asks as string[][]).map(([p, q]) => ({ price: Number(p), qty: Number(q) }));
          live.current.bids = bids;
          live.current.asks = asks;
          const mid = bids[0] && asks[0] ? (bids[0].price + asks[0].price) / 2 : 0;
          for (const [side, levels] of [["BID", bids], ["ASK", asks]] as const) {
            for (const level of levels) {
              const usd = level.price * level.qty;
              const key = `${side}${level.price}`;
              if (usd >= WALL_USD && mid && Math.abs(level.price - mid) / mid < 0.003 && !seenWalls.current.has(key)) {
                seenWalls.current.add(key);
                pushWire({ id: `w${key}${now}`, t: now, tone: side === "BID" ? "up" : "down", label: `${side} WALL`, text: `$${compact(usd)} resting at ${level.price.toFixed(2)}` });
              }
            }
          }
        } else if (stream.endsWith("@ticker")) {
          const ticker: Ticker24 = {
            last: Number(data.c),
            changePct: Number(data.P),
            high: Number(data.h),
            low: Number(data.l),
            quoteVolume: Number(data.q),
            open: Number(data.o),
          };
          const before = live.current.ticker;
          if (before && ticker.high > before.high) pushWire({ id: `h${ticker.high}`, t: now, tone: "up", label: "NEW 24H HIGH", text: `${symbol.replace("USDT", "")} printed ${ticker.high.toFixed(2)}` });
          if (before && ticker.low < before.low) pushWire({ id: `l${ticker.low}`, t: now, tone: "down", label: "NEW 24H LOW", text: `${symbol.replace("USDT", "")} printed ${ticker.low.toFixed(2)}` });
          live.current.ticker = ticker;
        }
      };
      socket.onclose = () => {
        if (!closed) retry = setTimeout(connect, 2000);
      };
    };
    connect();

    const flush = setInterval(() => {
      const cutoff = Date.now() - 60_000;
      let buyUsd = 0;
      let sellUsd = 0;
      for (const print of live.current.prints) {
        if (print.t < cutoff) break;
        if (print.sell) sellUsd += print.usd;
        else buyUsd += print.usd;
      }
      setState({ ...live.current, flow: { buyUsd, sellUsd } });
    }, 250);

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      clearInterval(flush);
      socket?.close();
    };
  }, [symbol]);

  return state;
}

/** The newest BNB Chain block and gas price, read from the chain every 3 seconds. */
export function useChainPulse() {
  return useQuery({
    queryKey: ["live-chain-pulse"],
    refetchInterval: 3_000,
    staleTime: 2_000,
    placeholderData: (previous) => previous,
    queryFn: async () => {
      const [block, gas] = await Promise.all([bscPublicClient.getBlockNumber(), bscPublicClient.getGasPrice()]);
      return { block: Number(block), gasGwei: Number(gas) / 1e9, at: Date.now() };
    },
  });
}

/** Candles for a rule's own timeframe: the 200 closed ones the engine judges, plus the one forming. */
export type RuleCandles = { closed: Candle[]; forming: Candle | null };

/** One kline-stream message applied to the candles: a tick moves the forming candle, a close appends it. */
export function applyKline(current: RuleCandles | undefined, k: Record<string, unknown>): RuleCandles | undefined {
  if (!current) return current;
  const candle = { t: Number(k.t), o: Number(k.o), h: Number(k.h), l: Number(k.l), c: Number(k.c), v: Number(k.v), closeTime: Number(k.T) };
  if (!Number.isFinite(candle.t) || !Number.isFinite(candle.c)) return current;
  const lastClosed = current.closed[current.closed.length - 1];
  // Already closed and counted (a late or repeated message): nothing changes.
  if (lastClosed && candle.t <= lastClosed.t) return current;
  if (k.x === true) return { closed: [...current.closed, candle].slice(-200), forming: null };
  return { ...current, forming: candle };
}

/**
 * Loaded once, then kept current by Binance's kline stream (2026-10-20): every tick moves the forming
 * candle, and a close moves it into the closed list - the moment it happens, where this used to ask the
 * REST API every 10 seconds. A reconnect reloads, so nothing that passed while the socket was down is lost.
 */
export function useRuleCandles(symbol: string | null, timeframe: string | null) {
  const queryClient = useQueryClient();
  const queryKey = ["live-rule-candles", symbol, timeframe];
  const query = useQuery({
    queryKey,
    enabled: Boolean(symbol && timeframe),
    staleTime: Infinity,
    placeholderData: (previous) => previous,
    queryFn: async (): Promise<RuleCandles> => {
      const response = await fetch(`${REST}/klines?symbol=${symbol}&interval=${timeframe}&limit=201`);
      if (!response.ok) throw new Error(`Binance ${response.status}`);
      const rows = (await response.json()) as unknown[][];
      const all = rows.map((row) => ({ t: Number(row[0]), o: +row[1]!, h: +row[2]!, l: +row[3]!, c: +row[4]!, v: +row[5]!, closeTime: Number(row[6]) }));
      const now = Date.now();
      const closed = all.filter((c) => c.closeTime < now).slice(-200);
      const forming = all.find((c) => c.closeTime >= now) ?? null;
      return { closed, forming };
    },
  });
  useBinancePush(
    symbol && timeframe ? `${symbol.toLowerCase()}@kline_${timeframe}` : null,
    (data) => {
      const k = data.k as Record<string, unknown> | undefined;
      if (k) queryClient.setQueryData<RuleCandles>(queryKey, (current) => applyKline(current, k));
    },
    () => void queryClient.invalidateQueries({ queryKey }),
  );
  return query;
}

/* ── the engine's indicator math, mirrored from convex/lib/indicators.ts (web/ may not import it) ── */

export function rsiSeries(closes: readonly number[], period = 14): (number | null)[] {
  const out: (number | null)[] = closes.map(() => null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i]! - closes[i - 1]!;
    if (change >= 0) gain += change;
    else loss -= change;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i]! - closes[i - 1]!;
    gain = (gain * (period - 1) + Math.max(change, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function emaSeries(values: readonly number[], length: number): (number | null)[] {
  const k = 2 / (length + 1);
  const out: (number | null)[] = [];
  let ema: number | null = null;
  values.forEach((value, index) => {
    if (index + 1 < length) {
      out.push(null);
      return;
    }
    ema = ema === null ? values.slice(index - length + 1, index + 1).reduce((sum, v) => sum + v, 0) / length : value * k + ema * (1 - k);
    out.push(ema);
  });
  return out;
}

export function smaSeries(values: readonly number[], length: number): (number | null)[] {
  return values.map((_, index) => {
    if (index + 1 < length) return null;
    let sum = 0;
    for (let i = index - length + 1; i <= index; i++) sum += values[i]!;
    return sum / length;
  });
}

const lastOf = (series: (number | null)[]) => series[series.length - 1] ?? null;

/** One condition, read the way the engine reads it, on these closes. Null when it cannot be read here. */
export function readCondition(condition: LiveCondition, closes: number[]): { value: number | null; met: boolean | null; label: string } {
  const close = closes[closes.length - 1] ?? null;
  switch (condition.kind) {
    case "rsi": {
      const value = lastOf(rsiSeries(closes, condition.period ?? 14));
      return { value, met: value === null ? null : condition.op === "below" ? value < condition.value : value > condition.value, label: `RSI(${condition.period ?? 14}) ${condition.op} ${condition.value}` };
    }
    case "price_vs_ma": {
      const ma = lastOf(condition.ma === "ema" ? emaSeries(closes, condition.length) : smaSeries(closes, condition.length));
      return { value: ma, met: ma === null || close === null ? null : condition.op === "above" ? close > ma : close < ma, label: `Price ${condition.op} ${condition.ma.toUpperCase()} ${condition.length}` };
    }
    case "price":
      return { value: close, met: close === null ? null : condition.op === "above" ? close > condition.value : close < condition.value, label: `Price ${condition.op} ${condition.value}` };
    case "change_pct": {
      const from = closes[closes.length - 1 - condition.candles];
      const change = from && close !== null ? ((close - from) / from) * 100 : null;
      return { value: change, met: change === null ? null : condition.op === "above" ? change > condition.value : change < condition.value, label: `${condition.candles}-candle change ${condition.op} ${condition.value}%` };
    }
    case "trend": {
      const window = closes.slice(-(condition.candles + 1));
      if (window.length < condition.candles + 1) return { value: null, met: null, label: `${condition.candles} closes ${condition.direction}` };
      const met = window.every((c, i) => i === 0 || (condition.direction === "down" ? c < window[i - 1]! : c > window[i - 1]!));
      return { value: null, met, label: `${condition.candles} closes in a row ${condition.direction}` };
    }
    default:
      return { value: null, met: null, label: condition.kind === "macd_cross" ? `MACD cross ${condition.direction}` : condition.kind === "ma_cross" ? `MA ${condition.fast}/${condition.slow} cross ${condition.direction}` : `Fib ${condition.value}` };
  }
}

export function compact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return n.toFixed(0);
}
