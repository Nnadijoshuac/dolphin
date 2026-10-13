"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import styles from "@/app/trade/hub.module.css";
import { ago, creatorLabel, HubStartDialog, pct } from "@/app/trade/trade-hub";
import { WalletAvatar } from "@/components/wallet-avatar";
import { tradersApi } from "@/convex/api";

/** One trader, laid out like an agent page on Guild's hub: what it does on the left, its facts on the right. */
export function TraderPage({ id }: { id: string }) {
  const trader = useQuery(tradersApi.traders.trader, { id });
  const [starting, setStarting] = useState(false);

  if (trader === undefined) {
    return (
      <div className={styles.page}>
        <div className={styles.narrow}>
          <div className={`${styles.panel} skeleton`} style={{ height: 320 }} />
        </div>
      </div>
    );
  }
  if (trader === null) {
    return (
      <div className={styles.page}>
        <div className={styles.narrow}>
          <p className={styles.crumbs}>
            <Link href="/trade">Trade</Link> / Not found
          </p>
          <div className={styles.empty} style={{ marginTop: 18 }}>
            This trader isn&rsquo;t available any more. <Link href="/trade">See all traders</Link>
          </div>
        </div>
      </div>
    );
  }

  const year = trader.backtest?.find((window) => window.days === 365) ?? null;
  const quarter = trader.backtest?.find((window) => window.days === 90) ?? null;
  const live = trader.live;

  return (
    <div className={styles.page}>
      <div className={styles.narrow}>
        <p className={styles.crumbs}>
          <Link href="/trade">Trade</Link> / {trader.name}
        </p>

        <div className={styles.head}>
          <span className={`${styles.mark} ${styles.headMark}`}>
            <WalletAvatar address={trader.id} kind="bot" size={48} />
          </span>
          <div className="min-w-0">
            <h1 className={styles.headName}>{trader.name}</h1>
            <p className={styles.byline}>
              <span className={styles.by}>
              by <WalletAvatar address={trader.creator.address} className="rounded-full" kind="human" size={14} /> <b>{creatorLabel(trader.creator)}</b>
            </span> · {trader.market.replace("USDT", "")} · {trader.timeframe} candles
            </p>
          </div>
          <div className={styles.headActions}>
            <button className={styles.primary} onClick={() => setStarting(true)} type="button">
              Run it
            </button>
          </div>
        </div>

        <div className={styles.detail}>
          <div>
            <section className={styles.panel}>
              <h2 className={styles.panelTitle}>What it does</h2>
              <p className={styles.lede}>{trader.tagline}</p>
              {trader.desk ? (
                <ul className={styles.rules} style={{ marginTop: 14 }}>
                  <li>Watches: {trader.desk.watches}</li>
                  <li>Buys: {trader.desk.buys}</li>
                  <li>Sells: {trader.desk.sells}</li>
                  <li>Protects you: {trader.desk.protects}</li>
                </ul>
              ) : trader.rules.length > 0 ? (
                <ul className={styles.rules} style={{ marginTop: 14 }}>
                  {trader.rules.map((rule, index) => (
                    <li key={index}>{rule}</li>
                  ))}
                </ul>
              ) : null}
            </section>

            <section className={styles.panel}>
              <h2 className={styles.panelTitle}>Trades</h2>
              {trader.trades.length > 0 ? (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Trade</th>
                      <th>Price</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trader.trades.map((trade, index) => (
                      <tr key={index}>
                        <td className={styles.mono}>{ago(trade.at)}</td>
                        <td>
                          {trade.kind === "enter" ? (trade.side === "long" ? "Bought" : "Shorted") : "Closed"} · ${trade.sizeUsd}
                          {trade.paper ? " · practice" : ""}
                          <div className={styles.reason}>{trade.reason}</div>
                        </td>
                        <td className={styles.mono}>${trade.price.toFixed(2)}</td>
                        <td className={`${styles.mono} ${trade.pnlPct === null ? "" : trade.pnlPct >= 0 ? "pnl-up" : "pnl-down"}`}>
                          {trade.pnlPct === null ? "–" : pct(trade.pnlPct)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : trader.kind === "house" ? (
                <p className={styles.lede}>
                  Its record so far is a backtest on the last year of BNB prices, with fees and gas counted. Trades taken by people running it show in their own Your traders list.
                </p>
              ) : (
                <p className={styles.lede}>No trades yet. It trades only when its rule is met, so quiet weeks are normal.</p>
              )}
            </section>
          </div>

          <aside className={styles.panel}>
            <dl className={styles.facts}>
              {year ? (
                <>
                  <div>
                    <dt>Last 12 months (backtest)</dt>
                    <dd className={`${styles.mono} ${year.resultPct >= 0 ? "pnl-up" : "pnl-down"}`}>{pct(year.resultPct)}</dd>
                  </div>
                  <div>
                    <dt>Last 3 months (backtest)</dt>
                    <dd className={`${styles.mono} ${quarter && quarter.resultPct >= 0 ? "pnl-up" : "pnl-down"}`}>{quarter ? pct(quarter.resultPct) : "–"}</dd>
                  </div>
                  <div>
                    <dt>Holding BNB instead</dt>
                    <dd className={styles.mono}>
                      {pct(year.holdPct)}
                      {year.resultPct > year.holdPct ? <span className="pnl-up"> · {(year.resultPct - year.holdPct).toFixed(1)} pts better</span> : null}
                    </dd>
                  </div>
                  <div>
                    <dt>Trades a year · won</dt>
                    <dd className={styles.mono}>
                      {year.trades} · {year.winPct ?? 0}%
                    </dd>
                  </div>
                  <div>
                    <dt>Worst dip</dt>
                    <dd className={styles.mono}>−{year.worstDropPct.toFixed(1)}%</dd>
                  </div>
                </>
              ) : live ? (
                <>
                  <div>
                    <dt>Result so far</dt>
                    <dd className={`${styles.mono} ${(live.resultPct ?? 0) >= 0 ? "pnl-up" : "pnl-down"}`}>{live.closed > 0 && live.resultPct !== null ? pct(live.resultPct) : "–"}</dd>
                  </div>
                  <div>
                    <dt>Closed trades · won</dt>
                    <dd className={styles.mono}>
                      {live.closed} · {live.closed > 0 ? Math.round((live.won / live.closed) * 100) : 0}%
                    </dd>
                  </div>
                  <div>
                    <dt>Money</dt>
                    <dd>{live.paper === false ? "Real" : "Practice"}</dd>
                  </div>
                  <div>
                    <dt>Last trade</dt>
                    <dd>{live.lastAt ? ago(live.lastAt) : "None yet"}</dd>
                  </div>
                </>
              ) : null}
              <hr />
              <div>
                <dt>Stop loss · target</dt>
                <dd className={styles.mono}>
                  {trader.stopLossPct ? `−${trader.stopLossPct}%` : "–"} · {trader.takeProfitPct ? `+${trader.takeProfitPct}%` : "–"}
                </dd>
              </div>
              <div>
                <dt>To run it</dt>
                <dd>
                  {trader.priceUsd ? `$${trader.priceUsd}` : "Free"} · from ${trader.minUsd}
                </dd>
              </div>
              <div>
                <dt>Made by</dt>
                <dd>{trader.creator.name ?? creatorLabel(trader.creator)}</dd>
              </div>
              <hr />
              <button className={styles.primary} onClick={() => setStarting(true)} type="button">
                Run it in your wallet
              </button>
            </dl>
          </aside>
        </div>

        <p className={styles.note}>Past results don&rsquo;t predict what happens next. Not financial advice.</p>
      </div>
      {starting ? <HubStartDialog minUsd={trader.minUsd} onClose={() => setStarting(false)} trader={trader} /> : null}
    </div>
  );
}
