"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useMemo } from "react";

import { Heartbeat, LiveBadge, Track, ago, dayOf, pct, usd, useSecond } from "@/app/live/live-bits";
import styles from "@/app/live/live.module.css";
import { RollingFigure } from "@/components/rolling-figure";
import { liveRunsApi, type LiveRunDetail } from "@/convex/api";
import { useWalletHoldings } from "@/hooks/use-wallet-holdings";
import { useWallet } from "@/wallet/wallet-provider";
import { useWalletSession } from "@/wallet/wallet-session";

/**
 * /live/<slug>: one public run, as it happens. The balance is read from the chain in the viewer's browser
 * (and every 5 minutes by Dolphin), the heartbeat follows the engine's own last check, and the feed is
 * the engine's own words. Nothing on this page is decoration over a stale number.
 */
export function LiveRun({ slug }: { slug: string }) {
  const run = useQuery(liveRunsApi.liveRuns.get, { slug });
  const now = useSecond();

  if (run === undefined) return <div className={`test-dark ${styles.page}`}><div className="site-frame"><div className="skeleton h-96 rounded-[22px]" /></div></div>;
  if (run === null) {
    return (
      <div className={`test-dark ${styles.page}`}>
        <div className="site-frame text-center">
          <p className="text-muted">No run with that link.</p>
          <Link className="mt-4 inline-block text-[#f3c13a]" href="/live">See who is live</Link>
        </div>
      </div>
    );
  }
  return <RunView now={now} run={run} />;
}

function RunView({ run, now }: { run: LiveRunDetail; now: number }) {
  const running = run.status === "running";
  // The wallet read live in this browser; Dolphin's last 5-minute reading until it lands.
  const addresses = useMemo(() => [run.walletAddress], [run.walletAddress]);
  const held = useWalletHoldings(addresses, "USD", false);
  const liveFigure = typeof held.headline === "object" ? held.headline.figure : usd(run.lastUsd);
  const liveUsd = typeof held.headline === "object" ? Number(held.headline.figure.replace(/[^0-9.]/g, "")) : run.lastUsd;
  const lastCheck = Math.max(0, ...run.engine.map((row) => row.lastCheckedAt));
  // Alive while the engine's minute clock keeps booking the next look (it looks every minute).
  const alive = running && run.watching && now > 0 && run.nextLookAt !== null && run.nextLookAt > now - 120_000;
  const nextIn = alive && run.nextLookAt ? Math.max(0, Math.round((run.nextLookAt - now) / 1000)) : null;
  const position = run.engine.find((row) => row.position)?.position ?? null;
  const up = liveUsd >= run.startUsd;
  const latestThought = run.engine.find((row) => row.reason)?.reason ?? null;

  return (
    <div className={`test-dark ${styles.page}`}>
      <div className="site-frame">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link className="text-sm text-muted no-underline hover:text-ink" href="/live">← All live runs</Link>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted">{running ? `Day ${now ? dayOf(run.startedAt, now) : 1}` : ""}</span>
            <LiveBadge running={running} />
          </div>
        </div>

        {/* The money. */}
        <section className={`${styles.card} relative mt-6 overflow-hidden p-6 sm:p-10`}>
          {running ? <div className={styles.scan} /> : null}
          <p className="text-sm text-muted">
            {run.name} · {run.market ?? "—"}
            {run.timeframe ? ` · ${run.timeframe} candles` : ""}
          </p>
          <div className={`${styles.balance} mt-3 text-ink`}>
            <RollingFigure value={liveFigure} />
          </div>
          <p className={`mt-2 text-lg font-semibold ${up ? "text-[#3ddc97]" : "text-[#ff6b6b]"}`}>
            {pct(run.startUsd, liveUsd)} <span className="text-sm font-normal text-muted">since it started with {usd(run.startUsd)}</span>
          </p>
          <div className="mt-8">
            <Track now={liveUsd} start={run.startUsd} target={run.targetUsd} />
            <div className="mt-2 flex justify-between text-xs text-muted">
              <span>$0, it&apos;s over</span>
              <span>${run.targetUsd}, it wins</span>
            </div>
          </div>
          {!running ? (
            <p className="mt-6 text-xl font-bold text-ink">
              {run.status === "won" ? `It made it to $${run.targetUsd}.` : run.status === "lost" ? "It went to zero." : "Its owner ended the run."}
            </p>
          ) : null}
        </section>

        {/* The pulse. */}
        <section className={`${styles.card} mt-4 p-5`}>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-ink">
              {position ? `Holding a ${position.side} from ${position.entryPrice.toPrecision(6)}` : "Not holding anything. Watching for its entry."}
            </span>
            <span className="tabular-nums text-muted">
              {alive ? `looks at the market every minute · next look in ${nextIn}s` : running ? "not watching right now" : "run over"}
            </span>
          </div>
          <div className="mt-3">
            <Heartbeat alive={alive} />
          </div>
          {latestThought ? (
            <p className="mt-3 text-[15px] text-ink-soft">
              “{latestThought}”
              {lastCheck ? <span className="ml-2 text-xs text-muted">decided {ago(now - lastCheck)}, on the last closed {run.timeframe ?? ""} candle</span> : null}
            </p>
          ) : null}
        </section>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <section className={`${styles.card} p-5`}>
            <h2 className="text-sm font-semibold text-muted">The money over time</h2>
            <ValueChart history={run.history} liveUsd={liveUsd} start={run.startUsd} />
          </section>
          <section className={`${styles.card} p-5`}>
            <h2 className="text-sm font-semibold text-muted">What it&apos;s thinking</h2>
            <ul className="mt-3 flex max-h-[360px] flex-col gap-3 overflow-y-auto">
              {run.thoughts.length === 0 ? <li className="text-sm text-muted">Its thoughts show up here as it checks the market.</li> : null}
              {run.thoughts.map((thought) => (
                <li className={`${styles.feedItem} text-sm`} key={`${thought.t}-${thought.text}`}>
                  <span className="text-xs text-muted">{now ? ago(now - thought.t) : ""}</span>
                  <p className="text-ink-soft">{thought.text}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className={`${styles.card} mt-4 p-5`}>
          <h2 className="text-sm font-semibold text-muted">Every trade since it went live</h2>
          {run.trades.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No trades yet. It only buys when its rule says so.</p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--line)]">
              {run.trades.map((trade) => (
                <li className={`${styles.feedItem} flex flex-wrap items-start justify-between gap-3 py-3`} key={`${trade.at}-${trade.kind}`}>
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">
                      {trade.kind === "enter" ? (trade.side === "short" ? "Shorted" : "Bought") : "Sold"} {trade.market} at {trade.price.toPrecision(6)}
                      {trade.pnlPct !== null ? (
                        <span className={trade.pnlPct >= 0 ? "text-[#3ddc97]" : "text-[#ff6b6b]"}> {trade.pnlPct >= 0 ? "+" : ""}{trade.pnlPct.toFixed(2)}%</span>
                      ) : null}
                      {trade.paper ? <span className="ml-2 text-xs font-normal text-muted">practice</span> : null}
                    </p>
                    <p className="text-sm text-muted">{trade.reason}</p>
                  </div>
                  <div className="shrink-0 text-right text-xs text-muted">
                    <div>{usd(trade.sizeUsd)} · {now ? ago(now - trade.at) : ""}</div>
                    {trade.txHash ? (
                      <a className="text-[#f3c13a]" href={`https://bscscan.com/tx/${trade.txHash}`} rel="noreferrer" target="_blank">
                        BscScan ↗
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={`${styles.card} mt-4 p-5`}>
          <h2 className="text-sm font-semibold text-muted">Its rules</h2>
          <ul className="mt-2 list-disc pl-5 text-sm text-ink-soft">
            {run.rules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">
            Wallet{" "}
            <a className="text-ink-soft" href={`https://bscscan.com/address/${run.walletAddress}`} rel="noreferrer" target="_blank">
              {run.walletAddress.slice(0, 6)}…{run.walletAddress.slice(-4)} ↗
            </a>
            . Not financial advice.
          </p>
          <OwnerEnd run={run} />
        </section>
      </div>
    </div>
  );
}

function ValueChart({ history, liveUsd, start }: { history: { t: number; usd: number }[]; liveUsd: number; start: number }) {
  const points = history.length ? [...history.map((p) => p.usd), liveUsd] : [start, liveUsd];
  const W = 600;
  const H = 200;
  const min = Math.min(...points, start) * 0.97;
  const max = Math.max(...points, start) * 1.03;
  const x = (i: number) => (i / Math.max(1, points.length - 1)) * W;
  const y = (v: number) => H - ((v - min) / Math.max(0.01, max - min)) * H;
  const line = points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const up = liveUsd >= start;
  const color = up ? "#3ddc97" : "#ff6b6b";
  return (
    <svg className="mt-3 h-[200px] w-full" preserveAspectRatio="none" viewBox={`0 0 ${W} ${H}`}>
      <defs>
        <linearGradient id="vfill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line stroke="rgba(244,243,236,0.18)" strokeDasharray="4 6" vectorEffect="non-scaling-stroke" x1="0" x2={W} y1={y(start)} y2={y(start)} />
      <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#vfill)" />
      <path d={line} fill="none" stroke={color} strokeWidth="2.5" style={{ filter: `drop-shadow(0 0 6px ${color})` }} vectorEffect="non-scaling-stroke" />
      <circle cx={x(points.length - 1)} cy={y(liveUsd)} fill="#fff" r="4" stroke={color} strokeWidth="3" />
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
      className="mt-4 rounded-full border border-[var(--line-strong)] px-4 py-2 text-sm text-muted hover:text-ink"
      onClick={() => {
        if (window.confirm("End this public run? The agent itself keeps running.")) void end({ sessionToken: session.sessionToken!, slug: run.slug });
      }}
      type="button"
    >
      End the public run
    </button>
  );
}
