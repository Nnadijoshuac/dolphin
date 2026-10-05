"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { LivePnl } from "@/components/live-pnl";
import { ReceiveSheet } from "@/components/receive-sheet";
import { autotradeApi, tradersApi, type MyTrader, type TraderCard } from "@/convex/api";
import { useWalletTokens } from "@/hooks/use-wallet-tokens";
import { toast } from "@/store/use-toast-store";
import { useAltanaWallet } from "@/wallet/altana-provider";
import { toUserMessage } from "@/wallet/wallet-errors";
import { useWallet } from "@/wallet/wallet-provider";
import { useWalletSession } from "@/wallet/wallet-session";

/**
 * LET AN AGENT TRADE FOR YOU (owner + mentor, 2026-10-05: "trading agents that people can just hire and it
 * trades for them... aggressive and risk-averse"). Two of Dolphin's own traders (convex/lib/traders.ts),
 * started in one dialog: on paper with nothing to fund, or with real money from the person's own Dolphin
 * Wallet behind a capped, expiring trade key. Calm by design: one choice per card, one dialog, one list.
 */

function reason(cause: unknown, fallback: string): string {
  if (cause instanceof ConvexError && typeof cause.data === "string") return cause.data;
  return toUserMessage(cause, fallback);
}

function pct(value: number): string {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(1)}%`;
}

function ago(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

export function TradeClient() {
  const data = useQuery(tradersApi.traders.list, {});
  const refresh = useAction(tradersApi.traders.refreshStats);
  const [starting, setStarting] = useState<TraderCard | null>(null);

  // Re-run the backtest when the stored one is old; the page shows the stored one meanwhile.
  useEffect(() => {
    void refresh({}).catch(() => undefined);
  }, [refresh]);

  return (
    <div className="site-frame page-shell trade-page">
      <header className="trade-hero">
        <p className="trade-label">Trading agents</p>
        <h1>Let an agent trade for you.</h1>
        <p className="trade-lede">
          Pick how careful it should be and how much it can use. It trades BNB from your own wallet, by fixed rules, and you can stop it whenever you like.
        </p>
      </header>

      <div className="trade-cards">
        {(data?.traders ?? [null, null]).map((trader, index) =>
          trader ? <TraderCardView key={trader.id} onStart={() => setStarting(trader)} trader={trader} /> : <div className="skeleton trade-card h-[520px]" key={index} />,
        )}
      </div>
      {data?.statsAt ? (
        <p className="trade-note">
          Past results on BNB, re-checked {ago(data.statsAt)} on Binance price history, with PancakeSwap fees and gas. They don&rsquo;t predict what happens next.
          Not financial advice.
        </p>
      ) : null}

      <MyTraders />

      {starting && data ? <TraderStartDialog minUsd={data.minUsd} onClose={() => setStarting(null)} trader={starting} /> : null}
    </div>
  );
}

function TraderCardView({ trader, onStart }: { trader: TraderCard; onStart: () => void }) {
  const year = trader.backtest?.find((window) => window.days === 365) ?? null;
  const quarter = trader.backtest?.find((window) => window.days === 90) ?? null;
  return (
    <article className="trade-card surface-raised" data-trader={trader.id}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="trade-card__name">{trader.name}</h2>
          <p className="trade-card__tagline">{trader.tagline}</p>
        </div>
        <span className="trade-risk" data-risk={trader.risk}>
          {trader.risk} risk
        </span>
      </div>

      <dl className="trade-desk">
        <div>
          <dt>Watches</dt>
          <dd>{trader.desk.watches}</dd>
        </div>
        <div>
          <dt>Buys</dt>
          <dd>{trader.desk.buys}</dd>
        </div>
        <div>
          <dt>Sells</dt>
          <dd>{trader.desk.sells}</dd>
        </div>
        <div>
          <dt>Protects you</dt>
          <dd>{trader.desk.protects}</dd>
        </div>
      </dl>

      <div className="trade-stats">
        {year ? (
          <>
            <div>
              <p className="trade-stats__label">Last 12 months</p>
              <p className={`trade-stats__big ${year.resultPct >= 0 ? "pnl-up" : "pnl-down"}`}>{pct(year.resultPct)}</p>
              <p className="trade-stats__sub">BNB itself {pct(year.holdPct)}</p>
            </div>
            <div>
              <p className="trade-stats__label">Last 3 months</p>
              <p className={`trade-stats__big ${quarter && quarter.resultPct >= 0 ? "pnl-up" : "pnl-down"}`}>{quarter ? pct(quarter.resultPct) : "…"}</p>
              <p className="trade-stats__sub">{quarter ? `BNB itself ${pct(quarter.holdPct)}` : ""}</p>
            </div>
            <div>
              <p className="trade-stats__label">Trades a year</p>
              <p className="trade-stats__big">{year.trades}</p>
              <p className="trade-stats__sub">{year.winPct !== null ? `${year.winPct}% won` : ""}</p>
            </div>
            <div>
              <p className="trade-stats__label">Worst dip</p>
              <p className="trade-stats__big">−{year.worstDropPct.toFixed(1)}%</p>
              <p className="trade-stats__sub">of what it trades</p>
            </div>
          </>
        ) : (
          <p className="trade-stats__pending">Checking its past results on BNB…</p>
        )}
      </div>

      <button className="trade-start" onClick={onStart} type="button">
        <span>Start {trader.name}</span>
      </button>
    </article>
  );
}

/* ── Starting one: amount, paper or real, and the few steps real money needs ── */

const LOW_GAS_WEI = BigInt("200000000000000");

function TraderStartDialog({ trader, minUsd, onClose }: { trader: TraderCard; minUsd: number; onClose: () => void }) {
  const start = useMutation(tradersApi.traders.start);
  return (
    <StartDialog
      begin={(sessionToken, amountUsd, real) => start({ sessionToken, traderId: trader.id, amountUsd, real, ...(real ? { acknowledge: true } : {}) })}
      minUsd={minUsd}
      name={trader.name}
      onClose={onClose}
      riskLabel={`${trader.risk} risk`}
    />
  );
}

/**
 * STARTING A TRADER, anywhere (owner, 2026-10-05: "Hire = it runs in your own wallet"): Steady and Bold
 * here, and any trading agent built on Dolphin from its agent page. `begin` makes the agent; this dialog
 * does the rest - paper at once, or real money behind the terms, a Dolphin Wallet, funds and a trade key.
 */
export function StartDialog({
  name,
  riskLabel,
  minUsd,
  begin,
  onClose,
}: {
  name: string;
  riskLabel: string;
  minUsd: number;
  begin: (sessionToken: string, amountUsd: number, real: boolean) => Promise<{ conversationKey: string }>;
  onClose: () => void;
}) {
  const router = useRouter();
  const session = useWalletSession();
  const wallet = useWallet();
  const dolphin = useAltanaWallet();
  const arm = useMutation(tradersApi.traders.arm);
  const prepare = useAction(autotradeApi.autotrade.prepare);
  const confirmGrant = useMutation(autotradeApi.autotrade.confirmGrant);
  const [amount, setAmount] = useState(String(minUsd));
  const [real, setReal] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(false);
  const amountUsd = Number(amount);
  const amountOk = Number.isFinite(amountUsd) && amountUsd >= minUsd;

  const address = dolphin.status === "connected" ? dolphin.address : null;
  const addresses = useMemo(() => (address ? [address] : []), [address]);
  const tokens = useWalletTokens(addresses);
  const held = address ? tokens.data?.get(address.toLowerCase()) : undefined;
  const usdt = held?.get("USDT");
  const bnb = held?.get("BNB");
  const enoughUsdt = usdt !== undefined && amountOk && usdt >= BigInt(Math.round(amountUsd * 100)) * BigInt(10) ** BigInt(16);
  const enoughGas = bnb !== undefined && bnb >= LOW_GAS_WEI;

  const signedIn = Boolean(session.sessionToken);
  const ready = amountOk && (!real || (signedIn && Boolean(address) && enoughUsdt && enoughGas && agreed));

  const go = async () => {
    setBusy("Starting…");
    try {
      const sessionToken = session.sessionToken ?? (await session.signIn());
      if (!sessionToken) return;
      const { conversationKey } = await begin(sessionToken, amountUsd, real);
      if (real && address) {
        setBusy("Approve with your passkey…");
        const prepared = await prepare({ sessionToken, conversationKey, altanaWalletAddress: address, durationDays: 7 });
        const transactionHash = await dolphin.grantAgentTradeKey(prepared);
        await confirmGrant({ sessionToken, keyId: prepared.keyId, transactionHash });
        await arm({ sessionToken, conversationKey });
      }
      toast.success(real ? `${name} is trading with $${amountUsd}. Follow it under Your traders.` : `${name} started on paper with $${amountUsd} of pretend money.`);
      onClose();
      const list = document.getElementById("my-traders");
      if (list) list.scrollIntoView({ behavior: "smooth" });
      else router.push("/trade#my-traders");
    } catch (cause) {
      toast.error(reason(cause, "It could not start. Nothing was charged."));
    } finally {
      setBusy(null);
    }
  };

  return createPortal(
    <div aria-labelledby="start-title" aria-modal className="confirm-scrim" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()} role="dialog">
      <div className="confirm-card trade-dialog">
        <p className="trade-label">{riskLabel}</p>
        <h3 className="trade-dialog__title" id="start-title">
          Start {name}
        </h3>

        <label className="trade-amount">
          <span>How much can it trade with?</span>
          <span className="trade-amount__box">
            $
            <input inputMode="decimal" onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))} value={amount} />
          </span>
        </label>
        {!amountOk ? <p className="trade-warn">At least ${minUsd}: below that, fees eat most of each trade.</p> : null}

        <div className="trade-mode" role="radiogroup">
          <button aria-checked={!real} onClick={() => setReal(false)} role="radio" type="button">
            <b>Practice first</b>
            <span>Pretend money at real prices. Nothing to fund.</span>
          </button>
          <button aria-checked={real} onClick={() => setReal(true)} role="radio" type="button">
            <b>Real money</b>
            <span>Trades from your own Dolphin Wallet.</span>
          </button>
        </div>

        {real ? (
          <ol className="trade-steps">
            <li data-done={signedIn || undefined}>
              <span>Sign in with your wallet</span>
              {signedIn ? <em>Done</em> : wallet.isConnected ? (
                <button onClick={() => void session.signIn()} type="button">Sign in</button>
              ) : (
                <button onClick={() => void wallet.connect()} type="button">Connect</button>
              )}
            </li>
            <li data-done={address ? true : undefined}>
              <span>Your Dolphin Wallet (the trader uses only this)</span>
              {address ? <em>Ready</em> : (
                <button disabled={dolphin.isBusy} onClick={() => void dolphin.createWallet().catch((cause) => toast.error(reason(cause, "Could not create it.")))} type="button">
                  {dolphin.isBusy ? "Creating…" : "Create with passkey"}
                </button>
              )}
            </li>
            <li data-done={(enoughUsdt && enoughGas) || undefined}>
              <span>
                ${amountOk ? amountUsd : minUsd} of USDT, plus a little BNB for fees
                {address && usdt !== undefined && !enoughUsdt ? <small> · you have {(Number(usdt) / 1e18).toFixed(2)} USDT</small> : null}
                {address && bnb !== undefined && !enoughGas ? <small> · add about $0.20 of BNB</small> : null}
              </span>
              {enoughUsdt && enoughGas ? <em>Ready</em> : address ? (
                <button onClick={() => setReceiving(true)} type="button">Add funds</button>
              ) : null}
            </li>
            <li data-done={agreed || undefined}>
              <label className="flex items-start gap-2">
                <input checked={agreed} className="mt-0.5 size-4 accent-[var(--ink)]" onChange={(event) => setAgreed(event.target.checked)} type="checkbox" />
                <span>
                  I understand it trades real money on its own, I can lose some or all of it, and every trade is my own responsibility (
                  <Link className="underline" href="/policies/risk" target="_blank">risks</Link>).
                </span>
              </label>
            </li>
          </ol>
        ) : null}

        <p className="trade-fine">
          {real
            ? "Your passkey gives it a trade key for 7 days, capped to this amount. It can only swap on PancakeSwap. Stop it any time."
            : "You can switch to real money later by starting it again."}
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button className="h-10 rounded-xl border border-line px-4 !text-[13px] font-semibold text-ink" disabled={Boolean(busy)} onClick={onClose} type="button">
            Cancel
          </button>
          <button className="trade-start trade-start--inline" disabled={!ready || Boolean(busy)} onClick={() => void go()} type="button">
            <span>{busy ?? (real ? `Start with $${amountOk ? amountUsd : minUsd}` : "Start practising")}</span>
          </button>
        </div>
      </div>
      {receiving && address ? <ReceiveSheet address={address} label="Dolphin Wallet" onClose={() => setReceiving(false)} /> : null}
    </div>,
    document.body,
  );
}

/* ── The traders this wallet started ── */

function MyTraders() {
  const session = useWalletSession();
  const mine = useQuery(tradersApi.traders.mine, session.sessionToken ? { sessionToken: session.sessionToken } : "skip");
  if (!session.sessionToken || !mine || mine.length === 0) return null;
  return (
    <section className="trade-mine" id="my-traders">
      <h2>Your traders</h2>
      <ul>
        {mine.map((trader) => (
          <MyTraderRow key={trader.conversationKey} sessionToken={session.sessionToken!} trader={trader} />
        ))}
      </ul>
    </section>
  );
}

function plainReason(text: string | null): string | null {
  if (!text) return null;
  if (/^No trade/.test(text)) return "Waiting for its moment.";
  if (/^Holding/.test(text)) return "Holding, waiting to sell at its target or stop.";
  if (/^Already judged/.test(text)) return null;
  return text.replace(/^Entry rule met: /, "Bought because ").replace(/^Exit rule met: /, "Sold because ");
}

function MyTraderRow({ trader, sessionToken }: { trader: MyTrader; sessionToken: string }) {
  const stop = useMutation(tradersApi.traders.stop);
  const arm = useMutation(tradersApi.traders.arm);
  const [busy, setBusy] = useState(false);
  const status = !trader.on ? "Stopped" : trader.position ? "Holding BNB" : "Watching BNB";
  const note = trader.lastError ?? plainReason(trader.lastReason);
  const toggle = async () => {
    setBusy(true);
    try {
      if (trader.on) await stop({ sessionToken, conversationKey: trader.conversationKey });
      else await arm({ sessionToken, conversationKey: trader.conversationKey });
    } catch (cause) {
      toast.error(reason(cause, "That did not save."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="trade-mine__row surface-raised">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-[1rem] text-ink">{trader.name}</b>
        <span className="trade-pill" data-real={trader.real || undefined}>
          {trader.real ? "Real" : "Practice"}
        </span>
        <span className="text-[0.82rem] text-muted">
          ${trader.sizeUsd} · started {ago(trader.startedAt)}
        </span>
        <span className="ml-auto text-[0.82rem] font-semibold" data-on={trader.on || undefined}>
          <span aria-hidden className={`mr-1.5 inline-block size-2 rounded-full ${trader.on ? "bg-success" : "bg-line-strong"}`} />
          {status}
        </span>
      </div>
      <LivePnl rule={trader} size="small" />
      {note ? <p className="trade-mine__note">{note}</p> : null}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[0.82rem]">
        <span className="text-muted">
          {trader.closed === 0 ? "No closed trades yet" : `${trader.closed} closed, ${trader.won} won · `}
          {trader.closed > 0 ? <b className={trader.resultUsd >= 0 ? "pnl-up" : "pnl-down"}>{`${trader.resultUsd >= 0 ? "+" : "−"}$${Math.abs(trader.resultUsd).toFixed(2)}`}</b> : null}
        </span>
        <span className="ml-auto flex gap-2">
          {trader.position && trader.real ? (
            <Link className="trade-link" href="/wallet">
              Sell now
            </Link>
          ) : null}
          <Link className="trade-link" href={`/dolphin?c=${trader.conversationKey}`}>
            Details
          </Link>
          <button className="trade-link" disabled={busy} onClick={() => void toggle()} type="button">
            {trader.on ? "Stop" : "Start again"}
          </button>
        </span>
      </div>
    </li>
  );
}
