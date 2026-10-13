"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";

import styles from "@/app/trade/hub.module.css";
import { StartDialog } from "@/app/trade/trade-client";
import { WalletAvatar } from "@/components/wallet-avatar";
import { traderSalesApi, tradersApi, type HubTrader, type MyTrader, type TraderAccess } from "@/convex/api";
import { toast } from "@/store/use-toast-store";
import { useAltanaWallet } from "@/wallet/altana-provider";
import { toUserMessage } from "@/wallet/wallet-errors";
import { useWallet } from "@/wallet/wallet-provider";
import { useWalletSession } from "@/wallet/wallet-session";

/**
 * THE TRADING HUB (owner, 2026-10-13: "what beebots is doing, with the cleanliness of Guild"). Every
 * trader in one place with its record, made by a person (Steady and Bold read as made by the owner,
 * not as a house product), and the visitor's own traders in a sidebar. Each card opens the trader's
 * page, where it can be run in the visitor's own wallet.
 */

type Filter = "all" | "lower" | "higher" | "community";

export function pct(value: number): string {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(1)}%`;
}

export function usd(value: number): string {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}$${Math.abs(value).toFixed(2)}`;
}

export function ago(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

export function creatorLabel(creator: HubTrader["creator"]): string {
  if (creator.name) return creator.name;
  if (creator.handle) return `@${creator.handle}`;
  return `${creator.address.slice(0, 6)}…${creator.address.slice(-4)}`;
}

export function TradeHub() {
  const data = useQuery(tradersApi.traders.hub, {});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const traders = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.traders ?? []).filter((trader) => {
      if (filter === "lower" && trader.risk !== "Lower") return false;
      if (filter === "higher" && trader.risk !== "Higher") return false;
      if (filter === "community" && trader.kind !== "community") return false;
      if (!needle) return true;
      return `${trader.name} ${trader.tagline} ${trader.creator.handle ?? ""} ${trader.market}`.toLowerCase().includes(needle);
    });
  }, [data, query, filter]);

  // Featured is what beat its own year; a house trader that lost money still shows, in its own row, with
  // its record - honesty, but not the shop window (owner's fresh-eyes review, 2026-10-14).
  const yearOf = (trader: HubTrader) => trader.backtest?.find((window) => window.days === 365)?.resultPct ?? null;
  const featured = traders.filter((trader) => trader.kind === "house" && (yearOf(trader) ?? 1) > 0);
  const alsoHouse = traders.filter((trader) => trader.kind === "house" && (yearOf(trader) ?? 1) <= 0);
  const community = traders.filter((trader) => trader.kind === "community" && trader.active);
  const seabed = traders.filter((trader) => trader.kind === "community" && !trader.active);

  return (
    <div className={styles.page}>
      <div className={styles.layout}>
        <main>
          <header className={`${styles.hero} test-dark`}>
            {/* The approved gold-dolphin art (campaign/assets/ART-STYLE.md) in place of the dot grid. */}
            {/* eslint-disable-next-line @next/next/no-img-element -- one static, pre-sized artwork */}
            <img alt="" className={styles.heroArt} src="/home-hero-pod.jpg" />
            <h1 className={styles.heroTitle}>Agents that trade, in the open</h1>
            <p className={styles.heroSub}>Every trader here shows its record, losses included. Run one in your own wallet, on practice money first.</p>
            <label className={styles.search}>
              <svg aria-hidden fill="none" height="16" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" width="16">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input aria-label="Search traders" onChange={(event) => setQuery(event.target.value)} placeholder="Search traders by name, market or maker…" value={query} />
            </label>
          </header>

          <div className={styles.section}>
            <div className={styles.chips} role="group" aria-label="Filter">
              {(
                [
                  ["all", "All traders"],
                  ["lower", "Careful"],
                  ["higher", "Bold"],
                  ["community", "Built by the community"],
                ] as const
              ).map(([value, label]) => (
                <button aria-pressed={filter === value} className={styles.chip} key={value} onClick={() => setFilter(value)} type="button">
                  {label}
                </button>
              ))}
            </div>
          </div>

          {featured.length > 0 || !data ? (
            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>Featured</h2>
              </div>
              <div className={styles.grid}>
                {data ? featured.map((trader) => <TraderCard key={trader.id} trader={trader} />) : [0, 1].map((key) => <div className={`${styles.card} skeleton`} key={key} />)}
              </div>
            </section>
          ) : null}

          {alsoHouse.length > 0 ? (
            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>Also by Serenity</h2>
                <span className={styles.sectionNote}>Lost money over the last 12 months. Here so you can compare.</span>
              </div>
              <div className={styles.grid}>
                {alsoHouse.map((trader) => (
                  <TraderCard key={trader.id} trader={trader} />
                ))}
              </div>
            </section>
          ) : null}

          {filter !== "lower" && filter !== "higher" ? (
            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>Built by the community</h2>
                <Link className={styles.secondary} href="/dolphin?mode=build&new=1">
                  Build a trader
                </Link>
              </div>
              {community.length > 0 ? (
                <div className={styles.grid}>
                  {community.map((trader) => (
                    <TraderCard key={trader.id} trader={trader} />
                  ))}
                </div>
              ) : data ? (
                <div className={styles.empty}>
                  No community traders yet{query ? " match that search" : ""}. <Link href="/test?ref=trade-empty">Test a strategy</Link>, run it, then publish it to be the first.
                </div>
              ) : null}
            </section>
          ) : null}

          {seabed.length > 0 && filter !== "lower" && filter !== "higher" ? (
            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>The seabed</h2>
                <span className={styles.sectionNote}>Stopped by their makers, or quiet for 14 days. Their records stay here.</span>
              </div>
              <div className={styles.grid}>
                {seabed.map((trader) => (
                  <TraderCard key={trader.id} trader={trader} />
                ))}
              </div>
            </section>
          ) : null}

          <p className={styles.note}>Past results don&rsquo;t predict what happens next. Not financial advice.</p>
        </main>

        <YourTraders />
      </div>
    </div>
  );
}

/** Each house trader's scene from the approved art set. */
const TRADER_ART: Record<string, string> = {
  steady: "/test/art-survivor.jpg",
  riptide: "/test/art-assassin.jpg",
  bold: "/test/art-bruised.jpg",
};

function TraderCard({ trader }: { trader: HubTrader }) {
  const year = trader.backtest?.find((window) => window.days === 365) ?? null;
  const quarter = trader.backtest?.find((window) => window.days === 90) ?? null;
  const live = trader.live;
  return (
    <Link className={styles.card} href={`/trade/${encodeURIComponent(trader.id)}`}>
      {TRADER_ART[trader.id] ? <div aria-hidden className={styles.cardArt} style={{ backgroundImage: `url(${TRADER_ART[trader.id]})` }} /> : null}
      <div className={styles.cardTop}>
        <span className={styles.mark}>
          <WalletAvatar address={trader.id} kind="bot" size={36} />
        </span>
        <div className="min-w-0">
          <p className={styles.cardName}>{trader.name}</p>
          <p className={styles.byline}>
            <span className={styles.by}>
              by <WalletAvatar address={trader.creator.address} className="rounded-full" kind="human" size={14} /> <b>{creatorLabel(trader.creator)}</b>
            </span>
          </p>
        </div>
        <span className={styles.tag}>{trader.risk ? `${trader.risk} risk` : live?.paper === false ? "Live" : "Practice"}</span>
      </div>
      <p className={styles.tagline}>{trader.tagline}</p>

      <div className={styles.figure}>
        {year ? (
          <>
            <p className={`${styles.figureBig} ${styles.mono} ${year.resultPct >= 0 ? "pnl-up" : "pnl-down"}`}>{pct(year.resultPct)}</p>
            <p className={styles.figureLabel}>Last 12 months, backtested</p>
            <p className={styles.versus}>
              {year.resultPct > year.holdPct ? (
                <>
                  <b className="pnl-up">{(year.resultPct - year.holdPct).toFixed(1)} points better</b> than holding BNB ({pct(year.holdPct)})
                </>
              ) : (
                <>Holding BNB did {pct(year.holdPct)}</>
              )}
            </p>
          </>
        ) : live && live.closed > 0 && live.resultPct !== null ? (
          <>
            <p className={`${styles.figureBig} ${styles.mono} ${live.resultPct >= 0 ? "pnl-up" : "pnl-down"}`}>{pct(live.resultPct)}</p>
            <p className={styles.figureLabel}>Since it started, {live.paper ? "on practice money" : "real money"}</p>
          </>
        ) : trader.kind === "house" ? (
          <p className={styles.figureLabel}>Checking its record…</p>
        ) : (
          <p className={styles.figureLabel}>No closed trades yet</p>
        )}
      </div>

      <div className={`${styles.stats} ${styles.mono}`}>
        {year ? (
          <>
            <span>
              3 mo <b className={quarter && quarter.resultPct >= 0 ? "pnl-up" : "pnl-down"}>{quarter ? pct(quarter.resultPct) : "–"}</b>
            </span>
            <span>
              <b>{year.trades}</b> trades · <b>{year.winPct ?? 0}%</b> won
            </span>
          </>
        ) : (
          <>
            <span>
              <b>{live?.closed ?? 0}</b> closed
            </span>
            <span>
              <b>{live && live.closed > 0 ? Math.round((live.won / live.closed) * 100) : 0}%</b> won
            </span>
            <span>{trader.priceUsd ? <b>{trader.priceUsd} U</b> : "Free"}</span>
          </>
        )}
      </div>
    </Link>
  );
}

function plain(text: string | null): string | null {
  if (!text) return null;
  if (/^No trade/.test(text)) return "Waiting for its moment";
  if (/^Holding/.test(text)) return "Holding, waiting for its target or stop";
  if (/^Already judged/.test(text)) return null;
  return text.replace(/^Entry rule met: /, "Bought: ").replace(/^Exit rule met: /, "Sold: ");
}

function YourTraders() {
  const session = useWalletSession();
  const mine = useQuery(tradersApi.traders.mine, session.sessionToken ? { sessionToken: session.sessionToken } : "skip");
  return (
    <aside className={styles.side} id="my-traders">
      <h2 className={styles.sideTitle}>Your traders</h2>
      {!session.sessionToken ? (
        <p className={styles.sideMeta}>Sign in with your wallet to see the traders you run.</p>
      ) : !mine ? (
        <p className={styles.sideMeta}>Loading…</p>
      ) : mine.length === 0 ? (
        <p className={styles.sideMeta}>None yet. Pick a trader and start it on practice money.</p>
      ) : (
        <div>
          {mine.map((trader) => (
            <SideRow key={trader.conversationKey} sessionToken={session.sessionToken!} trader={trader} />
          ))}
        </div>
      )}
      <p className={styles.sideFoot}>Each one trades from your own Dolphin Wallet, by fixed rules. Stop any of them whenever you like.</p>
    </aside>
  );
}

function SideRow({ trader, sessionToken }: { trader: MyTrader; sessionToken: string }) {
  const stop = useMutation(tradersApi.traders.stop);
  const arm = useMutation(tradersApi.traders.arm);
  const [busy, setBusy] = useState(false);
  const note = trader.lastError ?? plain(trader.lastReason);
  const toggle = async () => {
    setBusy(true);
    try {
      if (trader.on) await stop({ sessionToken, conversationKey: trader.conversationKey });
      else await arm({ sessionToken, conversationKey: trader.conversationKey });
    } catch (cause) {
      toast.error(toUserMessage(cause, "That did not save."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.sideRow}>
      <div className={styles.sideName}>
        <span className={styles.dot} data-on={trader.on || undefined} />
        <span className="truncate">{trader.name}</span>
        <span className={`${styles.mono} ml-auto ${trader.resultUsd > 0 ? "pnl-up" : trader.resultUsd < 0 ? "pnl-down" : ""}`}>{trader.closed > 0 ? usd(trader.resultUsd) : ""}</span>
      </div>
      <p className={styles.sideMeta}>
        {trader.real ? "Real" : "Practice"} · ${trader.sizeUsd} · {!trader.on ? "stopped" : trader.position ? "holding BNB" : "watching"}
      </p>
      {note ? <p className={styles.sideMeta}>{note}</p> : null}
      <div className={styles.sideActions}>
        <Link className={styles.linkBtn} href={`/dolphin?c=${trader.conversationKey}`}>
          Details
        </Link>
        <button className={styles.linkBtn} disabled={busy} onClick={() => void toggle()} type="button">
          {trader.on ? "Stop" : "Start again"}
        </button>
      </div>
    </div>
  );
}

/** Starting any hub trader: Steady and Bold by id, a community trader by its agent key. */
export function HubStartDialog({ trader, minUsd, onClose }: { trader: HubTrader; minUsd: number; onClose: () => void }) {
  const startHouse = useMutation(tradersApi.traders.start);
  const startAgent = useMutation(tradersApi.traders.startFromAgent);
  const session = useWalletSession();
  const access = useQuery(
    traderSalesApi.traderSales.access,
    trader.kind === "community" ? { agentKey: trader.id, ...(session.sessionToken ? { sessionToken: session.sessionToken } : {}) } : "skip",
  );
  // A priced trader asks for its price first, unless it is yours or already paid for.
  if (trader.kind === "community" && access?.priceU && !access.own && !access.paid) {
    return <PayDialog access={access} onClose={onClose} trader={trader} />;
  }
  return (
    <StartDialog
      begin={(sessionToken, amountUsd, real) =>
        trader.kind === "house"
          ? startHouse({ sessionToken, traderId: trader.id, amountUsd, real, ...(real ? { acknowledge: true } : {}) })
          : startAgent({ sessionToken, agentKey: trader.id, amountUsd, real, ...(real ? { acknowledge: true } : {}) })
      }
      minUsd={minUsd}
      name={trader.name}
      onClose={onClose}
      riskLabel={trader.risk ? `${trader.risk} risk` : "Built by the community"}
    />
  );
}

/**
 * THE PRICE OF A TRADER, PAID ONCE (convex/traderSales.ts). U goes from the buyer's Dolphin Wallet
 * straight to the builder; Dolphin reads the receipt before the Start step appears.
 */
function PayDialog({ trader, access, onClose }: { trader: HubTrader; access: TraderAccess; onClose: () => void }) {
  const session = useWalletSession();
  const wallet = useWallet();
  const dolphin = useAltanaWallet();
  const reserve = useMutation(traderSalesApi.traderSales.reserve);
  const confirm = useAction(traderSalesApi.traderSales.confirm);
  const [busy, setBusy] = useState<string | null>(null);
  const signedIn = Boolean(session.sessionToken);
  const address = dolphin.status === "connected" ? dolphin.address : null;

  const pay = async () => {
    setBusy("Preparing…");
    try {
      const sessionToken = session.sessionToken ?? (await session.signIn());
      if (!sessionToken) return;
      const reserved = await reserve({ sessionToken, agentKey: trader.id });
      setBusy("Confirm with your passkey…");
      const { transactionHash } = await dolphin.payTraderBuilder({
        to: reserved.payTo as `0x${string}`,
        amountRaw: BigInt(reserved.amountRaw),
        agentKey: trader.id,
        agentName: trader.name,
      });
      setBusy("Checking the payment on BNB Chain…");
      await confirm({ sessionToken, purchaseId: reserved.purchaseId, txHash: transactionHash });
      toast.success(`Paid. ${trader.name} is yours to run.`);
      // The access query flips to paid and this dialog becomes the Start step.
    } catch (cause) {
      toast.error(toUserMessage(cause, "The payment did not go through."));
    } finally {
      setBusy(null);
    }
  };

  return createPortal(
    <div aria-labelledby="pay-title" aria-modal className="confirm-scrim" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()} role="dialog">
      <div className="confirm-card trade-dialog">
        <p className="trade-label">Built by {creatorLabel(trader.creator)}</p>
        <h3 className="trade-dialog__title" id="pay-title">
          Run {trader.name} for {access.priceU} U
        </h3>
        <p className="trade-fine">
          Paid once, from your Dolphin Wallet straight to its builder. Then it trades in your own wallet with your own money, practice or real, and its rules stay locked.
        </p>
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
            <span>Your Dolphin Wallet, holding {access.priceU} U and a little BNB for gas</span>
            {address ? <em>Ready</em> : (
              <button disabled={dolphin.isBusy} onClick={() => void dolphin.createWallet().catch((cause) => toast.error(toUserMessage(cause, "Could not create it.")))} type="button">
                Create
              </button>
            )}
          </li>
        </ol>
        <div className="mt-5 flex justify-end gap-2">
          <button className="h-10 rounded-xl border border-line px-4 !text-[13px] font-semibold text-ink" disabled={Boolean(busy)} onClick={onClose} type="button">
            Cancel
          </button>
          <button className="trade-start trade-start--inline" disabled={!signedIn || !address || Boolean(busy)} onClick={() => void pay()} type="button">
            <span>{busy ?? `Pay ${access.priceU} U`}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
