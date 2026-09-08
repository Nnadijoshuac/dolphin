"use client";

import { useState } from "react";

import { CategoryGlyph } from "@/components/category-glyph";
import { REVIEW_COMMENT_MAX_LENGTH } from "@/constants/reviews";
import {
  useReviewEligibility,
  useSubmitReview,
  usePublishReviewOnChain,
  type ReviewOutcome,
} from "@/hooks/use-agent-reviews";
import { track } from "@/lib/analytics";
import { convexClient } from "@/providers/convex-provider";
import { toUserMessage } from "@/wallet/wallet-errors";

/**
 * TWO QUESTIONS AND A SENTENCE. Not stars.
 *
 * ===========================================================================
 * WHY NOT A FIVE-STAR RATING
 * ===========================================================================
 * convex/agentReviews.ts carries the full argument; the short version is three
 * points, none of which is about aesthetics:
 *
 *  - A five-star mean over a marketplace this size is noise. A few dozen agents
 *    and a handful of reviewers produce averages that reorder on one opinion.
 *  - "How did you feel about it" is the wrong question about software that
 *    moves money. "Did it do the thing" and "would you pay for it again" are
 *    answerable, comparable, and hard to be vague about.
 *  - Stars invite bulk manufacture. Two structured questions tied to a
 *    verified, aged, sometimes-paid hire do not.
 *
 * This page's own history is the other reason: a previous version of the agent
 * detail page carried a hardcoded "4.9", five gold stars and a fabricated star
 * histogram, and all of it was deleted. The obvious way to "add reviews" is to
 * put that shape back with real numbers underneath. That would be a mistake for
 * reasons that have nothing to do with the old fake data.
 *
 * ===========================================================================
 * THE GATES ARE NOT HERE
 * ===========================================================================
 * Authenticated, has hired it, hire at least 24 hours old - all three are
 * enforced in the Convex mutation. This component only ASKS whether they pass,
 * so it can state the actual reason ("your hire is 3 hours old" is a different
 * thing to tell someone than "you have not hired this agent") instead of
 * offering a form that fails on submit. A gate the client owns is not a gate.
 */

const OUTCOMES: { value: ReviewOutcome; label: string; hint: string }[] = [
  { value: "yes", label: "Yes", hint: "It did what it said it would" },
  { value: "partially", label: "Partially", hint: "Some of it, or not reliably" },
  { value: "no", label: "No", hint: "It did not do the job" },
];

export function ReviewForm({
  agentKey,
  agentName,
}: {
  agentKey: string;
  agentName: string;
}) {
  /*
   * Same guard as every other Convex-backed component here: convex/react's
   * hooks throw without a provider, and a deployment with no
   * NEXT_PUBLIC_CONVEX_URL renders none. `convexClient` is a module constant, so
   * this branch never changes hook order.
   */
  if (!convexClient) return null;
  return <BackendReviewForm agentKey={agentKey} agentName={agentName} />;
}

function BackendReviewForm({
  agentKey,
  agentName,
}: {
  agentKey: string;
  agentName: string;
}) {
  const eligibility = useReviewEligibility(agentKey);
  const submitReview = useSubmitReview();

  const existing = eligibility?.existing ?? null;
  const [outcome, setOutcome] = useState<ReviewOutcome | null>(null);
  const [wouldHireAgain, setWouldHireAgain] = useState<boolean | null>(null);
  const [comment, setComment] = useState("");
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string }
  >({ kind: "idle" });

  /*
   * Prefilled from the existing review ONCE, during render rather than in an
   * effect - React's documented "adjusting state when a prop changes" pattern,
   * used elsewhere in this app (app/search/search-client.tsx) for the same
   * reason: an effect would re-set the same values on every subscription tick.
   */
  const [prefilledFor, setPrefilledFor] = useState<string | null>(null);
  const existingSignature = existing
    ? `${existing.outcome}:${existing.wouldHireAgain}:${existing.comment ?? ""}`
    : null;

  if (existing && prefilledFor === null) {
    setPrefilledFor(existingSignature);
    setOutcome(existing.outcome);
    setWouldHireAgain(existing.wouldHireAgain);
    setComment(existing.comment ?? "");
  }

  if (eligibility === undefined) {
    return (
      <div className="border-t border-line pt-6">
        <div className="skeleton h-24 w-full rounded-xl" />
      </div>
    );
  }

  if (!eligibility.eligible) {
    /*
     * The real reason, from the backend, verbatim. Not a generic "you cannot
     * review this": the difference between "sign in", "you have not hired this"
     * and "wait another 9 hours" is the difference between a dead end and an
     * instruction.
     */
    return (
      <div className="flex gap-3 border-t border-line pt-6">
        <span aria-hidden="true" className="mt-0.5 shrink-0 text-faint">
          <CategoryGlyph color="currentColor" name="info" size={17} strokeWidth={2} />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-ink">Reviews come from hirers</h3>
          <p className="mt-1 max-w-xl text-sm leading-6 text-muted">
            {eligibility.reason}
          </p>
        </div>
      </div>
    );
  }

  const canSubmit =
    outcome !== null && wouldHireAgain !== null && state.kind !== "saving";

  async function save() {
    if (outcome === null || wouldHireAgain === null) return;
    setState({ kind: "saving" });

    try {
      const trimmed = comment.trim();
      await submitReview({
        agentKey,
        outcome,
        wouldHireAgain,
        comment: trimmed.length > 0 ? trimmed : null,
      });
      setState({ kind: "saved" });
      track("review_submitted", {
        agentKey,
        outcome,
        wouldHireAgain,
        hasComment: trimmed.length > 0,
      });
    } catch (cause) {
      setState({
        kind: "error",
        message: toUserMessage(cause, "The review could not be saved. Try again."),
      });
    }
  }

  return (
    <div className="border-t border-line pt-6">
      <h3 className="text-sm font-semibold text-ink">
        {existing ? "Your review" : `Review ${agentName}`}
      </h3>
      <p className="mt-1 max-w-xl text-sm leading-6 text-muted">
        {existing
          ? "You can change this at any time. An opinion formed on day two should be allowed to change on day thirty."
          : "Two questions, because they are the two that are worth comparing across agents."}
      </p>

      <fieldset className="mt-6">
        <legend className="text-xs font-semibold uppercase tracking-[0.1em] text-faint">
          Did it do what it said?
        </legend>
        <div className="mt-3 flex flex-wrap gap-2">
          {OUTCOMES.map((option) => (
            <button
              aria-pressed={outcome === option.value}
              className={`interactive min-h-10 rounded-xl border px-4 text-sm font-medium ${
                outcome === option.value
                  ? "border-ink bg-ink text-paper"
                  : "border-line bg-paper text-muted hover:text-ink"
              }`}
              key={option.value}
              onClick={() => {
                if (outcome === null) track("review_started", { agentKey });
                setOutcome(option.value);
                setState({ kind: "idle" });
              }}
              title={option.hint}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
        {outcome ? (
          <p className="mt-2 text-xs text-faint">
            {OUTCOMES.find((option) => option.value === outcome)?.hint}
          </p>
        ) : null}
      </fieldset>

      <fieldset className="mt-6">
        <legend className="text-xs font-semibold uppercase tracking-[0.1em] text-faint">
          Would you hire it again?
        </legend>
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            { value: true, label: "Yes" },
            { value: false, label: "No" },
          ].map((option) => (
            <button
              aria-pressed={wouldHireAgain === option.value}
              className={`interactive min-h-10 rounded-xl border px-4 text-sm font-medium ${
                wouldHireAgain === option.value
                  ? "border-ink bg-ink text-paper"
                  : "border-line bg-paper text-muted hover:text-ink"
              }`}
              key={option.label}
              onClick={() => {
                setWouldHireAgain(option.value);
                setState({ kind: "idle" });
              }}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="mt-6">
        <label
          className="text-xs font-semibold uppercase tracking-[0.1em] text-faint"
          htmlFor="review-comment"
        >
          One sentence, optional
        </label>
        <textarea
          className="mt-3 w-full resize-y rounded-xl border border-line bg-paper p-3 text-sm leading-6 text-ink placeholder:text-faint"
          id="review-comment"
          maxLength={REVIEW_COMMENT_MAX_LENGTH}
          onChange={(event) => {
            setComment(event.target.value);
            setState({ kind: "idle" });
          }}
          placeholder="What someone deciding whether to hire this should know."
          rows={3}
          value={comment}
        />
        <p className="mt-1 text-right text-xs tabular-nums text-faint">
          {comment.length} / {REVIEW_COMMENT_MAX_LENGTH}
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          aria-busy={state.kind === "saving"}
          className="interactive min-h-11 rounded-xl bg-accent px-5 text-sm font-semibold text-ink hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-paper-muted disabled:text-faint"
          disabled={!canSubmit}
          onClick={() => void save()}
          type="button"
        >
          {state.kind === "saving"
            ? "Saving…"
            : existing
              ? "Update review"
              : "Save review"}
        </button>
        {state.kind === "saved" ? (
          <span className="text-xs font-medium text-success" role="status">
            Saved.
          </span>
        ) : null}
        {state.kind === "error" ? (
          <span className="text-xs text-danger" role="alert">
            {state.message}
          </span>
        ) : null}
      </div>

      {/*
       * Publishing on-chain is offered ONLY once a review exists, because it
       * publishes THAT review. Never automatic and never folded into the save
       * button: it spends the user's own BNB, and a control that spends money
       * has to be its own deliberate decision.
       */}
      {existing ? (
        <PublishOnChain
          agentKey={agentKey}
          existingTxHash={existing.onChainTxHash}
          outcome={existing.outcome}
          wouldHireAgain={existing.wouldHireAgain}
        />
      ) : null}
    </div>
  );
}

/**
 * The optional second step: mirror a saved review into the ERC-8004 Reputation
 * Registry, from the reviewer's own wallet.
 *
 * WHY THIS MATTERS BEYOND THE FEATURE. Dolphin displays the registry's address
 * on every agent page and reads feedback counts from it. Writing to it is what
 * turns this product from a reader of the standard into a contributor to it:
 * the review becomes portable, censorship-resistant, and readable by every
 * other ERC-8004 client. That is the actual argument for doing this on-chain
 * rather than in a database.
 *
 * WHAT IS SAID PLAINLY, BEFORE THE BUTTON: it costs real BNB, it cannot be
 * deleted, and the comment does NOT go on-chain - only the two structured
 * answers do, because Dolphin hosts no off-chain JSON to point a `feedbackURI`
 * at and will not publish a URL to a file that does not exist. See
 * services/reputation-registry.ts.
 */
function PublishOnChain({
  agentKey,
  outcome,
  wouldHireAgain,
  existingTxHash,
}: {
  agentKey: string;
  outcome: ReviewOutcome;
  wouldHireAgain: boolean;
  existingTxHash: string | null;
}) {
  const publish = usePublishReviewOnChain();
  const [status, setStatus] = useState<"idle" | "publishing">("idle");
  const [error, setError] = useState<string | null>(null);

  if (existingTxHash) {
    return (
      <div className="mt-6 rounded-xl border border-line bg-accent-soft/40 p-4">
        <p className="text-xs font-semibold text-accent-ink">
          Published to the ERC-8004 Reputation Registry
        </p>
        <p className="mt-1 text-sm leading-6 text-muted">
          Dolphin read this transaction back off BNB Smart Chain and confirmed it
          came from your wallet. Any ERC-8004 client can now read this review.
        </p>
        <a
          className="interactive mt-2 inline-block break-all font-mono text-xs text-accent-ink underline-offset-4 hover:underline"
          href={`https://bscscan.com/tx/${existingTxHash}`}
          rel="noreferrer"
          target="_blank"
        >
          {existingTxHash} ↗
        </a>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-xl border border-line bg-paper p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-faint">
        Optional · costs gas
      </p>
      <h4 className="mt-2 text-sm font-semibold text-ink">
        Publish this to the ERC-8004 registry
      </h4>
      <p className="mt-1 max-w-xl text-sm leading-6 text-muted">
        Your two answers are written to the public Reputation Registry on BNB
        Smart Chain, from your wallet, so any ERC-8004 client can read them. This
        costs real BNB and cannot be undone. Your written comment stays in
        Dolphin — only the structured answers go on-chain.
      </p>

      <button
        aria-busy={status === "publishing"}
        className="interactive mt-4 min-h-11 rounded-xl border border-line bg-canvas px-5 text-sm font-semibold text-ink hover:bg-paper-muted disabled:cursor-wait disabled:opacity-60"
        disabled={status === "publishing"}
        onClick={async () => {
          setStatus("publishing");
          setError(null);
          try {
            await publish({ agentKey, outcome, wouldHireAgain });
            track("review_published_onchain", { agentKey });
          } catch (cause) {
            setError(
              toUserMessage(
                cause,
                "The review was not published. Nothing was recorded.",
              ),
            );
          } finally {
            setStatus("idle");
          }
        }}
        type="button"
      >
        {status === "publishing" ? "Check your wallet…" : "Publish on-chain"}
      </button>

      {error ? (
        <p className="mt-3 text-xs leading-5 text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
