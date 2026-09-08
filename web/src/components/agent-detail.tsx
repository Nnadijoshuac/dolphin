"use client";

import Link from "next/link";
import { useState } from "react";

import { AgentIcon } from "@/components/agent-icon";
import { CategoryGlyph } from "@/components/category-glyph";
import { HireAction } from "@/components/hire-action";
import { McpUseAction } from "@/components/mcp-use-action";
import { MetricCell } from "@/components/metric-cell";
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

function LiveStatsView({ stats }: { stats: AgentLiveStats }) {
  return (
    <div className="grid border-l border-t border-line sm:grid-cols-2">
      {stats.category === "monitoring" ? (
        <>
          <MetricCell
            format={(value) => value}
            label="Alert frequency"
            metric={stats.alertFrequency}
          />
          <MetricCell format={formatList} label="Assets watched" metric={stats.assetsWatched} />
          <MetricCell
            format={(value) => value}
            label="Last alert"
            metric={stats.lastAlertAt}
          />
          <MetricCell
            format={(value) => `${value.toFixed(1)}%`}
            label="False positives"
            metric={stats.falsePositiveRate}
          />
        </>
      ) : null}

      {stats.category === "rebalancing" ? (
        <>
          <MetricCell
            format={(value) => `${value.toFixed(1)}%`}
            label="Historical win rate"
            metric={stats.winRate}
          />
          <MetricCell
            format={(value) => value}
            label="Active LP range"
            metric={stats.activeRange}
          />
          <MetricCell
            format={(value) => value}
            label="Current P&L"
            metric={stats.currentPnl}
          />
          <MetricCell
            format={(value) => String(value)}
            label="LP positions monitored"
            metric={stats.positionCount}
          />
        </>
      ) : null}

      {stats.category === "grid-trading" ? (
        <>
          <MetricCell
            format={(value) => `${value.toFixed(1)}%`}
            label="Historical win rate"
            metric={stats.winRate}
          />
          <MetricCell
            format={(value) => value}
            label="Active grid range"
            metric={stats.activeRange}
          />
          <MetricCell
            format={(value) => value}
            label="Current P&L"
            metric={stats.currentPnl}
          />
          <MetricCell
            format={(value) => String(value)}
            label="Positions monitored"
            metric={stats.positionCount}
          />
        </>
      ) : null}

      {stats.category === "health-factor" ? (
        <>
          <MetricCell
            format={(value) => value.toFixed(2)}
            label="Venus health factor"
            metric={stats.averageHealthFactor}
          />
          <MetricCell
            format={(value) => String(value)}
            label="Loan positions monitored"
            metric={stats.positionsMonitored}
          />
          <MetricCell
            format={(value) => String(value)}
            label="Liquidations prevented"
            metric={stats.liquidationsPrevented}
          />
          <MetricCell
            format={(value) => `${value}ms`}
            label="Response latency"
            metric={stats.responseLatencyMs}
          />
        </>
      ) : null}

      {stats.category === "yield" ? (
        <>
          <MetricCell
            format={(value) => `${value.toFixed(2)}%`}
            label="Current APY"
            metric={stats.currentApy}
          />
          <MetricCell
            format={(value) => `$${(value / 1e6).toFixed(2)}M`}
            label="Total value managed"
            metric={stats.tvlManagedUsd}
          />
          <MetricCell
            format={formatList}
            label="Protocols used"
            metric={stats.protocolsUsed}
          />
          <MetricCell
            format={(value) => value}
            label="Rebalance cadence"
            metric={stats.rebalanceFrequency}
          />
        </>
      ) : null}

      {stats.category === "trading" ? (
        <>
          <MetricCell
            format={(value) => `${value.toFixed(1)}%`}
            label="Historical win rate"
            metric={stats.winRate}
          />
          <MetricCell
            format={(value) => String(value)}
            label="Trades executed"
            metric={stats.tradesExecuted}
          />
          <MetricCell
            format={(value) => value}
            label="Realized P&L"
            metric={stats.realizedPnl}
          />
          <MetricCell
            format={formatList}
            label="Markets traded"
            metric={stats.marketsTraded}
          />
        </>
      ) : null}
    </div>
  );
}

/** Collapsible Accordion for On-chain and Technical Records */
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
    ["Identity Registry", shortAddress(agent.registryAddress)],
    ["Publisher Address", shortAddress(agent.publisherAddress)],
    ["Agent Wallet", shortAddress(agent.agentWallet)],
    [
      "Registered Date",
      agent.registeredAt ? `${formatDate(agent.registeredAt)} UTC` : "Not reported",
    ],
    ["Verified Endpoint", agent.services[0]?.endpoint ?? "Not reported"],
  ] as const;

  return (
    <section className="rounded-2xl border border-line bg-paper overflow-hidden">
      <button
        aria-expanded={isOpen}
        className="interactive flex w-full items-center justify-between p-6 sm:p-7 text-left"
        onClick={() => setIsOpen((prev) => !prev)}
        type="button"
      >
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-ink">Details & Registry Record</h2>
            {isRegistryVerified ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 border border-emerald-200">
                Verified
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-muted">
            On-chain parameters, smart contract addresses, and verification sources.
          </p>
        </div>
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-full border border-line bg-paper-muted text-muted transition-transform duration-200 ${
            isOpen ? "rotate-90" : ""
          }`}
        >
          <CategoryGlyph color="currentColor" name="chevron-right" size={14} />
        </span>
      </button>

      {isOpen ? (
        <div className="border-t border-line p-6 sm:p-7 pt-4 space-y-6 animate-in fade-in duration-150">
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
  const registryStatus = agent.registryVerification.registered;
  const isRegistryVerified =
    (registryStatus.status === "live" || registryStatus.status === "stale") &&
    registryStatus.value;

  const publisherDisplay = agent.publisher?.startsWith("0x")
    ? shortAddress(agent.publisher)
    : agent.publisher || "Unlisted publisher";

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
      <header className="border-b border-line pb-8 pt-6 sm:pb-10 sm:pt-8">
        <div className="flex flex-col sm:flex-row sm:items-start gap-5">
          <div className="shrink-0">
            <AgentIcon category={agent.category} seed={agent.iconSeed} size={84} uri={agent.iconUrl} />
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
            <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">
              {agent.name}
            </h1>

            {/* Tagline */}
            {agent.tagline ? (
              <p className="mt-2.5 text-base font-medium leading-relaxed text-ink/80 max-w-3xl">
                {agent.tagline}
              </p>
            ) : null}

            {/* Metadata Footer */}
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
              <span>
                By <span className="font-semibold text-ink">{publisherDisplay}</span>
              </span>
              <span aria-hidden="true">·</span>
              <span>Token #{agent.tokenId}</span>
              <span aria-hidden="true">·</span>
              <span>BNB Smart Chain · 56</span>
            </div>
          </div>
        </div>
      </header>

      {/* ── Main Layout: Content & Action Sidebar ── */}
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-12 lg:items-start">
        {/* Action Card: On mobile it is order-1 (one of the first things seen!), on desktop it is order-2 (sticky right column) */}
        <aside className="order-1 lg:order-2 lg:sticky lg:top-24 space-y-4">
          {agent.protocol === "mcp" ? (
            <McpUseAction agent={agent} />
          ) : (
            <HireAction agent={agent} />
          )}
        </aside>

        {/* Left Column: Core Agent Information */}
        <div className="order-2 lg:order-1 space-y-8 min-w-0">
          {/* 1. About section (Top priority) */}
          <section className="rounded-2xl border border-line bg-paper p-6 sm:p-7">
            <h2 className="text-base font-bold tracking-tight text-ink">About this agent</h2>
            <p className="mt-3 text-sm leading-7 text-ink/80 whitespace-pre-line">
              {agent.description}
            </p>

            {/* Published Capabilities */}
            {agent.skills.length > 0 ? (
              <div className="mt-6 border-t border-line pt-5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted mb-3">
                  Published Capabilities
                </h3>
                <div className="flex flex-wrap gap-2">
                  {agent.skills.map((skill) => (
                    <span
                      className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-paper-muted px-3 py-1.5 text-xs font-medium text-ink"
                      key={`${skill.name}-${skill.evidence}`}
                    >
                      <span>{skill.name}</span>
                      <span className="text-[10px] text-muted">({skill.evidence.replaceAll("-", " ")})</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          {/* 2. Track Record & Reviews */}
          <section className="rounded-2xl border border-line bg-paper p-6 sm:p-7">
            <h2 className="text-base font-bold tracking-tight text-ink">Track Record & Reviews</h2>
            <p className="mt-1 text-xs text-muted">
              Verified hire outcomes and structured feedback from wallets on BNB Chain.
            </p>
            <div className="mt-5">
              <TrackRecord agentKey={agent.agentKey} agentName={agent.name} />
            </div>
          </section>

          {/* 3. Live Protocol Evidence (shown only if agent has live stats) */}
          {agent.hasLiveStats ? (
            <section className="rounded-2xl border border-line bg-paper p-6 sm:p-7">
              <h2 className="text-base font-bold tracking-tight text-ink">Live Protocol Evidence</h2>
              <p className="mt-1 text-xs text-muted">
                Direct on-chain metrics checked against live protocol contracts.
              </p>
              <div className="mt-5">
                <LiveStats agent={agent} />
              </div>
              <div className="mt-6 border-t border-line pt-5">
                <PerformancePanel agent={agent} />
              </div>
            </section>
          ) : null}

          {/* 4. Details & Technical Record (Collapsible Accordion) */}
          <TechnicalDetailsAccordion agent={agent} isRegistryVerified={isRegistryVerified} />
        </div>
      </div>
    </div>
  );
}
