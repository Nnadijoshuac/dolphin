"use client";

import { openResult, useLivePrice } from "@/hooks/use-live-price";
import type { TradingRuleView } from "@/convex/api";

/**
 * AN OPEN POSITION, LIVE (owner, 2026-10-04: "the price it is currently at... profit percentage with
 * up arrow... green... down with red... if you should go out now this is the amount of dollar you'll
 * be losing"). The price now, the move since the buy with a triangle, and what selling now would
 * return - after the venue's fee on the sale - in dot-matrix digits that tick as the price moves.
 * Read from the token's pool on BNB Chain every 2 s (hooks/use-live-price.ts). Nothing is shown
 * until a price has been read: no placeholder figure.
 */

/** The venue's fee on the sale, as convex/lib/strategy.ts VENUE_FEE_BPS charges it. */
const SELL_FEE_BPS: Record<TradingRuleView["venue"], number> = { "binance-spot": 10, "binance-futures": 5, "binance-wallet": 10, "dolphin-wallet": 25 };

function money(value: number): string {
  const digits = Math.abs(value) < 1 ? 3 : 2;
  return `${value < 0 ? "−" : "+"}$${Math.abs(value).toFixed(digits)}`;
}

function price(value: number): string {
  return value >= 100 ? value.toFixed(2) : value >= 1 ? value.toFixed(3) : value.toPrecision(4);
}

function Triangle({ up }: { up: boolean }) {
  return (
    <svg aria-hidden className="pnl__arrow" height="10" viewBox="0 0 10 10" width="10">
      <path d={up ? "M5 1 9.5 9h-9z" : "M5 9 .5 1h9z"} fill="currentColor" />
    </svg>
  );
}

type PnlRule = Pick<TradingRuleView, "market" | "venue" | "sizeUsd" | "leverage" | "heldQty"> & { position: TradingRuleView["position"] };

export function LivePnl({ rule, size = "small" }: { rule: PnlRule; size?: "small" | "large" }) {
  const now = useLivePrice(rule.position ? rule.market : null);
  if (!rule.position) return null;
  const base = rule.market.replace(/(USDT|USDC|FDUSD|BUSD|USD1)$/, "");
  const held = rule.heldQty ? `${Number(rule.heldQty)} ${base}` : `$${rule.sizeUsd} of ${base}`;
  if (now === null) {
    return (
      <div className="pnl" data-size={size}>
        <p className="pnl__sub">
          Holding {held} · bought at ${price(rule.position.entryPrice)} · reading the price…
        </p>
      </div>
    );
  }
  const { pct, usd } = openResult(rule.position, now, rule.leverage, rule.sizeUsd, rule.heldQty);
  const qty = rule.heldQty ? Number(rule.heldQty) : rule.sizeUsd / rule.position.entryPrice;
  const afterFee = usd - (qty * now * SELL_FEE_BPS[rule.venue]) / 10_000;
  const tone = pct > 0.0001 ? "up" : pct < -0.0001 ? "down" : "flat";
  return (
    <div className="pnl" data-size={size} data-tone={tone}>
      <div className="pnl__row">
        <div className="pnl__cell">
          <span className="pnl__label">{base} now</span>
          {/* Keyed by the value: each new price replays the tick. */}
          <b className="pnl__digits" key={`p${now}`}>
            {price(now)}
          </b>
        </div>
        <div className="pnl__cell pnl__cell--move">
          <span className="pnl__label">Since entry</span>
          <b className="pnl__digits pnl__tone" key={`m${pct.toFixed(3)}`}>
            {tone === "flat" ? null : <Triangle up={tone === "up"} />}
            {Math.abs(pct).toFixed(2)}%
          </b>
        </div>
        <div className="pnl__cell pnl__cell--usd">
          <span className="pnl__label">{rule.position.side === "short" ? "Close now" : "Sell now"}</span>
          <b className="pnl__digits pnl__own" key={`u${afterFee.toFixed(4)}`} data-tone={afterFee > 0 ? "up" : afterFee < 0 ? "down" : "flat"}>
            {money(afterFee)}
          </b>
        </div>
      </div>
      <p className="pnl__sub">
        Holding {held} · bought at ${price(rule.position.entryPrice)} · after the {SELL_FEE_BPS[rule.venue] / 100}% fee on the sale
      </p>
    </div>
  );
}
