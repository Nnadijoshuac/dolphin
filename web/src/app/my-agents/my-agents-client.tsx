"use client";

/**
 * MY AGENTS (revamped 2026-09-29 - owner: "think it through: what would
 * somebody need to see?").
 *
 * The old page listed hires only, as bare rows - the agents a person BUILT,
 * half the product, appeared nowhere. This answers, in order:
 *
 *   At a glance      how many built, trading on their own, practising, hired
 *   You built        each agent's state and what it is doing: trading on its
 *                    own until a date, practising, or waiting; when it runs
 *                    next; its practice trades; a way back into the builder
 *   You hired        each hire's live job state, what was paid, and Manage
 *   Recent activity  every wallet action, from its receipt
 *
 * Every value is read - convex/myAgents.ts, the hire records and the chain -
 * and nothing is estimated (no P&L: it would need prices Dolphin has not read).
 */

import Link from "next/link";
import { useQuery } from "convex/react";

import { AgentActivity } from "@/components/agent-activity";
import { AgentIcon } from "@/components/agent-icon";
import { CategoryGlyph } from "@/components/category-glyph";
import { MobileMenuButton } from "@/components/mobile-nav";
import { StatePanel } from "@/components/state-panel";
import { agentRouteId, categoryLabel } from "@/constants/agents";
import { agentPaymentsApi, myAgentsApi, type AgentJobRow, type MyBuiltAgent } from "@/convex/api";
import { useAgentsByKeys } from "@/hooks/use-agents";
import { useHiredAgents } from "@/hooks/use-hired-agents";
import { useJobDelivery } from "@/hooks/use-job-delivery";
import { useNow } from "@/hooks/use-now";
import { convexClient } from "@/providers/convex-provider";
import type { Agent } from "@/types/agent";
import { useAltanaWallet } from "@/wallet/altana-provider";
import type { DeliveryState } from "@/wallet/erc8183-job";
import { formatTokenAmount } from "@/wallet/erc8183-policy";
import { WalletConnectButton, useWallet } from "@/wallet/wallet-provider";
import { useWalletSession } from "@/wallet/wallet-session";

function day(value: number | string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short" }).format(date);
}

/** "in 38m", "3h ago" - relative to the shared clock, never Date.now() in render. */
function relative(at: number, now: number): string | null {
  if (!now || !Number.isFinite(at)) return null;
  const diff = at - now;
  const minutes = Math.round(Math.abs(diff) / 60_000);
  const text =
    minutes < 1 ? "now" : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes / 1440)}d`;
  if (text === "now") return diff >= 0 ? "any moment" : "just now";
  return diff >= 0 ? `in ${text}` : `${text} ago`;
}

/* ── Built ─────────────────────────────────────────────────────────────── */

type Doing = { tone: "live" | "practice" | "idle"; text: string };

function doingFor(agent: MyBuiltAgent): Doing {
  if (agent.trading?.status === "active") return { tone: "live", text: `Trading on its own until ${day(agent.trading.expiresAt)}` };
  if (agent.paperMode) return { tone: "practice", text: "Practising with pretend money" };
  return { tone: "idle", text: "Live - each trade waits for your approval" };
}

function BuiltCard({ agent, now }: { agent: MyBuiltAgent; now: number }) {
  const doing = doingFor(agent);
  const next = agent.nextRunAt ? relative(agent.nextRunAt, now) : null;
  const lastTrade = agent.lastTradeAt ? relative(Date.parse(agent.lastTradeAt), now) : null;
  const badge = agent.published ? (agent.published.visibility === "private" ? "Just for me" : "Public") : "Draft";

  return (
    <article className="mine-card">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 truncate text-[1rem] font-semibold tracking-[-0.02em] text-ink">{agent.name}</h3>
        <span className="mine-badge" data-kind={badge === "Draft" ? "draft" : "live"}>
          {badge}
        </span>
      </div>
      {agent.description ? <p className="mt-1 line-clamp-2 text-[0.82rem] leading-5 text-muted">{agent.description}</p> : null}

      <p className="mine-doing" data-tone={doing.tone}>
        <span aria-hidden="true" className="mine-doing__dot" />
        {doing.text}
      </p>

      <dl className="mine-facts">
        <div>
          <dt>Next run</dt>
          <dd>{next ?? "No trigger"}</dd>
        </div>
        <div>
          <dt>Practice trades</dt>
          <dd>
            {agent.practiceTrades}
            {agent.practiceTradesCapped ? "+" : ""}
            {lastTrade ? <span className="text-faint"> · last {lastTrade}</span> : null}
          </dd>
        </div>
      </dl>

      <div className="mine-actions">
        {agent.conversationKey ? (
          <Link className="manage-btn manage-btn--primary !min-h-9 flex-1" href={`/dolphin?c=${agent.conversationKey}`}>
            Open in builder
          </Link>
        ) : null}
        {agent.published && agent.published.visibility === "public" ? (
          <Link className="manage-btn manage-btn--quiet !min-h-9" href={`/agent/${agent.published.hash}`}>
            Public page
          </Link>
        ) : null}
      </div>
    </article>
  );
}

function BuiltSection({ address }: { address: string }) {
  const session = useWalletSession();
  const now = useNow();
  const built = useQuery(myAgentsApi.myAgents.built, session.sessionToken ? { sessionToken: session.sessionToken } : "skip");

  return (
    <section aria-labelledby="mine-built" className="mine-section">
      <div className="discover-section__head">
        <div>
          <h2 className="discover-section__title" id="mine-built">
            Agents you built
          </h2>
          <p className="discover-section__sub">What each one is doing right now.</p>
        </div>
        <Link className="discover-link !mt-0" href="/dolphin">
          Build another
          <CategoryGlyph color="currentColor" name="arrow-right" size={14} strokeWidth={2} />
        </Link>
      </div>

      {!session.sessionToken ? (
        <div className="mine-empty">
          <p className="text-[0.9rem] text-ink-soft">Sign in with your wallet to see the agents you built. It is a signature, not a transaction.</p>
          <button className="manage-btn manage-btn--primary mt-4" onClick={() => void session.signIn(address)} type="button">
            Sign in
          </button>
        </div>
      ) : built === undefined ? (
        <div className="mine-grid">
          {[0, 1].map((item) => (
            <div aria-hidden="true" className="mine-card skeleton h-[230px]" key={item} />
          ))}
        </div>
      ) : built.length === 0 ? (
        <div className="mine-empty">
          <p className="text-[0.95rem] font-medium text-ink">You have not built an agent yet.</p>
          <p className="mt-1 text-[0.86rem] text-muted">Describe what it should do in plain words, and Dolphin puts it together.</p>
          <Link className="manage-btn manage-btn--primary mt-4" href="/dolphin">
            Build your first agent
          </Link>
        </div>
      ) : (
        <div className="mine-grid">
          {built.map((agent) => (
            <BuiltCard agent={agent} key={agent.conversationKey ?? agent.name} now={now} />
          ))}
        </div>
      )}
    </section>
  );
}

/* ── Hired ─────────────────────────────────────────────────────────────── */

const JOB_WORDS: Record<DeliveryState, { tone: "live" | "practice" | "idle"; text: string }> = {
  working: { tone: "live", text: "Working on your job" },
  declined: { tone: "practice", text: "Job declined - money safe" },
  overdue: { tone: "practice", text: "Taking longer than usual" },
  missed: { tone: "practice", text: "Not delivered - money safe" },
  delivered: { tone: "live", text: "Delivered" },
  settled: { tone: "idle", text: "Delivered" },
  rejected: { tone: "idle", text: "Job rejected" },
  expired: { tone: "practice", text: "Deadline passed - refund available" },
  unfunded: { tone: "idle", text: "Job not paid for" },
};

function HiredStatus({ job }: { job: AgentJobRow }) {
  const delivery = useJobDelivery(job);
  const words = job.refundedAt
    ? { tone: "idle" as const, text: "Refunded" }
    : delivery.state
      ? JOB_WORDS[delivery.state]
      : { tone: "idle" as const, text: "Checking the job..." };
  return (
    <p className="mine-doing" data-tone={words.tone}>
      <span aria-hidden="true" className="mine-doing__dot" />
      {words.text}
    </p>
  );
}

function HiredCard({
  agent,
  hire,
  job,
}: {
  agent: Agent | undefined;
  hire: { agentKey: string; status: "active" | "cancelled"; hiredAt: string };
  job: AgentJobRow | null;
}) {
  const cancelled = hire.status === "cancelled";
  return (
    <Link className="mine-card mine-card--link" href={`/manage/${agentRouteId(agent?.agentKey ?? hire.agentKey)}`}>
      <div className="flex items-center gap-3">
        <AgentIcon category={agent?.category ?? "general"} seed={agent?.iconSeed} size={40} uri={agent?.iconUrl} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[0.98rem] font-semibold tracking-[-0.02em] text-ink">{agent?.name ?? "Agent"}</h3>
          <p className="truncate text-[0.74rem] text-muted">
            {agent ? categoryLabel(agent.category) : ""} · hired {day(hire.hiredAt)}
          </p>
        </div>
      </div>
      {cancelled ? (
        <p className="mine-doing" data-tone="idle">
          <span aria-hidden="true" className="mine-doing__dot" />
          Cancelled
        </p>
      ) : job ? (
        <HiredStatus job={job} />
      ) : (
        <p className="mine-doing" data-tone="live">
          <span aria-hidden="true" className="mine-doing__dot" />
          {agent?.protocol === "mcp" ? "Connected - your AI app can use it" : "Ready - no job running"}
        </p>
      )}
      <div className="mine-card__foot">
        <span className="text-[0.8rem] text-muted">
          {job ? `Paid ${formatTokenAmount(job.budgetRaw, job.paymentTokenDecimals)} ${job.paymentTokenSymbol}` : "Free"}
        </span>
        <span className="mine-card__manage">
          Manage
          <CategoryGlyph color="currentColor" name="arrow-right" size={14} strokeWidth={2} />
        </span>
      </div>
    </Link>
  );
}

function HiredSection({ address }: { address: string }) {
  const hires = useHiredAgents(address);
  const agents = useAgentsByKeys((hires ?? []).map((hire) => hire.agentKey));
  const wallet = useAltanaWallet();
  // All of this Dolphin Wallet's jobs in one read, matched to hires below.
  const jobs = useQuery(
    agentPaymentsApi.agentPayments.getJobsForAltanaWallet,
    wallet.address ? { altanaWalletAddress: wallet.address } : "skip",
  ) as AgentJobRow[] | undefined;
  const latestJob = (agentKey: string) => jobs?.find((job) => job.agentKey === agentKey) ?? null;

  return (
    <section aria-labelledby="mine-hired" className="mine-section">
      <div className="discover-section__head">
        <div>
          <h2 className="discover-section__title" id="mine-hired">
            Agents you hired
          </h2>
          <p className="discover-section__sub">Their jobs, as the chain reports them.</p>
        </div>
        <Link className="discover-link !mt-0" href="/search">
          Find more
          <CategoryGlyph color="currentColor" name="arrow-right" size={14} strokeWidth={2} />
        </Link>
      </div>
      {hires === undefined ? (
        <div className="mine-grid">
          <div aria-hidden="true" className="mine-card skeleton h-[150px]" />
        </div>
      ) : hires.length === 0 ? (
        <div className="mine-empty">
          <p className="text-[0.95rem] font-medium text-ink">You have not hired an agent yet.</p>
          <p className="mt-1 text-[0.86rem] text-muted">Every agent in the catalog answered when Dolphin called it.</p>
          <Link className="manage-btn manage-btn--quiet mt-4" href="/search">
            Browse agents
          </Link>
        </div>
      ) : (
        <div className="mine-grid">
          {hires.map((hire) => (
            <HiredCard agent={agents.get(hire.agentKey)} hire={hire} job={latestJob(hire.agentKey)} key={`${hire.agentKey}-${hire.hiredAt}`} />
          ))}
        </div>
      )}
    </section>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────── */

function Glance({ address }: { address: string }) {
  const session = useWalletSession();
  const built = useQuery(myAgentsApi.myAgents.built, session.sessionToken ? { sessionToken: session.sessionToken } : "skip");
  const hires = useHiredAgents(address);
  // Only once the built list is read: a strip of dashes reads as broken, not as loading.
  if (!built || !hires) return null;
  // A new wallet has nothing to count; the empty states below say what to do instead.
  if (built.length === 0 && hires.length === 0) return null;
  const trading = built?.filter((agent) => agent.trading?.status === "active").length ?? null;
  const practising = built?.filter((agent) => agent.paperMode && agent.trading?.status !== "active").length ?? null;
  const facts = [
    { label: "Built", value: built ? String(built.length) : "-" },
    { label: "Trading on their own", value: trading === null ? "-" : String(trading), dot: (trading ?? 0) > 0 },
    { label: "Practising", value: practising === null ? "-" : String(practising) },
    { label: "Hired", value: hires ? String(hires.filter((hire) => hire.status === "active").length) : "-" },
  ];
  return (
    <dl className="glance">
      {facts.map((fact) => (
        <div className="glance__item" key={fact.label}>
          <dt className="glance__label">{fact.label}</dt>
          <dd className="glance__value">
            {fact.dot ? <span aria-hidden="true" className="glance__dot" /> : null}
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function MyAgentsClient() {
  const wallet = useWallet();

  return (
    <div className="mobile-my-agents site-frame page-shell">
      <header className="mobile-only mobile-page-heading">
        <div>
          <h1>My Agents</h1>
          <p>What you built and hired</p>
        </div>
        <MobileMenuButton />
      </header>

      <div className="mine-head">
        <div>
          <h1 className="catalog-title">My agents</h1>
          <p className="catalog-count">Everything you built and hired, and what it is doing.</p>
        </div>
        <div className="flex gap-2">
          <Link className="manage-btn manage-btn--quiet" href="/search">
            Browse agents
          </Link>
          <Link className="manage-btn manage-btn--primary" href="/dolphin">
            Build an agent
          </Link>
        </div>
      </div>

      {!wallet.isConnected || !wallet.address ? (
        <div className="detail-card mx-auto mt-10 max-w-xl text-center">
          <h2 className="text-xl font-semibold tracking-[-0.03em] text-ink">Connect your wallet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">
            Your agents belong to your wallet. Connecting only lets Dolphin find them - it cannot spend anything.
          </p>
          <div className="mt-5 flex justify-center">
            <WalletConnectButton />
          </div>
        </div>
      ) : !convexClient ? (
        <div className="mt-8">
          <StatePanel body="This deployment is not connected to Dolphin's backend, so your agents cannot be read." state="unavailable" title="Agents unavailable" />
        </div>
      ) : (
        <>
          <Glance address={wallet.address} />
          <BuiltSection address={wallet.address} />
          <HiredSection address={wallet.address} />
          <section className="mine-section">
            <AgentActivity maxRows={8} />
          </section>
        </>
      )}
    </div>
  );
}
