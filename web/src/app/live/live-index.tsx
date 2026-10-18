"use client";

import { useAction, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { LiveBadge, Ticker, dayOf, pct, usd, useSecond } from "@/app/live/live-bits";
import styles from "@/app/live/live.module.css";
import { TokenLogo } from "@/components/brand-mark";
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
      <div className="mx-auto w-full max-w-[2000px] px-4 pt-8 sm:px-6 xl:px-10">
        <header className="flex flex-wrap items-end justify-between gap-6">
          <div>
            {data?.running.length ? <LiveBadge running /> : null}
            <h1 className={`${styles.title} ${data?.running.length ? "mt-4" : ""}`}>Agents trading real money, live</h1>
            <p className={`mt-2 max-w-xl text-sm ${styles.muted}`}>
              Each one starts with what is in its wallet and trades it in the open until it runs out or its owner stops it. Every trade is on BNB Chain.
            </p>
          </div>
          {data ? (
            <div className="flex flex-wrap gap-5">
              <Kpi label="Live now" value={String(data.running.length)} />
              <Kpi label="Finished" value={String(data.finished.length)} />
            </div>
          ) : null}
        </header>

        <section className="mt-8">
          <SectionHead meta={data?.running.length ? "tap one to watch" : undefined} title="Live now" />
          {data === undefined ? (
            <div className={`mt-3 ${GRID}`}>
              {[0, 1, 2].map((i) => (
                <div className="skeleton h-56 rounded-2xl" key={i} />
              ))}
            </div>
          ) : data.running.length === 0 ? (
            <Empty />
          ) : (
            <div className={`mt-3 ${GRID}`}>
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
            <div className={`mt-3 ${GRID}`}>
              {data.finished.map((run) => (
                <RunCard key={run.slug} now={now} run={run} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

const GRID = "grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4";

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.kpi}>
      <span className={`text-xs ${styles.muted}`}>{label}</span>
      <span className="text-lg font-medium tabular-nums">{value}</span>
    </div>
  );
}

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

function RunCard({ run, now }: { run: LiveRunSummary; now: number }) {
  const up = run.lastUsd >= run.startUsd;
  const base = (run.market ?? "").replace("USDT", "");
  const status =
    run.status === "running" ? `Day ${now ? dayOf(run.startedAt, now) : 1}` : run.status === "lost" ? "Ran out" : "Ended";
  return (
    <Link className={`${styles.card} p-5 no-underline`} href={`/live/${run.slug}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={styles.chip}>{base ? <TokenLogo size={18} symbol={base} /> : null}</span>
          <div className="min-w-0">
            <p className={`${styles.cardTitle} truncate`}>{run.name}</p>
            <p className={`text-[11px] ${styles.muted}`}>{run.market?.replace("USDT", "/USDT") ?? "—"}</p>
          </div>
        </div>
        {run.status === "running" ? <LiveBadge running /> : <span className={`shrink-0 text-xs ${styles.muted}`}>{status}</span>}
      </div>
      <div className="mt-6 flex items-baseline gap-3">
        <span className="text-[32px] font-semibold leading-none tabular-nums">{usd(run.lastUsd)}</span>
        <span className={`text-sm font-medium tabular-nums ${up ? "text-[#3ddc84]" : "text-[#ff5c5c]"}`}>{pct(run.startUsd, run.lastUsd)}</span>
      </div>
      <p className={`mt-3 text-[11px] tabular-nums ${styles.muted}`}>started with {usd(run.startUsd)}</p>
      {run.status === "running" ? <p className={`mt-4 border-t border-white/5 pt-3 text-[11px] ${styles.muted}`}>{status}</p> : null}
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

  const ready = (built ?? []).filter((agent) => agent.conversationKey && !agent.paperMode && agent.trading?.status === "active");
  if (!wallet.isConnected || !built || built.length === 0) return null;

  return (
    <section className={`${styles.panel} mt-3 p-5`}>
      <h2 className={styles.cardTitle}>Make your run public</h2>
      <p className={`mt-1 text-sm ${styles.muted}`}>
        Pick an agent trading real money. Anyone with the link watches it live until its wallet runs out or you stop it.
      </p>
      {ready.length === 0 ? (
        <p className={`mt-4 text-sm ${styles.muted}`}>
          None of your agents can go live yet. An agent needs Trading mode set to Live, Autopilot on, and an active trade key.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {ready.map((agent) => (
            <li className={`${styles.panel2} flex items-center justify-between gap-3 px-4 py-3`} key={agent.conversationKey}>
              <span className="truncate text-sm font-medium">{agent.name}</span>
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
                {busy === agent.conversationKey ? "Reading the wallet…" : "Go live"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="mt-3 text-sm text-[#ff5c5c]">{error}</p> : null}
    </section>
  );
}
