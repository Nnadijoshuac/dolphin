"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";

import { BacktestPanel } from "@/components/backtest-panel";
import { RuleChart } from "@/components/rule-chart";
import type { ChartCandle } from "@/convex/api";
import { bscPublicClient } from "@/services/chain";
import { livePricer } from "@/wallet/pool-live-price";

/**
 * The live chart for the token a trading agent works on. (owner, 2026-09-28:
 * "you should be able to see what that currency is actually doing IRL")
 *
 * OUR OWN CHART, LIVE ON ANY NETWORK, FREE TO RUN (owner, 2026-10-03). The TradingView embed that
 * briefly replaced it brought drawing tools nobody here needs ("what we just need here was just the
 * chart... more like a preview"), and Dolphin's earlier chart froze on networks that block Binance.
 * Now, all in the browser and with no Convex call:
 *   - HISTORY: the token's BNB Chain pool from GeckoTerminal, 1,000 candles a page, older pages
 *     loaded as the chart is dragged back - so a trader can study what the market did and judge
 *     what their agent is doing. Re-read after each candle closes.
 *   - LIVE: the pool's own price read from BNB Chain every 1.5 s while the tab is visible
 *     (wallet/pool-live-price.ts) - the price the Dolphin Wallet trades at, which moves with every
 *     swap - drawn into the forming candle.
 * Quiet pools only report candles that traded; the gaps are drawn as flat candles at the last price
 * with no volume, so time on the chart is real time. Every number drawn was read; while nothing
 * has loaded it says so (AGENTS.md §5).
 */

export type Frame = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

const FRAMES: Record<Frame, string> = {
  "1m": "minute?aggregate=1",
  "5m": "minute?aggregate=5",
  "15m": "minute?aggregate=15",
  "1h": "hour?aggregate=1",
  "4h": "hour?aggregate=4",
  "1d": "day?aggregate=1",
};
const FRAME_MS: Record<Frame, number> = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 };
const PAGE = 1000;
/** The most candles kept, gaps included, however far back the chart is dragged. */
const MAX_CANDLES = 6000;
const LIVE_MS = 1_500;

const BINANCE_ALIASES: Record<string, string> = { WBNB: "BNB", BTCB: "BTC" };

/** A dollar stablecoin: a USD in its name, or one of the known ones. Drawn on a peg-sized scale. */
export function isDollarToken(symbol: string): boolean {
  const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return ["U", "DAI", "FDUSD"].includes(s) || /USD/.test(s);
}

/** The Binance pair a token would trade as (WBNB is BNB, BTCB is BTC). The backtest presets use it. */
export function binancePair(symbol: string): string | null {
  const base = (BINANCE_ALIASES[symbol.toUpperCase()] ?? symbol.toUpperCase()).replace(/[^A-Z0-9]/g, "");
  if (!base || isDollarToken(base)) return null;
  return `${base}USDT`;
}

/** The token's deepest BNB Chain pool, from DexScreener (read in the browser). */
export async function findPool(tokenAddress: string): Promise<string | null> {
  const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) return null;
  const data = (await response.json()) as { pairs?: Array<{ chainId: string; pairAddress: string; liquidity?: { usd?: number } }> };
  const pairs = (data.pairs ?? []).filter((pair) => pair.chainId === "bsc");
  pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  return pairs[0]?.pairAddress ?? null;
}

/** A pool's candles from GeckoTerminal, oldest first; `before` (seconds) pages back in time. */
export async function loadCandles(pool: string, tokenAddress: string, frame: Frame, limit = PAGE, before?: number) {
  const joiner = FRAMES[frame].includes("?") ? "&" : "?";
  const response = await fetch(
    `https://api.geckoterminal.com/api/v2/networks/bsc/pools/${pool}/ohlcv/${FRAMES[frame]}${joiner}limit=${limit}&currency=usd&token=${tokenAddress}${before ? `&before_timestamp=${before}` : ""}`,
    { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = (await response.json()) as { data?: { attributes?: { ohlcv_list?: number[][] } } };
  return (data.data?.attributes?.ohlcv_list ?? []).map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v })).sort((a, b) => a.t - b.t);
}

/** Seconds -> the chart's milliseconds. */
const toChart = (candle: { t: number; o: number; h: number; l: number; c: number; v: number }): ChartCandle => ({ ...candle, t: candle.t * 1000 });

/** Merges candles by open time (later wins), oldest first, and draws each untraded interval flat at the last price. */
function combine(older: readonly ChartCandle[], newer: readonly ChartCandle[], frame: Frame, now: number): ChartCandle[] {
  const byTime = new Map<number, ChartCandle>();
  for (const candle of [...older, ...newer]) byTime.set(candle.t, candle);
  const sorted = [...byTime.values()].sort((a, b) => a.t - b.t);
  const step = FRAME_MS[frame];
  const out: ChartCandle[] = [];
  for (const candle of sorted) {
    const previous = out[out.length - 1];
    if (previous) for (let t = previous.t + step; t < candle.t && out.length < MAX_CANDLES * 2; t += step) out.push({ t, o: previous.c, h: previous.c, l: previous.c, c: previous.c, v: 0 });
    out.push(candle);
  }
  const current = Math.floor(now / step) * step;
  while (out.length && out[out.length - 1].t + step <= current) {
    const last = out[out.length - 1];
    out.push({ t: last.t + step, o: last.c, h: last.c, l: last.c, c: last.c, v: 0 });
  }
  return out.slice(-MAX_CANDLES);
}

/** The live price drawn into the forming candle, or a new candle once the interval rolls over. */
function withTick(candles: readonly ChartCandle[], price: number, frame: Frame, now: number): ChartCandle[] {
  const last = candles[candles.length - 1];
  if (!last) return candles as ChartCandle[];
  const start = Math.floor(now / FRAME_MS[frame]) * FRAME_MS[frame];
  if (start > last.t) return [...combine(candles, [], frame, start), { t: start, o: last.c, h: Math.max(last.c, price), l: Math.min(last.c, price), c: price, v: 0 }].slice(-MAX_CANDLES);
  return [...candles.slice(0, -1), { ...last, c: price, h: Math.max(last.h, price), l: Math.min(last.l, price) }];
}

function price(value: number): string {
  if (value >= 100) return value.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (value >= 1) return value.toLocaleString("en", { maximumFractionDigits: 3 });
  return value.toPrecision(4);
}

function ExpandIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg aria-hidden fill="none" height="14" viewBox="0 0 16 16" width="14">
      {expanded ? (
        <path d="M6.5 2.5v4h-4M9.5 13.5v-4h4M6.5 6.5 2 2M9.5 9.5 14 14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
      ) : (
        <path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
      )}
    </svg>
  );
}

type Series = { key: string; candles: ChartCandle[]; oldestReached: boolean };

export function TradingChart({
  tokenAddress,
  symbol,
  poolAddress,
  expanded = false,
  onToggleExpand,
}: {
  tokenAddress: string;
  symbol: string;
  poolAddress: string | null;
  expanded?: boolean;
  onToggleExpand?: () => void;
}) {
  const [frame, setFrame] = useState<Frame>("5m");
  const [collapsed, setCollapsed] = useState(false);
  // Expanded, the chart can switch to testing a rule on this token's history.
  const [view, setView] = useState<"chart" | "backtest">("chart");
  const testing = expanded && view === "backtest";

  // The pool: the block's own, else the deepest one DexScreener knows.
  const [found, setFound] = useState<{ token: string; pool: string | null } | null>(null);
  const pool = poolAddress ?? (found && found.token === tokenAddress ? found.pool : null);
  const poolPending = !poolAddress && (!found || found.token !== tokenAddress);
  useEffect(() => {
    if (poolAddress) return;
    let cancelled = false;
    void findPool(tokenAddress)
      .catch(() => null)
      .then((result) => {
        if (!cancelled) setFound({ token: tokenAddress, pool: result });
      });
    return () => {
      cancelled = true;
    };
  }, [poolAddress, tokenAddress]);

  const key = `${pool}:${tokenAddress}:${frame}`;
  const [series, setSeries] = useState<Series | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // True while live ticks arrive; cleared 6 s after the last one, so it never claims a stopped feed.
  const [live, setLive] = useState(false);
  const candles = series && series.key === key ? series.candles : null;

  // History: the latest page, then again a few seconds after each candle closes.
  useEffect(() => {
    if (!pool) return;
    let cancelled = false;
    let timer = 0;
    const load = async () => {
      try {
        const page = (await loadCandles(pool, tokenAddress, frame)).map(toChart);
        if (cancelled) return;
        if (page.length === 0) setFailed(key);
        else {
          setFailed(null);
          setSeries((current) =>
            current && current.key === key
              ? { ...current, candles: combine(current.candles, page, frame, Date.now()) }
              : { key, candles: combine([], page, frame, Date.now()), oldestReached: page.length < PAGE },
          );
        }
      } catch {
        if (!cancelled) setFailed((current) => current ?? key);
      }
      if (!cancelled) timer = window.setTimeout(load, FRAME_MS[frame] - (Date.now() % FRAME_MS[frame]) + 15_000);
    };
    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [frame, key, pool, tokenAddress]);

  // Live: the pool's own price from BNB Chain, every 1.5 s while the tab is visible.
  useEffect(() => {
    if (!pool || !/^0x[0-9a-fA-F]{40}$/.test(pool)) return;
    let cancelled = false;
    let timer = 0;
    let stale = 0;
    void (async () => {
      const pricer = await livePricer(bscPublicClient, pool as Address, tokenAddress as Address).catch(() => null);
      if (!pricer || cancelled) return;
      const tick = async () => {
        if (!document.hidden) {
          const value = await pricer.read().catch(() => null);
          if (cancelled) return;
          if (value !== null && Number.isFinite(value) && value > 0) {
            const now = Date.now();
            setSeries((current) => (current && current.key === key ? { ...current, candles: withTick(current.candles, value, frame, now) } : current));
            setLive(true);
            window.clearTimeout(stale);
            stale = window.setTimeout(() => setLive(false), 6_000);
          }
        }
        if (!cancelled) timer = window.setTimeout(tick, LIVE_MS);
      };
      void tick();
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearTimeout(stale);
      setLive(false);
    };
  }, [frame, key, pool, tokenAddress]);

  // Older history, when the chart is dragged back to its first candle.
  const loadingOlder = useRef(false);
  const loadOlder = useCallback(() => {
    if (!pool || loadingOlder.current || !series || series.key !== key || series.oldestReached || series.candles.length >= MAX_CANDLES) return;
    loadingOlder.current = true;
    const before = Math.floor(series.candles[0].t / 1000);
    void loadCandles(pool, tokenAddress, frame, PAGE, before)
      .then((page) => {
        setSeries((current) =>
          current && current.key === key
            ? { ...current, candles: combine(page.map(toChart), current.candles, frame, Date.now()), oldestReached: page.length < PAGE }
            : current,
        );
      })
      .catch(() => undefined)
      .finally(() => {
        loadingOlder.current = false;
      });
  }, [frame, key, pool, series, tokenAddress]);

  // The chart's height follows its box (the card, or the whole canvas when expanded).
  const [bodyHeight, setBodyHeight] = useState(170);
  const measure = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setBodyHeight(Math.max(120, Math.round(entry.contentRect.height))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const last = candles?.[candles.length - 1];
  const dayAgo = candles && last ? candles.find((candle) => candle.t >= last.t - 86_400_000) : undefined;
  const change = last && dayAgo ? ((last.c - dayAgo.o) / dayAgo.o) * 100 : null;
  const showBody = expanded || !collapsed;

  return (
    <div className="trading-chart" data-collapsed={!showBody || undefined} data-expanded={expanded || undefined}>
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
        <button
          aria-expanded={showBody}
          className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden whitespace-nowrap text-left"
          disabled={expanded}
          onClick={() => setCollapsed((value) => !value)}
          type="button"
        >
          <span className={`${expanded ? "!text-[16px]" : "!text-[13px]"} font-semibold text-ink`}>{symbol}</span>
          {last ? <span className={`font-mono ${expanded ? "!text-[16px]" : "!text-[13px]"} text-ink`}>${price(last.c)}</span> : null}
          {change !== null ? (
            <span className={`font-mono !text-[11px] ${change >= 0 ? "trading-chart__up" : "trading-chart__down"}`} title="Over the last 24 hours">
              {change >= 0 ? "+" : ""}
              {change.toFixed(2)}%
            </span>
          ) : null}
          {live ? (
            <span className="flex items-center gap-1 self-center !text-[10px] font-semibold text-muted">
              <span className="trading-chart__live" /> Live
            </span>
          ) : null}
        </button>
        {showBody && !testing ? (
          <div className="flex rounded-full bg-paper-muted p-[2px]" role="radiogroup" aria-label="Candle length">
            {(Object.keys(FRAMES) as Frame[]).map((option) => (
              <button
                aria-checked={frame === option}
                className={`rounded-full px-2 py-0.5 !text-[10.5px] font-semibold transition-colors ${frame === option ? "bg-paper-strong text-ink shadow-sm" : "text-muted hover:text-ink"}`}
                key={option}
                onClick={() => setFrame(option)}
                role="radio"
                type="button"
              >
                {option}
              </button>
            ))}
          </div>
        ) : null}
        {expanded ? (
          <div className="flex rounded-full bg-paper-muted p-[2px]" role="tablist" aria-label="Chart or backtest">
            {(["chart", "backtest"] as const).map((option) => (
              <button
                aria-selected={view === option}
                className={`rounded-full px-2.5 py-0.5 !text-[11px] font-semibold ${view === option ? "bg-paper-strong text-ink shadow-sm" : "text-muted hover:text-ink"}`}
                key={option}
                onClick={() => setView(option)}
                role="tab"
                type="button"
              >
                {option === "chart" ? "Chart" : "Backtest"}
              </button>
            ))}
          </div>
        ) : null}
        {onToggleExpand ? (
          <button aria-label={expanded ? "Shrink the chart" : "Expand the chart"} className="trading-chart__expand" onClick={onToggleExpand} title={expanded ? "Shrink (Esc)" : "Expand"} type="button">
            <ExpandIcon expanded={expanded} />
          </button>
        ) : null}
      </div>

      {testing ? <BacktestPanel poolAddress={pool} symbol={symbol} tokenAddress={tokenAddress} /> : null}

      {showBody && !testing ? (
        <div className="trading-chart__body" ref={measure}>
          {candles ? (
            <RuleChart
              candles={candles}
              compact={!expanded}
              height={expanded ? bodyHeight - 30 : bodyHeight}
              initialSpan={expanded ? 160 : 64}
              key={`${key}-${expanded}`}
              onNeedOlder={expanded ? loadOlder : undefined}
              pegDollar={isDollarToken(symbol)}
              timeframe={frame}
              volume={expanded}
            />
          ) : (
            <div className="grid h-full place-items-center px-6 text-center text-[0.72rem] text-muted">
              {poolPending || (pool && failed !== key) ? "Loading the market…" : `No live chart for ${symbol} right now. It needs a BNB Chain pool with trading.`}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
