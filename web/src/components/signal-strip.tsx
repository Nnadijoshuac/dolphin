"use client";

import { MIN_RATE_DENOMINATOR } from "@/constants/reviews";
import { useNow } from "@/hooks/use-now";
import type { AgentSignals } from "@/hooks/use-agents";

/**
 * "Answered 4m ago", from the probe timestamp.
 *
 * Returns null when the time is not yet known - `useNow` reports 0 on the
 * server so that the first client render agrees with it - and when the
 * timestamp is unparseable. Both cases render nothing rather than a guess.
 */
function answeredLabel(verifiedAt: string | null | undefined, now: number): string | null {
  if (!verifiedAt || now === 0) return null;

  const at = new Date(verifiedAt).getTime();
  if (Number.isNaN(at)) return null;

  const seconds = Math.round((now - at) / 1000);
  if (seconds < 0) return null;

  if (seconds < 90) return "Answered just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Answered ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Answered ${hours}h ago`;
  const days = Math.round(hours / 24);
  return `Answered ${days}d ago`;
}

/**
 * The one line on a catalog card that lets one agent be preferred to another.
 *
 * ===========================================================================
 * WHY A CARD NEEDED THIS (2026-09-08)
 * ===========================================================================
 * Every record in the catalog grid rendered the same three things: a name, a
 * category and a source label. Nothing on the browse surface distinguished an
 * agent forty people had hired and kept from one nobody had ever tried. A
 * marketplace whose comparison signal only appears after you click into a
 * record is not helping anyone compare.
 *
 * ===========================================================================
 * WHAT IT SHOWS, IN ORDER OF EVIDENCE
 * ===========================================================================
 * Only what is TRUE and NON-ZERO. An agent with no history renders nothing at
 * all rather than a row of zeros - "0 hires · 0 reviews" reads as a verdict,
 * and for a newly listed agent it is only an absence of evidence. Silence is
 * the honest rendering of "not yet known".
 *
 * The rate is omitted below MIN_RATE_DENOMINATOR, matching the backend, which
 * returns null there for the same reason: a percentage over three reviewers
 * reorders on one person changing their mind.
 */
export function SignalStrip({
  signals,
  verifiedAt,
  className = "",
}: {
  signals: AgentSignals | undefined;
  /**
   * WHEN DOLPHIN LAST CALLED THIS AGENT AND IT ANSWERED. (2026-09-12)
   *
   * The note above is right that silence is the honest rendering of "not yet
   * known" - and wrong about what silence COMMUNICATES. On a catalog where
   * most records have no hires and no reviews, most cards rendered nothing at
   * all, and a blank card does not read as "new". It reads as abandoned. There
   * is no signal-free option here: absence is itself a signal, and this
   * component did not control which one it sent.
   *
   * The way out is not to invent evidence, it is to show a DIFFERENT true
   * thing. Every listed agent has answered a probe, because answering is what
   * listing means (README: "Nothing enters the catalog that has not
   * answered"). So this is the one signal that is real for every row, is never
   * zero, is produced by infrastructure already running, and belongs to
   * Dolphin rather than to an indexer.
   *
   * Rendered last and muted: it is a liveness fact, not an endorsement, and it
   * must never outrank a hire or a review that was actually earned.
   */
  verifiedAt?: string | null;
  className?: string;
}) {
  const now = useNow();

  if (!signals) return null;

  const parts: { key: string; label: string; strong?: boolean }[] = [];

  if (signals.hires > 0) {
    parts.push({
      key: "hires",
      label: `${signals.hires} ${signals.hires === 1 ? "hire" : "hires"}`,
    });
  }

  /*
   * Retention as a raw ratio, not a percentage. On a card there is no room to
   * say what the denominator is, and "80%" over five hires implies a precision
   * that "4 of 5 still running" does not pretend to.
   */
  if (signals.activeHires > 0 && signals.hires > 0) {
    parts.push({
      key: "active",
      label: `${signals.activeHires} of ${signals.hires} still running`,
    });
  }

  if (signals.paidHires > 0) {
    parts.push({
      key: "paid",
      label: `${signals.paidHires} paid`,
      strong: true,
    });
  }

  if (signals.deliveredCount > 0) {
    parts.push({
      key: "delivered",
      label: `${signals.deliveredCount} delivered`,
      strong: true,
    });
  }

  if (signals.reviews > 0) {
    /*
     * `wouldHireAgainRate` is null below five reviews. Rendering the raw counts
     * in that case is not a fallback - it is the accurate reading.
     */
    const rehire =
      signals.reviews >= MIN_RATE_DENOMINATOR && signals.wouldHireAgainRate !== null
        ? `${Math.round(signals.wouldHireAgainRate * 100)}% would hire again`
        : `${signals.wouldHireAgain} of ${signals.reviews} would hire again`;

    parts.push({ key: "reviews", label: rehire });
  }

  const answered = answeredLabel(verifiedAt, now);
  if (answered) parts.push({ key: "answered", label: answered });

  if (parts.length === 0) return null;

  return (
    <ul
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.69rem] ${className}`}
    >
      {parts.map((part, index) => (
        <li className="flex items-center gap-2" key={part.key}>
          {index > 0 ? (
            <span aria-hidden="true" className="text-line">
              ·
            </span>
          ) : null}
          <span className={part.strong ? "font-semibold text-accent-ink" : "text-muted"}>
            {part.label}
          </span>
        </li>
      ))}
    </ul>
  );
}
