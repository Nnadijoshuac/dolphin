"use client";

/**
 * MANAGING A HIRED AGENT (revamped 2026-09-29).
 *
 * The owner's brief: someone managing an agent wants to know what it is doing
 * right now, what it delivered, what they have paid it for, and how to stop
 * it - and the old page answered those in scattered paragraphs with buttons
 * that were hard to read. This page answers them in that order:
 *
 *   Right now         a live tracker - Paid, Working, Delivered, Paid out -
 *                     with the current step lit and one plain sentence.
 *   What it delivered the delivery and its on-chain proof, or "nothing yet".
 *   Every job         all purchases from this agent, not only the latest.
 *   Your review       the track record and the review form.
 *   Side panel        the hire at a glance and every action, clearly.
 *
 * WHAT THIS PAGE CANNOT SHOW, AND SAYS SO. On this rail an agent records its
 * delivery on-chain as a 32-byte fingerprint of the result, not the result
 * itself (Agent/HANDOFF_BRIEF.md: the event that would carry its location was
 * never found on BSC). So "What it delivered" shows when it delivered and the
 * proof, and never presents the fingerprint as the content.
 *
 * Cancelling ends Dolphin's hire record only. It does not touch an escrow -
 * that money is on-chain and Dolphin has no authority over it - and the panel
 * says so before the button, not after.
 */

import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { AgentIcon } from "@/components/agent-icon";
import { HoldButton } from "@/components/hold-button";
import { OneLine } from "@/components/agent-detail-extras";
import { CategoryGlyph } from "@/components/category-glyph";
import { TrackRecord } from "@/components/track-record";
import { categoryLabel } from "@/constants/agents";
import { agentHiresApi, agentPaymentsApi, type AgentJobRow } from "@/convex/api";
import { useJobDelivery } from "@/hooks/use-job-delivery";
import { useNow } from "@/hooks/use-now";
import { priceTextOr, usePriceText } from "@/hooks/use-price-text";
import { track } from "@/lib/analytics";
import type { Agent } from "@/types/agent";
import { useAltanaWallet } from "@/wallet/altana-provider";
import { hasDeliverable, type DeliveryState } from "@/wallet/erc8183-job";
import { ESCROW_DISPUTE_WINDOW_SECONDS, formatTokenAmount } from "@/wallet/erc8183-policy";
import { toUserMessage } from "@/wallet/wallet-errors";
import { useWalletSession } from "@/wallet/wallet-session";

export type HireRow = {
  agentKey: string;
  status: "active" | "cancelled";
  hiredAt: string;
  paymentJobId: string | null;
};

function day(value: number | string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "an unknown date";
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function dayTime(value: number): string {
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(
    new Date(value),
  );
}

/**
 * What the person asked for, from the on-chain job description. Sellers put a
 * quote anchor in it, sometimes as JSON; the readable request is pulled out
 * and capped, and nothing is shown when there is no readable text.
 */
function requestText(description: string): string | null {
  const trimmed = description.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    try {
      const data = JSON.parse(trimmed) as Record<string, unknown>;
      const text = [data.task_description, data.task, data.description, data.deliverables, data.request].find(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      );
      return text ? text.trim().slice(0, 600) : null;
    } catch {
      return null;
    }
  }
  return trimmed.slice(0, 600);
}

function paidText(job: AgentJobRow): string {
  return `${formatTokenAmount(job.budgetRaw, job.paymentTokenDecimals)} ${job.paymentTokenSymbol}`;
}

/** Jobs for this agent paid from the Dolphin Wallet on this device, newest first. */
function useJobs(agentKey: string): AgentJobRow[] | undefined {
  const wallet = useAltanaWallet();
  return useQuery(
    agentPaymentsApi.agentPayments.getJobsForAgent,
    wallet.address ? { agentKey, altanaWalletAddress: wallet.address } : "skip",
  ) as AgentJobRow[] | undefined;
}

const STEPS = ["Paid", "Working", "Delivered", "Paid out"] as const;

/** Which step is lit, and whether the job ended somewhere off the happy path. */
function stepFor(state: DeliveryState | undefined): { index: number; tone: "live" | "warn" | "done" } {
  switch (state) {
    case "settled":
      return { index: 3, tone: "done" };
    case "delivered":
      return { index: 2, tone: "live" };
    case "overdue":
      return { index: 1, tone: "warn" };
    case "rejected":
    case "expired":
      return { index: 1, tone: "warn" };
    case "unfunded":
      return { index: 0, tone: "warn" };
    default:
      return { index: 1, tone: "live" };
  }
}

function Tracker({ state }: { state: DeliveryState | undefined }) {
  const { index, tone } = stepFor(state);
  return (
    <ol className="tracker" data-tone={tone}>
      {STEPS.map((label, step) => (
        <li
          className="tracker__step"
          data-state={step < index || (tone === "done" && step === index) ? "done" : step === index ? "now" : "next"}
          key={label}
        >
          <span aria-hidden="true" className="tracker__dot" />
          <span className="tracker__label">{label}</span>
        </li>
      ))}
    </ol>
  );
}

/** The one sentence under the tracker. Plain words; dates are the chain's own. */
function nowSentence(agent: Agent, state: DeliveryState | undefined, submittedAt: number, expiredAt: number): string {
  const paidOutOn = submittedAt > 0 ? day((submittedAt + ESCROW_DISPUTE_WINDOW_SECONDS) * 1000) : null;
  switch (state) {
    case undefined:
      return "Checking the job on BNB Chain...";
    case "working":
      return `${agent.name} is working on your request. This page updates by itself.`;
    case "overdue":
      return `Nothing yet, and it is taking longer than usual. ${agent.name} can still deliver, or it may have declined the job.${expiredAt > 0 ? ` If nothing arrives by ${day(expiredAt * 1000)}, you can take your money back.` : ""}`;
    case "delivered":
      return `${agent.name} delivered${submittedAt > 0 ? ` on ${day(submittedAt * 1000)}` : ""}.${paidOutOn ? ` It is paid automatically on ${paidOutOn}.` : ""}`;
    case "settled":
      return `Done. ${agent.name} delivered and has been paid.`;
    case "rejected":
      return "This job was rejected, so the agent was not paid.";
    case "expired":
      return "The deadline passed without a delivery.";
    case "unfunded":
      return "This job was created but never paid for.";
  }
}

/* ────────────────────────────────────────────────────────────────────────── */

export function ManageView({ agent, hire, address }: { agent: Agent; hire: HireRow; address: string }) {
  const jobs = useJobs(agent.agentKey);
  const current = jobs?.[0] ?? null;
  const [cancelled, setCancelled] = useState(false);
  const isCancelled = cancelled || hire.status === "cancelled";
  const isTools = agent.protocol === "mcp";

  return (
    <div className="site-frame page-shell">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <Link className="interactive hover:text-ink" href="/my-agents">
          My agents
        </Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page" className="max-w-[240px] truncate text-ink">
          {agent.name}
        </span>
      </nav>

      <header className="flex flex-col gap-5 pb-2 pt-6 sm:flex-row sm:items-center">
        <AgentIcon category={agent.category} seed={agent.iconSeed} size={64} uri={agent.iconUrl} />
        <div className="min-w-0 flex-1">
          <OneLine as="h1" className="text-[2rem] font-semibold tracking-[-0.035em] text-ink" text={agent.name} />
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.84rem] text-muted">
            <span className="manage-status" data-cancelled={isCancelled || undefined}>
              <span aria-hidden="true" className="manage-status__dot" />
              {isCancelled ? "Cancelled" : "Active"}
            </span>
            <span>{categoryLabel(agent.category)}</span>
            <span>Hired {day(hire.hiredAt)}</span>
          </p>
        </div>
        <Link className="manage-btn manage-btn--quiet" href={`/agent/${agent.tokenId}`}>
          View agent page
          <CategoryGlyph color="currentColor" name="arrow-right" size={14} strokeWidth={2} />
        </Link>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="min-w-0 space-y-5">
          {current ? (
            <JobPanels agent={agent} job={current} />
          ) : (
            <section className="detail-card">
              <h2 className="detail-card__title">Right now</h2>
              {jobs === undefined && hire.paymentJobId ? (
                <p className="mt-2 text-sm text-muted">Reading your jobs...</p>
              ) : isTools ? (
                <>
                  <p className="mt-2 text-[0.9rem] leading-6 text-ink-soft">
                    {isCancelled
                      ? `You removed ${agent.name}.`
                      : `${agent.name} is connected. Your AI app can use its tools whenever you ask.`}
                  </p>
                  {agent.mcpEndpoint && !isCancelled ? <EndpointRow endpoint={agent.mcpEndpoint} /> : null}
                </>
              ) : (
                <p className="mt-2 text-[0.9rem] leading-6 text-ink-soft">
                  No job running. Give {agent.name} a job from its{" "}
                  <Link className="font-medium text-ink underline underline-offset-4" href={`/agent/${agent.tokenId}`}>
                    page
                  </Link>
                  .
                </p>
              )}
            </section>
          )}

          {jobs && jobs.length > 0 ? <JobHistory jobs={jobs} /> : null}

          <section className="detail-card">
            <h2 className="detail-card__title">Your review</h2>
            <p className="mt-1 text-[0.8rem] text-muted">You can review {agent.name} once you have had it for a day.</p>
            <div className="mt-4">
              <TrackRecord agentKey={agent.agentKey} agentName={agent.name} />
            </div>
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24">
          <SidePanel
            address={address}
            agent={agent}
            hire={hire}
            isCancelled={isCancelled}
            job={current}
            onCancelled={() => setCancelled(true)}
          />
        </aside>
      </div>
    </div>
  );
}

function EndpointRow({ endpoint }: { endpoint: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-4 flex items-center gap-2 rounded-xl bg-paper-muted/60 px-4 py-3">
      <code className="min-w-0 flex-1 truncate text-[0.78rem] text-ink">{endpoint}</code>
      <button
        className="manage-btn manage-btn--quiet !min-h-8 !px-3 !text-[0.76rem]"
        onClick={() => {
          void navigator.clipboard.writeText(endpoint).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          });
        }}
        type="button"
      >
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}

/** "Right now" and "What it delivered" for the current job - one poller shared by both. */
function JobPanels({ agent, job }: { agent: Agent; job: AgentJobRow }) {
  const delivery = useJobDelivery(job);
  const onChain = delivery.onChain;
  const delivered = onChain ? hasDeliverable(onChain) : false;
  const request = requestText(job.taskDescription);
  const [copied, setCopied] = useState(false);

  return (
    <>
      <section className="detail-card">
        <div className="flex items-center justify-between gap-3">
          <h2 className="detail-card__title">Right now</h2>
          <button className="text-[0.76rem] font-medium text-muted hover:text-ink" onClick={delivery.refresh} type="button">
            Check now
          </button>
        </div>
        <Tracker state={delivery.state} />
        <p className="mt-4 text-[0.92rem] leading-6 text-ink">
          {job.refundedAt
            ? "You took your money back for this job."
            : nowSentence(agent, delivery.state, onChain?.submittedAt ?? 0, onChain?.expiredAt ?? 0)}
        </p>
        {delivery.isReconnecting ? (
          <p className="mt-1 text-[0.74rem] text-faint">Could not reach the chain just now - showing the last reading.</p>
        ) : null}
        {request ? (
          <div className="mt-4 rounded-xl bg-paper-muted/60 px-4 py-3">
            <p className="text-[0.72rem] text-muted">What you asked for</p>
            <p className="mt-1 line-clamp-4 whitespace-pre-line text-[0.86rem] leading-6 text-ink-soft">{request}</p>
          </div>
        ) : null}
      </section>

      <section className="detail-card">
        <h2 className="detail-card__title">What it delivered</h2>
        {delivered && onChain ? (
          <>
            <p className="mt-2 text-[0.9rem] leading-6 text-ink-soft">
              {agent.name} submitted its result{onChain.submittedAt > 0 ? ` on ${dayTime(onChain.submittedAt * 1000)}` : ""}.
              The result stays with the agent; this fingerprint, recorded on BNB Chain, proves exactly what it submitted.
            </p>
            <div className="mt-4 flex items-center gap-2 rounded-xl bg-paper-muted/60 px-4 py-3">
              <code className="min-w-0 flex-1 truncate font-mono text-[0.74rem] text-ink" title={onChain.deliverable}>
                {onChain.deliverable}
              </code>
              <button
                className="manage-btn manage-btn--quiet !min-h-8 !px-3 !text-[0.76rem]"
                onClick={() => {
                  void navigator.clipboard.writeText(onChain.deliverable).then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1600);
                  });
                }}
                type="button"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </>
        ) : (
          <p className="mt-2 text-[0.9rem] leading-6 text-muted">
            {delivery.isFirstLoad ? "Checking..." : "Nothing delivered yet. It will appear here the moment it is."}
          </p>
        )}
        <a
          className="mt-3 inline-flex items-center gap-1 text-[0.76rem] font-medium text-muted hover:text-ink"
          href={job.transactionHash ? `https://bscscan.com/tx/${job.transactionHash}` : `https://bscscan.com/address/${job.escrowContract}`}
          rel="noreferrer"
          target="_blank"
        >
          See the payment on BscScan
          <CategoryGlyph color="currentColor" name="external" size={12} />
        </a>
      </section>
    </>
  );
}

function JobHistory({ jobs }: { jobs: AgentJobRow[] }) {
  return (
    <section className="detail-card">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="detail-card__title">Every job</h2>
        <span className="text-[0.76rem] text-muted">
          {jobs.length} {jobs.length === 1 ? "job" : "jobs"}
        </span>
      </div>
      <ul className="mt-3 divide-y divide-line/70">
        {jobs.map((job, index) => {
          const request = requestText(job.taskDescription);
          return (
            <li className="flex items-start justify-between gap-4 py-3" key={`${job.escrowContract}:${job.jobId}`}>
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[0.86rem] font-medium text-ink">
                  Job #{job.jobId}
                  {index === 0 ? <span className="rounded-full bg-paper-muted px-2 py-0.5 text-[0.66rem] font-semibold text-ink-soft">Latest</span> : null}
                  {job.refundedAt ? <span className="rounded-full bg-paper-muted px-2 py-0.5 text-[0.66rem] font-semibold text-ink-soft">Refunded</span> : null}
                </p>
                {request ? <p className="mt-0.5 truncate text-[0.78rem] text-muted">{request}</p> : null}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[0.84rem] font-medium text-ink">{paidText(job)}</p>
                <p className="text-[0.72rem] text-faint">{day(job._creationTime)}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function SidePanel({
  agent,
  hire,
  job,
  address,
  isCancelled,
  onCancelled,
}: {
  agent: Agent;
  hire: HireRow;
  job: AgentJobRow | null;
  address: string;
  isCancelled: boolean;
  onCancelled: () => void;
}) {
  const session = useWalletSession();
  const cancelHire = useMutation(agentHiresApi.agentHires.cancelHire);
  const [cancel, setCancel] = useState<"idle" | "cancelling" | { error: string }>("idle");

  const paid = usePriceText({
    amountRaw: job?.budgetRaw,
    token: job?.paymentToken,
    decimals: job?.paymentTokenDecimals,
    symbol: job?.paymentTokenSymbol,
  });

  async function runCancel() {
    setCancel("cancelling");
    try {
      // Signs in if needed rather than sending the person elsewhere to do it.
      let token = session.sessionToken;
      if (!token) {
        token = await session.signIn(address);
        if (!token) {
          setCancel("idle");
          return;
        }
      }
      await cancelHire({ agentKey: agent.agentKey, sessionToken: token });
      track("hire_cancelled", { agentKey: agent.agentKey });
      onCancelled();
      setCancel("idle");
    } catch (cause) {
      setCancel({ error: toUserMessage(cause, "The hire could not be cancelled. Nothing has changed.") });
    }
  }

  const rows: [string, string][] = [
    ["Status", isCancelled ? "Cancelled" : "Active"],
    ["Hired", day(hire.hiredAt)],
    ["Paid", job ? priceTextOr(paid, paidText(job)) : agent.protocol === "mcp" ? "Free" : "Nothing yet"],
  ];
  if (job) rows.push(["Job", `#${job.jobId}`]);

  return (
    <section className="detail-card">
      <h2 className="detail-card__title">Your hire</h2>
      <dl className="mt-3 divide-y divide-line/70">
        {rows.map(([label, value]) => (
          <div className="flex items-center justify-between gap-3 py-2.5 text-[0.84rem]" key={label}>
            <dt className="text-muted">{label}</dt>
            <dd className="font-medium text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      {job ? <RefundAction job={job} /> : null}

      <div className="mt-5 border-t border-line/70 pt-4">
        {isCancelled ? (
          <p className="text-[0.8rem] leading-5 text-muted">
            This hire is cancelled. It stays in your history, and you can still review {agent.name}.
          </p>
        ) : (
          /*
           * HOLD TO CANCEL (owner, 2026-09-29): a press-and-hold replaces the
           * two-step confirm. Letting go early changes nothing; what it does and
           * does not do is said above it, before the hand is on it.
           */
          <div>
            <p className="mb-3 text-[0.78rem] leading-5 text-muted">
              Cancelling removes {agent.name} from your active list.
              {job ? " It does not refund a payment - that money is held on-chain, where Dolphin has no control." : ""}
            </p>
            <HoldButton
              backgroundColor="var(--paper)"
              className="manage-hold"
              disabled={cancel === "cancelling"}
              doneLabel="Cancelling..."
              fillColor="#c9362b"
              fillTextColor="#ffffff"
              holdTime={1600}
              onHold={() => void runCancel()}
              radius={11}
              resetAfter={1800}
              size="md"
              textColor="var(--hold-danger)"
            >
              Hold to cancel hire
            </HoldButton>
          </div>
        )}
        {typeof cancel === "object" ? (
          <p className="mt-2 text-[0.76rem] leading-5 text-danger" role="alert">
            {cancel.error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Take the money back - offered only once the chain's own deadline has passed
 * with nothing delivered (the kernel reverts an early claim; this just avoids
 * showing a button that cannot work).
 */
function RefundAction({ job }: { job: AgentJobRow }) {
  const wallet = useAltanaWallet();
  const delivery = useJobDelivery(job);
  const now = useNow();
  const [state, setState] = useState<"idle" | "claiming" | "done" | { error: string }>("idle");
  const onChain = delivery.onChain;
  const due = onChain !== undefined && !hasDeliverable(onChain) && onChain.expiredAt > 0 && now >= onChain.expiredAt * 1000;

  if (job.refundedAt) return <p className="mt-4 text-[0.8rem] text-muted">Refunded on {day(job.refundedAt)}.</p>;
  if (!due) return null;

  return (
    <div className="mt-4">
      {state === "done" ? (
        <p className="text-[0.8rem] text-ink">Refund claimed. It returns to your Dolphin Wallet once the chain confirms it.</p>
      ) : (
        <>
          <button
            className="manage-btn manage-btn--primary w-full"
            disabled={state === "claiming" || wallet.isBusy}
            onClick={() => {
              setState("claiming");
              void wallet.claimEscrowRefund(job.jobId).then(
                () => setState("done"),
                (cause: unknown) => setState({ error: toUserMessage(cause, "That refund could not be claimed. Try again.") }),
              );
            }}
            type="button"
          >
            {state === "claiming" ? "Confirm with your passkey..." : `Take back ${paidText(job)}`}
          </button>
          <p className="mt-2 text-[0.74rem] leading-5 text-muted">It never delivered and the deadline has passed, so this money is yours.</p>
          {typeof state === "object" ? (
            <p className="mt-2 text-[0.74rem] leading-5 text-danger" role="alert">
              {state.error}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
