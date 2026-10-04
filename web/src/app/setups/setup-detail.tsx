"use client";

import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { pct, seller, statsFor, StatsLine, venueLabel } from "@/app/setups/setup-parts";
import { setupsApi } from "@/convex/api";
import { toast } from "@/store/use-toast-store";
import { useWalletSession } from "@/wallet/wallet-session";

/** One trading setup: what it trades, its limits, Dolphin's backtest and its trades since listing - and Copy. */
export function SetupDetail({ listingId }: { listingId: string }) {
  const setup = useQuery(setupsApi.setups.get, { listingId });
  const copy = useMutation(setupsApi.setups.copy);
  const session = useWalletSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const copyIt = async () => {
    setBusy(true);
    try {
      const sessionToken = session.sessionToken ?? (await session.signIn());
      if (!sessionToken) return;
      const { conversationKey } = await copy({ sessionToken, listingId });
      toast.success("Copied to your agents, on paper. Its strategy stays locked.");
      router.push(`/dolphin?c=${conversationKey}`);
    } catch (cause) {
      toast.error(cause instanceof ConvexError && typeof cause.data === "string" ? cause.data : "Could not copy it.");
    } finally {
      setBusy(false);
    }
  };

  if (setup === undefined) {
    return (
      <div className="site-frame page-shell">
        <div className="skeleton h-64 rounded-2xl" />
      </div>
    );
  }
  if (setup === null) {
    return (
      <div className="site-frame page-shell">
        <div className="surface-raised setups-empty">
          <p className="font-semibold text-ink">That setup is no longer listed</p>
          <Link className="mt-3 inline-block font-semibold" href="/setups">
            See all setups
          </Link>
        </div>
      </div>
    );
  }
  const since = setup.sinceListed;
  return (
    <div className="site-frame page-shell">
      <Link className="setups-back" href="/setups">
        ← Trading setups
      </Link>
      <header className="setups-head">
        <h1>{setup.title}</h1>
        {setup.summary ? <p className="setups-lede">{setup.summary}</p> : null}
        <p className="setup-card__meta">
          By {seller(setup.seller)} · listed {new Date(setup.listedAt).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })} ·{" "}
          {setup.copies} {setup.copies === 1 ? "copy" : "copies"}
        </p>
      </header>

      <div className="setup-detail">
        <section className="surface-raised setup-section">
          <h2>Its rules</h2>
          <ul className="setup-rules">
            {setup.rules.map((rule, index) => (
              <li key={index}>
                <p className="setup-rules__words">
                  <span aria-hidden>🔒</span> {rule.words}
                </p>
                <p className="setup-rules__meta">
                  {venueLabel(rule.venue)}
                  {rule.leverage > 1 ? ` · ${rule.leverage}x` : ""}
                </p>
                <p className="setup-rules__stats">
                  <span className="text-muted">Backtest: </span>
                  <StatsLine stats={statsFor(setup, index)} />
                </p>
              </li>
            ))}
          </ul>
          <p className="setups-note">The entry and exit conditions are locked: a copy runs them on Dolphin without showing them.</p>
        </section>

        <aside className="setup-side">
          <section className="surface-raised setup-section">
            <h2>Since it was listed</h2>
            {since.trades === 0 ? (
              <p className="mt-2 text-[0.86rem] text-muted">No trades yet.</p>
            ) : (
              <dl className="setup-since">
                <div>
                  <dt>Trades</dt>
                  <dd>{since.trades}</dd>
                </div>
                <div>
                  <dt>Closed · won</dt>
                  <dd>
                    {since.closed} · {since.won}
                  </dd>
                </div>
                <div>
                  <dt>Sum of results</dt>
                  <dd className={since.sumPct >= 0 ? "setup-up" : "setup-down"}>{pct(since.sumPct)}</dd>
                </div>
                <div>
                  <dt>With real money</dt>
                  <dd>{since.real}</dd>
                </div>
              </dl>
            )}
          </section>
          <section className="surface-raised setup-section">
            <h2>Copy it</h2>
            <ul className="setup-copy-notes">
              <li>It becomes your own agent, trading your own money from your own wallet.</li>
              <li>It starts on paper with Autopilot off - nothing trades until you choose.</li>
              <li>You can change its size, stop and limits; its conditions stay locked.</li>
            </ul>
            <button className="setup-copy" disabled={busy} onClick={() => void copyIt()} type="button">
              <span>{busy ? "Copying…" : "Copy to my agents"}</span>
            </button>
            <p className="setups-note">Free for now. Past results don&rsquo;t predict future ones. Not financial advice.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
