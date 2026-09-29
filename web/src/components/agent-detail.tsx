"use client";

import { ByDolphin } from "@/components/by-dolphin";
import Link from "next/link";
import { useState } from "react";

import { AgentIcon } from "@/components/agent-icon";
import { CategoryGlyph } from "@/components/category-glyph";
import { AgentTransactionPanel } from "@/components/agent-transaction-panel";
import { AgentTrialPanel } from "@/components/agent-trial-panel";
import { FavoriteButton } from "@/components/favorite-button";
import { HireAction } from "@/components/hire-action";
import { McpUseAction } from "@/components/mcp-use-action";
import { MobileAgentDetail } from "@/components/mobile-agent-detail";
import { useMobileLayout } from "@/hooks/use-mobile-layout";
import { useNow } from "@/hooks/use-now";
import { PerformancePanel } from "@/components/performance-panel";
import { TrackRecord } from "@/components/track-record";
import { useAgentCategoryStats } from "@/hooks/use-category-stats";
import { categoryLabel } from "@/constants/agents";
import { convexClient } from "@/providers/convex-provider";
import type { Agent, AgentLiveStats, LiveMetric } from "@/types/agent";

function shortAddress(value: string | null) {
  if (!value) return "Not published";
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function formatList(values: string[]) {
  return values.length > 0 ? values.join(", ") : "None";
}

function formatDate(value: string | null) {
  if (!value) return "Not published";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

function syncingLiveStats(stats: AgentLiveStats): AgentLiveStats {
  return Object.fromEntries(
    Object.entries(stats).map(([key, field]) =>
      key === "category"
        ? [key, field]
        : [
            key,
            {
              status: "syncing",
              value: null,
              asOf: null,
              source: (field as LiveMetric<unknown>).source,
            },
          ],
    ),
  ) as AgentLiveStats;
}

function LiveStats({ agent }: { agent: Agent }) {
  if (!agent.hasLiveStats) return null;

  if (!convexClient) {
    return agent.liveStats ? <LiveStatsView stats={agent.liveStats} /> : null;
  }

  return <BackendLiveStats agent={agent} />;
}

function BackendLiveStats({ agent }: { agent: Agent }) {
  const cached = useAgentCategoryStats(
    agent.agentKey,
    agent.category,
    agent.agentWallet,
  );
  if (!agent.liveStats) return null;
  const stats = cached?.stats ?? syncingLiveStats(agent.liveStats);

  return <LiveStatsView stats={stats} />;
}

type StatTile = { label: string; value: string | null; stale: boolean };

function tile<T>(label: string, metric: LiveMetric<T>, format: (value: T) => string): StatTile {
  const has = (metric.status === "live" || metric.status === "stale") && metric.value !== null;
  return { label, value: has ? format(metric.value as T) : null, stale: metric.status === "stale" };
}

function tilesFor(stats: AgentLiveStats): StatTile[] {
  switch (stats.category) {
    case "monitoring":
      return [
        tile("Alert frequency", stats.alertFrequency, (value) => value),
        tile("Assets watched", stats.assetsWatched, formatList),
        tile("Last alert", stats.lastAlertAt, (value) => value),
        tile("False positives", stats.falsePositiveRate, (value) => `${value.toFixed(1)}%`),
      ];
    case "rebalancing":
      return [
        tile("Historical win rate", stats.winRate, (value) => `${value.toFixed(1)}%`),
        tile("Active LP range", stats.activeRange, (value) => value),
        tile("Current P&L", stats.currentPnl, (value) => value),
        tile("LP positions monitored", stats.positionCount, (value) => String(value)),
      ];
    case "grid-trading":
      return [
        tile("Historical win rate", stats.winRate, (value) => `${value.toFixed(1)}%`),
        tile("Active grid range", stats.activeRange, (value) => value),
        tile("Current P&L", stats.currentPnl, (value) => value),
        tile("Positions monitored", stats.positionCount, (value) => String(value)),
      ];
    case "health-factor":
      return [
        tile("Venus health factor", stats.averageHealthFactor, (value) => value.toFixed(2)),
        tile("Loan positions monitored", stats.positionsMonitored, (value) => String(value)),
        tile("Liquidations prevented", stats.liquidationsPrevented, (value) => String(value)),
        tile("Response latency", stats.responseLatencyMs, (value) => `${value}ms`),
      ];
    case "yield":
      /*
       * "Total value managed" and "Protocols used" were REMOVED (2026-09-12):
       * both read the agent's OWN wallet, which an agent managing YOUR position
       * never funds, so they could never be non-zero. See git history.
       */
      return [
        tile("Current APY", stats.currentApy, (value) => `${value.toFixed(2)}%`),
        tile("Rebalance cadence", stats.rebalanceFrequency, (value) => value),
      ];
    case "trading":
      return [
        tile("Historical win rate", stats.winRate, (value) => `${value.toFixed(1)}%`),
        tile("Trades executed", stats.tradesExecuted, (value) => String(value)),
        tile("Realized P&L", stats.realizedPnl, (value) => value),
        tile("Markets traded", stats.marketsTraded, formatList),
      ];
    default:
      return [];
  }
}

/**
 * ONLY WHAT WAS READ (owner cleanup, 2026-09-29). This rendered every metric
 * the category defines, and for most agents most of them are unavailable - a
 * wall of "Unavailable" with a source and a timestamp under each. §5 forbids
 * inventing a number; it does not require listing every number we lack. A
 * metric with a real reading is shown; the rest are left out, and when none
 * has one the section is not rendered at all.
 */
function LiveStatsView({ stats }: { stats: AgentLiveStats }) {
  const shown = tilesFor(stats).filter((item) => item.value !== null);
  if (shown.length === 0) return null;
  return (
    <section className="detail-card">
      <h2 className="detail-card__title">Live on-chain</h2>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {shown.map((item) => (
          <div className="min-w-0 rounded-xl bg-paper-muted/60 px-4 py-3" key={item.label}>
            <dt className="truncate text-[0.72rem] text-muted">{item.label}</dt>
            <dd className="mt-1 truncate text-xl font-semibold tracking-[-0.03em] text-ink">{item.value}</dd>
            {item.stale ? <dd className="mt-0.5 text-[0.68rem] text-faint">Earlier reading</dd> : null}
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Collapsible Accordion for On-chain and Technical Records */
/**
 * WHETHER THIS AGENT IS ANSWERING, said at the top of its page (2026-09-26).
 *
 * Set and Earn: "where an agent's data is stale or the agent isn't
 * responding, say so on the page rather than hiding it". The page had no such
 * line: an agent Dolphin had delisted after five failed probes rendered
 * exactly like a healthy one, hire button and all.
 */
/** "Answering · checked 7h ago" - relative, in the header's one meta line. */
function AnsweringBadge({ agent }: { agent: Agent }) {
  const now = useNow();
  if (agent.status !== "live") return null;
  const lastChecked = agent.verification?.lastProbeAt ?? agent.verifiedAt;
  const ago = relativeAgo(lastChecked, now);
  return (
    <span className="inline-flex items-center gap-1.5" title={lastChecked ? `Last checked ${formatDate(lastChecked)} UTC` : undefined}>
      {/* The same live green as the catalog cards' "Answered" dot. */}
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#22a55b]" />
      <span className="font-medium text-ink-soft">Answering</span>
      {ago ? <span className="text-faint">· checked {ago}</span> : null}
    </span>
  );
}

function relativeAgo(value: string | null | undefined, now: number): string | null {
  if (!value || now === 0) return null;
  const at = new Date(value).getTime();
  if (Number.isNaN(at) || at > now) return null;
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function AvailabilityNotice({ agent }: { agent: Agent }) {
  const check = agent.verification;
  const lastChecked = check?.lastProbeAt ?? agent.verifiedAt;
  const lastAnswered = check?.lastOkAt ?? null;

  if (agent.status === "live") {
    // Said inline in the header's meta line (AnsweringBadge), not as a notice.
    return null;
  }

  if (agent.status === "duplicate") {
    return (
      <p className="mt-6 rounded-xl border border-line bg-paper-muted px-4 py-3 text-sm text-muted">
        <span className="font-semibold text-ink">Another registration of a listed agent.</span>{" "}
        Its publisher registered the same agent more than once, so Dolphin lists one of them.
      </p>
    );
  }

  const delisted = agent.status === "unavailable";
  return (
    <div
      className={`mt-6 rounded-xl border px-4 py-3 text-sm ${
        delisted ? "border-danger/30 bg-danger-soft" : "border-accent/40 bg-accent-soft"
      }`}
      role="status"
    >
      <p className="font-semibold text-ink">
        {delisted
          ? "Not responding. This agent is no longer listed and cannot be hired."
          : "Not answering right now. Dolphin is retrying; a hire may fail until it recovers."}
      </p>
      <p className="mt-1 text-muted">
        Last answered {lastAnswered ? `${formatDate(lastAnswered)} UTC` : "never"} · last checked{" "}
        {formatDate(lastChecked)} UTC
        {check && check.consecutiveFailures > 0
          ? ` · ${check.consecutiveFailures} failed ${check.consecutiveFailures === 1 ? "check" : "checks"} in a row`
          : ""}
      </p>
      {check?.detail ? <p className="mt-1 break-words text-xs text-muted">{check.detail}</p> : null}
    </div>
  );
}

function TechnicalDetailsAccordion({
  agent,
  isRegistryVerified,
}: {
  agent: Agent;
  isRegistryVerified: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const facts = [
    ["ERC-8004 Token", `#${agent.tokenId}`],
    ["Network", "BNB Smart Chain (Chain ID: 56)"],
    ["Protocol Type", agent.protocol === "mcp" ? "MCP Server" : "A2A Agent"],
    /*
     * READ OFF THE TOOL LIST, NOT THE NAME.
     *
     * Measured 2026-09-12: every agent in the "trading" category publishes only
     * reads, while agents filed under health-factor and yield publish real Aave
     * V3 writes. The name and the capability disagreed and only the name was on
     * screen, so this states the capability beside it. Evidence, not a claim -
     * the count is the agent's own published tools.
     */
    [
      "Can it act?",
      agent.execution.kind === "calldata"
        ? `Builds transactions you sign (${agent.execution.calldataTools.length} tools)`
        : agent.execution.kind === "direct"
          ? `Publishes ${agent.execution.writeTools.length} on-chain write tools`
          : "Reads and reports only",
    ],
    ["Identity Registry", shortAddress(agent.registryAddress)],
    ["Publisher Address", shortAddress(agent.publisherAddress)],
    ["Agent Wallet", shortAddress(agent.agentWallet)],
    [
      "Registered Date",
      agent.registeredAt ? `${formatDate(agent.registeredAt)} UTC` : "Not reported",
    ],
    ["Verified Endpoint", agent.services[0]?.endpoint ?? "Not reported"],
    ["Last checked", `${formatDate(agent.verification?.lastProbeAt ?? agent.verifiedAt)} UTC`],
    [
      "Last answered",
      agent.verification?.lastOkAt ? `${formatDate(agent.verification.lastOkAt)} UTC` : "Not recorded",
    ],
  ] as const;
  // The token's own page on BscScan lists its mint (registration) transaction.
  const registrationRecord = `https://bscscan.com/nft/${agent.registryAddress}/${agent.tokenId}`;

  return (
    <section className="detail-card overflow-hidden !p-0">
      <button
        aria-expanded={isOpen}
        className="interactive flex w-full items-center justify-between px-6 py-5 text-left"
        onClick={() => setIsOpen((prev) => !prev)}
        type="button"
      >
        <div>
          <div className="flex items-center gap-2">
            <h2 className="detail-card__title">Registry details</h2>
            {isRegistryVerified ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[10px] font-semibold text-success border border-success/30">
                Verified
              </span>
            ) : null}
          </div>
        </div>
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-full text-muted transition-transform duration-200 ${
            isOpen ? "rotate-90" : ""
          }`}
        >
          <CategoryGlyph color="currentColor" name="chevron-right" size={14} />
        </span>
      </button>

      {isOpen ? (
        <div className="space-y-6 border-t border-line/70 px-6 pb-6 pt-4">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 text-xs">
            {facts.map(([label, value]) => (
              <div
                className="flex flex-col justify-center border-b border-line/60 pb-3"
                key={label}
              >
                <dt className="text-muted font-medium">{label}</dt>
                <dd className="mt-1 font-mono font-semibold text-ink break-all">
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          <a
            className="interactive inline-flex items-center gap-1 text-xs font-semibold text-ink underline underline-offset-4 hover:text-accent-ink"
            href={registrationRecord}
            rel="noreferrer"
            target="_blank"
          >
            Registration record and transactions on BscScan ↗
          </a>

          {agent.sourceLabels.length > 0 ? (
            <div className="border-t border-line/60 pt-4">
              <p className="text-xs font-semibold text-muted mb-2">Sources attached to this record:</p>
              <ul className="space-y-1.5">
                {agent.sourceLabels.map((source) => (
                  <li
                    className="flex items-center justify-between text-xs py-1 border-b border-line/40 last:border-b-0"
                    key={source.id}
                  >
                    <span className="text-muted">{source.label}</span>
                    {source.url ? (
                      <a
                        className="interactive font-medium text-ink underline underline-offset-4 hover:text-accent-ink"
                        href={source.url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Source URL ↗
                      </a>
                    ) : (
                      <span className="text-faint text-[11px]">No public URL</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="text-[11px] leading-relaxed text-muted bg-paper-muted p-3.5 rounded-xl border border-line/80">
            Token identity #{agent.tokenId} is verified directly against the ERC-8004 registry on BNB Smart Chain. Dolphin never asks for private keys or seed phrases.
          </p>
        </div>
      ) : null}
    </section>
  );
}

export function AgentDetail({ agent }: { agent: Agent }) {
  const isMobile = useMobileLayout();
  const registryStatus = agent.registryVerification.registered;
  const isRegistryVerified =
    (registryStatus.status === "live" || registryStatus.status === "stale") &&
    registryStatus.value;

  const normalized = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
  const showDescription =
    Boolean(agent.description?.trim()) && normalized(agent.description) !== normalized(agent.tagline ?? "");

  const publisherDisplay = agent.publisher?.startsWith("0x")
    ? shortAddress(agent.publisher)
    : agent.publisher || "Unlisted publisher";

  if (isMobile) {
    return (
      <>
        <div className="px-4">
          <AvailabilityNotice agent={agent} />
        </div>
        <MobileAgentDetail agent={agent} registry={<TechnicalDetailsAccordion agent={agent} isRegistryVerified={Boolean(isRegistryVerified)} />} />
      </>
    );
  }

  return (
    <div className="site-frame pb-16 pt-6 sm:pb-24 sm:pt-8">
      {/* ── Breadcrumb ── */}
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <Link className="interactive hover:text-ink" href="/">
          Discover
        </Link>
        <span aria-hidden="true">/</span>
        <Link
          className="interactive hover:text-ink"
          href={`/search?category=${agent.category}`}
        >
          {categoryLabel(agent.category)}
        </Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page" className="font-medium text-ink truncate max-w-[240px]">
          {agent.name}
        </span>
      </nav>

      {/* ── Hero Header ── */}
      <header className="pb-2 pt-6 sm:pt-8">
        <div className="flex flex-col sm:flex-row sm:items-start gap-5">
          <div className="shrink-0">
            <AgentIcon category={agent.category} seed={agent.iconSeed} size={72} uri={agent.iconUrl} />
          </div>

          {/*
           * No badge row here - no category, no protocol, no verification chip.
           *
           * Three chips led the page with taxonomy and a claim before the reader
           * had been told what the agent IS. The category is which drawer it
           * browses in, the protocol is how Dolphin talks to it rather than a
           * choice the reader makes, and "Verified on BNB Chain" is the weakest
           * of the three in the strongest position: it means the token resolves
           * on the identity registry, which is true of 307,559 identities and is
           * NOT the verification that matters here. What earns a listing is that
           * the agent answered its own protocol, and that is what the action card
           * and the detail record say.
           *
           * Nothing is lost. The category is in the breadcrumb directly above and
           * on the cards that led here, and the protocol and the registry record
           * are both in "Details & Registry Record" below, which carries its own
           * Verified chip next to the on-chain parameters that back it up.
           *
           * Mirrors the same removal in src/components/agent-detail.tsx.
           */}
          <div className="min-w-0 flex-1">
            {/* Agent Name */}
            <div className="flex items-start justify-between gap-4">
              <h1 className="text-3xl font-semibold tracking-[-0.035em] text-ink sm:text-[2.4rem]">
                {agent.name}
                {agent.firstParty ? <ByDolphin /> : null}
              </h1>
              <FavoriteButton agentKey={agent.agentKey} agentName={agent.name} className="mt-1" />
            </div>

            {/* Tagline */}
            {agent.tagline ? (
              <p className="mt-2 max-w-3xl text-[1.02rem] leading-relaxed text-ink-soft">
                {agent.tagline}
              </p>
            ) : null}

            {/* Metadata Footer */}
            {/* One quiet line. Token id and chain live in Registry details. */}
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[0.8rem] text-muted">
              <span>
                by <span className="font-medium text-ink">{publisherDisplay}</span>
              </span>
              <AnsweringBadge agent={agent} />
            </div>
          </div>
        </div>
        <AvailabilityNotice agent={agent} />
      </header>

      {/* ── Main Layout: Content & Action Sidebar ── */}
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-12 lg:items-start">
        {/* Action Card: On mobile it is order-1 (one of the first things seen!), on desktop it is order-2 (sticky right column) */}
        <aside className="order-1 lg:order-2 lg:sticky lg:top-24 space-y-4">
          {/* A delisted agent failed its last several probes: a hire would start
              a quote request nothing answers. The notice above says why. */}
          {agent.status === "unavailable" ? null : agent.protocol === "mcp" ? (
            <McpUseAction agent={agent} />
          ) : (
            <HireAction agent={agent} />
          )}

          {/*
            Only renders for an agent whose own tool list says it BUILDS
            transactions (execution.kind === "calldata"). The component
            returns null otherwise, so a read-only agent's page is unchanged
            and a direct-write agent is deliberately not offered a button -
            see convex/agentTools.ts for why that boundary is held.
          */}
          <AgentTransactionPanel agent={agent} />

          {/*
            Running the agent, free, before anything is connected or signed.
            Placed in the action column ABOVE nothing and below the primary
            CTA on purpose: it is the cheapest thing on the page to say yes to,
            and the only one that returns something. Renders null for an A2A
            agent and for an MCP agent with no read-only tool.
          */}
          <AgentTrialPanel agent={agent} />

          {/*
            Opens Dolphin with this agent already in context, so a conversation
            started from an agent's page does not begin cold.

            Deliberately secondary to the action above it. Using the agent
            directly is the primary thing to do here; asking Dolphin about it is
            the thing to do when you do not yet know whether you want it.
          */}
          <Link
            className="flex items-center justify-center gap-2 rounded-xl border border-line bg-paper-strong px-4 py-3 text-sm font-semibold text-ink transition-colors hover:border-line-strong hover:bg-paper-muted"
            href={`/dolphin?agent=${encodeURIComponent(agent.id)}&name=${encodeURIComponent(agent.name)}&ask=1`}
          >
            <CategoryGlyph name="sparkle" size={16} />
            Ask Dolphin about this agent
          </Link>
        </aside>

        {/* Left Column: Core Agent Information */}
        <div className="order-2 min-w-0 space-y-5 lg:order-1">
          {/*
            1. ABOUT - only what the header has not already said (owner cleanup,
            2026-09-29): many agents publish the same sentence as tagline and
            description, and the page printed it twice.
          */}
          {showDescription || agent.skills.length > 0 ? (
            <section className="detail-card">
              {showDescription ? (
                <>
                  <h2 className="detail-card__title">About</h2>
                  <p className="mt-2 whitespace-pre-line text-[0.9rem] leading-7 text-ink-soft">{agent.description}</p>
                </>
              ) : null}
              {agent.skills.length > 0 ? (
                <div className={showDescription ? "mt-6" : undefined}>
                  <h2 className="detail-card__title">What it can do</h2>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {agent.skills.map((skill) => (
                      <li
                        className="rounded-full border border-line/80 px-3 py-1.5 text-[0.8rem] text-ink"
                        key={`${skill.name}-${skill.evidence}`}
                      >
                        {skill.name}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}

          {/* 2. Track record */}
          <section className="detail-card">
            <h2 className="detail-card__title">Track record</h2>
            <div className="mt-3">
              <TrackRecord agentKey={agent.agentKey} agentName={agent.name} />
            </div>
          </section>

          {/* 3. Live on-chain readings and their chart - each renders only if it has something. */}
          {agent.hasLiveStats ? (
            <>
              <LiveStats agent={agent} />
              <PerformancePanel agent={agent} />
            </>
          ) : null}

          {/* 4. Details & Technical Record (Collapsible Accordion) */}
          <TechnicalDetailsAccordion agent={agent} isRegistryVerified={isRegistryVerified} />
        </div>
      </div>
    </div>
  );
}
