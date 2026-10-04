"use client";

import { useQuery } from "convex/react";
import Link from "next/link";

import { pct, seller, statsFor, StatsLine, venueLabel } from "@/app/setups/setup-parts";
import { setupsApi } from "@/convex/api";

/**
 * TRADING SETUPS (owner, 2026-10-04: "a new category... sell your whole setup"). Whole trading
 * agents builders have listed: what each trades, its limits, and a backtest Dolphin ran itself. A copy
 * trades the buyer's own money; its strategy stays locked.
 */
export function SetupsClient() {
  const setups = useQuery(setupsApi.setups.list, {});
  return (
    <div className="site-frame page-shell">
      <header className="setups-head">
        <p className="eyebrow">Marketplace</p>
        <h1>Trading setups</h1>
        <p className="setups-lede">
          Whole trading agents, built on Dolphin. Copy one into your own agents - it trades your own money from your own wallet, starts on paper,
          and its strategy stays locked to its builder.
        </p>
      </header>

      {setups === undefined ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((item) => (
            <div className="skeleton h-40 rounded-2xl" key={item} />
          ))}
        </div>
      ) : setups.length === 0 ? (
        <div className="surface-raised setups-empty">
          <p className="font-semibold text-ink">No setups listed yet</p>
          <p className="mt-1 text-[0.86rem] text-muted">Build a trading agent, then choose &ldquo;List as a setup&rdquo; under its Trading rules.</p>
          <Link className="mt-3 inline-block font-semibold" href="/dolphin">
            Build one
          </Link>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {setups.map((setup) => {
            const first = statsFor(setup, 0);
            return (
              <Link className="surface-raised setup-card no-underline" href={`/setups/${setup.id}`} key={setup.id}>
                <div className="flex items-start justify-between gap-3">
                  <h2 className="setup-card__title">{setup.title}</h2>
                  {first && !("error" in first) ? (
                    <span className={`setup-card__result ${first.resultPct >= 0 ? "setup-up" : "setup-down"}`}>{pct(first.resultPct)}</span>
                  ) : null}
                </div>
                {setup.summary ? <p className="setup-card__summary">{setup.summary}</p> : null}
                <ul className="setup-card__rules">
                  {setup.rules.map((rule, index) => (
                    <li key={index}>
                      <span className="setup-chip">{rule.market.replace(/USDT$/, "")}</span>
                      <span className="setup-chip">{rule.timeframe}</span>
                      <span className="setup-chip">{venueLabel(rule.venue)}</span>
                      {rule.stopLossPct !== null ? <span className="setup-chip">stop {rule.stopLossPct}%</span> : null}
                      {rule.takeProfitPct !== null ? <span className="setup-chip">target {rule.takeProfitPct}%</span> : null}
                    </li>
                  ))}
                </ul>
                <p className="setup-card__foot">
                  <StatsLine stats={first} />
                </p>
                <p className="setup-card__meta">
                  By {seller(setup.seller)} · {setup.copies} {setup.copies === 1 ? "copy" : "copies"}
                </p>
              </Link>
            );
          })}
        </div>
      )}
      <p className="setups-note">
        Backtests replay each rule on Binance&rsquo;s history with its fees; slippage and funding are not included. Past results don&rsquo;t predict
        future ones.
      </p>
    </div>
  );
}
