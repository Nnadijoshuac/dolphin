"use client";

import { useAction, useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { LivePnl } from "@/components/live-pnl";
import { EquityCurve, RuleChart, type ChartLevel, type ChartMarker } from "@/components/rule-chart";
import { strategyApi, type ChartCandle, type RuleBacktest, type TradingRuleTrade, type TradingRuleView } from "@/convex/api";

/**
 * ONE RULE, SEEN WHOLE (owner, 2026-10-03: "a visual trading view", "you can decide to turn it
 * off"). Live: the market the rule watches, streaming, with every trade it made and the open
 * position's entry, stop and target. Backtest: the same rule replayed by the live engine's own
 * decisions over Binance's history (convex/strategy.ts backtestRule). Pause stops new entries;
 * an open position still closes by its exits and stop.
 */

const TIMEFRAME_MS: Record<string, number> = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 };

const VENUE_WORDS: Record<TradingRuleView["venue"], string> = {
  "dolphin-wallet": "Dolphin Wallet",
  "binance-wallet": "Binance Wallet",
  "binance-spot": "Binance spot",
  "binance-futures": "Binance futures",
};

function fmt(value: number): string {
  return value >= 1 ? value.toLocaleString("en", { maximumFractionDigits: 2 }) : value.toPrecision(4);
}

function usd(value: number): string {
  return `${value < 0 ? "−" : value > 0 ? "+" : ""}$${Math.abs(value).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(value: number): string {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}%`;
}

/** Entry, stop and target of an open position. Stops and targets are price moves from the entry. */
function levelsOf(position: { side: "long" | "short"; entryPrice: number } | null, stopLossPct: number | null, takeProfitPct: number | null): ChartLevel[] {
  if (!position) return [];
  const sign = position.side === "long" ? 1 : -1;
  return [
    { kind: "entry", price: position.entryPrice, label: "Entry" },
    ...(stopLossPct !== null ? [{ kind: "stop" as const, price: position.entryPrice * (1 - (sign * stopLossPct) / 100), label: "Stop" }] : []),
    ...(takeProfitPct !== null ? [{ kind: "target" as const, price: position.entryPrice * (1 + (sign * takeProfitPct) / 100), label: "Target" }] : []),
  ];
}

export function RuleView({
  conversationKey,
  rule,
  trades,
  onClose,
  standalone = false,
}: {
  conversationKey: string;
  rule: TradingRuleView;
  trades: TradingRuleTrade[];
  onClose: () => void;
  /** Its own window (/dolphin/rule, owner 2026-10-04: "it deserves its own pop-out"): a page, not a dialog. */
  standalone?: boolean;
}) {
  const [tab, setTab] = useState<"live" | "backtest">("live");
  const setPaused = useMutation(strategyApi.strategy.setRulePaused);
  const [pauseError, setPauseError] = useState<string | null>(null);
  // The rule re-renders with every check; the close handler is read through a ref so this runs once.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    if (standalone) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => event.key === "Escape" && close.current();
    window.addEventListener("keydown", escape);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", escape);
    };
  }, [standalone]);

  /** Its own window, for a second screen: the same live data, read by the same subscriptions. */
  const popOut = () => {
    const opened = window.open(`/dolphin/rule?c=${encodeURIComponent(conversationKey)}&r=${encodeURIComponent(rule.id)}`, `dolphin-rule-${rule.id}`, "popup,width=1180,height=860");
    if (opened) onClose();
  };

  const togglePause = async () => {
    setPauseError(null);
    try {
      await setPaused({ conversationKey, ruleId: rule.id, paused: !rule.paused });
    } catch (cause) {
      setPauseError(cause instanceof ConvexError && typeof cause.data === "string" ? cause.data : "That did not save. Try again.");
    }
  };

  const status = rule.paused ? (rule.position ? "Paused · still closing its position" : "Paused") : rule.position ? `Holding a ${rule.position.side}` : rule.lastCheckedAt ? "Watching" : "Not started";

  const body = (
      <div className="rule-view" data-standalone={standalone || undefined}>
        <div className="rule-view__top">
          <div className="min-w-0 flex-1">
            <p className="text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-muted">
              {rule.market} · {rule.timeframe} · {VENUE_WORDS[rule.venue]}
            </p>
            <h3 className="mt-1 text-[0.98rem] font-semibold leading-snug tracking-[-0.01em] text-ink" id="rule-view-title">
              {rule.words}
            </h3>
            <p className="mt-1 flex items-center gap-1.5 text-[0.72rem] text-ink-soft">
              <span className="rule-view__dot" data-state={rule.paused ? "paused" : rule.position ? "holding" : rule.lastCheckedAt ? "watching" : "idle"} />
              {status}
            </p>
          </div>
          <button className="rule-view__pause" data-paused={rule.paused || undefined} onClick={() => void togglePause()} type="button">
            {rule.paused ? "Resume" : "Pause"}
          </button>
          {standalone ? null : (
            <button aria-label="Open in its own window" className="grid size-8 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-paper-muted hover:text-ink" onClick={popOut} title="Open in its own window" type="button">
              <svg aria-hidden fill="none" height="15" viewBox="0 0 16 16" width="15">
                <path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
              </svg>
            </button>
          )}
          {standalone ? null : (
            <button aria-label="Close" className="grid size-8 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-paper-muted hover:text-ink" onClick={onClose} type="button">
              <span aria-hidden className="text-lg leading-none">×</span>
            </button>
          )}
        </div>
        {pauseError ? (
          <p className="mt-1 text-[0.7rem] text-danger" role="alert">
            {pauseError}
          </p>
        ) : null}
        {rule.paused ? <p className="mt-2 text-[0.72rem] leading-relaxed text-muted">Paused: it opens no new trades. A position it already holds still closes by its exit rule and stop.</p> : null}

        <div aria-label="Live or backtest" className="rule-view__tabs" role="tablist">
          {(["live", "backtest"] as const).map((option) => (
            <button aria-selected={tab === option} key={option} onClick={() => setTab(option)} role="tab" type="button">
              {option === "live" ? "Live" : "Backtest"}
            </button>
          ))}
        </div>

        {tab === "live" ? <LiveTab rule={rule} trades={trades} /> : <BacktestTab conversationKey={conversationKey} rule={rule} />}
      </div>
  );
  if (standalone) return body;
  return createPortal(
    <div aria-labelledby="rule-view-title" aria-modal className="confirm-scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()} role="dialog">
      {body}
    </div>,
    document.body,
  );
}

/* ── Live ── */

type LiveState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; candles: ChartCandle[]; streaming: boolean };

/** Binance's public kline streams: spot on its market-data host, futures on its own (two URL forms, newest first). */
function streamUrls(venue: TradingRuleView["venue"], market: string, timeframe: string): string[] {
  const stream = `${market.toLowerCase()}@kline_${timeframe}`;
  return venue === "binance-futures"
    ? [`wss://fstream.binance.com/market/ws/${stream}`, `wss://fstream.binance.com/ws/${stream}`]
    : [`wss://data-stream.binance.vision/ws/${stream}`];
}

/** The rule's market: closed history from Dolphin, then every tick over Binance's stream; polling if the stream cannot connect. */
function useLiveCandles(rule: TradingRuleView, timeframe: string): LiveState {
  const loadCandles = useAction(strategyApi.strategy.marketCandles);
  const [state, setState] = useState<LiveState>({ status: "loading" });
  const { venue, market } = rule;

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | null = null;
    let timer = 0;
    const fetchHistory = async (): Promise<ChartCandle[] | string> => {
      try {
        const result = await loadCandles({ venue, market, timeframe, limit: 500 });
        return Array.isArray(result) ? result : result.error;
      } catch {
        return "The market did not answer. Try again in a moment.";
      }
    };
    // Two seconds after the candle in view closes.
    const untilNextClose = () => {
      const frame = TIMEFRAME_MS[timeframe] ?? 60_000;
      return frame - (Date.now() % frame) + 2_000;
    };
    // Without the stream (a network that blocks Binance): re-read once each candle closes - nothing
    // new exists between closes, and every read is a Convex call (owner, 2026-10-03).
    const poll = async () => {
      const result = await fetchHistory();
      if (cancelled) return;
      if (Array.isArray(result)) setState({ status: "ready", candles: result, streaming: false });
      timer = window.setTimeout(poll, untilNextClose());
    };
    const connect = (urls: string[]) => {
      if (urls.length === 0) return void (timer = window.setTimeout(poll, untilNextClose()));
      let heard = false;
      const current = new WebSocket(urls[0]);
      socket = current;
      current.onmessage = (event) => {
        const k = (JSON.parse(String(event.data)) as { k?: { t: number; o: string; h: string; l: string; c: string } }).k;
        if (!k || cancelled) return;
        heard = true;
        const tick: ChartCandle = { t: k.t, o: Number(k.o), h: Number(k.h), l: Number(k.l), c: Number(k.c) };
        setState((previous) => {
          if (previous.status !== "ready") return previous;
          const candles = previous.candles;
          const lastCandle = candles[candles.length - 1];
          if (lastCandle && tick.t < lastCandle.t) return previous;
          const next = lastCandle && lastCandle.t === tick.t ? [...candles.slice(0, -1), tick] : [...candles.slice(-999), tick];
          return { status: "ready", candles: next, streaming: true };
        });
      };
      current.onclose = () => {
        if (cancelled) return;
        if (!heard) connect(urls.slice(1));
        else {
          setState((previous) => (previous.status === "ready" ? { ...previous, streaming: false } : previous));
          void poll();
        }
      };
    };
    void (async () => {
      const history = await fetchHistory();
      if (cancelled) return;
      if (!Array.isArray(history)) return setState({ status: "error", message: history });
      setState({ status: "ready", candles: history, streaming: false });
      connect(streamUrls(venue, market, timeframe));
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [loadCandles, venue, market, timeframe]);

  return state;
}

const FRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;

function LiveTab({ rule, trades }: { rule: TradingRuleView; trades: TradingRuleTrade[] }) {
  // Any candle length, starting from the rule's own (owner, 2026-10-04: "one minute... ten minutes - the normal standard").
  const [chartFrame, setChartFrame] = useState<string>(rule.timeframe);
  const state = useLiveCandles(rule, chartFrame);
  // Oldest first, at the moment each order filled and the price it filled at - so a marker lands on the right
  // candle of any candle length, and meets its entry line.
  const markers: ChartMarker[] = [...trades]
    .sort((a, b) => a.at - b.at)
    .map((trade) => ({
      time: trade.at,
      kind: trade.kind,
      side: trade.side,
      price: trade.price,
      title: trade.reason,
      pnlPct: trade.pnlPct,
    }));
  const closed = trades.filter((trade) => trade.kind === "exit" && trade.pnlPct !== null);
  const wins = closed.filter((trade) => (trade.pnlPct ?? 0) > 0).length;

  return (
    <div className="mt-3">
      {state.status === "loading" ? (
        <div className="rule-view__empty">Loading {rule.market}…</div>
      ) : state.status === "error" ? (
        <div className="rule-view__empty">{state.message}</div>
      ) : (
        <>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[0.7rem] text-muted">
            <div aria-label="Candle length" className="rule-view__frames" role="radiogroup">
              {FRAMES.map((option) => (
                <button aria-checked={chartFrame === option} key={option} onClick={() => setChartFrame(option)} role="radio" type="button">
                  <span>{option}</span>
                </button>
              ))}
            </div>
            <span className="flex items-center gap-3">
              <span>{trades.length === 0 ? "No trades yet" : `${trades.length} trade${trades.length === 1 ? "" : "s"}`}</span>
              {state.streaming ? (
                <span className="flex items-center gap-1.5 text-ink-soft">
                  <span className="rule-view__live" /> Live
                </span>
              ) : null}
            </span>
          </div>
          <RuleChart candles={state.candles} key={chartFrame} levels={levelsOf(rule.position, rule.stopLossPct, rule.takeProfitPct)} markers={markers} timeframe={chartFrame} />
        </>
      )}

      <LivePnl rule={rule} size="large" />

      <div className="rule-view__stats">
        <Stat label="Position" value={rule.position ? `${rule.position.side === "long" ? "Long" : "Short"} from ${fmt(rule.position.entryPrice)}` : "None"} />
        <Stat label="Stop" value={rule.stopLossPct !== null ? `${rule.stopLossPct}%` : "None"} />
        <Stat label="Target" value={rule.takeProfitPct !== null ? `${rule.takeProfitPct}%` : "None"} />
        <Stat label="Closed trades" value={closed.length === 0 ? "None yet" : `${closed.length} · ${wins} won`} />
      </div>
      {rule.lastError || rule.lastReason ? (
        <p className={`mt-2 text-[0.72rem] leading-relaxed ${rule.lastError ? "text-danger" : "text-ink-soft"}`}>
          <span className="text-muted">Last check: </span>
          {rule.lastError ?? rule.lastReason}
        </p>
      ) : null}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="rule-view__stat">
      <p>{label}</p>
      <b className={tone === "up" ? "rule-chart__up" : tone === "down" ? "rule-chart__down" : undefined}>{value}</b>
    </div>
  );
}

/* ── Backtest ── */

type BacktestState =
  | { status: "running" }
  | { status: "error"; message: string }
  | { status: "done"; candles: ChartCandle[]; result: RuleBacktest; feeBps: number; at: number };

function BacktestTab({ conversationKey, rule }: { conversationKey: string; rule: TradingRuleView }) {
  const run = useAction(strategyApi.strategy.backtestRule);
  const [state, setState] = useState<BacktestState>({ status: "running" });
  const [attempt, setAttempt] = useState(0);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const answer = await run({ conversationKey, ruleId: rule.id });
        if (cancelled) return;
        setState("error" in answer ? { status: "error", message: answer.error } : { status: "done", ...answer, at: Date.now() });
      } catch (cause) {
        if (!cancelled) setState({ status: "error", message: cause instanceof ConvexError && typeof cause.data === "string" ? cause.data : "The backtest did not finish. Try again." });
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-run when the rule's settings change, or on "Run again".
  }, [run, conversationKey, rule.id, rule.sizeUsd, rule.leverage, rule.stopLossPct, rule.takeProfitPct, attempt]);

  const again = () => {
    setState({ status: "running" });
    setAttempt((value) => value + 1);
  };

  if (state.status === "running") return <div className="rule-view__empty mt-3">Replaying {rule.market} {rule.timeframe} history…</div>;
  if (state.status === "error")
    return (
      <div className="rule-view__empty mt-3">
        <p>{state.message}</p>
        <button className="mt-2 font-semibold text-accent-ink hover:underline" onClick={again} type="button">
          Try again
        </button>
      </div>
    );

  const { candles, result, feeBps } = state;
  const closed = result.wins + result.losses;
  const markers: ChartMarker[] = result.trades.map((trade) => ({ time: trade.time, kind: trade.kind, side: trade.side, price: trade.price, title: trade.reason, pnlPct: trade.pnlPct ?? null }));
  const first = candles[0];
  const lastCandle = candles[candles.length - 1];
  const days = first && lastCandle ? Math.max(1, Math.round((lastCandle.t - first.t) / 86_400_000)) : 0;
  const listed = [...result.trades].reverse();

  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-[0.7rem] text-muted">
        <span>
          {candles.length.toLocaleString("en")} candles · {days} day{days === 1 ? "" : "s"} · ${rule.sizeUsd} a trade{rule.leverage > 1 ? ` at ${rule.leverage}x` : ""}
        </span>
        <button className="font-semibold text-accent-ink hover:underline" onClick={again} type="button">
          Run again
        </button>
      </div>

      <div className="rule-view__stats">
        <Stat label={`Result on $${rule.sizeUsd}`} tone={result.totalUsd > 0 ? "up" : result.totalUsd < 0 ? "down" : undefined} value={`${usd(result.totalUsd)} · ${pct(result.returnPct)}`} />
        <Stat label="Just holding" tone={result.buyHoldPct > 0 ? "up" : result.buyHoldPct < 0 ? "down" : undefined} value={pct(result.buyHoldPct)} />
        <Stat label="Trades" value={closed === 0 ? "None" : `${closed} · ${Math.round((result.wins / closed) * 100)}% won`} />
        <Stat label="Worst drop" value={result.maxDrawdownUsd > 0 ? `−$${result.maxDrawdownUsd.toFixed(2)}` : "$0.00"} />
        <Stat label="Fees" value={`$${result.feesUsd.toFixed(2)}`} />
      </div>

      <div className="mt-3">
        <RuleChart
          candles={candles}
          initialSpan={Math.min(candles.length, 240)}
          levels={result.open ? levelsOf(result.open, rule.stopLossPct, rule.takeProfitPct) : []}
          markers={markers}
          timeframe={rule.timeframe}
        />
      </div>

      {result.equity.length > 1 ? (
        <div className="mt-3">
          <p className="text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-muted">Result over time</p>
          <EquityCurve points={result.equity} />
        </div>
      ) : null}

      {listed.length > 0 ? (
        <div className="mt-3">
          <p className="text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-muted">Every trade, newest first</p>
          <ol className="rule-view__trades">
            {(showAll ? listed : listed.slice(0, 12)).map((trade, index) => (
              <li data-kind={trade.kind} key={`${trade.time}-${trade.kind}-${index}`}>
                <span className="rule-view__when">{new Date(trade.time).toLocaleString("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}</span>
                <div className="min-w-0">
                  <p className="text-ink-soft">
                    {trade.kind === "enter" ? (trade.side === "short" ? "Shorted" : "Bought") : "Closed"} at ${fmt(trade.price)}
                    {trade.pnlUsd !== undefined ? (
                      <span className={trade.pnlUsd > 0 ? "rule-chart__up" : trade.pnlUsd < 0 ? "rule-chart__down" : "text-muted"}>
                        {" "}
                        · {usd(trade.pnlUsd)}
                        {trade.pnlPct !== undefined ? ` (${pct(trade.pnlPct)})` : ""}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-muted">{trade.reason}</p>
                </div>
              </li>
            ))}
          </ol>
          {listed.length > 12 ? (
            <button className="mt-1 !text-[0.7rem] font-semibold text-accent-ink hover:underline" onClick={() => setShowAll((value) => !value)} type="button">
              {showAll ? "Show fewer" : `Show all ${listed.length}`}
            </button>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-[0.72rem] text-muted">The rule&rsquo;s conditions were never met in this stretch of history.</p>
      )}

      <p className="mt-3 text-[0.66rem] leading-relaxed text-faint">
        Each trade fills at its candle&rsquo;s close with a {feeBps / 100}% fee each way; slippage and funding are not included. Past results don&rsquo;t predict future ones.
      </p>
    </div>
  );
}
