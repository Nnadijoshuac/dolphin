"use client";

import { useAction } from "convex/react";
import { useEffect, useState } from "react";

import { BacktestPanel } from "@/components/backtest-panel";
import { strategyApi } from "@/convex/api";

/**
 * The live chart for the token a trading agent works on. (owner, 2026-09-28:
 * "you should be able to see what that currency is actually doing IRL")
 *
 * A LIVE CHART, EMBEDDED (owner, 2026-10-03: "the market is almost never still... it's updating
 * every one minute... these people's money"; "I got a pair from TradingView... at least it was
 * live"). Dolphin drew its own candles here from Binance and GeckoTerminal. On a network that
 * blocks Binance (the owner's) the live stream never connected and the price moved once a minute;
 * GeckoTerminal caches about a minute too. Routing it through Dolphin's server cost Convex calls
 * on every refresh of every open chart.
 *
 * Now the chart is embedded, served and kept live by its provider, which the owner's network
 * reaches:
 *   - a token Binance lists: TradingView's chart of the Binance pair (BINANCE:BNBUSDT), tick by tick;
 *   - any other token: GeckoTerminal's live chart of its BNB Chain pool (the block's own, or the
 *     deepest one DexScreener knows).
 * Whether Binance lists a token is asked of Dolphin ONCE and remembered in the browser for a week,
 * so a chart costs at most one Convex call per token per week - never one per refresh.
 * (DexScreener's embed was tried first: its chart never received data in a test browser, so it
 * could not be verified.)
 */

export type Frame = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

/** TradingView's interval names, and GeckoTerminal's, for each frame. */
const TV_INTERVALS: Record<Frame, string> = { "1m": "1", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "D" };
const FRAME_NAMES = Object.keys(TV_INTERVALS) as Frame[];
const LISTED_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Whether Binance lists a pair, remembered per browser for a week. Null: not known yet. */
function rememberedListing(pair: string): boolean | null {
  try {
    const saved = JSON.parse(localStorage.getItem(`dolphin.binanceListed.${pair}`) ?? "null") as { listed: boolean; at: number } | null;
    return saved && Date.now() - saved.at < LISTED_TTL_MS ? saved.listed : null;
  } catch {
    return null;
  }
}
function rememberListing(pair: string, listed: boolean) {
  try {
    localStorage.setItem(`dolphin.binanceListed.${pair}`, JSON.stringify({ listed, at: Date.now() }));
  } catch {
    /* storage blocked: it is asked again next time */
  }
}

const FRAMES: Record<Frame, string> = {
  "1m": "minute?aggregate=1",
  "5m": "minute?aggregate=5",
  "15m": "minute?aggregate=15",
  "1h": "hour?aggregate=1",
  "4h": "hour?aggregate=4",
  "1d": "day?aggregate=1",
};

const BINANCE_ALIASES: Record<string, string> = { WBNB: "BNB", BTCB: "BTC" };

/** A dollar stablecoin: a USD in its name, or one of the known ones. Binance has no XUSDT market for these. */
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

/** A pool's candles from GeckoTerminal - for the backtest presets of tokens Binance does not list. */
export async function loadCandles(pool: string, tokenAddress: string, frame: Frame, limit = 160) {
  const joiner = FRAMES[frame].includes("?") ? "&" : "?";
  const response = await fetch(
    `https://api.geckoterminal.com/api/v2/networks/bsc/pools/${pool}/ohlcv/${FRAMES[frame]}${joiner}limit=${limit}&currency=usd&token=${tokenAddress}`,
    { headers: { accept: "application/json" } },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = (await response.json()) as { data?: { attributes?: { ohlcv_list?: number[][] } } };
  return (data.data?.attributes?.ohlcv_list ?? []).map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v })).sort((a, b) => a.t - b.t);
}

/** Follows the site's light or dark look, so the embedded chart matches it. */
function useDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const read = () => {
      const forced = document.documentElement.dataset.theme;
      setDark(forced ? forced === "dark" : media.matches);
    };
    read();
    media.addEventListener("change", read);
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      media.removeEventListener("change", read);
      observer.disconnect();
    };
  }, []);
  return dark;
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
  const dark = useDark();
  const checkMarket = useAction(strategyApi.strategy.marketCandles);
  // What to chart: the Binance pair when Binance lists the token, else its BNB Chain pool.
  const [source, setSource] = useState<{ key: string; chart: { kind: "binance"; pair: string } | { kind: "pool"; pool: string } | null } | null>(null);
  const sourceKey = `${tokenAddress}:${symbol}:${poolAddress ?? ""}`;
  const chart = source && source.key === sourceKey ? source.chart : undefined;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const pair = binancePair(symbol);
      if (pair) {
        let listed = rememberedListing(pair);
        if (listed === null) {
          const answer = await checkMarket({ venue: "binance-spot", market: pair, timeframe: "1d", limit: 20 }).catch(() => null);
          // No answer (offline): not remembered, so it is asked again next time.
          if (answer !== null) {
            listed = Array.isArray(answer) && answer.length > 0;
            rememberListing(pair, listed);
          }
        }
        if (listed) {
          if (!cancelled) setSource({ key: sourceKey, chart: { kind: "binance", pair } });
          return;
        }
      }
      const pool = poolAddress ?? (await findPool(tokenAddress).catch(() => null));
      if (!cancelled) setSource({ key: sourceKey, chart: pool ? { kind: "pool", pool } : null });
    })();
    return () => {
      cancelled = true;
    };
  }, [checkMarket, poolAddress, sourceKey, symbol, tokenAddress]);

  const showBody = expanded || !collapsed;
  const src = !chart
    ? null
    : chart.kind === "binance"
      ? `https://s.tradingview.com/widgetembed/?${new URLSearchParams({
          symbol: `BINANCE:${chart.pair}`,
          interval: TV_INTERVALS[frame],
          theme: dark ? "dark" : "light",
          style: "1",
          timezone: "Etc/UTC",
          locale: "en",
          hide_side_toolbar: expanded ? "0" : "1",
          withdateranges: "0",
          hideideas: "1",
          saveimage: "0",
        }).toString()}`
      : `https://www.geckoterminal.com/bsc/pools/${chart.pool}?${new URLSearchParams({
          embed: "1",
          info: "0",
          swaps: "0",
          grayscale: "0",
          light_chart: dark ? "0" : "1",
          chart_type: "price",
          resolution: frame,
        }).toString()}`;

  return (
    <div className="trading-chart" data-collapsed={!showBody || undefined} data-expanded={expanded || undefined}>
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-2">
        <button
          aria-expanded={showBody}
          className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
          disabled={expanded}
          onClick={() => setCollapsed((value) => !value)}
          type="button"
        >
          <span className={`${expanded ? "!text-[16px]" : "!text-[13px]"} font-semibold text-ink`}>{symbol}</span>
          <span className="flex items-center gap-1 !text-[10.5px] font-semibold text-muted">
            <span className="trading-chart__live" /> Live
          </span>
        </button>
        {showBody && !testing ? (
          <div className="flex rounded-full bg-paper-muted p-[2px]" role="radiogroup" aria-label="Candle length">
            {FRAME_NAMES.map((option) => (
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

      {testing ? <BacktestPanel poolAddress={chart?.kind === "pool" ? chart.pool : poolAddress} symbol={symbol} tokenAddress={tokenAddress} /> : null}

      {showBody && !testing ? (
        <div className="trading-chart__body">
          {src ? (
            <iframe
              className="trading-chart__frame"
              key={src}
              referrerPolicy="strict-origin-when-cross-origin"
              src={src}
              title={`${symbol} live chart`}
            />
          ) : (
            <div className="grid h-full place-items-center px-6 text-center text-[0.72rem] text-muted">
              {chart === undefined ? "Loading the market…" : `No live chart for ${symbol} right now. It needs a BNB Chain pool with trading.`}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
