"use client";

import type { SetupCard, SetupRuleStats } from "@/convex/api";

/** Shared pieces of the Trading setups pages. Every number is Dolphin's own (convex/setups.ts). */

export function pct(value: number): string {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(1)}%`;
}

const VENUE: Record<string, string> = { "dolphin-wallet": "Dolphin Wallet", "binance-spot": "Binance spot", "binance-futures": "Binance futures", "binance-wallet": "Binance Wallet" };

export function venueLabel(venue: string): string {
  return VENUE[venue] ?? venue;
}

export function seller(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** The backtest line for one rule, or why there is none yet. */
export function StatsLine({ stats }: { stats: SetupRuleStats | undefined }) {
  if (!stats) return <span className="text-muted">Backtest running…</span>;
  if ("error" in stats) return <span className="text-muted">{stats.error}</span>;
  return (
    <span className="setup-stats">
      <b className={stats.resultPct >= 0 ? "setup-up" : "setup-down"}>{pct(stats.resultPct)}</b> on its stake
      <span className="text-muted"> · holding {pct(stats.holdPct)}</span>
      <span className="text-muted">
        {" "}
        · {stats.trades} trades{stats.winPct !== null ? `, ${stats.winPct}% won` : ""}
      </span>
      <span className="text-muted"> · worst drop −${stats.worstDropUsd.toFixed(2)}</span>
    </span>
  );
}

export function statsFor(card: SetupCard, index: number): SetupRuleStats | undefined {
  return card.stats?.rules[index];
}
