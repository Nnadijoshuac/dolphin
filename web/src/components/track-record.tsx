"use client";

import { MIN_RATE_DENOMINATOR } from "@/constants/reviews";
import { ReviewForm } from "@/components/review-form";
import {
  useAgentRetention,
  useAgentReviews,
} from "@/hooks/use-agent-reviews";
import { convexClient } from "@/providers/convex-provider";
import type { AgentReviewRow } from "@/convex/api";

/**
 * THE TRACK RECORD: what Dolphin can verify itself, and what hirers said.
 *
 * ===========================================================================
 * WHY THIS SECTION EXISTS AT ALL (2026-09-08)
 * ===========================================================================
 * The agent page's trust block showed exactly two social numbers: an on-chain
 * "Reputation" score and a "Feedback" count, both sourced from 8004scan's index.
 * Both are usually zero, neither is about Dolphin's own users, and together they
 * gave a visitor nothing to compare one agent against another with.
 *
 * Meanwhile convex/agentReviews.ts and convex/agentRetention.ts had been
 * complete for two days and the website did not declare either. project-scope.md
 * SS4 called for exactly this and called it the right thing:
 * "Reviews -> track record: win rate, volume, uptime - verifiable, not star
 * ratings."
 *
 * ===========================================================================
 * TWO SIGNALS, ORDERED BY HOW HARD THEY ARE TO FAKE
 * ===========================================================================
 * RETENTION FIRST, and deliberately above reviews. It is computed entirely from
 * Dolphin's own agentHires table: nobody writes it, nobody can inflate it
 * without paying for hires and then keeping them, and it exists for an agent
 * that has never been reviewed. It is the single most honest comparison signal
 * this marketplace can produce, and it is marketplace-derived rather than
 * claimed - exactly the labelled distinction project-scope.md SS5 asks for.
 *
 * REVIEWS SECOND. Structured outcomes from wallets that provably hired, aged at
 * least a day, some of which paid on-chain. Stronger than stars, weaker than
 * arithmetic over the hire table.
 *
 * ===========================================================================
 * NO PERCENTAGE BELOW FIVE
 * ===========================================================================
 * Both backends return `null` for a rate with fewer than five in the
 * denominator, and this renders the COUNTS in that case rather than working
 * around the null. "100% would hire again" over one review is true arithmetic
 * and a false impression, and the whole point of this section is to be the part
 * of the page that cannot mislead.
 */

export function TrackRecord({
  agentKey,
  agentName,
}: {
  agentKey: string;
  agentName: string;
}) {
  if (!convexClient) return null;
  return <BackendTrackRecord agentKey={agentKey} agentName={agentName} />;
}

function percent(rate: number) {
  return `${Math.round(rate * 100)}%`;
}

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

const OUTCOME_LABELS: Record<AgentReviewRow["outcome"], string> = {
  yes: "Did the job",
  partially: "Partially",
  no: "Did not",
};

function BackendTrackRecord({
  agentKey,
  agentName,
}: {
  agentKey: string;
  agentName: string;
}) {
  const reviews = useAgentReviews(agentKey);
  const retention = useAgentRetention(agentKey);

  const loading = reviews === undefined || retention === undefined;

  return (
    <div>
      {/* ---------------------------------------------------------------- */}
      {/* RETENTION — Dolphin's own arithmetic, no reviewer involved.       */}
      {/* ---------------------------------------------------------------- */}
      <div className="grid border-l border-t border-line sm:grid-cols-3">
        <RetentionCell
          detail={
            retention
              ? `${retention.activeHires} of ${retention.totalHires} still running`
              : null
          }
          label="Hires"
          loading={loading}
          value={retention ? String(retention.totalHires) : null}
        />
        <RetentionCell
          detail={
            retention
              ? retention.day7.rate !== null
                ? `${retention.day7.retained} of ${retention.day7.eligible} hires`
                : `${retention.day7.eligible} of ${MIN_RATE_DENOMINATOR} hires needed`
              : null
          }
          label="Kept past 7 days"
          loading={loading}
          value={
            retention?.day7.rate !== null && retention !== undefined
              ? percent(retention.day7.rate as number)
              : null
          }
        />
        <RetentionCell
          detail={
            retention
              ? retention.day30.rate !== null
                ? `${retention.day30.retained} of ${retention.day30.eligible} hires`
                : `${retention.day30.eligible} of ${MIN_RATE_DENOMINATOR} hires needed`
              : null
          }
          label="Kept past 30 days"
          loading={loading}
          value={
            retention?.day30.rate !== null && retention !== undefined
              ? percent(retention.day30.rate as number)
              : null
          }
        />
      </div>

      <p className="mt-3 text-xs leading-5 text-muted">
        Retention is computed by Dolphin from its own hire records, not reported
        by the publisher. A percentage appears once {MIN_RATE_DENOMINATOR} hires
        are old enough to have been kept or dropped; below that the counts are
        shown instead, because a rate over a handful of hires reorders on one
        person changing their mind.
      </p>

      {/* ---------------------------------------------------------------- */}
      {/* REVIEWS                                                           */}
      {/* ---------------------------------------------------------------- */}
      <div className="mt-9 border-t border-line pt-7">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold text-ink">
            What hirers said
          </h3>
          {reviews && reviews.total > 0 ? (
            <p className="text-xs text-muted">
              {reviews.total} {reviews.total === 1 ? "review" : "reviews"}
              {reviews.paidReviews > 0
                ? ` · ${reviews.paidReviews} from paid hires`
                : ""}
              {reviews.onChainReviews > 0
                ? ` · ${reviews.onChainReviews} published on-chain`
                : ""}
            </p>
          ) : null}
        </div>

        {loading ? (
          <div className="mt-4 space-y-3">
            <div className="skeleton h-16 w-full rounded-xl" />
            <div className="skeleton h-16 w-full rounded-xl" />
          </div>
        ) : reviews && reviews.total > 0 ? (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <SummaryTile
                label="Would hire again"
                /*
                 * Null below five. Rendering counts rather than a percentage is
                 * not a degraded state - it is the accurate one.
                 */
                sub={
                  reviews.wouldHireAgainRate !== null
                    ? `${reviews.wouldHireAgainCount} of ${reviews.total}`
                    : `${reviews.wouldHireAgainCount} of ${reviews.total} so far`
                }
                value={
                  reviews.wouldHireAgainRate !== null
                    ? percent(reviews.wouldHireAgainRate)
                    : `${reviews.wouldHireAgainCount}/${reviews.total}`
                }
              />
              <SummaryTile
                label="Did the job"
                sub={`${reviews.outcomes.partially} partially · ${reviews.outcomes.no} did not`}
                value={`${reviews.outcomes.yes}/${reviews.total}`}
              />
            </div>

            <ul className="mt-6 border-t border-line">
              {reviews.reviews.map((review) => (
                <ReviewRow
                  key={`${review.walletAddress}-${review.updatedAt}`}
                  review={review}
                />
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted">
            Nobody who has hired {agentName} has reviewed it yet. Reviews here
            can only be written by a wallet that hired the agent and kept it for
            at least a day, which is why there are few of them and why they are
            worth reading.
          </p>
        )}

        <ReviewForm agentKey={agentKey} agentName={agentName} />
      </div>
    </div>
  );
}

function RetentionCell({
  label,
  value,
  detail,
  loading,
}: {
  label: string;
  value: string | null;
  detail: string | null;
  loading: boolean;
}) {
  return (
    <div className="min-w-0 border-b border-r border-line bg-paper p-5">
      <h4 className="text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-muted">
        {label}
      </h4>
      {loading ? (
        <div className="skeleton mt-4 h-8 w-20 rounded-md" />
      ) : (
        <p className="mt-4 text-2xl font-semibold tracking-[-0.035em] text-ink">
          {/* Not enough data is "—", never a zero or an invented percentage. */}
          {value ?? "—"}
        </p>
      )}
      {detail ? <p className="mt-2 text-xs leading-5 text-faint">{detail}</p> : null}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-paper p-4">
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-faint">
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold tracking-[-0.03em] text-ink">
        {value}
      </p>
      <p className="mt-1 text-xs text-muted">{sub}</p>
    </div>
  );
}

function ReviewRow({ review }: { review: AgentReviewRow }) {
  return (
    <li className="border-b border-line py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span
          className={`font-semibold ${
            review.outcome === "yes"
              ? "text-success"
              : review.outcome === "no"
                ? "text-danger"
                : "text-accent-ink"
          }`}
        >
          {OUTCOME_LABELS[review.outcome]}
        </span>
        <span className="text-faint" aria-hidden="true">
          ·
        </span>
        <span className="text-muted">
          {review.wouldHireAgain ? "Would hire again" : "Would not hire again"}
        </span>
        {/*
         * The badges are the whole reason these reviews are worth more than a
         * star average. Both are facts Dolphin holds, not claims the reviewer
         * made: the hire record is ours, and the paid one was witnessed on-chain
         * by recordJobPayment before it was written.
         */}
        {review.paidJobId ? (
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[0.65rem] font-semibold text-accent-ink">
            Paid hire
          </span>
        ) : (
          <span className="rounded-full bg-paper-muted px-2 py-0.5 text-[0.65rem] font-semibold text-muted">
            Verified hire
          </span>
        )}
        {review.onChainTxHash ? (
          <a
            className="interactive rounded-full border border-line px-2 py-0.5 text-[0.65rem] font-semibold text-muted hover:text-ink"
            href={`https://bscscan.com/tx/${review.onChainTxHash}`}
            rel="noreferrer"
            target="_blank"
          >
            On-chain ↗
          </a>
        ) : null}
      </div>

      {review.comment ? (
        <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-soft">
          {review.comment}
        </p>
      ) : null}

      <p className="mt-2 font-mono text-[0.68rem] text-faint">
        {/*
         * The address in full-ish rather than an anonymous handle: it is already
         * public on-chain, and being able to look up who said something is most
         * of what makes a review checkable rather than merely present.
         */}
        <a
          className="interactive hover:text-muted"
          href={`https://bscscan.com/address/${review.walletAddress}`}
          rel="noreferrer"
          target="_blank"
          title={review.walletAddress}
        >
          {shortAddress(review.walletAddress)}
        </a>
        {" · hired "}
        {new Date(review.hiredAt).toLocaleDateString("en", {
          day: "numeric",
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        })}
      </p>
    </li>
  );
}
