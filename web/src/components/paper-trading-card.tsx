"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AutoTradeCard } from "@/components/auto-trade-card";
import { ReceiveSheet } from "@/components/receive-sheet";
import { paperTradingApi, strategyApi } from "@/convex/api";
import { useWalletTokens } from "@/hooks/use-wallet-tokens";
import { toast } from "@/store/use-toast-store";
import { useAltanaWallet } from "@/wallet/altana-provider";
import { formatTokenAmount } from "@/wallet/erc8183-policy";

/**
 * PAPER TRADING (convex/paperTrading.ts): pretend money, real prices. On by
 * default, so an agent practises before it touches funds - the mentor
 * review's "paper mode before indicators". Switching to Live brings back
 * tickets and "Trade without asking". Shown only when the agent can trade.
 */

function amount(value: string): string {
  const n = Number(value);
  return n >= 1 ? n.toLocaleString("en", { maximumFractionDigits: 4 }) : n.toPrecision(4);
}

/** Below this much BNB a swap's gas may not be covered: about $0.15, several smart-wallet swaps at 0.05 gwei (measured 2026-10-03). */
const LOW_GAS_WEI = BigInt("200000000000000");

/**
 * WHAT THE DOLPHIN WALLET HAS FOR THIS AGENT (owner, 2026-10-03: "something... for funding the
 * Dolphin Wallet"). Shown only when the agent trades from it: its USDT (what rules buy with) and BNB
 * (gas), a note when either is short, and Add funds - the wallet's own Receive sheet, not a second
 * funding flow. Read in the browser from BNB Chain.
 */
function WalletFunds({ needUsdt }: { needUsdt: number | null }) {
  const dolphin = useAltanaWallet();
  const address = dolphin.status === "connected" ? dolphin.address : null;
  const addresses = useMemo(() => (address ? [address] : []), [address]);
  const tokens = useWalletTokens(addresses);
  const [receiving, setReceiving] = useState(false);
  if (!address) return null;
  const held = tokens.data?.get(address.toLowerCase());
  const usdt = held?.get("USDT");
  const bnb = held?.get("BNB");
  const shortUsdt = needUsdt !== null && usdt !== undefined && usdt < BigInt(Math.round(needUsdt * 100)) * BigInt(10) ** BigInt(16);
  const lowGas = bnb !== undefined && bnb < LOW_GAS_WEI;
  return (
    <div className="mt-2 rounded-lg bg-paper-muted/70 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[11px] text-muted">
          Dolphin Wallet:{" "}
          <span className="font-semibold text-ink">{usdt === undefined ? "…" : `${formatTokenAmount(usdt, 18)} USDT`}</span>
          {" · "}
          <span className="font-semibold text-ink">{bnb === undefined ? "…" : `${formatTokenAmount(bnb, 18)} BNB`}</span>
        </p>
        <button className="shrink-0 !text-[11px] font-semibold text-accent-ink hover:underline" onClick={() => setReceiving(true)} type="button">
          Add funds
        </button>
      </div>
      {shortUsdt ? <p className="mt-1 text-[10.5px] leading-snug text-danger">Each rule trade spends ${needUsdt} of USDT - add USDT before going Live.</p> : null}
      {lowGas ? <p className="mt-1 text-[10.5px] leading-snug text-danger">Low on BNB for gas - add a little BNB (about $0.20 covers several trades).</p> : null}
      {receiving ? <ReceiveSheet address={address} label="Dolphin Wallet" onClose={() => setReceiving(false)} /> : null}
    </div>
  );
}

export function PaperTradingCard({
  conversationKey,
  hasSwap,
  hasRules = false,
  riskDailyUsd = null,
}: {
  conversationKey: string;
  hasSwap: boolean;
  hasRules?: boolean;
  /** A swapping agent's Risk limits per day, for its trade key. */
  riskDailyUsd?: number | null;
}) {
  const trades = hasSwap || hasRules;
  // The same query the Trading rules section runs (Convex shares it): which rules trade from the Dolphin Wallet, and their largest size.
  const ruleView = useQuery(strategyApi.strategy.forConversation, hasRules ? { conversationKey } : "skip");
  const walletRules = (ruleView?.rules ?? []).filter((rule) => rule.venue === "dolphin-wallet");
  const usesWallet = hasSwap || walletRules.length > 0;
  const needUsdt = walletRules.length > 0 ? Math.max(...walletRules.map((rule) => rule.sizeUsd)) : null;
  const state = useQuery(paperTradingApi.paperTrading.forDraft, trades ? { conversationKey } : "skip");
  // The first switch to real money asks first (owner, 2026-10-03), and the server holds to it.
  const [asking, setAsking] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const goLive = (acknowledge: boolean) =>
    void setMode({ conversationKey, paperMode: false, ...(acknowledge ? { acknowledge: true } : {}) })
      .then(() => toast.success("Live. Real trades from now on - paper until then."))
      .catch(() => toast.error("Could not switch to Live."));
  const setMode = useMutation(paperTradingApi.paperTrading.setMode);
  const reset = useMutation(paperTradingApi.paperTrading.reset);
  const move = useMutation(paperTradingApi.paperTrading.move);
  const [moving, setMoving] = useState<"deposit" | "withdraw" | null>(null);
  const [moveUsd, setMoveUsd] = useState("");
  const valuation = useAction(paperTradingApi.paperTrading.valuation);
  const [value, setValue] = useState<{ valueUsd: number | null; startUsd: number } | "loading" | null>(null);
  const [version, setVersion] = useState(0);
  const tradeCount = state?.trades.length ?? 0;
  const moveCount = state?.moves.length ?? 0;

  // Valued at live prices when the account changes or on Refresh - never polled.
  useEffect(() => {
    if (!state?.paperMode) return;
    let live = true;
    valuation({ conversationKey })
      .then((result) => {
        if (live) setValue(result);
      })
      .catch(() => {
        if (live) setValue(null);
      });
    return () => {
      live = false;
    };
  }, [conversationKey, state?.paperMode, tradeCount, moveCount, valuation, version]);

  if (!trades || !state) return null;
  const change = typeof value === "object" && value?.valueUsd != null ? value.valueUsd - value.startUsd : null;

  return (
    <div className="mx-2 mt-2 rounded-xl border border-line bg-paper-strong px-3 py-2.5">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[12.5px] font-semibold text-ink">Trading mode</p>
        <div className="panel-tabs grid grid-cols-2 rounded-full p-[2px]" role="radiogroup" aria-label="Trading mode">
          {([true, false] as const).map((paper) => (
            <button
              aria-checked={state.paperMode === paper}
              className={`rounded-full px-2.5 py-0.5 !text-[11px] font-semibold transition-colors ${
                state.paperMode === paper ? "bg-white text-[#171813] shadow-sm" : "text-muted hover:text-ink"
              }`}
              key={String(paper)}
              onClick={() => {
                if (state.paperMode === paper) return;
                if (paper) return void setMode({ conversationKey, paperMode: true }).catch(() => toast.error("Could not switch the mode."));
                if (state.liveAcknowledged) return goLive(false);
                setAgreed(false);
                setAsking(true);
              }}
              role="radio"
              type="button"
            >
              {/* The label in a span: globals.css repaints button text light in dark mode, which vanished on the white pill. */}
              <span className={state.paperMode === paper ? "text-[#171813]" : undefined}>{paper ? "Paper" : "Live"}</span>
            </button>
          ))}
        </div>
      </div>

      {state.paperMode ? (
        <>
          <p className="mt-1 text-[0.7rem] leading-snug text-muted">
            {hasSwap
              ? "Practice with demo money at real PancakeSwap prices - fees, price impact and gas included. No real funds move."
              : "Practice with demo money at live prices. No real funds move."}
          </p>
          <div className="mt-2 flex items-baseline gap-2">
            <p className="text-[1rem] font-semibold text-ink">
              {value === "loading" || value === null ? "…" : value.valueUsd === null ? "Unpriced" : `$${value.valueUsd.toFixed(2)}`}
            </p>
            {change !== null ? (
              <p className={`text-[0.74rem] font-semibold ${change >= 0 ? "text-success" : "text-danger"}`}>
                {change >= 0 ? "+" : ""}
                {change.toFixed(2)} on ${value !== "loading" && value ? value.startUsd.toLocaleString("en", { maximumFractionDigits: 2 }) : ""} put in
              </p>
            ) : null}
            <button className="ml-auto !text-[0.7rem] font-semibold text-muted hover:text-ink" onClick={() => { setValue("loading"); setVersion((n) => n + 1); }} type="button">
              Refresh
            </button>
          </div>
          {hasSwap ? (
            <p className="mt-1 truncate font-mono text-[0.7rem] text-ink-soft">
              {state.holdings.map((holding) => `${amount(holding.amount)} ${holding.symbol}`).join(" · ")}
            </p>
          ) : null}

          {/* DEMO MONEY (owner, 2026-10-26): add it from nowhere, withdraw it to nowhere - like a broker's demo account. */}
          {moving ? (
            <form
              className="mt-2 flex items-center gap-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                const usd = Number(moveUsd);
                if (!(usd > 0)) return;
                const kind = moving;
                void move({ conversationKey, kind, usd })
                  .then(() => {
                    toast.success(kind === "deposit" ? `Added $${usd.toLocaleString("en")} demo money.` : `Withdrew $${usd.toLocaleString("en")} demo money.`);
                    setMoving(null);
                    setMoveUsd("");
                  })
                  .catch((error: unknown) => toast.error(error instanceof Error ? error.message.replace(/^.*ConvexError:\s*/, "").split("\n")[0] : "Could not move demo money."));
              }}
            >
              <span className="text-[0.74rem] text-muted">$</span>
              <input
                aria-label={moving === "deposit" ? "Demo money to add" : "Demo money to withdraw"}
                autoFocus
                className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-paper px-2 text-[0.8rem] text-ink"
                inputMode="decimal"
                onChange={(event) => setMoveUsd(event.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="1000"
                value={moveUsd}
              />
              <button className="h-8 rounded-lg bg-ink px-3 !text-[0.72rem] font-semibold" type="submit">
                <span className="text-canvas">{moving === "deposit" ? "Add" : "Withdraw"}</span>
              </button>
              <button className="h-8 px-1.5 !text-[0.72rem] font-semibold text-muted hover:text-ink" onClick={() => setMoving(null)} type="button">
                Cancel
              </button>
            </form>
          ) : (
            <div className="mt-2 flex gap-1.5">
              <button className="h-8 flex-1 rounded-lg border border-line !text-[0.72rem] font-semibold text-ink hover:border-line-strong" onClick={() => setMoving("deposit")} type="button">
                Add demo money
              </button>
              <button className="h-8 flex-1 rounded-lg border border-line !text-[0.72rem] font-semibold text-ink hover:border-line-strong" onClick={() => setMoving("withdraw")} type="button">
                Withdraw
              </button>
            </div>
          )}
          {state.moves.length > 0 ? (
            <ul className="mt-2 space-y-0.5">
              {state.moves.slice(0, 3).map((entry) => (
                <li className="truncate text-[0.68rem] text-muted" key={entry.at}>
                  {new Date(entry.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} ·{" "}
                  {entry.kind === "deposit" ? "added" : "withdrew"} ${entry.usd.toLocaleString("en", { maximumFractionDigits: 2 })} demo
                </li>
              ))}
            </ul>
          ) : null}

          {!hasSwap ? null : state.trades.length > 0 ? (
            <ul className="mt-2 space-y-0.5">
              {state.trades.slice(0, 4).map((trade) => (
                <li className="truncate text-[0.68rem] text-muted" key={trade.at}>
                  {new Date(trade.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} · sold{" "}
                  {amount(trade.sellAmount)} {trade.sellSymbol} → {amount(trade.buyAmount)} {trade.buySymbol}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[0.68rem] text-muted">No paper swaps yet. Run the agent to see what it would do.</p>
          )}
          <button
            className="mt-2 !text-[0.7rem] font-semibold text-muted hover:text-ink"
            onClick={() => void reset({ conversationKey }).then(() => toast.success("Paper account reset to $1,000 USDT."))}
            type="button"
          >
            Reset the paper account
          </button>
        </>
      ) : (
        <p className="mt-1 text-[0.7rem] leading-snug text-muted">Live: real orders, with real funds.</p>
      )}

      {usesWallet ? <WalletFunds needUsdt={needUsdt} /> : null}

      {/* Live only: in paper mode nothing real is traded, so no key is offered. */}
      {!state.paperMode && usesWallet ? <AutoTradeCard conversationKey={conversationKey} hasSwap riskDailyUsd={riskDailyUsd} /> : null}

      {asking ? (
        <div aria-labelledby="live-confirm-title" aria-modal className="confirm-scrim" role="dialog">
          <div className="confirm-card">
            <p className="text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-danger">Real money</p>
            <h3 className="mt-1 text-[1.05rem] font-semibold tracking-[-0.01em] text-ink" id="live-confirm-title">
              Trade with real funds?
            </h3>
            <ul className="mt-3 space-y-2 text-[0.82rem] leading-relaxed text-ink-soft">
              <li>This agent will place real orders on its own, from your Binance account or your Dolphin Wallet.</li>
              <li>Every trade it makes - and every gain or loss - is <strong>solely your responsibility</strong>, not Dolphin&rsquo;s.</li>
              <li>Nothing Dolphin or its AI says is financial advice. Markets can move fast and you can lose everything you trade.</li>
            </ul>
            <label className="mt-4 flex items-start gap-2 text-[0.8rem] leading-snug text-ink">
              <input checked={agreed} className="mt-0.5 size-4 accent-[var(--ink)]" onChange={(event) => setAgreed(event.target.checked)} type="checkbox" />
              <span>
                I understand and accept the <Link className="underline" href="/policies/disclaimer" target="_blank">Disclaimer</Link> and the{" "}
                <Link className="underline" href="/policies/risk" target="_blank">Risk Disclosure</Link>.
              </span>
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button className="h-9 rounded-lg border border-line px-4 !text-[13px] font-semibold text-ink" onClick={() => setAsking(false)} type="button">
                Stay on paper
              </button>
              <button
                className="h-9 rounded-lg bg-ink px-4 !text-[13px] font-semibold disabled:opacity-40"
                disabled={!agreed}
                onClick={() => {
                  setAsking(false);
                  goLive(true);
                }}
                type="button"
              >
                <span className="text-canvas">Go live</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
