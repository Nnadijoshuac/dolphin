"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { healthAlertsApi } from "@/convex/api";
import { useWallet } from "@/wallet/wallet-provider";
import { useWalletSession } from "@/wallet/wallet-session";

/**
 * ===========================================================================
 * THE ONE PLACE DOLPHIN CAN ASK TO REACH YOU
 * ===========================================================================
 * Until 2026-09-12 this product had no notification channel of any kind - no
 * email, no push, no webhook - while its hero rail said "Never Get Liquidated"
 * and its flagship listing said "24/7 liquidation protection". A health-factor
 * monitor that cannot wake you up is a page you have to remember to visit,
 * about a risk that materialises while you are asleep.
 *
 * This panel is the smallest thing that makes that claim true: an address, an
 * inbox, a threshold, and one email when the position first goes under.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT IS CAREFUL NOT TO IMPLY
 * ---------------------------------------------------------------------------
 * It is Dolphin watching, not an agent. Nothing here hires anything, grants
 * anything, or lets any listed agent act on a position - the copy says so
 * plainly, because a panel about liquidation sitting on a marketplace page
 * would otherwise read as "one of these agents is now protecting me".
 *
 * It also does not offer the form when the deployment cannot send. A signup
 * that accepts an address and silently never delivers is the "syncing" problem
 * with someone's loan attached.
 */

const THRESHOLDS = [1.1, 1.25, 1.5, 2] as const;

/** Mirrors DEFAULT_THRESHOLD in convex/healthAlerts.ts. */
const DEFAULT_THRESHOLD = 1.5;

function formatChecked(at: number | null): string {
  if (at === null) return "not checked yet";
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "checked just now";
  if (minutes < 60) return `checked ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `checked ${hours}h ago`;
  return `checked ${Math.round(hours / 24)}d ago`;
}

export function LiquidationAlertPanel() {
  const wallet = useWallet();
  const session = useWalletSession();

  const available = useQuery(healthAlertsApi.healthAlerts.alertsAvailable, {});
  const existing = useQuery(
    healthAlertsApi.healthAlerts.getAlertForWallet,
    session.sessionToken ? { sessionToken: session.sessionToken } : "skip",
  );

  const subscribe = useMutation(healthAlertsApi.healthAlerts.subscribe);
  const unsubscribe = useMutation(healthAlertsApi.healthAlerts.unsubscribe);

  /*
   * DRAFTS, NOT A COPY OF THE SERVER STATE.
   *
   * Null means "the user has not touched this field", so the rendered value
   * falls through to the saved subscription. Seeding the fields from an effect
   * instead would be a setState inside a render cycle driven by a Convex
   * subscription - a cascading render the React Compiler lint rejects, and a
   * real bug when a cron patches the row mid-typing and the effect re-fires
   * over what someone is halfway through entering.
   */
  const [emailDraft, setEmailDraft] = useState<string | null>(null);
  const [thresholdDraft, setThresholdDraft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const email = emailDraft ?? existing?.email ?? "";
  const threshold = thresholdDraft ?? existing?.threshold ?? DEFAULT_THRESHOLD;

  /*
   * A deployment with no RESEND_API_KEY renders nothing at all rather than a
   * disabled form. An offer that cannot be honoured is worse than no offer.
   */
  if (available === false) return null;

  const active = existing?.active === true;

  async function onSubscribe() {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    setFailure(null);

    try {
      /*
       * Connect and sign in as part of the same intent, the way HireAction
       * does. Someone who pressed a button saying "Email me" should not be
       * answered with two more buttons.
       */
      let token = session.sessionToken;
      if (!token) {
        const address = wallet.address ?? (await wallet.connect());
        if (!address) {
          setFailure("Connect a wallet so Dolphin knows which position to watch.");
          return;
        }
        token = await session.signIn(address);
        if (!token) {
          setFailure(session.error ?? "Sign-in did not complete.");
          return;
        }
      }

      const result = await subscribe({ sessionToken: token, email, threshold });
      if (result.ok) {
        setNotice(
          `Dolphin will email ${email.trim().toLowerCase()} when this position first falls below ${threshold}.`,
        );
      } else {
        setFailure(result.reason);
      }
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function onUnsubscribe() {
    if (busy || !session.sessionToken) return;
    setBusy(true);
    setNotice(null);
    setFailure(null);
    try {
      await unsubscribe({ sessionToken: session.sessionToken });
      setNotice("Alerts stopped. Nothing further will be sent to that address.");
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface-raised mt-6 p-6" aria-labelledby="alerts-heading">
      <p className="eyebrow">Liquidation alerts</p>
      <h2 className="section-title mt-3" id="alerts-heading">
        Get told before it matters
      </h2>
      <p className="body-copy mt-3 max-w-2xl">
        Dolphin reads your Venus health factor from the Comptroller on BNB Smart
        Chain every fifteen minutes and emails you the first time it falls below
        the figure you pick. Venus liquidates at 1.0, so pick a number with room
        in it.
      </p>

      {/*
        * Stated outright. This panel sits on a marketplace, so without this
        * line it reads as one of the listed agents taking the position over.
        */}
      <p className="mt-2 max-w-2xl text-xs text-faint">
        This is Dolphin watching, not an agent. Nothing is hired, no permission
        is granted, and nothing here can move your funds. Your email is used for
        these alerts and nothing else.
      </p>

      {active && existing ? (
        <div className="mt-5 rounded-xl border border-success/30 bg-success-soft p-4">
          <p className="text-sm font-semibold text-ink">
            Watching {existing.email} below {existing.threshold}
          </p>
          <p className="mt-1 text-xs text-muted">
            {existing.lastHealthFactor !== null
              ? `Health factor ${existing.lastHealthFactor.toFixed(3)}, ${formatChecked(existing.lastCheckedAt)}.`
              : /*
                 * No number is not "you are safe". The cron records a failed or
                 * borrow-free read as null, and those are different from a
                 * healthy position - saying otherwise here would repeat the
                 * exact mistake removed from the chat fallback today.
                 */
                `No health factor read yet — ${formatChecked(existing.lastCheckedAt)}. A position with no Venus borrow has no health factor to report.`}
          </p>
        </div>
      ) : null}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex-1">
          <span className="block text-xs font-semibold text-muted">Email</span>
          <input
            autoComplete="email"
            className="mt-1.5 min-h-11 w-full rounded-xl border border-line bg-paper px-3 text-sm text-ink"
            inputMode="email"
            onChange={(event) => setEmailDraft(event.target.value)}
            placeholder="you@example.com"
            type="email"
            value={email}
          />
        </label>

        <fieldset className="sm:w-auto">
          <legend className="block text-xs font-semibold text-muted">
            Tell me below
          </legend>
          <div className="mt-1.5 flex gap-1.5">
            {THRESHOLDS.map((value) => (
              <button
                aria-pressed={threshold === value}
                className={`min-h-11 rounded-xl border px-3 text-sm font-semibold transition-colors ${
                  threshold === value
                    ? "border-accent bg-accent-soft text-ink"
                    : "border-line bg-paper text-muted hover:bg-canvas"
                }`}
                key={value}
                onClick={() => setThresholdDraft(value)}
                type="button"
              >
                {value}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          className="interactive min-h-11 rounded-xl bg-accent px-5 text-sm font-semibold text-ink hover:bg-accent-hover disabled:cursor-wait disabled:opacity-60"
          disabled={busy || email.trim().length === 0}
          onClick={() => void onSubscribe()}
          type="button"
        >
          {busy ? "Saving…" : active ? "Update alert" : "Email me"}
        </button>

        {active ? (
          <button
            className="interactive min-h-11 rounded-xl border border-line bg-paper px-5 text-sm font-semibold text-ink hover:bg-canvas disabled:opacity-60"
            disabled={busy}
            onClick={() => void onUnsubscribe()}
            type="button"
          >
            Stop alerts
          </button>
        ) : null}
      </div>

      {notice ? <p className="mt-3 text-sm text-success">{notice}</p> : null}
      {failure ? <p className="mt-3 text-sm text-danger">{failure}</p> : null}
    </section>
  );
}
