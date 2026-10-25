"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { compact, readCondition, rsiSeries, useChainPulse, useMarketStream, useRuleCandles, type MarketStream, type WireEvent } from "@/app/live/desk-feeds";
import { LiveBadge, Ticker, ago, dayOf, pct, price, usd, useSecond, useTickers, type Candle } from "@/app/live/live-bits";
import styles from "@/app/live/live.module.css";
import { RsiDial, RsiTrack } from "@/app/live/rsi-dial";
import { TChange } from "@/app/live/tcard";
import { ResultBars, ValueArea } from "@/app/live/stat-charts";
import { TokenLogo } from "@/components/brand-mark";
import { RollingFigure } from "@/components/rolling-figure";
import { liveRunsApi, type LiveDeskRule, type LiveRunDetail } from "@/convex/api";
import { useWalletHoldings } from "@/hooks/use-wallet-holdings";
import { useWallet } from "@/wallet/wallet-provider";
import { useWalletSession } from "@/wallet/wallet-session";

/**
 * /live/<slug>: one public run as a trading desk (owner, 2026-10-18: "Wall Street... someone checking the
 * news, someone checking the live trades, a manager... very complex but very clean", and it must fit one
 * screen so it can be streamed). Every panel is a desk role fed by something real:
 *   Treasury  - the wallet, read from BNB Chain in the viewer's browser
 *   Signal    - each rule's own indicator, recomputed with the engine's math on its own candles
 *   Risk      - stop, target, daily cap and cooldown, from the rule and the engine's state
 *   Engine    - the engine's minute clock and its last decision
 *   Market    - the order book, every trade and a wire of large prints and walls, from Binance's stream
 *   Chain     - the newest BNB Chain block and the gas price
 * Below the fold: every trade since it went live.
 */
export function LiveRun({ slug }: { slug: string }) {
  const run = useQuery(liveRunsApi.liveRuns.get, { slug });
  const now = useSecond();

  if (run === undefined) {
    return (
      <div className={styles.page}>
        <Ticker />
        <div className="p-3">
          <div className="skeleton h-[calc(100dvh-140px)] rounded-[12px]" />
        </div>
      </div>
    );
  }
  if (run === null) {
    return (
      <div className={styles.page}>
        <Ticker />
        <div className="mx-auto w-full max-w-[2000px] px-4 pt-16 text-center">
          <p className={styles.muted}>No run with that link.</p>
          <Link className={`mt-4 inline-block ${styles.lime}`} href="/live">See who is live</Link>
        </div>
      </div>
    );
  }
  return <RunView now={now} run={run} />;
}

const UP = "#3ddc84";
const DOWN = "#ff5c5c";
const GOLD = "#f3c13a";
/** The entry level: white, so it can never be mistaken for the gold line of the price now (owner, 2026-10-25). */
const ENTRY = "#f2f2ee";
const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;

function RunView({ run, now }: { run: LiveRunDetail; now: number }) {
  const running = run.status === "running";
  const desk = run.desk ?? [];
  const addresses = useMemo(() => [run.walletAddress], [run.walletAddress]);
  const held = useWalletHoldings(addresses, "USD", false);
  const liveFigure = typeof held.headline === "object" ? held.headline.figure : usd(run.lastUsd);
  const liveUsd = typeof held.headline === "object" ? Number(held.headline.figure.replace(/[^0-9.]/g, "")) : run.lastUsd;
  // A run can watch several coins (The Dip: BNB, ETH, BTC). The watchlist picks which one the market panels show.
  const coins = [...new Set(desk.map((rule) => rule.market ?? run.market).filter((m): m is string => Boolean(m)))];
  const [picked, setPicked] = useState<string | null>(null);
  const coin = picked && coins.includes(picked) ? picked : (coins[0] ?? run.market);
  const coinRules = desk.filter((rule) => (rule.market ?? run.market) === coin);
  const market = useMarketStream(coin);
  const chain = useChainPulse();
  const [detail, setDetail] = useState<Detail | null>(null);
  // The chart opens on the timeframe of the newest rule - the one its owner set last.
  const [frame, setFrame] = useState<string>(desk[desk.length - 1]?.timeframe ?? run.timeframe ?? "5m");
  const alive = running && run.watching && now > 0 && run.nextLookAt !== null && run.nextLookAt > now - 120_000;
  const nextIn = alive && run.nextLookAt ? Math.max(0, Math.min(60, Math.round((run.nextLookAt - now) / 1000))) : 0;
  const lastPrice = market.ticker?.last ?? null;
  const wide = useIsWide();

  if (wide === false) {
    return (
      <div className={styles.page}>
        <Ticker />
        <MobileRunView
          alive={alive}
          coin={coin}
          coinRules={coinRules}
          coins={coins}
          desk={desk}
          frame={frame}
          liveFigure={liveFigure}
          liveUsd={liveUsd}
          market={market}
          nextIn={nextIn}
          now={now}
          onCoin={setPicked}
          onFrame={setFrame}
          onOpen={setDetail}
          run={run}
        />
        {detail ? <DetailDrawer detail={detail} onClose={() => setDetail(null)} /> : null}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Ticker />
      <div className={`${styles.desk} flex flex-col gap-2 p-2 xl:h-[max(calc(100dvh-69px-38px),940px)]`}>
        <TopBar alive={alive} chain={chain.data ?? null} coin={coin} liveFigure={liveFigure} liveUsd={liveUsd} market={market} nextIn={nextIn} now={now} run={run} />
        {!running ? <RunEnded run={run} /> : null}

        <div className="grid min-h-0 flex-1 gap-2 xl:grid-cols-[minmax(300px,22%)_minmax(0,1fr)_minmax(300px,21%)]">
          {/* LEFT: the agent's own desk - money, signal, risk, engine */}
          <div className="flex min-h-0 flex-col gap-2">
            <Treasury liveFigure={liveFigure} liveUsd={liveUsd} now={now} run={run} />
            <Panel live meta={coins.length > 1 ? "tap a coin to watch it" : "what it waits for"} title="Watchlist">
              <div className="flex flex-col gap-2 p-2">
                {desk.length === 0 ? <p className={`p-3 text-xs ${styles.muted}`}>Syncing the agent&apos;s rules…</p> : null}
                {desk.map((rule) => (
                  <CoinCard
                    key={rule.id}
                    market={rule.market ?? run.market}
                    now={now}
                    onPick={() => setPicked(rule.market ?? run.market)}
                    rule={rule}
                    selected={(rule.market ?? run.market) === coin}
                  />
                ))}
              </div>
            </Panel>
            {/* The log scrolls inside whatever height is left, so the column never ends in dead space. */}
            <DecisionLog onOpen={setDetail} run={run} />
          </div>

          {/* CENTRE: the market the agent trades */}
          <div className="flex min-h-0 flex-col gap-2">
            <ChartPanel coin={coin} desk={coinRules} frame={frame} lastPrice={lastPrice} onFrame={setFrame} run={run} />
            <div className="grid min-h-0 gap-2 xl:h-[22%] xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
              <EngineCard alive={alive} desk={desk} nextIn={nextIn} now={now} run={run} />
              <Performance run={run} />
            </div>
          </div>

          {/* RIGHT: the market floor - book, tape, wire */}
          <div className="flex min-h-0 flex-col gap-2">
            <OrderBook market={market} />
            <Tape market={market} />
            <Wire market={market} now={now} run={run} />
          </div>
        </div>
      </div>

      {/* below the fold: the full record */}
      <div className="p-2 pt-0">
        <TradesTable now={now} onOpen={setDetail} run={run} />
      </div>
      {detail ? <DetailDrawer detail={detail} onClose={() => setDetail(null)} /> : null}
    </div>
  );
}

/* ── the phone ─────────────────────────────────────────────────────────── */

/**
 * The desk on a phone (owner, 2026-10-19: "most people scroll X on a phone... the mobile is shit... two cards
 * in one line where possible"). Not the desktop stacked: its own order, after the chart-first asset screens
 * of mobile trading apps - who and the money first, the chart full width, stats two to a row, the market's
 * dense panels as tabs (one at a time), and Share pinned at the bottom for visitors arriving from X.
 */
function useIsWide(): boolean | null {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia("(min-width: 1280px)");
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(min-width: 1280px)").matches,
    () => null,
  );
}

function MobileRunView({
  run,
  now,
  desk,
  coins,
  coin,
  onCoin,
  coinRules,
  frame,
  onFrame,
  market,
  liveFigure,
  liveUsd,
  alive,
  nextIn,
  onOpen,
}: {
  run: LiveRunDetail;
  now: number;
  desk: LiveDeskRule[];
  coins: string[];
  coin: string | null;
  onCoin: (market: string) => void;
  coinRules: LiveDeskRule[];
  frame: string;
  onFrame: (tf: string) => void;
  market: MarketStream;
  liveFigure: string;
  liveUsd: number;
  alive: boolean;
  nextIn: number;
  onOpen: (detail: Detail) => void;
}) {
  /*
   * A TRADING APP, FOR AN AGENT (owner, 2026-10-19: "make it like a real trading app but for agentic
   * trading"). Built the way exchange apps build a pair on a phone - flat, edge to edge: the account on top,
   * the pair and its price, the chart full-bleed, one row of underlined tabs, and actions pinned at the
   * bottom. The account is the AGENT's; where an app pins Buy / Sell, nobody here places orders - the agent
   * does - so the bar holds what a viewer can do: build one like it, or pass it on.
   * Type: tDisplay / tTitle / tValue / tBody / tLabel / tCaption only.
   */
  const running = run.status === "running";
  const t = market.ticker;
  const [tab, setTab] = useState<"agent" | "position" | "trades" | "book" | "tape">("agent");
  const rule = coinRules[0] ?? desk[0] ?? null;
  const candles = useRuleCandles(coin, rule?.timeframe ?? null);
  const buyLine = rule?.when.find((c) => c.kind === "rsi") ?? null;
  const rsi = buyLine ? readCondition(buyLine, candles.data?.closed.map((c) => c.c) ?? []).value : null;
  const holding = desk.find((r) => r.position) ?? null;

  return (
    <div className="pb-10">
      {/* the account: the agent's - who on the left, its money and Share on the right */}
      <header className={styles.appTopBar}>
        <span className={styles.appAvatar}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the brand mark in an avatar dot */}
          <img alt="" height={20} src="/dolphin-logo.png" width={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={`${styles.tBody} truncate !font-semibold !text-white`}>{run.name}</p>
          <p className={`${styles.tCaption} flex items-center gap-1.5`}>
            {running ? <span className={styles.blip} /> : null}
            {running ? `Live · day ${now ? dayOf(run.startedAt, now) : 1}` : run.status === "lost" ? "Ran out" : "Ended"}
            {(() => {
              const key = running ? keyLeft(run.tradeKey, now) : null;
              return key ? <span style={key.soon ? { color: DOWN } : undefined}>{` · key ${key.text === "Expired" ? "expired" : `${key.text} left`}`}</span> : null;
            })()}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <p className={`${styles.tValue} leading-none`}>
            <RollingFigure value={liveFigure} />
          </p>
          <TChange value={run.startUsd > 0 ? ((liveUsd - run.startUsd) / run.startUsd) * 100 : null} />
        </div>
        {/* Share: small, where the account is */}
        <ShareButton change={pct(run.startUsd, liveUsd)} icon liveFigure={liveFigure} run={run} />
      </header>
      {!running ? (
        <div className="px-4 pt-3">
          <RunEnded run={run} />
        </div>
      ) : null}

      {/* the pair */}
      <section className="px-4 pt-4">
        {coins.length > 1 ? (
          <div className="flex gap-1.5">
            {coins.map((m) => (
              <button className={`${styles.appCoinPick} ${m === coin ? styles.appCoinPickOn : ""}`} key={m} onClick={() => onCoin(m)} type="button">
                {m.replace("USDT", "")}
              </button>
            ))}
          </div>
        ) : null}
        <div className="mt-3 flex items-center gap-2">
          <TokenLogo size={22} symbol={(coin ?? "").replace("USDT", "")} />
          <span className={`${styles.tBody} !font-semibold !text-white`}>{coin?.replace("USDT", "/USDT")}</span>
        </div>
        <div className="mt-1 flex items-end justify-between gap-4">
          <div>
            <Flash className={styles.tDisplay} value={t?.last ?? null}>
              {t ? price(t.last) : "—"}
            </Flash>
            <p className="mt-1.5 flex items-center gap-1.5">
              <TChange value={t?.changePct ?? null} />
              <span className={styles.tCaption}>today</span>
            </p>
          </div>
          <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-right">
            <dt className={styles.tCaption}>24h high</dt>
            <dd className={`${styles.tCaption} !text-white`}>{t ? price(t.high) : "—"}</dd>
            <dt className={styles.tCaption}>24h low</dt>
            <dd className={`${styles.tCaption} !text-white`}>{t ? price(t.low) : "—"}</dd>
            <dt className={styles.tCaption}>24h vol</dt>
            <dd className={`${styles.tCaption} !text-white`}>{t ? `$${compact(t.quoteVolume)}` : "—"}</dd>
          </dl>
        </div>
      </section>

      {/* the chart, full-bleed */}
      <div className="mt-3 h-[340px]">
        <ChartPanel coin={coin} desk={coinRules} flat frame={frame} lastPrice={t?.last ?? null} onFrame={onFrame} run={run} />
      </div>

      {/* where an exchange draws your order line: what the agent waits for, on this coin */}
      {rule ? (
        <section className="border-y border-white/[0.06] px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className={styles.tLabel}>{holding && (holding.market ?? run.market) === coin ? "In a trade" : "The agent waits for"}</p>
            <p className={styles.tCaption}>
              RSI {rsi === null ? "—" : rsi.toFixed(1)}
              {buyLine && buyLine.kind === "rsi" ? ` · buys under ${buyLine.value}` : ""}
            </p>
          </div>
          <div className="mt-2">
            <RsiTrack buy={buyLine && buyLine.kind === "rsi" ? buyLine.value : null} value={rsi} />
          </div>
          <p className={`${styles.tBody} mt-1.5`}>
            {rsi === null || !buyLine || buyLine.kind !== "rsi"
              ? "Reading candles…"
              : rsi < buyLine.value
                ? "At its buy line - it buys when this candle closes."
                : `${(rsi - buyLine.value).toFixed(1)} points from buying ${(coin ?? "").replace("USDT", "")}.`}
            <span className={styles.tCaption}> {alive ? `Next look in ${nextIn}s.` : ""}</span>
          </p>
        </section>
      ) : null}

      {/* everything else, one tab at a time */}
      <nav className={styles.appTabs}>
        {(
          [
            ["agent", "Agent"],
            ["position", "Position"],
            ["trades", `Trades${run.tradeCount ? ` ${run.tradeCount}` : ""}`],
            ["book", "Book"],
            ["tape", "Tape"],
          ] as const
        ).map(([key, label]) => (
          <button className={`${styles.appTab} ${tab === key ? styles.appTabOn : ""}`} key={key} onClick={() => setTab(key)} type="button">
            {label}
          </button>
        ))}
      </nav>

      {tab === "agent" ? (
        <section>
          {rule ? (
            <p className={`${styles.tBody} px-4 py-3`}>
              {buyLine && buyLine.kind === "rsi"
                ? `Buys sharp dips: RSI under ${buyLine.value} on ${rule.timeframe} candles, ${usd(rule.sizeUsd)} a trade. Sells at +${rule.takeProfitPct ?? "—"}% or cuts at −${rule.stopLossPct ?? "—"}%. At most ${rule.maxTradesPerDay} a day per coin.`
                : null}
            </p>
          ) : null}
          <p className={`${styles.tLabel} px-4 pb-1`}>Watching</p>
          {desk.map((r) => (
            <AgentCoinRow key={r.id} market={r.market ?? run.market} onPick={() => onCoin(r.market ?? run.market ?? "")} rule={r} selected={(r.market ?? run.market) === coin} />
          ))}
          <p className={`${styles.tLabel} px-4 pb-1 pt-5`}>Its decisions</p>
          <div className="flex h-[300px] flex-col px-2">
            <DecisionLog bare onOpen={onOpen} run={run} />
          </div>
        </section>
      ) : tab === "position" ? (
        <section className="px-4 py-4">
          {holding && holding.position ? (
            <PositionBlock rule={holding} />
          ) : (
            <p className={styles.tBody}>No open position. It holds only after its rule buys, and only for one coin at a time.</p>
          )}
          <dl className={`${styles.statRow} mt-5`}>
            <MobileStat label="Start" value={usd(run.startUsd)} />
            <MobileStat label="Best" tone="gold" value={usd(Math.max(liveUsd, ...run.history.map((p) => p.usd)))} />
            <MobileStat label="Low" value={usd(Math.min(liveUsd, ...run.history.map((p) => p.usd)))} />
            <MobileStat label="Won" value={run.closedCount ? `${run.winCount}/${run.closedCount}` : "—"} />
          </dl>
        </section>
      ) : tab === "trades" ? (
        <section>
          {run.trades.length === 0 ? (
            <p className={`${styles.tBody} px-4 py-4 !text-[#8a8c85]`}>No trades yet. It only buys when its rule says so.</p>
          ) : (
            run.trades.map((trade) => {
              const buy = trade.kind === "enter" && trade.side === "long";
              return (
                <button className={styles.appRow} key={`${trade.at}-${trade.kind}`} onClick={() => onOpen(tradeDetail(trade, run))} type="button">
                  <TokenLogo size={26} symbol={trade.market.replace("USDT", "")} />
                  <span className="min-w-0 flex-1">
                    <span className={`${styles.tBody} block !font-semibold`} style={{ color: buy ? GOLD : DOWN }}>
                      {buy ? "Bought" : "Sold"} {trade.market.replace("USDT", "")}
                    </span>
                    <span className={`${styles.tCaption} block`}>
                      {price(trade.price)} · {usd(trade.sizeUsd)} · {now ? ago(now - trade.at) : ""}
                    </span>
                  </span>
                  <span className={styles.tValue} style={{ color: trade.pnlPct === null ? "#8a8c85" : trade.pnlPct >= 0 ? UP : DOWN }}>
                    {trade.pnlPct === null ? "open" : `${trade.pnlPct >= 0 ? "+" : ""}${trade.pnlPct.toFixed(2)}%`}
                  </span>
                </button>
              );
            })
          )}
          <p className={`${styles.tCaption} px-4 py-4`}>
            Wallet{" "}
            <a className="text-[#c9cbc3]" href={`https://bscscan.com/address/${run.walletAddress}`} rel="noreferrer" target="_blank">
              {run.walletAddress.slice(0, 6)}…{run.walletAddress.slice(-4)} ↗
            </a>{" "}
            · Not financial advice.
          </p>
          <div className="px-4">
            <OwnerEnd run={run} />
          </div>
        </section>
      ) : tab === "book" ? (
        <div className="flex h-[440px] flex-col px-2 py-2">
          <OrderBook bare market={market} />
        </div>
      ) : (
        <div className="flex h-[440px] flex-col gap-3 px-2 py-2 [&>div]:flex-1">
          <Tape bare market={market} />
        </div>
      )}

    </div>
  );
}

function MobileStat({ label, value, tone }: { label: string; value: string; tone?: "gold" }) {
  return (
    <div className={styles.stat}>
      <dt className={styles.tLabel}>{label}</dt>
      <dd className={`${styles.tValue} mt-1`} style={tone === "gold" ? { color: GOLD } : undefined}>
        {value}
      </dd>
    </div>
  );
}

/** One coin the agent watches, as a market-list row: its price and day, and the Dolphin on its RSI track. */
function AgentCoinRow({ rule, market, selected, onPick }: { rule: LiveDeskRule; market: string | null; selected: boolean; onPick: () => void }) {
  const candles = useRuleCandles(market, rule.timeframe);
  const tickers = useTickers();
  const base = (market ?? "").replace("USDT", "");
  const ticker = tickers.data?.find((row) => row.symbol === market?.replace("USDT", "/USDT"));
  const buyLine = rule.when.find((c) => c.kind === "rsi");
  const rsi = buyLine ? readCondition(buyLine, candles.data?.closed.map((c) => c.c) ?? []).value : null;
  return (
    <button className={`${styles.appRow} ${selected ? styles.appRowOn : ""}`} onClick={onPick} type="button">
      <TokenLogo size={28} symbol={base} />
      <span className="w-[86px] shrink-0">
        <span className={`${styles.tBody} block !font-semibold !text-white`}>{base}</span>
        <span className={`${styles.tCaption} block`}>{ticker ? price(ticker.price) : "—"}</span>
      </span>
      <span className="min-w-0 flex-1">
        <RsiTrack buy={buyLine && buyLine.kind === "rsi" ? buyLine.value : null} height={20} value={rsi} />
      </span>
      <span className="w-[54px] shrink-0 text-right">
        <span className={`${styles.tValue} block`}>{rsi === null ? "—" : rsi.toFixed(0)}</span>
        <span className={`${styles.tCaption} block`}>RSI</span>
      </span>
    </button>
  );
}

/** The open trade, as an app shows a position: entry, the live result, and where it exits. */
function PositionBlock({ rule }: { rule: LiveDeskRule }) {
  const tickers = useTickers();
  const p = rule.position!;
  const base = (rule.market ?? "").replace("USDT", "");
  const live = tickers.data?.find((row) => row.symbol === rule.market?.replace("USDT", "/USDT"))?.price ?? null;
  const pnl = live ? ((live - p.entryPrice) / p.entryPrice) * 100 : null;
  return (
    <div>
      <div className="flex items-center gap-2">
        <TokenLogo size={22} symbol={base} />
        <span className={`${styles.tBody} !font-semibold !text-white`}>{base} · long</span>
      </div>
      <p className={`${styles.tDisplay} mt-2`} style={{ color: pnl === null ? undefined : pnl >= 0 ? UP : DOWN }}>
        {pnl === null ? "—" : `${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}%`}
      </p>
      <dl className={`${styles.statRow} mt-4 !grid-cols-3`}>
        <MobileStat label="Entry" value={price(p.entryPrice)} />
        <MobileStat label="Target" value={rule.takeProfitPct === null ? "—" : price(p.entryPrice * (1 + rule.takeProfitPct / 100))} />
        <MobileStat label="Stop" value={rule.stopLossPct === null ? "—" : price(p.entryPrice * (1 - rule.stopLossPct / 100))} />
      </dl>
    </div>
  );
}

/**
 * PASS THE RUN ON (owner, 2026-10-19: "make the share have a post on X template and Reddit and all that").
 * A sheet with the post already written from the run's live numbers - never a made-up figure - and one tap
 * to X, Reddit, Telegram or WhatsApp, or to copy it. Calm and one line, the way the owner posts on X: what
 * it is, the real number, and where to check it.
 */
function ShareButton({ run, liveFigure, change, className, icon }: { run: LiveRunDetail; liveFigure: string; change: string; className?: string; icon?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {icon ? (
        <button aria-label="Share this run" className={styles.shareIcon} onClick={() => setOpen(true)} type="button">
          <svg aria-hidden className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13" />
          </svg>
        </button>
      ) : (
        <button className={className ?? styles.watchButton} onClick={() => setOpen(true)} type="button">
          Share
        </button>
      )}
      {/* At the document's top level: a blurred bar is a containing block for fixed children, and trapped the sheet inside it. */}
      {open ? createPortal(<ShareSheet change={change} liveFigure={liveFigure} onClose={() => setOpen(false)} run={run} />, document.body) : null}
    </>
  );
}

function ShareSheet({ run, liveFigure, change, onClose }: { run: LiveRunDetail; liveFigure: string; change: string; onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const url = typeof window === "undefined" ? `https://www.dolphinamp.xyz/live/${run.slug}` : window.location.href.split("?")[0]!;
  const coins = [...new Set((run.desk ?? []).map((rule) => (rule.market ?? run.market ?? "").replace("USDT", "")).filter(Boolean))];
  const coinWords = coins.length > 1 ? `${coins.slice(0, -1).join(", ")} and ${coins[coins.length - 1]}` : (coins[0] ?? "crypto");
  const running = run.status === "running";
  const post = running
    ? `An AI agent is trading real money in public. ${run.name}: ${liveFigure} (${change}) on ${coinWords}. Every trade on BNB Chain.`
    : `An AI agent traded real money in public. ${run.name} finished at ${liveFigure} (${change}) on ${coinWords}. Every trade is on BNB Chain.`;
  const redditTitle = `${run.name}: an AI agent trading ${liveFigure} of real money live on ${coinWords} - every trade verifiable on BNB Chain`;
  const enc = encodeURIComponent;
  // Public social platforms only (owner, 2026-10-19: "remove WhatsApp - what we need is social media, public").
  const targets = [
    { name: "X", href: `https://x.com/intent/post?text=${enc(post)}&url=${enc(url)}`, mark: "𝕏" },
    { name: "Reddit", href: `https://www.reddit.com/submit?url=${enc(url)}&title=${enc(redditTitle)}`, mark: "r/" },
    { name: "Threads", href: `https://www.threads.net/intent/post?text=${enc(`${post} ${url}`)}`, mark: "@" },
    { name: "LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`, mark: "in" },
    { name: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`, mark: "f" },
  ];
  const copy = async (what: "post" | "link") => {
    try {
      await navigator.clipboard.writeText(what === "post" ? `${post} ${url}` : url);
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      // Clipboard refused (an old browser or a denied permission): the text stays on screen to copy by hand.
    }
  };
  return (
    <>
      <div className={styles.scrim} onClick={onClose} />
      <div aria-label="Share this run" className={styles.shareSheet} role="dialog">
        <div className="flex items-center justify-between">
          <p className={styles.tTitle}>Share this run</p>
          <button aria-label="Close" className={`${styles.tBody} px-2`} onClick={onClose} type="button">
            ✕
          </button>
        </div>
        <p className={`${styles.tLabel} mt-4`}>The post</p>
        <p className={`${styles.sharePreview} mt-2`}>
          {post} <span className="text-[#f3c13a]">{url.replace("https://", "")}</span>
        </p>
        <p className={`${styles.tCaption} mt-1 text-right`}>{post.length + 24} / 280 on X</p>
        <div className="mt-4 grid grid-cols-5 gap-2">
          {targets.map((target) => (
            <a className={styles.shareTarget} href={target.href} key={target.name} rel="noreferrer" target="_blank">
              <span className={styles.shareMark}>{target.mark}</span>
              <span className={styles.tCaption}>{target.name}</span>
            </a>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button className={styles.appSecondary} onClick={() => void copy("post")} type="button">
            {copied === "post" ? "Copied" : "Copy post"}
          </button>
          <button className={styles.appSecondary} onClick={() => void copy("link")} type="button">
            {copied === "link" ? "Copied" : "Copy link"}
          </button>
        </div>
        {typeof navigator !== "undefined" && "share" in navigator ? (
          <button
            className={`${styles.tBody} mt-3 w-full py-2 text-center !text-[#8a8c85]`}
            onClick={() => void navigator.share({ title: run.name, text: post, url }).catch(() => undefined)}
            type="button"
          >
            More…
          </button>
        ) : null}
      </div>
    </>
  );
}

/* ── shell ─────────────────────────────────────────────────────────────── */

function Panel({ title, meta, live, className, bare, children }: { title: string; meta?: string; live?: boolean; className?: string; bare?: boolean; children: React.ReactNode }) {
  // Bare: the content alone, for a place that already says what it is (a phone tab, a labelled list).
  if (bare) return <div className="flex min-h-0 flex-1 flex-col">{children}</div>;
  return (
    <section className={`${styles.dpanel} flex flex-col ${className ?? "shrink-0"}`}>
      <header className={styles.dhead}>
        <span className="flex shrink-0 items-center gap-2 whitespace-nowrap">
          {live ? <span className={styles.blip} /> : null}
          {title}
        </span>
        {meta ? <span className={`${styles.dmeta} min-w-0 truncate`}>{meta}</span> : null}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

/** A number that flashes green or red for a moment whenever it moves. */
function Flash({ value, children, className }: { value: number | null; children: React.ReactNode; className?: string }) {
  const previous = useRef(value);
  const [tone, setTone] = useState<"up" | "down" | null>(null);
  const [key, setKey] = useState(0);
  useEffect(() => {
    if (value !== null && previous.current !== null && value !== previous.current) {
      setTone(value > previous.current ? "up" : "down");
      setKey((k) => k + 1);
    }
    previous.current = value;
  }, [value]);
  return (
    <span className={`${className ?? ""} ${tone === "up" ? styles.flashUp : tone === "down" ? styles.flashDown : ""}`} key={key}>
      {children}
    </span>
  );
}

/** A finished run says so plainly, with how it ended, and points the visitor at building their own. */
function RunEnded({ run }: { run: LiveRunDetail }) {
  const hours = Math.max(1, Math.round(((run.endedAt ?? run.lastValuedAt) - run.startedAt) / 3_600_000));
  const why = run.status === "lost" ? "The wallet ran out of money." : "Its owner stopped the agent.";
  const up = run.lastUsd >= run.startUsd;
  return (
    <section className={`${styles.dpanel} ${styles.runEnded} flex shrink-0 flex-wrap items-center gap-x-8 gap-y-4 px-5 py-4`}>
      <div className="min-w-0 flex-1">
        <p className="text-[18px] font-semibold">This run has ended</p>
        <p className={`mt-1 text-[13px] ${styles.muted}`}>
          {why} It finished at <span className={`${styles.mono} text-white`}>{usd(run.lastUsd)}</span>,{" "}
          <span className={styles.mono} style={{ color: up ? UP : DOWN }}>
            {pct(run.startUsd, run.lastUsd)}
          </span>{" "}
          from its {usd(run.startUsd)} start, after {run.closedCount} closed trade{run.closedCount === 1 ? "" : "s"} over {hours} hour{hours === 1 ? "" : "s"}. Everything below is
          the full record.
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <Link className="rounded-full bg-[#f3c13a] px-5 py-2.5 text-sm font-semibold text-[#0b0c0a] no-underline" href="/dolphin?mode=build&new=1">
          Build your own trading agent
        </Link>
        <Link className="rounded-full border border-white/15 px-5 py-2.5 text-sm text-[#d6d6d2] no-underline hover:text-white" href="/live">
          See who is live
        </Link>
      </div>
    </section>
  );
}

/* ── top bar ───────────────────────────────────────────────────────────── */

function TopBar({
  run,
  market,
  chain,
  liveFigure,
  liveUsd,
  now,
  alive,
  nextIn,
  coin,
}: {
  coin: string | null;
  run: LiveRunDetail;
  market: MarketStream;
  chain: { block: number; gasGwei: number; at: number } | null;
  liveFigure: string;
  liveUsd: number;
  now: number;
  alive: boolean;
  nextIn: number;
}) {
  const t = market.ticker;
  const feedAge = market.lastMessageAt && now ? Math.max(0, now - market.lastMessageAt) : null;
  const base = (coin ?? "").replace("USDT", "");
  return (
    <div className={`${styles.dpanel} flex shrink-0 flex-wrap items-center gap-x-6 gap-y-3 px-4 py-2.5`}>
      <div className="flex items-center gap-3">
        <LiveBadge running={run.status === "running"} />
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold leading-tight">{run.name}</p>
          <p className={`text-[11px] ${styles.muted}`}>Day {now ? dayOf(run.startedAt, now) : 1} · real money on BNB Chain</p>
        </div>
      </div>

      <div className="flex items-center gap-3 border-l border-white/5 pl-6">
        <span className={styles.chip}>{base ? <TokenLogo size={18} symbol={base} /> : null}</span>
        <div>
          <p className={`text-[11px] ${styles.muted}`}>{coin?.replace("USDT", "/USDT")}</p>
          <Flash className={`${styles.mono} text-[22px] font-semibold leading-none`} value={t?.last ?? null}>
            {t ? t.last.toFixed(2) : "—"}
          </Flash>
        </div>
      </div>
      <Kv label="24h" tone={t ? (t.changePct >= 0 ? "up" : "down") : undefined} value={t ? `${t.changePct >= 0 ? "+" : ""}${t.changePct.toFixed(2)}%` : "—"} />
      <Kv label="24h high" value={t ? t.high.toFixed(2) : "—"} />
      <Kv label="24h low" value={t ? t.low.toFixed(2) : "—"} />
      <Kv label="24h volume" value={t ? `$${compact(t.quoteVolume)}` : "—"} />

      <div className="ml-auto flex items-center gap-6">
        <div className="text-right">
          <p className={`text-[11px] ${styles.muted}`}>Wallet</p>
          <p className={`${styles.mono} text-[20px] font-semibold leading-none`}>
            <RollingFigure value={liveFigure} />
          </p>
        </div>
        <Kv label="Since start" tone={liveUsd >= run.startUsd ? "up" : "down"} value={pct(run.startUsd, liveUsd)} />
        {(() => {
          const key = keyLeft(run.tradeKey, now);
          return key ? (
            <div title={`Its trade key stops working ${key.when}`}>
              <Kv label="Key expires in" tone={key.soon ? "down" : undefined} value={key.text} />
            </div>
          ) : null;
        })()}
        <ShareButton change={pct(run.startUsd, liveUsd)} icon liveFigure={liveFigure} run={run} />
        <div className="hidden flex-col gap-1 border-l border-white/5 pl-5 2xl:flex">
          <Status label="Binance feed" ok={feedAge !== null && feedAge < 5000} value={feedAge === null ? "connecting" : `${(feedAge / 1000).toFixed(1)}s`} />
          <Status label="BNB Chain" ok={Boolean(chain && now - chain.at < 15_000)} value={chain ? `#${chain.block.toLocaleString("en-US")}` : "reading"} />
          <Status label="Engine" ok={alive} value={alive ? `next look ${nextIn}s` : "idle"} />
        </div>
      </div>
    </div>
  );
}

/**
 * When the agent's trade key stops working, in words (owner, 2026-10-25: "a 'when key expires' place").
 * Past it the agent cannot buy, and cannot sell what it holds, until its owner renews the key.
 */
function keyLeft(key: LiveRunDetail["tradeKey"], now: number): { text: string; soon: boolean; when: string } | null {
  if (!key || key.status === "none" || key.expiresAt === null || !now) return null;
  const when = new Date(key.expiresAt).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const left = key.expiresAt - now;
  if (key.status === "expired" || left <= 0) return { text: "Expired", soon: true, when };
  const hours = Math.floor(left / 3_600_000);
  const text = hours >= 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : hours >= 1 ? `${hours}h ${Math.floor((left % 3_600_000) / 60_000)}m` : `${Math.max(1, Math.floor(left / 60_000))}m`;
  return { text, soon: left < 24 * 3_600_000, when };
}

function Kv({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div>
      <p className={`text-[11px] ${styles.muted}`}>{label}</p>
      <p className={`${styles.mono} text-[14px] font-medium`} style={tone ? { color: tone === "up" ? UP : DOWN } : undefined}>
        {value}
      </p>
    </div>
  );
}

function Status({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <span className="flex items-center gap-2 text-[11px]">
      <span className="size-1.5 rounded-full" style={{ background: ok ? UP : "#5a5c56", boxShadow: ok ? `0 0 6px ${UP}` : undefined }} />
      <span className={`w-[78px] ${styles.muted}`}>{label}</span>
      <span className={`${styles.mono} text-[#d6d6d2]`}>{value}</span>
    </span>
  );
}

/* ── left desk ─────────────────────────────────────────────────────────── */

function Treasury({ run, liveFigure, liveUsd, now }: { run: LiveRunDetail; liveFigure: string; liveUsd: number; now: number }) {
  const best = Math.max(liveUsd, ...run.history.map((point) => point.usd));
  const low = Math.min(liveUsd, ...run.history.map((point) => point.usd));
  const up = liveUsd >= run.startUsd;
  return (
    <Panel live meta="on BNB Chain" title="Treasury">
      <div className="px-3 pb-2 pt-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className={`${styles.mono} text-[30px] font-semibold leading-none`}>
            <RollingFigure value={liveFigure} />
          </span>
          <span className={`${styles.mono} text-sm font-semibold`} style={{ color: up ? UP : DOWN }}>
            {pct(run.startUsd, liveUsd)}
          </span>
        </div>
        {run.history.length >= 3 ? (
          <div className="mt-1">
            <ValueArea points={[...run.history, ...(now ? [{ t: now, usd: liveUsd }] : [])]} start={run.startUsd} />
          </div>
        ) : (
          <p className={`mt-3 text-[11.5px] ${styles.muted}`}>The value curve draws itself as the wallet moves - read from the chain every 5 minutes.</p>
        )}
        <div className={`mt-1 grid grid-cols-3 gap-2 text-[11px] ${styles.muted}`}>
          <span>
            Start<span className={`${styles.mono} block text-[13px] text-white`}>{usd(run.startUsd)}</span>
          </span>
          <span>
            Best<span className={`${styles.mono} block text-[13px] ${styles.lime}`}>{usd(best)}</span>
          </span>
          <span>
            Lowest<span className={`${styles.mono} block text-[13px] text-white`}>{usd(low)}</span>
          </span>
        </div>
      </div>
    </Panel>
  );
}

/**
 * ONE COIN THE AGENT WATCHES (owner, 2026-10-19: "modern and wowy" - and the three Signal cards all showed BNB's
 * RSI). Its live price and day, an RSI dial with the buy zone lit, how far it is from buying, and - while it
 * holds - the trade's live result. Each card reads its OWN coin's candles.
 */
function CoinCard({ rule, market, selected, onPick, now }: { rule: LiveDeskRule; market: string | null; selected: boolean; onPick: () => void; now: number }) {
  const candles = useRuleCandles(market, rule.timeframe);
  const tickers = useTickers();
  const base = (market ?? "").replace("USDT", "");
  const ticker = tickers.data?.find((t) => t.symbol === market?.replace("USDT", "/USDT"));
  const closes = candles.data?.closed.map((c) => c.c) ?? [];
  const buyLine = rule.when.find((c) => c.kind === "rsi");
  const sellLine = rule.until.find((c) => c.kind === "rsi");
  const holding = rule.position !== null;
  const rsi = buyLine ? readCondition(buyLine, closes).value : sellLine ? readCondition(sellLine, closes).value : null;
  const livePrice = ticker?.price ?? candles.data?.forming?.c ?? null;
  const pnl = rule.position && livePrice ? ((livePrice - rule.position.entryPrice) / rule.position.entryPrice) * 100 * (rule.position.side === "short" ? -1 : 1) : null;
  const cooldownLeft = rule.lastTradeAt && now ? rule.lastTradeAt + rule.cooldownMinutes * 60_000 - now : 0;
  const atLine = rsi !== null && buyLine && buyLine.kind === "rsi" && (buyLine.op === "below" ? rsi < buyLine.value : rsi > buyLine.value);
  return (
    <button className={`${styles.coinCard} ${selected ? styles.coinCardOn : ""} ${holding ? styles.coinCardHolding : ""}`} onClick={onPick} type="button">
      <div className="flex items-center gap-2.5">
        <span className={styles.chip}>{base ? <TokenLogo size={18} symbol={base} /> : null}</span>
        <div className="min-w-0 flex-1 text-left">
          <p className="text-[13px] font-semibold leading-tight text-white">{base}</p>
          <p className={`${styles.mono} text-[12px] leading-tight text-[#c9cbc3]`}>{livePrice ? price(livePrice) : "—"}</p>
        </div>
        {ticker ? (
          <span
            className={`${styles.mono} rounded-md px-1.5 py-0.5 text-[11px] font-semibold`}
            style={{ color: ticker.change >= 0 ? UP : DOWN, background: ticker.change >= 0 ? "rgba(61,220,132,0.1)" : "rgba(255,92,92,0.1)" }}
          >
            {ticker.change >= 0 ? "+" : ""}
            {ticker.change.toFixed(2)}%
          </span>
        ) : null}
      </div>
      <div className="mt-1.5 flex items-center gap-3">
        <RsiDial buy={buyLine && buyLine.kind === "rsi" ? buyLine.value : null} sell={sellLine && sellLine.kind === "rsi" ? sellLine.value : null} size={66} value={rsi} />
        <div className="min-w-0 flex-1 text-left">
          {holding && rule.position ? (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#f3c13a]">In a trade</p>
              <p className={`${styles.mono} text-[18px] font-semibold leading-tight`} style={{ color: pnl === null ? undefined : pnl >= 0 ? UP : DOWN }}>
                {pnl === null ? "—" : `${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}%`}
              </p>
              <p className={`text-[11px] ${styles.muted}`}>
                from {price(rule.position.entryPrice)} · exits +{rule.takeProfitPct ?? "—"}% / −{rule.stopLossPct ?? "—"}%
              </p>
            </>
          ) : (
            <>
              <p className={`text-[11px] ${styles.muted}`}>RSI on {rule.timeframe} candles</p>
              <p className="text-[12.5px] leading-snug text-[#e4e4df]">
                {rsi === null || !buyLine || buyLine.kind !== "rsi"
                  ? "Reading candles…"
                  : atLine
                    ? "At its buy line - buys on this candle's close"
                    : `${Math.abs(rsi - buyLine.value).toFixed(1)} points from buying`}
              </p>
              <p className={`mt-0.5 text-[11px] ${styles.muted}`}>
                {usd(rule.sizeUsd)} · +{rule.takeProfitPct ?? "—"}% / −{rule.stopLossPct ?? "—"}% · {rule.tradesToday}/{rule.maxTradesPerDay} today
                {cooldownLeft > 0 ? ` · cooling ${Math.ceil(cooldownLeft / 60_000)}m` : ""}
              </p>
            </>
          )}
        </div>
      </div>
    </button>
  );
}

function EngineCard({ run, desk, now, alive, nextIn }: { run: LiveRunDetail; desk: LiveDeskRule[]; now: number; alive: boolean; nextIn: number }) {
  const lastCheck = Math.max(0, ...desk.map((rule) => rule.lastCheckedAt ?? 0), ...run.engine.map((row) => row.lastCheckedAt));
  return (
    <section className={`${styles.dpanel} flex shrink-0 items-center gap-4 px-3 py-2.5`}>
      <Ring alive={alive} seconds={nextIn} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold">{alive ? `Engine looks again in ${nextIn}s` : run.status === "running" ? "Engine not watching" : "Run over"}</p>
        <p className={`truncate text-[11px] ${styles.muted}`}>
          Last decision {lastCheck && now ? ago(now - lastCheck) : "—"} · no AI in the order path
        </p>
      </div>
    </section>
  );
}

function Performance({ run }: { run: LiveRunDetail }) {
  const exits = run.trades.filter((trade) => trade.kind === "exit" && trade.pnlPct !== null);
  const rate = run.closedCount ? Math.round((run.winCount / run.closedCount) * 100) : null;
  return (
    <Panel className="min-h-[120px]" meta={run.closedCount ? `${run.closedCount} closed` : "none closed yet"} title="Performance">
      <div className="flex h-full flex-col px-3 pb-2 pt-2">
        <div className={`grid grid-cols-3 gap-2 text-[11px] ${styles.muted}`}>
          <span>
            Win rate<span className={`${styles.mono} block text-[15px] text-white`}>{rate === null ? "—" : `${rate}%`}</span>
          </span>
          <span>
            Won<span className={`${styles.mono} block text-[15px]`} style={{ color: UP }}>{run.winCount}</span>
          </span>
          <span>
            Lost<span className={`${styles.mono} block text-[15px]`} style={{ color: DOWN }}>{run.closedCount - run.winCount}</span>
          </span>
        </div>
        <div className="mt-1 min-h-0 flex-1">
          <ResultBars results={[...exits].reverse().map((trade) => trade.pnlPct ?? 0)} />
        </div>
      </div>
    </Panel>
  );
}

/* ── centre ────────────────────────────────────────────────────────────── */

/** The element's size, kept current. A callback ref, so it follows the element even when React swaps it. */
function useSize<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: Math.round(entry.contentRect.width), h: Math.round(entry.contentRect.height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return [setEl, size, el] as const;
}

function ChartPanel({ run, coin, desk, frame, onFrame, lastPrice, flat, tabs = true }: { run: LiveRunDetail; coin: string | null; desk: LiveDeskRule[]; frame: string; onFrame: (tf: string) => void; lastPrice: number | null; flat?: boolean; tabs?: boolean }) {
  const data = useRuleCandles(coin, frame);
  const ruleFrames = new Set(desk.map((rule) => rule.timeframe));
  const frameRule = desk.find((rule) => rule.timeframe === frame) ?? null;
  // The forming candle follows the live price between refreshes, so the chart moves with every trade.
  const candles = useMemo(() => {
    const closed = data.data?.closed ?? [];
    const forming = data.data?.forming;
    if (!forming) return closed;
    const live = lastPrice ?? forming.c;
    return [...closed, { ...forming, c: live, h: Math.max(forming.h, live), l: Math.min(forming.l, live) }];
  }, [data.data, lastPrice]);
  const last = candles[candles.length - 1];
  const buyLine = frameRule?.when.find((c) => c.kind === "rsi");
  const sellLine = frameRule?.until.find((c) => c.kind === "rsi");
  const position = desk.find((rule) => rule.position)?.position ?? null;
  const positionRule = desk.find((rule) => rule.position) ?? null;
  const watchRule = frameRule ?? desk[desk.length - 1] ?? null;
  const watchLine = watchRule?.when.find((c) => c.kind === "rsi");
  const status = run.status !== "running"
    ? "Run over · the agent is no longer trading"
    : position
    ? `In a trade since ${new Date(position.openedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })} · entry ${position.entryPrice.toFixed(2)}`
    : watchRule
      ? `No open trade · waiting for ${watchLine && watchLine.kind === "rsi" ? `RSI under ${watchLine.value}` : "its entry"} on ${watchRule.timeframe}`
      : null;
  const chart = (
    <CandleChart
      buy={buyLine && buyLine.kind === "rsi" ? buyLine.value : null}
      candles={candles}
      position={position && positionRule ? { entry: position.entryPrice, side: position.side, stopPct: positionRule.stopLossPct, targetPct: positionRule.takeProfitPct } : null}
      sell={sellLine && sellLine.kind === "rsi" ? sellLine.value : null}
      trades={run.trades.filter((trade) => trade.market === coin)}
    />
  );
  // Flat, the way a trading app draws it on a phone: underlined timeframes over a full-bleed chart, no card.
  if (flat) {
    return (
      <section className="flex h-full flex-col">
        {tabs ? (
        <div className={styles.tfTabs}>
          {TIMEFRAMES.map((tf) => (
            <button className={`${styles.tfTab} ${tf === frame ? styles.tfTabOn : ""}`} key={tf} onClick={() => onFrame(tf)} type="button">
              {tf}
              {ruleFrames.has(tf) ? <span className={styles.tfDot} /> : null}
            </button>
          ))}
        </div>
        ) : null}
        <div className="relative min-h-0 flex-1">{chart}</div>
      </section>
    );
  }
  return (
    <section className={`${styles.dpanel} flex h-full min-h-[320px] flex-1 flex-col`}>
      <header className={`${styles.dhead} !h-auto flex-wrap gap-y-2 py-2`}>
        <span className="flex items-center gap-4">
          <span className="flex items-center gap-2">
            <span className={styles.blip} />
            {coin?.replace("USDT", "/USDT")}
          </span>
          {last ? (
            <span className={`${styles.mono} hidden gap-3 normal-case tracking-normal text-[#c9cbc3] lg:flex`}>
              <span>O {last.o.toFixed(2)}</span>
              <span>H {last.h.toFixed(2)}</span>
              <span>L {last.l.toFixed(2)}</span>
              <span style={{ color: last.c >= last.o ? UP : DOWN }}>C {last.c.toFixed(2)}</span>
            </span>
          ) : null}
        </span>
        <span className={styles.pills}>
          {TIMEFRAMES.map((tf) => (
            <button className={`${styles.pill} ${tf === frame ? styles.pillOn : ""} relative`} key={tf} onClick={() => onFrame(tf)} type="button">
              {tf}
              {ruleFrames.has(tf) ? <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-[#3ddc84]" title="One of its rules trades on this timeframe" /> : null}
            </button>
          ))}
        </span>
      </header>
      {status ? (
        <div className="flex items-center gap-2 border-b border-white/5 px-3 py-1.5 text-[12px]">
          <span className="size-1.5 rounded-full" style={{ background: position ? GOLD : "#6f716b" }} />
          <span className={position ? "font-semibold text-[#f3c13a]" : "text-[#c9cbc3]"}>{status}</span>
          <span className={`ml-auto hidden text-[11px] lg:inline ${styles.muted}`}>B / S: the agent&apos;s buys and sells · yellow line: price now</span>
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">{chart}</div>
    </section>
  );
}

/** Candles + volume + the agent's trades, an RSI pane with its buy and sell lines, its open position's levels. */
function CandleChart({
  candles: all,
  trades,
  buy,
  sell,
  position,
}: {
  candles: Candle[];
  trades: LiveRunDetail["trades"];
  buy: number | null;
  sell: number | null;
  position: { entry: number; side: "long" | "short"; stopPct: number | null; targetPct: number | null } | null;
}) {
  const [ref, { w: W, h: H }, node] = useSize<HTMLDivElement>();
  const clipId = useId();
  const rsiAll = useMemo(() => rsiSeries(all.map((c) => c.c), 14), [all]);
  const SHOW = Math.max(30, Math.min(110, Math.floor(W / 9)));
  /*
   * ZOOM AND SCROLL (owner, 2026-10-25: "allow for pinch actions for zoom and scroll"). `count` is how many
   * candles fit the width (0: the default for this width), `offset` how many sit to the right of the view
   * (0: the latest). Pinch or Ctrl+wheel zooms; dragging or a sideways scroll moves through time; an
   * ordinary vertical scroll still scrolls the page, so the chart never traps it.
   */
  const [view, setView] = useState({ count: 0, offset: 0 });
  const total = all.length;
  const count = Math.max(Math.min(20, total), Math.min(total, view.count || SHOW));
  const offset = Math.max(0, Math.min(total - count, view.offset));
  const candles = all.slice(total - offset - count, total - offset);
  const rsi = rsiAll.slice(total - offset - count, total - offset);
  const geometry = useRef({ step: 1, count, offset, total });
  useEffect(() => {
    geometry.current = { step: (W - 64) / Math.max(1, count), count, offset, total };
  });
  useEffect(() => {
    if (!node) return;
    const set = (nextCount: number, nextOffset: number) => {
      const g = geometry.current;
      const c = Math.round(Math.max(Math.min(20, g.total), Math.min(g.total, nextCount)));
      setView({ count: c, offset: Math.round(Math.max(0, Math.min(g.total - c, nextOffset))) });
    };
    const onWheel = (event: WheelEvent) => {
      const g = geometry.current;
      if (event.ctrlKey) {
        event.preventDefault();
        set(g.count * Math.exp(event.deltaY * 0.01), g.offset);
      } else if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey) {
        event.preventDefault();
        // Scrolling right (a positive delta) moves toward now, as on any horizontal scroller.
        set(g.count, g.offset - (event.shiftKey ? event.deltaY : event.deltaX) / g.step);
      }
    };
    const pointers = new Map<number, number>();
    let start: { x: number; dist: number; count: number; offset: number } | null = null;
    const spread = () => {
      const xs = [...pointers.values()];
      return xs.length > 1 ? Math.abs(xs[0]! - xs[1]!) : 0;
    };
    const begin = () => {
      const g = geometry.current;
      const xs = [...pointers.values()];
      start = { x: xs[0] ?? 0, dist: spread(), count: g.count, offset: g.offset };
    };
    const down = (event: PointerEvent) => {
      pointers.set(event.pointerId, event.clientX);
      node.setPointerCapture(event.pointerId);
      begin();
    };
    const move = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId) || !start) return;
      pointers.set(event.pointerId, event.clientX);
      const g = geometry.current;
      if (pointers.size > 1 && start.dist > 10) set((start.count * start.dist) / Math.max(10, spread()), start.offset);
      else if (pointers.size === 1) set(start.count, start.offset + (event.clientX - start.x) / g.step);
    };
    const up = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      begin();
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    node.addEventListener("pointerdown", down);
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", up);
    return () => {
      node.removeEventListener("wheel", onWheel);
      node.removeEventListener("pointerdown", down);
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up);
      node.removeEventListener("pointercancel", up);
    };
  }, [node]);
  if (all.length === 0 || W === 0 || H === 0) return <div className="absolute inset-0 animate-pulse bg-white/[0.02]" ref={ref} />;

  const AXIS = 64;
  const priceH = H * 0.72;
  const rsiTop = priceH + 34;
  const rsiH = H - rsiTop - 10;
  const levels = position
    ? [position.entry, ...(position.stopPct !== null ? [position.entry * (1 - ((position.side === "short" ? -1 : 1) * position.stopPct) / 100)] : []), ...(position.targetPct !== null ? [position.entry * (1 + ((position.side === "short" ? -1 : 1) * position.targetPct) / 100)] : [])]
    : [];
  const lo = Math.min(...candles.map((c) => c.l), ...levels);
  const hi = Math.max(...candles.map((c) => c.h), ...levels);
  const span = Math.max(hi - lo, hi * 0.001);
  const maxV = Math.max(...candles.map((c) => c.v), 1);
  const y = (v: number) => 12 + (1 - (v - lo) / span) * (priceH - 24);
  const ry = (v: number) => rsiTop + (1 - v / 100) * rsiH;
  const step = (W - AXIS) / candles.length;
  const width = Math.max(2, step * 0.62);
  const interval = candles.length > 1 ? candles[1]!.t - candles[0]!.t : 60_000;
  // Where a moment falls on the view, as a candle index - left of 0 or past the end when scrolled off.
  const slot = (at: number) => Math.floor((at - candles[0]!.t) / interval);
  const xAt = (at: number) => slot(at) * step + step / 2;
  const marks = trades
    .map((trade) => {
      const index = slot(trade.at);
      return index < 0 || index >= candles.length ? null : { index, buy: trade.kind === "enter" && trade.side === "long", price: trade.price, candle: candles[index]! };
    })
    .filter((m): m is { index: number; buy: boolean; price: number; candle: Candle } => m !== null);
  /*
   * EACH BUY JOINED TO ITS SELL (owner, 2026-10-25: "the in and out need a connecting line"). A rule holds one
   * position at a time, so a sell closes the latest unmatched buy of the same side; green when it made money.
   */
  const pairs: { inAt: number; inPrice: number; outAt: number; outPrice: number; won: boolean; pct: number }[] = [];
  const opened: { at: number; price: number; side: "long" | "short" }[] = [];
  for (const trade of [...trades].sort((a, b) => a.at - b.at)) {
    if (trade.kind === "enter") opened.push({ at: trade.at, price: trade.price, side: trade.side });
    else {
      const i = opened.map((o) => o.side).lastIndexOf(trade.side);
      if (i < 0) continue;
      const entry = opened.splice(i, 1)[0]!;
      const move = ((trade.price - entry.price) / entry.price) * 100 * (entry.side === "short" ? -1 : 1);
      const pct = trade.pnlPct ?? move;
      pairs.push({ inAt: entry.at, inPrice: entry.price, outAt: trade.at, outPrice: trade.price, won: pct >= 0, pct });
    }
  }
  const stillOpen = opened[opened.length - 1] ?? null;
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + span * f);
  const lastC = candles[candles.length - 1]!.c;
  const rsiPath = rsi
    .map((v, i) => (v === null ? null : `${i * step + step / 2},${ry(v)}`))
    .filter(Boolean)
    .join(" ");
  const lastRsi = rsi[rsi.length - 1] ?? null;
  const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="absolute inset-0 cursor-grab select-none active:cursor-grabbing" ref={ref} style={{ touchAction: "pan-y" }}>
      {offset > 0 || view.count ? (
        <button
          className="absolute right-[72px] top-2 z-10 rounded-md bg-white/10 px-2 py-1 text-[11px] font-semibold text-white hover:bg-white/20"
          onClick={() => setView({ count: 0, offset: 0 })}
          onPointerDown={(event) => event.stopPropagation()}
          type="button"
        >
          Latest
        </button>
      ) : null}
      <svg height={H} width={W}>
        {grid.map((v) => (
          <g key={v}>
            <line stroke="rgba(255,255,255,0.045)" x1="0" x2={W - AXIS} y1={y(v)} y2={y(v)} />
            {Math.abs(y(v) - y(candles[candles.length - 1]!.c)) > 14 ? (
              <text className={styles.axis} x={W - AXIS + 8} y={y(v) + 4}>
                {price(v)}
              </text>
            ) : null}
          </g>
        ))}
        {[0.25, 0.5, 0.75].map((f) => {
          const i = Math.floor(candles.length * f);
          const c = candles[i];
          return c ? (
            <text className={styles.axis} key={f} textAnchor="middle" x={i * step + step / 2} y={priceH + 13}>
              {time(c.t)}
            </text>
          ) : null;
        })}
        {candles.map((c, i) => {
          const vh = (c.v / maxV) * priceH * 0.16;
          return <rect fill={c.c >= c.o ? "rgba(61,220,132,0.16)" : "rgba(255,92,92,0.16)"} height={vh} key={`v${c.t}`} width={width} x={i * step + step / 2 - width / 2} y={priceH - vh} />;
        })}
        {candles.map((c, i) => {
          const cx = i * step + step / 2;
          const color = c.c >= c.o ? UP : DOWN;
          const top = y(Math.max(c.o, c.c));
          const bottom = y(Math.min(c.o, c.c));
          return (
            <g className={i === candles.length - 1 ? styles.liveCandle : undefined} key={c.t}>
              <line stroke={color} strokeWidth="1" x1={cx} x2={cx} y1={y(c.h)} y2={y(c.l)} />
              <rect fill={color} height={Math.max(1.5, bottom - top)} rx="1" width={width} x={cx - width / 2} y={top} />
            </g>
          );
        })}
        {position
          ? levels.map((level, i) => {
              const label = i === 0 ? "ENTRY" : level < position.entry === (position.side === "long") ? "STOP" : "TARGET";
              const color = label === "ENTRY" ? ENTRY : label === "STOP" ? DOWN : UP;
              return (
                <g key={label}>
                  <line stroke={color} strokeDasharray="2 4" strokeOpacity="0.8" x1="0" x2={W - AXIS} y1={y(level)} y2={y(level)} />
                  <text fill={color} fontSize="10" fontWeight="700" x="6" y={y(level) - 4}>
                    {label} {level.toFixed(2)}
                  </text>
                </g>
              );
            })
          : null}
        <g className={styles.priceLine}>
          <line stroke={GOLD} strokeDasharray="4 5" strokeOpacity="0.7" x1="0" x2={W - AXIS} y1={y(lastC)} y2={y(lastC)} />
          <rect fill={GOLD} height="18" rx="4" width={AXIS - 6} x={W - AXIS + 3} y={y(lastC) - 9} />
          <text fill="#0b0c0a" fontSize="11" fontWeight="700" x={W - AXIS + 8} y={y(lastC) + 4}>
            {price(lastC)}
          </text>
        </g>
        <defs>
          <clipPath id={clipId}>
            <rect height={priceH} width={W - AXIS} x="0" y="0" />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          {pairs.map((pair) => {
            const color = pair.won ? UP : DOWN;
            const x1 = xAt(pair.inAt);
            const x2 = xAt(pair.outAt);
            const sign = pair.pct >= 0 ? "+" : "";
            return (
              <g key={`${pair.inAt}-${pair.outAt}`}>
                <title>{`In at ${price(pair.inPrice)}, out at ${price(pair.outPrice)}: ${sign}${pair.pct.toFixed(2)}%`}</title>
                <line stroke={color} strokeDasharray="5 4" strokeOpacity="0.9" strokeWidth="1.5" x1={x1} x2={x2} y1={y(pair.inPrice)} y2={y(pair.outPrice)} />
                {/* Beside the sell, so it stays readable when the buy has scrolled off the left. */}
                <text fill={color} fontSize="10" fontWeight="700" paintOrder="stroke" stroke="#0e0f0d" strokeWidth="3" textAnchor="end" x={x2 - 8} y={y(pair.outPrice) + 14}>
                  {`${sign}${pair.pct.toFixed(2)}%`}
                </text>
              </g>
            );
          })}
          {stillOpen ? (
            <line stroke={ENTRY} strokeDasharray="5 4" strokeOpacity="0.7" strokeWidth="1.5" x1={xAt(stillOpen.at)} x2={(candles.length - 1) * step + step / 2} y1={y(stillOpen.price)} y2={y(lastC)} />
          ) : null}
        </g>
        {marks.map((m, i) => {
          const cx = m.index * step + step / 2;
          // The arrow's tip sits on the exact fill price, where the connecting line starts or ends (owner, 2026-10-25).
          if (m.buy) {
            const tip = y(m.price);
            return (
              <g key={i}>
                <title>{`Bought at ${price(m.price)} on PancakeSwap`}</title>
                <path d={`M${cx},${tip} l6,10 l-12,0 z`} fill={GOLD} />
                <text fill={GOLD} fontSize="9.5" fontWeight="700" paintOrder="stroke" stroke="#0e0f0d" strokeWidth="3" textAnchor="middle" x={cx} y={tip + 21}>B</text>
              </g>
            );
          }
          const tip = y(m.price);
          return (
            <g key={i}>
              <title>{`Sold at ${price(m.price)} on PancakeSwap`}</title>
              <path d={`M${cx},${tip} l6,-10 l-12,0 z`} fill={DOWN} />
              <text fill={DOWN} fontSize="9.5" fontWeight="700" paintOrder="stroke" stroke="#0e0f0d" strokeWidth="3" textAnchor="middle" x={cx} y={tip - 13}>S</text>
            </g>
          );
        })}

        {/* RSI pane: the indicator the agent reads, with its own lines */}
        <line stroke="rgba(255,255,255,0.06)" x1="0" x2={W} y1={priceH + 20} y2={priceH + 20} />
        {buy !== null ? <rect fill="rgba(61,220,132,0.07)" height={ry(0) - ry(buy)} width={W - AXIS} x="0" y={ry(buy)} /> : null}
        {sell !== null ? <rect fill="rgba(255,92,92,0.07)" height={ry(sell) - ry(100)} width={W - AXIS} x="0" y={ry(100)} /> : null}
        {buy !== null ? <line stroke={UP} strokeDasharray="3 4" strokeOpacity="0.7" x1="0" x2={W - AXIS} y1={ry(buy)} y2={ry(buy)} /> : null}
        {sell !== null ? <line stroke={DOWN} strokeDasharray="3 4" strokeOpacity="0.7" x1="0" x2={W - AXIS} y1={ry(sell)} y2={ry(sell)} /> : null}
        <polyline fill="none" points={rsiPath} stroke={GOLD} strokeWidth="1.5" />
        <text className={styles.axis} x="6" y={priceH + 31}>
          RSI 14{buy !== null ? ` · buys under ${buy}` : ""}
          {sell !== null ? ` · sells over ${sell}` : ""}
        </text>
        {buy !== null ? (
          <text className={styles.axis} x={W - AXIS + 8} y={ry(buy) + 4}>
            {buy}
          </text>
        ) : null}
        {sell !== null ? (
          <text className={styles.axis} x={W - AXIS + 8} y={ry(sell) + 4}>
            {sell}
          </text>
        ) : null}
        {lastRsi !== null ? (
          <g>
            <rect fill="#1d1d1d" height="16" rx="3" stroke={GOLD} strokeOpacity="0.5" width={AXIS - 6} x={W - AXIS + 3} y={ry(lastRsi) - 8} />
            <text fill={GOLD} fontSize="10.5" fontWeight="700" x={W - AXIS + 9} y={ry(lastRsi) + 4}>
              {lastRsi.toFixed(1)}
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}

function DecisionLog({ run, onOpen, bare }: { run: LiveRunDetail; onOpen: (detail: Detail) => void; bare?: boolean }) {
  return (
    <Panel bare={bare} className="min-h-[180px] flex-1" live meta="every closed candle" title="Decision log">
      <div className="relative h-full">
        <div className={`${styles.book} absolute inset-0 overflow-y-auto px-1 py-1`}>
          {run.thoughts.length === 0 ? <p className={`px-2 py-2 text-xs ${styles.muted}`}>Its decisions appear here as it makes them.</p> : null}
          {run.thoughts.map((thought) => (
            <div className={`${styles.bookRow} ${styles.feedItem} ${styles.clickable}`} key={`${thought.t}-${thought.text}`} onClick={() => onOpen(thoughtDetail(thought, run))} role="button" tabIndex={0}>
              <span className={`${styles.mono} ${styles.muted}`}>{new Date(thought.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}</span>
              <span className={thoughtColor(thought.text)}>{thought.text}</span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

/* ── right: the market floor ───────────────────────────────────────────── */

function OrderBook({ market, bare }: { market: MarketStream; bare?: boolean }) {
  const ROWS = 7;
  const asks = market.asks.slice(0, ROWS).reverse();
  const bids = market.bids.slice(0, ROWS);
  const max = Math.max(1, ...asks.map((l) => l.qty), ...bids.map((l) => l.qty));
  const bidUsd = market.bids.reduce((sum, l) => sum + l.price * l.qty, 0);
  const askUsd = market.asks.reduce((sum, l) => sum + l.price * l.qty, 0);
  const bidShare = bidUsd + askUsd > 0 ? (bidUsd / (bidUsd + askUsd)) * 100 : 50;
  const spread = market.asks[0] && market.bids[0] ? market.asks[0].price - market.bids[0].price : null;
  return (
    <Panel bare={bare} live meta="Binance · 100ms" title="Order book">
      <div className={`${styles.mono} px-2 pb-2 pt-1 text-[11.5px]`}>
        <div className={`grid grid-cols-3 px-1 pb-1 text-[10px] ${styles.muted}`}>
          <span>Price</span>
          <span className="text-right">Size</span>
          <span className="text-right">USD</span>
        </div>
        {asks.length === 0 ? <p className={`p-2 ${styles.muted}`}>Connecting to the book…</p> : null}
        {asks.map((level) => (
          <BookRow key={`a${level.price}`} level={level} max={max} side="ask" />
        ))}
        <div className="my-1 flex items-center justify-between border-y border-white/5 px-1 py-1">
          <span className="text-[13px] font-semibold text-white">{market.bids[0] && market.asks[0] ? ((market.bids[0].price + market.asks[0].price) / 2).toFixed(3) : "—"}</span>
          <span className={`text-[10px] ${styles.muted}`}>spread {spread === null ? "—" : spread.toFixed(2)}</span>
        </div>
        {bids.map((level) => (
          <BookRow key={`b${level.price}`} level={level} max={max} side="bid" />
        ))}
        <div className="mt-2">
          <div className="flex h-1.5 overflow-hidden rounded-full">
            <span style={{ width: `${bidShare}%`, background: UP, transition: "width 300ms" }} />
            <span className="flex-1" style={{ background: DOWN }} />
          </div>
          <div className={`mt-1 flex justify-between text-[10px] ${styles.muted}`}>
            <span>Bids ${compact(bidUsd)} · {bidShare.toFixed(0)}%</span>
            <span>Asks ${compact(askUsd)}</span>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function BookRow({ level, max, side }: { level: { price: number; qty: number }; max: number; side: "bid" | "ask" }) {
  const color = side === "bid" ? UP : DOWN;
  return (
    <div className="relative grid grid-cols-3 px-1 py-[1.5px]">
      <span className="absolute inset-y-0 right-0" style={{ width: `${(level.qty / max) * 100}%`, background: side === "bid" ? "rgba(61,220,132,0.10)" : "rgba(255,92,92,0.10)", transition: "width 150ms" }} />
      <span className="relative" style={{ color }}>
        {level.price.toFixed(2)}
      </span>
      <span className="relative text-right text-[#d6d6d2]">{level.qty.toFixed(3)}</span>
      <span className="relative text-right text-[#8a8c85]">{compact(level.price * level.qty)}</span>
    </div>
  );
}

function Tape({ market, bare }: { market: MarketStream; bare?: boolean }) {
  const { buyUsd, sellUsd } = market.flow;
  const buyShare = buyUsd + sellUsd > 0 ? (buyUsd / (buyUsd + sellUsd)) * 100 : 50;
  return (
    <Panel bare={bare} className="min-h-[150px] flex-1" live meta="Binance, live" title="Time & sales">
      <div className="flex h-full flex-col px-2 pb-2 pt-1">
        <div className="mb-1">
          <div className="flex h-1.5 overflow-hidden rounded-full">
            <span style={{ width: `${buyShare}%`, background: UP, transition: "width 300ms" }} />
            <span className="flex-1" style={{ background: DOWN }} />
          </div>
          <div className={`mt-1 flex justify-between text-[10px] ${styles.muted}`}>
            <span>Bought ${compact(buyUsd)} in 60s</span>
            <span>Sold ${compact(sellUsd)}</span>
          </div>
        </div>
        <div className={`${styles.mono} relative min-h-0 flex-1 text-[11.5px]`}>
          <div className="absolute inset-0 overflow-hidden">
            {market.prints.length === 0 ? <p className={`p-2 ${styles.muted}`}>Waiting for the next trade…</p> : null}
            {market.prints.map((print) => (
              <div className={`${styles.tapeRow} grid grid-cols-[1fr_1fr_1fr_auto] gap-2 px-1 py-[1.5px] ${print.usd >= 25_000 ? styles.bigPrint : ""}`} key={print.id}>
                <span style={{ color: print.sell ? DOWN : UP }}>{print.price.toFixed(2)}</span>
                <span className="text-right text-[#d6d6d2]">{print.qty.toFixed(3)}</span>
                <span className="text-right text-[#8a8c85]">${compact(print.usd)}</span>
                <span className="text-right text-[#6f716b]">{new Date(print.t).toLocaleTimeString([], { hour12: false })}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}

/** The wire: what just happened worth knowing - the agent's own trades, large prints, walls, new highs and lows. */
function Wire({ market, run, now, bare }: { market: MarketStream; run: LiveRunDetail; now: number; bare?: boolean }) {
  const events = useMemo<WireEvent[]>(() => {
    const agent: WireEvent[] = run.trades.slice(0, 10).map((trade) => ({
      id: `t${trade.at}${trade.kind}`,
      t: trade.at,
      tone: trade.kind === "enter" ? "gold" : (trade.pnlPct ?? 0) >= 0 ? "up" : "down",
      label: trade.kind === "enter" ? "AGENT BOUGHT" : "AGENT SOLD",
      text: `${trade.market.replace("USDT", "")} at ${price(trade.price)} with ${usd(trade.sizeUsd)}${trade.pnlPct !== null ? ` · ${trade.pnlPct >= 0 ? "+" : ""}${trade.pnlPct.toFixed(2)}%` : ""}`,
    }));
    return [...market.wire, ...agent].sort((a, b) => b.t - a.t).slice(0, 30);
  }, [market.wire, run.trades]);
  return (
    <Panel bare={bare} className="min-h-[150px] xl:h-[30%]" live meta="prints, walls, trades" title="Market wire">
      <div className="relative h-full">
        <div className="absolute inset-0 overflow-y-auto px-2 py-1">
          {events.length === 0 ? <div className={styles.empty}>Quiet so far. Trades over $25k, big resting orders and the agent&apos;s own trades land here.</div> : null}
          {events.map((event) => (
            <div className={`${styles.feedItem} border-b border-white/[0.04] py-1.5`} key={event.id}>
              <div className="flex items-center justify-between gap-2">
                <span className={styles.wireTag} style={{ color: event.tone === "up" ? UP : event.tone === "down" ? DOWN : event.tone === "gold" ? GOLD : "#c9cbc3" }}>
                  {event.label}
                </span>
                <span className={`${styles.mono} text-[10px] ${styles.muted}`}>{now ? ago(now - event.t) : ""}</span>
              </div>
              <p className="mt-0.5 truncate text-[11.5px] text-[#d6d6d2]">{event.text}</p>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

/* ── below the fold ────────────────────────────────────────────────────── */

function TradesTable({ run, now, onOpen }: { run: LiveRunDetail; now: number; onOpen: (detail: Detail) => void }) {
  return (
    <section className={`${styles.dpanel}`}>
      <header className={styles.dhead}>
        <span>Every trade since it went live</span>
        <span className={styles.dmeta}>{run.tradeCount} trades · each one on BNB Chain</span>
      </header>
      <div className="p-3">
        {run.trades.length === 0 ? (
          <p className={`text-sm ${styles.muted}`}>No trades yet. It only buys when its rule says so.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Price</th>
                  <th>Size</th>
                  <th>Pool</th>
                  <th>Cost vs market</th>
                  <th>Result</th>
                  <th>Why</th>
                  <th>Proof</th>
                </tr>
              </thead>
              <tbody>
                {run.trades.map((trade) => {
                  const buy = trade.kind === "enter" && trade.side === "long";
                  return (
                    <tr className={`${styles.feedItem} ${styles.clickable}`} key={`${trade.at}-${trade.kind}`} onClick={() => onOpen(tradeDetail(trade, run))}>
                      <td className={styles.muted}>{now ? ago(now - trade.at) : ""}</td>
                      <td>
                        <span className="font-semibold" style={{ color: buy ? GOLD : DOWN }}>
                          {trade.kind === "enter" ? (trade.side === "short" ? "Short" : "Buy") : "Sell"}
                        </span>{" "}
                        {trade.market.replace("USDT", "")}
                      </td>
                      <td>{price(trade.price)}</td>
                      <td>{usd(trade.sizeUsd)}</td>
                      <td className={styles.muted}>{trade.route ? trade.route.replace("PancakeSwap ", "") : "—"}</td>
                      <td className={styles.mono}>{fillCost(trade) ?? "—"}</td>
                      <td style={{ color: trade.pnlPct === null ? undefined : trade.pnlPct >= 0 ? UP : DOWN }}>
                        {trade.pnlPct === null ? "—" : `${trade.pnlPct >= 0 ? "+" : ""}${trade.pnlPct.toFixed(2)}%`}
                      </td>
                      <td className={`max-w-[420px] truncate ${styles.muted}`}>{trade.reason}</td>
                      <td>
                        {trade.txHash ? (
                          <a className={`${styles.tag} no-underline`} href={`https://bscscan.com/tx/${trade.txHash}`} rel="noreferrer" target="_blank">
                            BscScan ↗
                          </a>
                        ) : (
                          <span className={styles.muted}>{trade.paper ? "practice" : "—"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className={`mt-4 text-xs ${styles.muted}`}>
          Wallet{" "}
          <a className="text-[#c9cbc3]" href={`https://bscscan.com/address/${run.walletAddress}`} rel="noreferrer" target="_blank">
            {run.walletAddress.slice(0, 6)}…{run.walletAddress.slice(-4)} ↗
          </a>{" "}
          · Not financial advice.
        </p>
        <OwnerEnd run={run} />
      </div>
    </section>
  );
}

/**
 * What a fill cost against the market (owner, 2026-10-19: "a way for us to verify"): a buy above Binance's
 * price at the decision, or a sale below it, is the price of trading on chain - fee, pool and slippage.
 */
function fillCost(trade: LiveRunDetail["trades"][number]): string | null {
  if (!trade.marketPrice || trade.paper) return null;
  const buying = (trade.kind === "enter") === (trade.side === "long");
  // Positive: paid more (or got less) than the market. Negative: the fill beat it.
  const cost = ((buying ? trade.price - trade.marketPrice : trade.marketPrice - trade.price) / trade.marketPrice) * 100;
  return `${cost >= 0 ? "+" : "−"}${Math.abs(cost).toFixed(3)}%`;
}

/** Losses read red, profits green, everything else (waiting, buying) quiet. */
function thoughtColor(text: string): string {
  if (/stop|loss|-\d+(\.\d+)?%/i.test(text)) return "text-[#ff5c5c]";
  if (/profit|\+\d+(\.\d+)?%/i.test(text)) return "text-[#3ddc84]";
  return "text-[#c9cbc3]";
}

type Detail = { title: string; lines: string[]; facts: [string, string][]; tx?: string | null };

/** A trade, in full: what it did, why, what it cost, the proof. */
function tradeDetail(trade: LiveRunDetail["trades"][number], run: LiveRunDetail): Detail {
  const verb = trade.kind === "enter" ? (trade.side === "short" ? "Shorted" : "Bought") : "Sold";
  return {
    title: `${verb} ${trade.market.replace("USDT", "")} at ${price(trade.price)}`,
    lines: [trade.reason, ...(trade.kind === "enter" ? run.rules.slice(0, 1).map((rule) => `The rule it followed: ${rule}`) : [])],
    facts: [
      ["When", new Date(trade.at).toLocaleString()],
      ["Size", usd(trade.sizeUsd)],
      ["Price", price(trade.price)],
      ...(trade.pnlPct !== null ? ([["Result", `${trade.pnlPct >= 0 ? "+" : ""}${trade.pnlPct.toFixed(2)}%`]] as [string, string][]) : []),
      ["Money", trade.paper ? "practice" : "real, on BNB Chain"],
      ...(trade.route ? ([["Pool", trade.route]] as [string, string][]) : []),
      ...(trade.marketPrice ? ([["Market price then", price(trade.marketPrice)], ["Cost vs market", fillCost(trade) ?? "—"]] as [string, string][]) : []),
      ...(trade.measured !== undefined && trade.measured !== null ? ([["Amount", trade.measured ? "read from the chain receipt" : "the swap's quote"]] as [string, string][]) : []),
    ],
    tx: trade.txHash,
  };
}

/** One decision, in full, with the rules it was checking. */
function thoughtDetail(thought: LiveRunDetail["thoughts"][number], run: LiveRunDetail): Detail {
  return {
    title: /no trade/i.test(thought.text) ? "It decided to wait" : "It decided to act",
    lines: [thought.text, ...run.rules.map((rule) => `What it was checking for: ${rule}`)],
    facts: [
      ["When", new Date(thought.t).toLocaleString()],
      ["Market", run.market ?? "—"],
    ],
  };
}

function DetailDrawer({ detail, onClose }: { detail: Detail; onClose: () => void }) {
  return (
    <>
      <div className={styles.scrim} onClick={onClose} />
      <aside aria-label={detail.title} className={styles.drawer} role="dialog">
        <button className={`text-sm ${styles.muted} hover:text-white`} onClick={onClose} type="button">
          Close ✕
        </button>
        <h2 className="mt-6 text-2xl font-semibold leading-tight">{detail.title}</h2>
        <div className="mt-5 flex flex-col gap-3">
          {detail.lines.map((line) => (
            <p className={`${styles.panel2} p-4 text-[15px] leading-6 text-[#d9dbd3]`} key={line}>
              {line}
            </p>
          ))}
        </div>
        <dl className="mt-6 flex flex-col">
          {detail.facts.map(([k, v]) => (
            <div className="flex justify-between gap-4 border-b border-white/5 py-3 text-sm" key={k}>
              <dt className={styles.muted}>{k}</dt>
              <dd className="text-right tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        {detail.tx ? (
          <a className={`mt-6 inline-block ${styles.lime}`} href={`https://bscscan.com/tx/${detail.tx}`} rel="noreferrer" target="_blank">
            See it on BscScan ↗
          </a>
        ) : null}
      </aside>
    </>
  );
}

/** The engine's minute clock as a ring that drains toward its next look. */
function Ring({ seconds, alive }: { seconds: number; alive: boolean }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  return (
    <svg className={`${styles.ring} size-12 shrink-0 -rotate-90`} viewBox="0 0 50 50">
      <circle cx="25" cy="25" fill="none" r={r} stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
      <circle cx="25" cy="25" fill="none" r={r} stroke={alive ? GOLD : "#3a3c37"} strokeDasharray={c} strokeDashoffset={alive ? c * (1 - seconds / 60) : c} strokeLinecap="round" strokeWidth="4" />
    </svg>
  );
}

/** The run's owner can end it early. Shown only to them. */
function OwnerEnd({ run }: { run: LiveRunDetail }) {
  const wallet = useWallet();
  const session = useWalletSession();
  const end = useMutation(liveRunsApi.liveRuns.end);
  if (run.status !== "running" || !wallet.address || wallet.address.toLowerCase() !== run.ownerAddress.toLowerCase() || !session.sessionToken) return null;
  return (
    <button
      className="mt-4 rounded-full border border-white/15 px-4 py-2 text-sm text-[#8a8c85] hover:text-white"
      onClick={() => {
        if (window.confirm("End this public run? The agent itself keeps running.")) void end({ sessionToken: session.sessionToken!, slug: run.slug });
      }}
      type="button"
    >
      End the public run
    </button>
  );
}
