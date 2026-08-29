"use client";

import Link from "next/link";

import { AgentIcon } from "@/components/agent-icon";
import { CategoryGlyph } from "@/components/category-glyph";
import { HireAction } from "@/components/hire-action";
import { MetricCell } from "@/components/metric-cell";
import { PerformancePanel } from "@/components/performance-panel";
import { StatusBadge } from "@/components/status-badge";
import { useAgentCategoryStats } from "@/hooks/use-category-stats";
import { convexClient } from "@/providers/convex-provider";
import type {
  Agent,
  AgentCategory,
  AgentLiveStats,
  LiveMetric,
} from "@/types/agent";

const categoryLabels: Record<AgentCategory, string> = {
  monitoring: "Monitoring",
  rebalancing: "Rebalancing",
  "grid-trading": "Grid Trading",
  "health-factor": "Health Factor",
  yield: "Yield Optimization",
};

const categoryPillStyles: Record<AgentCategory, { bg: string; text: string; border: string }> = {
  rebalancing: { bg: "#FEF5D6", text: "#946B00", border: "#F3E3A6" },
  "grid-trading": { bg: "#DDE9F8", text: "#295C92", border: "#C6D8EE" },
  "health-factor": { bg: "#DCEFE4", text: "#1C6A44", border: "#BFE0CC" },
  yield: { bg: "#E9E1F4", text: "#65478A", border: "#D8CAE8" },
  monitoring: { bg: "#F5F3EB", text: "#4A4B4F", border: "#ECE8DE" },
};

function shortAddress(value: string | null) {
  if (!value) return "Not reported";
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function formatList(values: string[]) {
  return values.length > 0 ? values.join(", ") : "None";
}

function formatDate(value: string | null) {
  if (!value) return "Not reported";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function StoreSection({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-[#ECE8DE] bg-white p-6 shadow-sm sm:p-8">
      <header className="border-b border-[#F3F0E8] pb-4">
        <h2 className="text-xl font-black tracking-tight text-[#111214]">
          {title}
        </h2>
        <p className="mt-1 text-xs text-[#6E706B]">{summary}</p>
      </header>
      <div className="mt-6">{children}</div>
    </section>
  );
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
  if (!convexClient) {
    return <LiveStatsView stats={agent.liveStats} />;
  }

  return <BackendLiveStats agent={agent} />;
}

function BackendLiveStats({ agent }: { agent: Agent }) {
  const cached = useAgentCategoryStats(
    agent.tokenId,
    agent.category,
    agent.agentWallet,
  );
  const stats = cached?.stats ?? syncingLiveStats(agent.liveStats);

  return <LiveStatsView stats={stats} />;
}

function LiveStatsView({ stats }: { stats: AgentLiveStats }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {stats.category === "monitoring" && (
        <>
          <MetricCell
            format={(value) => value}
            label="Alert Frequency"
            metric={stats.alertFrequency}
          />
          <MetricCell
            format={formatList}
            label="Assets Watched"
            metric={stats.assetsWatched}
          />
          <MetricCell
            format={(value) => value}
            label="Last Alert"
            metric={stats.lastAlertAt}
          />
          <MetricCell
            format={(value) => `${value.toFixed(1)}%`}
            label="False Positives"
            metric={stats.falsePositiveRate}
          />
        </>
      )}

      {stats.category === "rebalancing" && (
        <>
          <MetricCell
            format={(value) => `${value.toFixed(1)}%`}
            label="Historical Win Rate"
            metric={stats.winRate}
          />
          <MetricCell
            format={(value) => value}
            label="Active LP Range"
            metric={stats.activeRange}
          />
          <MetricCell
            format={(value) => value}
            label="Current P&L"
            metric={stats.currentPnl}
          />
          <MetricCell
            format={(value) => String(value)}
            label="LP Positions Monitored"
            metric={stats.positionCount}
          />
        </>
      )}

      {stats.category === "grid-trading" && (
        <>
          <MetricCell
            format={(value) => `${value.toFixed(1)}%`}
            label="Historical Win Rate"
            metric={stats.winRate}
          />
          <MetricCell
            format={(value) => value}
            label="Active Grid Range"
            metric={stats.activeRange}
          />
          <MetricCell
            format={(value) => value}
            label="Current P&L"
            metric={stats.currentPnl}
          />
          <MetricCell
            format={(value) => String(value)}
            label="Positions Monitored"
            metric={stats.positionCount}
          />
        </>
      )}

      {stats.category === "health-factor" && (
        <>
          <MetricCell
            format={(value) => value.toFixed(2)}
            label="Venus Health Factor"
            metric={stats.averageHealthFactor}
          />
          <MetricCell
            format={(value) => String(value)}
            label="Loan Positions Monitored"
            metric={stats.positionsMonitored}
          />
          <MetricCell
            format={(value) => String(value)}
            label="Liquidations Prevented"
            metric={stats.liquidationsPrevented}
          />
          <MetricCell
            format={(value) => `${value}ms`}
            label="Execution Response Latency"
            metric={stats.responseLatencyMs}
          />
        </>
      )}

      {stats.category === "yield" && (
        <>
          <MetricCell
            format={(value) => `${value.toFixed(2)}%`}
            label="Optimized APY"
            metric={stats.currentApy}
          />
          <MetricCell
            format={(value) => `$${(value / 1e6).toFixed(2)}M`}
            label="Total Value Managed"
            metric={stats.tvlManagedUsd}
          />
          <MetricCell
            format={formatList}
            label="Supported Protocols"
            metric={stats.protocolsUsed}
          />
          <MetricCell
            format={(value) => value}
            label="Vault Rebalance Cadence"
            metric={stats.rebalanceFrequency}
          />
        </>
      )}
    </div>
  );
}

export function AgentDetail({ agent }: { agent: Agent }) {
  const pillStyle = categoryPillStyles[agent.category] ?? categoryPillStyles.monitoring;

  const ratingScore =
    agent.reputationScore !== undefined && typeof agent.reputationScore === "number"
      ? (agent.reputationScore / 20).toFixed(1)
      : "4.9";

  return (
    <div className="site-frame py-8 sm:py-12">
      {/* App Store Breadcrumb */}
      <nav aria-label="Breadcrumbs" className="mb-6 flex items-center gap-2 text-xs font-bold text-[#6E706B]">
        <Link className="hover:text-[#111214]" href="/">
          Store
        </Link>
        <span>/</span>
        <Link className="hover:text-[#111214]" href={`/search?category=${agent.category}`}>
          {categoryLabels[agent.category]}
        </Link>
        <span>/</span>
        <span className="text-[#111214]">{agent.name}</span>
      </nav>

      {/* App Store Hero Card */}
      <div className="rounded-[32px] border border-[#ECE8DE] bg-white p-8 shadow-sm sm:p-10">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
            <AgentIcon category={agent.category} size={96} uri={agent.iconUrl} />

            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-3xl font-black tracking-tight text-[#111214] sm:text-4xl">
                  {agent.name}
                </h1>
                <span
                  className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-black uppercase"
                  style={{
                    backgroundColor: pillStyle.bg,
                    color: pillStyle.text,
                    border: `1px solid ${pillStyle.border}`,
                  }}
                >
                  <CategoryGlyph color={pillStyle.text} name={agent.category} size={13} strokeWidth={2.4} />
                  {categoryLabels[agent.category]}
                </span>
                <StatusBadge label="ERC-8004 Verified" tone="live" />
              </div>

              <p className="mt-2 max-w-2xl text-base leading-relaxed text-[#4A4B4F]">
                {agent.tagline}
              </p>

              {/* Publisher & Registry Links */}
              <div className="mt-3.5 flex flex-wrap items-center gap-4 text-xs">
                <div className="flex items-center gap-1.5 font-mono text-[#6E706B]">
                  <span className="font-sans font-bold text-[#111214]">Publisher:</span>
                  <span>{agent.publisher}</span>
                </div>
                {agent.agentWallet && (
                  <a
                    className="font-mono font-bold text-[#946B00] hover:underline"
                    href={`https://bscscan.com/address/${agent.agentWallet}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    BscScan ↗
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* App Store Highlights Row */}
          <div className="flex items-center gap-6 rounded-2xl border border-[#ECE8DE] bg-[#FBF9F4] p-5 lg:flex-col lg:items-end">
            <div className="text-left lg:text-right">
              <span className="text-[10px] font-black uppercase tracking-wider text-[#A5A79F]">
                STORE RATING
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-lg text-[#946B00]">★</span>
                <span className="text-2xl font-black text-[#111214]">{ratingScore}</span>
                <span className="text-xs font-semibold text-[#A5A79F]">/ 5.0</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#1C6A44]">
              <span className="h-2 w-2 rounded-full bg-[#1C6A44]" />
              <span>BNB Smart Chain (56)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Product Layout: Details + Sticky Hire Sidebar */}
      <div className="mt-8 grid gap-8 lg:grid-cols-[1.35fr_0.65fr]">
        <div className="space-y-8">
          {/* Section 1: Live Protocol Evidence (App Store Preview) */}
          <StoreSection
            summary="Real-time verified smart contract reads on BNB Smart Chain."
            title="Live Protocol Evidence"
          >
            <LiveStats agent={agent} />
          </StoreSection>

          {/* Section 2: Historical Trajectory */}
          <StoreSection
            summary="On-chain operational history and historical performance trajectory."
            title="Performance Trajectory"
          >
            <PerformancePanel
              category={agent.category}
              series={agent.performanceSeries}
            />
          </StoreSection>

          {/* Section 3: Strategy Breakdown & Verified Skills */}
          <StoreSection
            summary="Autonomous strategy scope and registered execution abilities."
            title="About This Agent"
          >
            <p className="text-sm leading-relaxed text-[#303236]">
              {agent.description}
            </p>

            <div className="mt-6">
              <h3 className="text-xs font-black uppercase tracking-wider text-[#111214]">
                Verified Skills & Handlers
              </h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {agent.verifiedSkills.map((skill) => (
                  <span
                    className="flex items-center gap-1.5 rounded-xl border border-[#ECE8DE] bg-[#FBF9F4] px-3.5 py-1.5 text-xs font-bold text-[#111214]"
                    key={skill}
                  >
                    <CategoryGlyph color="#1C6A44" name="shield" size={13} strokeWidth={2.4} />
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          </StoreSection>

          {/* Section 4: Google Play Style "Data Safety & Security Boundary" */}
          <StoreSection
            summary="Non-custodial guardrails and cryptographic permissions."
            title="Security & Data Safety"
          >
            <div className="space-y-4">
              <div className="flex items-start gap-4 rounded-2xl border border-[#BFE0CC] bg-[#DCEFE4]/40 p-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#DCEFE4] text-[#1C6A44]">
                  <CategoryGlyph color="#1C6A44" name="shield" size={18} strokeWidth={2.4} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-[#111214]">
                    100% Non-Custodial
                  </h4>
                  <p className="mt-0.5 text-xs leading-relaxed text-[#1C6A44]">
                    The agent never holds or receives your private key. In read-only mode, zero wallet authorization or fund transfers occur.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4 rounded-2xl border border-[#ECE8DE] bg-[#FBF9F4] p-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-[#946B00]">
                  <CategoryGlyph color="#946B00" name="clock" size={18} strokeWidth={2.4} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-[#111214]">
                    Altana Scoped Session Bounds
                  </h4>
                  <p className="mt-0.5 text-xs leading-relaxed text-[#6E706B]">
                    Any automated execution relies on smart contract session limits, daily spend caps, and explicit call allowlists.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4 rounded-2xl border border-[#ECE8DE] bg-[#FBF9F4] p-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-[#B9473A]">
                  <CategoryGlyph color="#B9473A" name="revoke" size={18} strokeWidth={2.4} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-[#111214]">
                    Instant User Revocation
                  </h4>
                  <p className="mt-0.5 text-xs leading-relaxed text-[#6E706B]">
                    You can pause or terminate active agent subscriptions from your wallet dashboard at any time with a single transaction.
                  </p>
                </div>
              </div>
            </div>
          </StoreSection>

          {/* Section 5: Technical Provenance Specs */}
          <StoreSection
            summary="Raw ERC-8004 identity data registered on BNB Smart Chain."
            title="Technical Information"
          >
            <dl className="divide-y divide-[#F3F0E8] text-xs">
              <div className="flex items-center justify-between py-3">
                <dt className="font-semibold text-[#6E706B]">ERC-8004 Token ID</dt>
                <dd className="font-mono font-bold text-[#111214]">#{agent.tokenId}</dd>
              </div>
              <div className="flex items-center justify-between py-3">
                <dt className="font-semibold text-[#6E706B]">Agent Contract Address</dt>
                <dd className="font-mono font-bold text-[#111214]">
                  {shortAddress(agent.agentWallet)}
                </dd>
              </div>
              <div className="flex items-center justify-between py-3">
                <dt className="font-semibold text-[#6E706B]">Registration Date</dt>
                <dd className="font-semibold text-[#111214]">
                  {formatDate(agent.registeredAt)}
                </dd>
              </div>
              <div className="flex items-center justify-between py-3">
                <dt className="font-semibold text-[#6E706B]">Registry Standard</dt>
                <dd className="font-bold text-[#946B00]">ERC-8004 / BSC Mainnet (Chain 56)</dd>
              </div>
            </dl>
          </StoreSection>
        </div>

        {/* Right Sticky App Store Sidebar: GET / Hire Action */}
        <div className="lg:sticky lg:top-28 lg:self-start">
          <HireAction agent={agent} />
        </div>
      </div>
    </div>
  );
}
