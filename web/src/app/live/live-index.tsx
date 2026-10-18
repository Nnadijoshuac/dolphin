"use client";

import { useAction, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { LiveBadge, Track, dayOf, pct, usd, useSecond } from "@/app/live/live-bits";
import styles from "@/app/live/live.module.css";
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
    <div className={`test-dark ${styles.page}`}>
      <div className="mx-auto w-full max-w-[2000px] px-4 sm:px-6 xl:px-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <LiveBadge running={Boolean(data?.running.length)} />
            <h1 className="mt-4 text-4xl font-bold sm:text-5xl">Agents trading real money, live</h1>
            <p className="mt-2 max-w-xl text-[15px] text-muted">
              Each one started with what is in its wallet and runs until it hits $100 or hits zero. Every trade is on BNB Chain.
            </p>
          </div>
        </header>

        <section className="mt-10">
          {data === undefined ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div className={`skeleton h-44 rounded-[22px]`} key={i} />
              ))}
            </div>
          ) : data.running.length === 0 ? (
            <div className={`${styles.card} p-8 text-center text-muted`}>Nobody is live right now.</div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.running.map((run) => (
                <RunCard key={run.slug} now={now} run={run} />
              ))}
            </div>
          )}
        </section>

        <GoLive />

        {data && data.finished.length > 0 ? (
          <section className="mt-14">
            <h2 className="text-lg font-semibold">Finished</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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

function RunCard({ run, now }: { run: LiveRunSummary; now: number }) {
  const up = run.lastUsd >= run.startUsd;
  return (
    <Link className={`${styles.card} block p-5 no-underline transition-colors hover:border-[var(--line-strong)]`} href={`/live/${run.slug}`}>
      <div className="flex items-center justify-between gap-3">
        <LiveBadge running={run.status === "running"} />
        <span className="text-xs text-muted">
          {run.status === "running" ? `Day ${now ? dayOf(run.startedAt, now) : 1}` : run.status === "won" ? "Hit $100" : run.status === "lost" ? "Hit zero" : "Ended"}
        </span>
      </div>
      <h3 className="mt-4 truncate text-lg font-semibold text-ink">
        {run.name}
      </h3>
      <p className="text-xs text-muted">{run.market ?? "—"}</p>
      <div className="mt-4 flex items-baseline gap-3">
        <span className="text-3xl font-bold tabular-nums text-ink">{usd(run.lastUsd)}</span>
        <span className={`text-sm font-semibold ${up ? "text-[#3ddc97]" : "text-[#ff6b6b]"}`}>{pct(run.startUsd, run.lastUsd)}</span>
      </div>
      <div className="mt-4">
        <Track now={run.lastUsd} start={run.startUsd} target={run.targetUsd} />
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-muted">
        <span>$0</span>
        <span>started {usd(run.startUsd)}</span>
        <span>${run.targetUsd}</span>
      </div>
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
    <section className={`${styles.card} mt-10 p-6`}>
      <h2 className="text-lg font-semibold">Make your run public</h2>
      <p className="mt-1 text-sm text-muted">
        Pick an agent trading real money. Anyone with the link watches it live until its wallet reaches $100 or zero.
      </p>
      {ready.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          None of your agents can go live yet. An agent needs Trading mode set to Live, Autopilot on, and an active trade key.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {ready.map((agent) => (
            <li className="flex items-center justify-between gap-3 rounded-xl bg-paper-muted px-4 py-3" key={agent.conversationKey}>
              <span className="truncate font-medium text-ink">{agent.name}</span>
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
      {error ? <p className="mt-3 text-sm text-[#ff6b6b]">{error}</p> : null}
    </section>
  );
}
