"use client";

import { useAction, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { LiveBadge, Ticker, ago, dayOf, pct, usd, useSecond } from "@/app/live/live-bits";
import styles from "@/app/live/live.module.css";
import { TokenLogo } from "@/components/brand-mark";
import { useWalletHoldings } from "@/hooks/use-wallet-holdings";
import { liveRunsApi, myAgentsApi, type LiveRunSummary } from "@/convex/api";
import { useWallet } from "@/wallet/wallet-provider";
import { useWalletSession } from "@/wallet/wallet-session";

/**
 * /live: every public run happening now, and the last few that finished (owner, 2026-10-18: "anybody can
 * go on their phone, go to that URL and see what they are watching"). A signed-in builder can make one of
 * their own live agents public from here.
 */
export function LiveIndex() {
  const data = useQuery(liveRunsApi.liveRuns.list, {});
  const now = useSecond();

  return (
    <div className={styles.page}>
      <Ticker />
      <div className={`${styles.desk} mx-auto w-full max-w-[2000px] px-4 pt-8 sm:px-6 xl:px-10`}>
        <header>
          {data?.running.length ? <LiveBadge running /> : null}
          <h1 className={`${styles.title} ${data?.running.length ? "mt-4" : ""}`}>Agents trading live</h1>
          <p className={`mt-2 text-sm ${styles.muted}`}>Real money on BNB Chain, or paper trades at live prices - each says which. Tap one to watch it.</p>
        </header>

        <section className="mt-8">
          {data === undefined ? (
            <div className={`${GRID}`}>
              {[0, 1, 2].map((i) => (
                <div className="skeleton h-48 rounded-2xl" key={i} />
              ))}
            </div>
          ) : data.running.length === 0 ? (
            <Empty />
          ) : (
            <div className={GRID}>
              {data.running.map((run) => (
                <RunCard key={run.slug} now={now} run={run} />
              ))}
            </div>
          )}
        </section>

        <GoLive />

        {data && data.finished.length > 0 ? (
          <section className="mt-10">
            <SectionHead title="Finished" />
            <div className="mt-3 flex flex-col gap-2">
              {data.finished.map((run) => (
                <FinishedRow key={run.slug} now={now} run={run} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

const GRID = "grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4";

function SectionHead({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={styles.cardTitle}>{title}</span>
      {meta ? <span className={`text-[11px] ${styles.muted}`}>{meta}</span> : null}
    </div>
  );
}

/** Nobody is live: say how a run works, so the page still tells a visitor what they would be watching. */
function Empty() {
  const steps = [
    ["1", "It starts with its own wallet", "Whatever the agent holds when its owner goes live is the starting line."],
    ["2", "It trades on its own", "Every decision shows up as it happens, and every trade is on BNB Chain."],
    ["3", "It runs until it runs out", "No finish line and no time limit. It ends at zero, or when its owner stops it."],
  ];
  return (
    <div className={`${styles.panel} mt-3 p-5`}>
      <p className="text-base font-medium">Nobody is live right now.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {steps.map(([n, title, body]) => (
          <div className={`${styles.panel2} p-4`} key={n}>
            <span className={`${styles.chip} text-xs font-semibold ${styles.lime}`}>{n}</span>
            <p className="mt-3 text-sm font-medium">{title}</p>
            <p className={`mt-1 text-[13px] ${styles.muted}`}>{body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A LIVE RUN ON THE LIST, SHORT (owner, 2026-10-19: "a short card is good enough... like Guild, circles
 * overlapping, a little bigger... everything must have a function"). What a visitor needs to choose one:
 * which coins it trades, who it is, what its money is doing, and that it is live. The detail is one tap away.
 */
function RunCard({ run, now }: { run: LiveRunSummary; now: number }) {
  /*
   * THE SAME NUMBER AS THE RUN'S OWN PAGE (owner, 2026-10-26: the card said -1.7% while the page said -2.0%).
   * The card showed the value the backend saves every five minutes; the page reads the wallet live from BNB
   * Chain. A running card now reads it live too, the same way; the saved value is only the fallback.
   */
  const addresses = useMemo(() => (run.status === "running" && !run.paper ? [run.walletAddress] : []), [run.status, run.paper, run.walletAddress]);
  const held = useWalletHoldings(addresses, "USD", false);
  // A paper run has no wallet: its value is the demo account's, saved every five minutes.
  const value = !run.paper && typeof held.headline === "object" ? Number(held.headline.figure.replace(/[^0-9.]/g, "")) : run.lastUsd;
  const up = value >= run.startUsd;
  const markets = run.card?.markets.length ? run.card.markets : run.market ? [run.market] : [];
  const live = run.status === "running";
  return (
    <Link className={`${styles.dpanel} ${styles.runCard} block p-5 no-underline`} href={`/live/${run.slug}`}>
      <div className="flex items-start justify-between gap-3">
        <span className="flex -space-x-4">
          {markets.map((m, i) => (
            <span className={styles.coinBubble} key={m} style={{ zIndex: markets.length - i }}>
              <TokenLogo size={40} symbol={m.replace("USDT", "")} />
            </span>
          ))}
        </span>
        {live ? <span className={styles.blip} /> : null}
      </div>
      <p className="mt-4 truncate text-[18px] font-semibold text-white">{run.name}</p>
      <p className={`text-[12px] ${styles.muted}`}>
        {run.paper ? "Paper trade · " : ""}
        {markets.map((m) => m.replace("USDT", "")).join(" · ")} · Day {now ? dayOf(run.startedAt, now) : 1}
      </p>
      <div className="mt-4 flex items-baseline justify-between gap-3">
        <span className={`${styles.mono} text-[26px] font-semibold leading-none text-white`}>{usd(value)}</span>
        <span className={`${styles.mono} text-[13px] font-semibold`} style={{ color: up ? "#3ddc84" : "#ff5c5c" }}>
          {pct(run.startUsd, value)}
        </span>
      </div>
      <p className={`mt-1 text-[11.5px] ${styles.muted}`}>from {usd(run.startUsd)}</p>
    </Link>
  );
}

/** A finished run: one line - who, which coins, where it ended against where it started. */
function FinishedRow({ run, now }: { run: LiveRunSummary; now: number }) {
  const up = run.lastUsd >= run.startUsd;
  const markets = run.card?.markets.length ? run.card.markets : run.market ? [run.market] : [];
  const hours = Math.max(1, Math.round(((run.endedAt ?? run.lastValuedAt) - run.startedAt) / 3_600_000));
  return (
    <Link className={`${styles.dpanel} flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3.5 no-underline transition-colors hover:border-white/20`} href={`/live/${run.slug}`}>
      <span className="flex -space-x-2">
        {markets.map((m, i) => (
          <span className={styles.coinBubble} key={m} style={{ zIndex: markets.length - i }}>
            <TokenLogo size={18} symbol={m.replace("USDT", "")} />
          </span>
        ))}
      </span>
      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-white">
        {run.name}
        {run.paper ? <span className={`ml-2 text-[12px] font-normal ${styles.muted}`}>Paper</span> : null}
      </span>
      <span className={`${styles.mono} text-[13px] text-[#c9cbc3]`}>
        {usd(run.startUsd)} → {usd(run.lastUsd)}
      </span>
      <span className={`${styles.mono} text-[13px] font-semibold`} style={{ color: up ? "#3ddc84" : "#ff5c5c" }}>
        {pct(run.startUsd, run.lastUsd)}
      </span>
      <span className={`text-[12px] ${styles.muted}`}>
        {run.status === "lost" ? "ran out" : "stopped by its owner"} · {hours}h{now && run.endedAt ? ` · ${ago(now - run.endedAt)}` : ""}
      </span>
    </Link>
  );
}

/** Make one of your own live agents public. Shown only to a signed-in builder with an agent that qualifies. */
function GoLive() {
  const wallet = useWallet();
  const session = useWalletSession();
  const router = useRouter();
  const built = useQuery(myAgentsApi.myAgents.built, wallet.isConnected && session.sessionToken ? { sessionToken: session.sessionToken } : "skip");
  const start = useAction(liveRunsApi.liveRuns.start);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Paper agents too (owner, 2026-10-26: "even somebody that is paper trading can get to go live"): no key, no funding.
  const ready = (built ?? []).filter(
    (agent) => agent.conversationKey && agent.hasRules && agent.autopilotOn && (agent.paperMode || agent.trading?.status === "active"),
  );
  if (!wallet.isConnected || !built || built.length === 0) return null;

  return (
    <section className={`${styles.panel} mt-3 p-5`}>
      <h2 className={styles.cardTitle}>Make your run public</h2>
      <p className={`mt-1 text-sm ${styles.muted}`}>
        Pick an agent. Anyone with the link watches it trade, live. On Paper it trades demo money and says so; on Live, real money.
      </p>
      {ready.length === 0 ? (
        <p className={`mt-4 text-sm ${styles.muted}`}>
          None of your agents can go live yet. An agent needs a trading rule and Autopilot on. On Live it also needs an active trade key.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {ready.map((agent) => (
            <li className={`${styles.panel2} flex items-center justify-between gap-3 px-4 py-3`} key={agent.conversationKey}>
              <span className="min-w-0 truncate text-sm font-medium">
                {agent.name}
                <span className={`ml-2 text-[12px] ${styles.muted}`}>{agent.paperMode ? "Paper" : "Real money"}</span>
              </span>
              {/* Already public (owner, 2026-10-26: The Dip was live and still offered "go live"): link to it. */}
              {agent.liveSlug ? (
                <Link className="shrink-0 rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white no-underline hover:bg-white/5" href={`/live/${agent.liveSlug}`}>
                  Live now ↗
                </Link>
              ) : (
              <button
                className="shrink-0 rounded-full bg-[#f3c13a] px-4 py-2 text-sm font-semibold text-[#171813] disabled:opacity-50"
                disabled={busy !== null || !session.sessionToken}
                onClick={async () => {
                  setBusy(agent.conversationKey);
                  setError(null);
                  try {
                    const { slug } = await start({ sessionToken: session.sessionToken!, conversationKey: agent.conversationKey! });
                    router.push(`/live/${slug}`);
                  } catch (cause) {
                    const data = (cause as { data?: unknown }).data;
                    setError(typeof data === "string" ? data : "That did not start. Try again.");
                    setBusy(null);
                  }
                }}
                type="button"
              >
                {busy === agent.conversationKey ? (agent.paperMode ? "Reading the demo account…" : "Reading the wallet…") : "Go live"}
              </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="mt-3 text-sm text-[#ff5c5c]">{error}</p> : null}
    </section>
  );
}
