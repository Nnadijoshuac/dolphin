"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { LiveBadge, Ticker, Track, ago, dayOf, pct, price, usd, useCandles, useSecond, type Candle } from "@/app/live/live-bits";
import styles from "@/app/live/live.module.css";
import { RollingFigure } from "@/components/rolling-figure";
import { PriceArea, ResultBars, ValueArea } from "@/app/live/stat-charts";
import { liveRunsApi, type LiveRunDetail } from "@/convex/api";
import { useWalletHoldings } from "@/hooks/use-wallet-holdings";
import { useWallet } from "@/wallet/wallet-provider";
import { useWalletSession } from "@/wallet/wallet-session";

/**
 * /live/<slug>: one public run, as it happens. Layout after Mahatir MD Ayat's "Quantix" (owner's pick,
 * 2026-10-18). The balance is read from the chain in the viewer's browser, the candles and ticker from
 * Binance's public API, the pulse from the engine's own minute clock, the thoughts and trades from the
 * engine's own records. Nothing here moves unless something real moved.
 */
export function LiveRun({ slug }: { slug: string }) {
  const run = useQuery(liveRunsApi.liveRuns.get, { slug });
  const now = useSecond();

  if (run === undefined) {
    return (
      <div className={styles.page}>
        <Ticker />
        <div className="mx-auto w-full max-w-[2000px] px-4 sm:px-6 xl:px-10 pt-8">
          <div className="skeleton h-[520px] rounded-[18px]" />
        </div>
      </div>
    );
  }
  if (run === null) {
    return (
      <div className={styles.page}>
        <Ticker />
        <div className="mx-auto w-full max-w-[2000px] px-4 sm:px-6 xl:px-10 pt-16 text-center">
          <p className={styles.muted}>No run with that link.</p>
          <Link className={`mt-4 inline-block ${styles.lime}`} href="/live">See who is live</Link>
        </div>
      </div>
    );
  }
  return <RunView now={now} run={run} />;
}

function RunView({ run, now }: { run: LiveRunDetail; now: number }) {
  const running = run.status === "running";
  const addresses = useMemo(() => [run.walletAddress], [run.walletAddress]);
  const held = useWalletHoldings(addresses, "USD", false);
  const liveFigure = typeof held.headline === "object" ? held.headline.figure : usd(run.lastUsd);
  const liveUsd = typeof held.headline === "object" ? Number(held.headline.figure.replace(/[^0-9.]/g, "")) : run.lastUsd;
  const lastCheck = Math.max(0, ...run.engine.map((row) => row.lastCheckedAt));
  const alive = running && run.watching && now > 0 && run.nextLookAt !== null && run.nextLookAt > now - 120_000;
  const nextIn = alive && run.nextLookAt ? Math.max(0, Math.min(60, Math.round((run.nextLookAt - now) / 1000))) : 0;
  const position = run.engine.find((row) => row.position)?.position ?? null;
  const latestThought = run.engine.find((row) => row.reason)?.reason ?? null;
  const up = liveUsd >= run.startUsd;
  const exits = run.trades.filter((trade) => trade.kind === "exit" && trade.pnlPct !== null);
  const wins = exits.filter((trade) => (trade.pnlPct ?? 0) > 0).length;
  const candles = useCandles(run.market, run.timeframe);
  const [detail, setDetail] = useState<Detail | null>(null);
  const latestTrade = run.trades[0] ?? null;
  const last = candles.data?.[candles.data.length - 1];
  const first = candles.data?.[0];

  return (
    <div className={styles.page}>
      <Ticker />
      <div className="mx-auto w-full max-w-[2000px] px-4 sm:px-6 xl:px-10 pt-8">
        {/* header: title + the key numbers in a row (Oripio) */}
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-3">
              <Link className={`text-sm no-underline ${styles.muted} hover:text-white`} href="/live">← Live runs</Link>
              <LiveBadge running={running} />
            </div>
            <h1 className={`${styles.title} mt-3`}>{run.name}</h1>
            <p className={`mt-2 text-sm ${styles.muted}`}>
              {run.market ?? "—"} · {run.timeframe ?? ""} candles · real money on BNB Chain
            </p>
          </div>
          <div className="flex flex-wrap gap-5">
            <div className={styles.kpi}>
              <span className={`text-xs ${styles.muted}`}>Started</span>
              <span className="text-xl font-semibold tabular-nums">{usd(run.startUsd)}</span>
            </div>
            <div className={styles.kpi}>
              <span className={`text-xs ${styles.muted}`}>Now</span>
              <span className="text-xl font-semibold tabular-nums" style={{ color: up ? "#3ddc84" : "#ff5c5c" }}>{usd(liveUsd)}</span>
            </div>
            <div className={styles.kpi}>
              <span className={`text-xs ${styles.muted}`}>Target</span>
              <span className={`text-xl font-semibold tabular-nums ${styles.lime}`}>${run.targetUsd}</span>
            </div>
            <div className={styles.kpi}>
              <span className={`text-xs ${styles.muted}`}>{running ? "Day" : "Status"}</span>
              <span className="text-xl font-semibold tabular-nums">
                {running ? (now ? dayOf(run.startedAt, now) : 1) : run.status === "won" ? "Won" : run.status === "lost" ? "Zero" : "Ended"}
              </span>
            </div>
          </div>
        </div>

        {/* the newest move, first thing you see; tap it for the full story */}
        <button
          className={`${styles.panel} ${styles.latest} ${styles.clickable} mt-8 flex w-full flex-wrap items-center gap-4 p-5 text-left`}
          onClick={() =>
            setDetail(
              latestTrade
                ? tradeDetail(latestTrade, run)
                : { title: "What it is doing now", lines: [latestThought ?? "Watching the market for its entry."], facts: [["Holding", position ? `${position.side} from ${price(position.entryPrice)}` : "nothing"]] },
            )
          }
          type="button"
        >
          <span className={`grid size-12 shrink-0 place-items-center rounded-2xl text-lg font-bold`} style={{ background: "rgba(243,193,58,0.14)", color: "#f3c13a" }}>
            {latestTrade ? (latestTrade.kind === "enter" ? "B" : "S") : "•"}
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block text-xs ${styles.muted}`}>Latest move {latestTrade && now ? `· ${ago(now - latestTrade.at)}` : ""}</span>
            <span className="block truncate text-lg font-semibold">
              {latestTrade
                ? `${latestTrade.kind === "enter" ? (latestTrade.side === "short" ? "Shorted" : "Bought") : "Sold"} ${latestTrade.market.replace("USDT", "")} at ${price(latestTrade.price)} with ${usd(latestTrade.sizeUsd)}`
                : position
                  ? `Holding a ${position.side} from ${price(position.entryPrice)}`
                  : "No trade yet. Waiting for its rule to say buy."}
            </span>
            <span className={`block truncate text-sm ${styles.muted}`}>{latestTrade ? latestTrade.reason : latestThought ?? ""}</span>
          </span>
          <span className={`text-sm ${styles.lime}`}>How it decided →</span>
        </button>

        {/* three columns (Coinix trading): decision log | chart | wallet */}
        <div className="mt-8 grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)_360px] 2xl:grid-cols-[340px_minmax(0,1fr)_400px]">
          <section className={`${styles.panel} order-3 flex min-h-0 flex-col p-4 xl:order-1`}>
            <div className="flex items-center justify-between px-1">
              <h2 className="text-sm font-semibold">Decision log</h2>
              <span className={`text-[11px] ${styles.muted}`}>its own words</span>
            </div>
            {latestThought ? (
              <p className={`${styles.panel2} mt-3 p-3 text-[13px] leading-5`}>
                <span className={`mb-1 block text-[11px] ${styles.lime}`}>Latest</span>
                {latestThought}
              </p>
            ) : null}
            {/* On wide screens the list fills its card and scrolls inside it, so it never sets the row's height. */}
            <div className="relative mt-3 min-h-[160px] flex-1">
            <div className={`${styles.book} max-h-[420px] overflow-y-auto xl:absolute xl:inset-0 xl:max-h-none`}>
              {run.thoughts.length === 0 ? <p className={`px-1 text-xs ${styles.muted}`}>Its decisions appear here as it makes them.</p> : null}
              {run.thoughts.map((thought) => (
                <div
                  className={`${styles.bookRow} ${styles.feedItem} ${styles.clickable}`}
                  key={`${thought.t}-${thought.text}`}
                  onClick={() => setDetail(thoughtDetail(thought, run))}
                  role="button"
                  tabIndex={0}
                >
                  <span className={styles.muted}>{now ? ago(now - thought.t).replace(" ago", "") : ""}</span>
                  <span className={/no trade|waiting|not/i.test(thought.text) ? "text-[#c9cbc3]" : "text-[#3ddc84]"}>{thought.text}</span>
                </div>
              ))}
            </div>
            </div>
          </section>

          <section className={`${styles.panel} order-1 flex flex-col p-5 sm:p-6 xl:order-2`}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className={`text-sm ${styles.muted}`}>{run.market?.replace("USDT", "/USDT")}</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums">{last ? price(last.c) : "—"}</p>
                {first && last ? (
                  <p className="text-sm" style={{ color: last.c >= first.o ? "#3ddc84" : "#ff5c5c" }}>
                    {pct(first.o, last.c)} over the last {candles.data?.length} candles
                  </p>
                ) : null}
              </div>
              <div className={styles.pills}>
                {["15m", "1h", "4h", "1d"].map((tf) => (
                  <span className={`${styles.pill} ${tf === run.timeframe ? styles.pillOn : ""}`} key={tf}>
                    {tf}
                  </span>
                ))}
              </div>
            </div>
            <CandleChart candles={candles.data ?? []} trades={run.trades} />
          </section>

          <div className="order-2 flex flex-col gap-4 xl:order-3">
            <section className={`${styles.panel} p-5 sm:p-6`}>
              <p className={`text-sm ${styles.muted}`}>Wallet balance</p>
              <div className={`${styles.balance} mt-2`}>
                <RollingFigure value={liveFigure} />
              </div>
              <p className="mt-2 text-sm font-semibold" style={{ color: up ? "#3ddc84" : "#ff5c5c" }}>
                {pct(run.startUsd, liveUsd)} <span className={`font-normal ${styles.muted}`}>since the start</span>
              </p>
              <div className="mt-6">
                <Track now={liveUsd} start={run.startUsd} target={run.targetUsd} />
                <div className={`mt-2 flex justify-between text-xs ${styles.muted}`}>
                  <span>$0 · over</span>
                  <span className={styles.lime}>${run.targetUsd} · wins</span>
                </div>
              </div>
              {!running ? (
                <p className="mt-5 text-lg font-semibold">
                  {run.status === "won" ? `It made it to $${run.targetUsd}.` : run.status === "lost" ? "It went to zero." : "Its owner ended the run."}
                </p>
              ) : null}
            </section>

            <section className={`${styles.panel} flex items-center gap-5 p-5`}>
              <Ring alive={alive} seconds={nextIn} />
              <div className="min-w-0">
                <p className="font-semibold">{alive ? `Next look in ${nextIn}s` : running ? "Not watching right now" : "Run over"}</p>
                <p className={`text-sm ${styles.muted}`}>
                  {position ? `Holding a ${position.side} from ${price(position.entryPrice)}` : "Not holding anything. Waiting for its entry."}
                </p>
              </div>
            </section>

            <section className={`${styles.panel} flex min-h-0 flex-1 flex-col p-5`}>
              <p className="text-sm font-semibold">Its rules</p>
              <div className="relative mt-2 min-h-[80px] flex-1">
              <ul className="flex flex-col gap-2 overflow-y-auto text-[13px] leading-5 text-[#c9cbc3] xl:absolute xl:inset-0">
                {run.rules.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
              </div>
            </section>
          </div>
        </div>

        {/* stat cards (Quantix) */}
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Stat label="Since start" value={pct(run.startUsd, liveUsd)} tone={up ? "up" : "down"}>
            <ValueArea points={[...run.history, ...(now ? [{ t: now, usd: liveUsd }] : [])]} start={run.startUsd} />
          </Stat>
          <Stat label="Trades" value={`${run.trades.length}`} sub={exits.length ? `${wins} of ${exits.length} closed in profit` : "none closed yet"}>
            <ResultBars results={[...exits].reverse().map((trade) => trade.pnlPct ?? 0)} />
          </Stat>
          <Stat label="Last decision" value={lastCheck && now ? ago(now - lastCheck) : "—"} sub={`on the last closed ${run.timeframe ?? ""} candle`}>
            <PriceArea closes={(candles.data ?? []).slice(-30).map((c) => ({ t: c.t, c: c.c }))} />
          </Stat>
        </div>

        {/* every trade, as a table (Oripio) */}
        <section className={`${styles.panel} mt-4 p-5 sm:p-6`}>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Every trade since it went live</h2>
            <span className={`text-xs ${styles.muted}`}>each one on BNB Chain</span>
          </div>
          {run.trades.length === 0 ? (
            <p className={`mt-4 text-sm ${styles.muted}`}>No trades yet. It only buys when its rule says so.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Action</th>
                    <th>Price</th>
                    <th>Size</th>
                    <th>Result</th>
                    <th>Why</th>
                    <th>Proof</th>
                  </tr>
                </thead>
                <tbody>
                  {run.trades.map((trade) => {
                    const buy = trade.kind === "enter" && trade.side === "long";
                    return (
                      <tr className={`${styles.feedItem} ${styles.clickable}`} key={`${trade.at}-${trade.kind}`} onClick={() => setDetail(tradeDetail(trade, run))}>
                        <td className={styles.muted}>{now ? ago(now - trade.at) : ""}</td>
                        <td>
                          <span className="font-semibold" style={{ color: buy ? "#f3c13a" : "#ff5c5c" }}>
                            {trade.kind === "enter" ? (trade.side === "short" ? "Short" : "Buy") : "Sell"}
                          </span>{" "}
                          {trade.market.replace("USDT", "")}
                        </td>
                        <td>{price(trade.price)}</td>
                        <td>{usd(trade.sizeUsd)}</td>
                        <td style={{ color: trade.pnlPct === null ? undefined : trade.pnlPct >= 0 ? "#3ddc84" : "#ff5c5c" }}>
                          {trade.pnlPct === null ? "—" : `${trade.pnlPct >= 0 ? "+" : ""}${trade.pnlPct.toFixed(2)}%`}
                        </td>
                        <td className={`max-w-[320px] truncate ${styles.muted}`}>{trade.reason}</td>
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
        </section>
      </div>
      {detail ? <DetailDrawer detail={detail} onClose={() => setDetail(null)} /> : null}
    </div>
  );
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
    ],
    tx: trade.txHash,
  };
}

/** One decision, in full, with the rule it was checking. */
function thoughtDetail(thought: LiveRunDetail["thoughts"][number], run: LiveRunDetail): Detail {
  return {
    title: /no trade/i.test(thought.text) ? "It decided to wait" : "It decided to act",
    lines: [thought.text, ...run.rules.slice(0, 1).map((rule) => `What it was checking for: ${rule}`)],
    facts: [
      ["When", new Date(thought.t).toLocaleString()],
      ["Market", run.market ?? "—"],
      ["Candles", run.timeframe ?? "—"],
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

function Stat({ label, value, sub, tone, children }: { label: string; value: string; sub?: string; tone?: "up" | "down"; children: React.ReactNode }) {
  return (
    <section className={`${styles.panel} p-5`}>
      <div className="min-w-0">
        <p className={`text-sm ${styles.muted}`}>{label}</p>
        <p className="mt-2 text-2xl font-semibold tabular-nums" style={tone ? { color: tone === "up" ? "#3ddc84" : "#ff5c5c" } : undefined}>
          {value}
        </p>
        {sub ? <p className={`mt-1 truncate text-xs ${styles.muted}`}>{sub}</p> : null}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Candles of the run's own market, with its real buys and sells marked. The newest candle breathes. */
function CandleChart({ candles, trades }: { candles: Candle[]; trades: LiveRunDetail["trades"] }) {
  const W = 900;
  const H = 320;
  const PAD = 56;
  if (candles.length === 0) return <div className="mt-6 h-[320px] animate-pulse rounded-xl bg-white/[0.03]" />;
  const lo = Math.min(...candles.map((c) => c.l));
  const hi = Math.max(...candles.map((c) => c.h));
  const span = Math.max(hi - lo, hi * 0.001);
  const maxV = Math.max(...candles.map((c) => c.v), 1);
  const y = (v: number) => 10 + (1 - (v - lo) / span) * (H - 66);
  const step = (W - PAD) / candles.length;
  const width = Math.max(2, step * 0.62);
  const interval = candles.length > 1 ? candles[1]!.t - candles[0]!.t : 0;
  const marks = trades
    .map((trade) => {
      const index = candles.findIndex((c) => trade.at >= c.t && trade.at < c.t + interval);
      return index < 0 ? null : { index, buy: trade.kind === "enter" && trade.side === "long", price: trade.price };
    })
    .filter((m): m is { index: number; buy: boolean; price: number } => m !== null);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + span * f);
  return (
    <svg className="mt-6 h-[280px] w-full sm:h-[380px] 2xl:h-[460px]" preserveAspectRatio="none" viewBox={`0 0 ${W} ${H}`}>
      {grid.map((v) => (
        <g key={v}>
          <line stroke="rgba(255,255,255,0.05)" x1="0" x2={W - PAD} y1={y(v)} y2={y(v)} />
          <text fill="#6f716b" fontSize="11" x={W - PAD + 8} y={y(v) + 4}>
            {price(v)}
          </text>
        </g>
      ))}
      {candles.map((c, i) => {
        const vh = (c.v / maxV) * 46;
        return <rect fill={c.c >= c.o ? "rgba(61,220,132,0.22)" : "rgba(255,92,92,0.22)"} height={vh} key={`v${c.t}`} width={width} x={i * step + step / 2 - width / 2} y={H - vh} />;
      })}
      {candles.map((c, i) => {
        const cx = i * step + step / 2;
        const green = c.c >= c.o;
        const color = green ? "#3ddc84" : "#ff5c5c";
        const top = y(Math.max(c.o, c.c));
        const bottom = y(Math.min(c.o, c.c));
        return (
          <g className={i === candles.length - 1 ? styles.liveCandle : undefined} key={c.t}>
            <line stroke={color} strokeWidth="1.2" x1={cx} x2={cx} y1={y(c.h)} y2={y(c.l)} />
            <rect fill={color} height={Math.max(1.5, bottom - top)} rx="1" width={width} x={cx - width / 2} y={top} />
          </g>
        );
      })}
      {(() => {
        const lastC = candles[candles.length - 1]!.c;
        const ly = y(lastC);
        return (
          <g className={styles.priceLine}>
            <line stroke="#f3c13a" strokeDasharray="4 5" strokeOpacity="0.7" x1="0" x2={W - PAD} y1={ly} y2={ly} />
            <rect fill="#f3c13a" height="18" rx="4" width={PAD - 4} x={W - PAD + 2} y={ly - 9} />
            <text fill="#0b0c0a" fontSize="11" fontWeight="700" x={W - PAD + 7} y={ly + 4}>
              {price(lastC)}
            </text>
          </g>
        );
      })()}
      {marks.map((m, i) => {
        const cx = m.index * step + step / 2;
        const cy = y(m.price);
        return m.buy ? (
          <g key={i}>
            <path d={`M${cx},${cy + 8} l7,12 l-14,0 z`} fill="#f3c13a" />
            <circle cx={cx} cy={cy} fill="none" r="5" stroke="#f3c13a" strokeWidth="2" />
          </g>
        ) : (
          <g key={i}>
            <path d={`M${cx},${cy - 8} l7,-12 l-14,0 z`} fill="#ff5c5c" />
            <circle cx={cx} cy={cy} fill="none" r="5" stroke="#ff5c5c" strokeWidth="2" />
          </g>
        );
      })}
    </svg>
  );
}

/** The engine's minute clock as a ring that drains toward its next look. */
function Ring({ seconds, alive }: { seconds: number; alive: boolean }) {
  const r = 24;
  const c = 2 * Math.PI * r;
  return (
    <svg className={`${styles.ring} size-16 shrink-0 -rotate-90`} viewBox="0 0 60 60">
      <circle cx="30" cy="30" fill="none" r={r} stroke="rgba(255,255,255,0.08)" strokeWidth="5" />
      <circle
        cx="30"
        cy="30"
        fill="none"
        r={r}
        stroke={alive ? "#f3c13a" : "#3a3c37"}
        strokeDasharray={c}
        strokeDashoffset={alive ? c * (1 - seconds / 60) : c}
        strokeLinecap="round"
        strokeWidth="5"
      />
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
