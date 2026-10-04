"use client";

import { useAction, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useState } from "react";
import { createPortal } from "react-dom";

import { LivePnl } from "@/components/live-pnl";
import { strategyApi, type WalletOpenTrade } from "@/convex/api";
import { toast } from "@/store/use-toast-store";
import { useWalletSession } from "@/wallet/wallet-session";

/**
 * THE WALLET'S TRADES TAB (owner, 2026-10-04: "a clean way for people to view their trades... the trade
 * it took and the current performance... and stop the trade mid-way once they feel it is going the wrong
 * way"). Every open position of your agents, live, with Close now; then the latest trades.
 */

function price(value: number): string {
  return value >= 100 ? value.toFixed(2) : value >= 1 ? value.toFixed(3) : value.toPrecision(4);
}

function when(at: number): string {
  const date = new Date(at);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("en", { month: "short", day: "numeric" });
}

export function WalletTrades() {
  const session = useWalletSession();
  const data = useQuery(strategyApi.strategy.myTrades, session.sessionToken ? { sessionToken: session.sessionToken } : "skip");
  const [closing, setClosing] = useState<WalletOpenTrade | null>(null);

  if (!session.sessionToken) {
    return (
      <div className="pw-empty">
        <p>Sign in to see the trades your agents took.</p>
        <button className="mt-2 font-semibold text-ink hover:underline" onClick={() => void session.signIn()} type="button">
          Sign in
        </button>
      </div>
    );
  }
  if (data === undefined) {
    return (
      <div aria-busy="true" className="space-y-2 py-3">
        {[0, 1].map((item) => (
          <div className="skeleton h-28 rounded-xl" key={item} />
        ))}
      </div>
    );
  }
  if (data === null) return <p className="pw-empty">Sign in again to see your trades.</p>;

  return (
    <div className="wtrades">
      <p className="wtrades__head">Open</p>
      {data.open.length === 0 ? (
        <p className="pw-empty">No open trades. When an agent buys, it shows here live - with a button to close it.</p>
      ) : (
        <ul className="wtrades__open">
          {data.open.map((trade) => (
            <li className="wtrades__card" key={`${trade.draftId}-${trade.ruleId}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link className="wtrades__agent" href={`/dolphin?c=${trade.conversationKey}`}>
                    {trade.agentName}
                  </Link>
                  <p className="wtrades__rule">{trade.words}</p>
                </div>
                <span className="wtrades__mode" data-real={trade.real || undefined}>
                  {trade.real ? "Real" : "Paper"}
                </span>
              </div>
              <LivePnl rule={trade} size="small" />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[0.7rem] text-muted">{trade.confirming ? "An order is confirming…" : trade.autopilot ? "Its rule is managing it" : "Autopilot is off - only you can close it"}</span>
                <button className="wtrades__close" disabled={trade.confirming} onClick={() => setClosing(trade)} type="button">
                  <span>{trade.position.side === "short" ? "Close now" : "Sell now"}</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="wtrades__head mt-5">Latest trades</p>
      {data.recent.length === 0 ? (
        <p className="pw-empty">None yet.</p>
      ) : (
        <ol className="wtrades__list">
          {data.recent.map((trade) => (
            <li key={trade.id}>
              <span className="wtrades__when">{when(trade.at)}</span>
              <span className="min-w-0 flex-1">
                <span className="text-ink">
                  {trade.kind === "enter" ? (trade.side === "short" ? "Shorted" : "Bought") : trade.side === "short" ? "Closed" : "Sold"} {trade.market.replace(/USDT$/, "")} at ${price(trade.price)}
                </span>
                <span className="text-muted"> · {trade.agentName}</span>
                <span className="wtrades__reason">{trade.reason}</span>
              </span>
              <span className="wtrades__right">
                {trade.pnlPct !== null ? (
                  <b className={trade.pnlPct >= 0 ? "pnl-up" : "pnl-down"}>
                    {trade.pnlPct >= 0 ? "+" : "−"}
                    {Math.abs(trade.pnlPct).toFixed(2)}%
                  </b>
                ) : (
                  <b>${trade.sizeUsd}</b>
                )}
                <span className="wtrades__mode" data-real={trade.paper === false || undefined}>
                  {trade.paper === false ? "Real" : "Paper"}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
      {closing ? <CloseDialog onClose={() => setClosing(null)} sessionToken={session.sessionToken} trade={closing} /> : null}
    </div>
  );
}

/** One question before a trade is closed: what will happen, in plain words. */
function CloseDialog({ trade, sessionToken, onClose }: { trade: WalletOpenTrade; sessionToken: string; onClose: () => void }) {
  const closeNow = useAction(strategyApi.strategy.closeNow);
  const [busy, setBusy] = useState(false);
  const base = trade.market.replace(/USDT$/, "");
  const amount = trade.heldQty ? `${Number(trade.heldQty)} ${base}` : `the $${trade.sizeUsd} position`;
  const verb = trade.position.side === "short" ? "Close" : "Sell";

  const confirm = async () => {
    setBusy(true);
    try {
      const result = await closeNow({ sessionToken, draftId: trade.draftId, ruleId: trade.ruleId });
      toast.success(`${verb === "Sell" ? "Sold" : "Closed"} at $${price(result.price)} (${result.pnlPct >= 0 ? "+" : ""}${result.pnlPct.toFixed(2)}%)${result.real ? " - a real trade" : " - on paper"}.`);
      onClose();
    } catch (cause) {
      toast.error(cause instanceof ConvexError && typeof cause.data === "string" ? cause.data : "It could not be closed. Try again.");
      setBusy(false);
    }
  };

  return createPortal(
    <div aria-labelledby="close-trade-title" aria-modal className="confirm-scrim" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()} role="dialog">
      <div className="confirm-card">
        <p className={`text-[0.66rem] font-semibold uppercase tracking-[0.08em] ${trade.real ? "text-danger" : "text-muted"}`}>{trade.real ? "Real money" : "Paper"}</p>
        <h3 className="mt-1 text-[1.05rem] font-semibold tracking-[-0.01em] text-ink" id="close-trade-title">
          {verb} {amount} now?
        </h3>
        <p className="mt-2 text-[0.82rem] leading-relaxed text-ink-soft">
          {trade.real
            ? `${trade.agentName} ${verb === "Sell" ? "sells" : "closes"} it at the market price, ${trade.venue === "dolphin-wallet" ? "as a swap from your Dolphin Wallet" : "on Binance"}. The price can move a little before it fills.`
            : "It closes on paper at the current price. No real funds move."}
          {trade.autopilot ? " Its rule stays on and can open a new trade later - turn Autopilot off to stop that too." : ""}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="h-9 rounded-lg border border-line px-4 !text-[13px] font-semibold text-ink" disabled={busy} onClick={onClose} type="button">
            Keep it
          </button>
          <button className="h-9 rounded-lg bg-ink px-4 !text-[13px] font-semibold disabled:opacity-40" disabled={busy} onClick={() => void confirm()} type="button">
            <span className="text-canvas">{busy ? "Closing…" : `${verb} now`}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
