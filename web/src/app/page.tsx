"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import { CategoryGlyph, type GlyphName } from "@/components/category-glyph";
import { AGENT_CATEGORIES } from "@/constants/agents";
import { useAgents } from "@/hooks/use-agents";
import type { Agent, AgentCategory } from "@/types/agent";

const CATEGORY_COPY: Record<
  AgentCategory,
  { eyebrow: string; heading: string; description: string }
> = {
  monitoring: {
    eyebrow: "Always on",
    heading: "Agents that keep watch",
    description: "Monitoring agents and the alerts their publishers make available.",
  },
  rebalancing: {
    eyebrow: "Concentrated liquidity",
    heading: "Agents that keep liquidity in range",
    description:
      "Review LP-range agents built to reset concentrated-liquidity positions automatically.",
  },
  "grid-trading": {
    eyebrow: "Disciplined execution",
    heading: "Agents that work the price ladder",
    description:
      "Compare price-ladder agents alongside the execution evidence their publishers expose.",
  },
  "health-factor": {
    eyebrow: "Position protection",
    heading: "Agents that watch liquidation risk",
    description:
      "Explore lending-risk agents and the liquidation-buffer evidence available for each one.",
  },
  yield: {
    eyebrow: "Yield automation",
    heading: "Agents that search, route, and compound",
    description:
      "Inspect yield agents by protocol coverage, published sources, and permission model.",
  },
};

const CATEGORY_COLORS: Record<
  AgentCategory,
  { background: string; border: string; foreground: string }
> = {
  monitoring: {
    background: "#F1F3F1",
    border: "#D9DED9",
    foreground: "#3E4842",
  },
  rebalancing: {
    background: "#FFF7D6",
    border: "#EAD98A",
    foreground: "#755800",
  },
  "grid-trading": {
    background: "#EDF3FA",
    border: "#CAD9EA",
    foreground: "#315B80",
  },
  "health-factor": {
    background: "#E8F3EC",
    border: "#C2DCCB",
    foreground: "#276246",
  },
  yield: {
    background: "#F0ECF7",
    border: "#D9CFE9",
    foreground: "#665180",
  },
};

const PROOF_STEPS: readonly {
  title: string;
  label: string;
  icon: GlyphName;
}[] = [
  { title: "Identity", label: "ERC-8004", icon: "shield" },
  { title: "Evidence", label: "source-linked", icon: "layers" },
  { title: "Permission", label: "user-approved", icon: "revoke" },
];

const LIST_PREVIEW_LIMIT = 4;

function shortenAddress(address: string) {
  if (!address.startsWith("0x") || address.length <= 16) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function classificationLabel(agent: Agent) {
  switch (agent.classificationSource) {
    case "editorial-explicit-metadata":
      return "Editorial classification";
    case "registry-metadata":
      return "Registry metadata";
    case "oasf-metadata":
      return "OASF metadata";
    case "heuristic-keyword-match":
      return agent.classificationConfidence === "likely"
        ? "Automated classification · likely"
        : "Automated classification";
  }
}

function registryStatus(agent: Agent) {
  const registration = agent.registryVerification.registered;

  if (registration.status === "live" && registration.value) {
    return {
      dot: "#4D8E6B",
      label: "ERC-8004 registration confirmed",
      text: "#38674F",
    };
  }

  if (registration.status === "syncing") {
    return {
      dot: "#C08B19",
      label: "Registry check syncing",
      text: "#705815",
    };
  }

  return {
    dot: "#A2A8A3",
    label: "Registry check on detail",
    text: "#626963",
  };
}

function ProofRail() {
  return (
    <div
      aria-label="Dolphin verification path: identity, evidence, then permission"
      className="relative mx-auto w-full max-w-[640px] py-4 lg:py-10"
      role="img"
    >
      <div
        aria-hidden="true"
        className="absolute left-[13%] right-[8%] top-[4.1rem] hidden h-px origin-left -rotate-[6deg] bg-[#8D928D] lg:block"
      />
      <div className="relative grid grid-cols-3 gap-3 sm:gap-6">
        {PROOF_STEPS.map((step, index) => (
          <div
            className={`flex min-w-0 flex-col items-center text-center lg:items-start lg:text-left ${
              index === 0 ? "lg:translate-y-12" : index === 1 ? "lg:translate-y-5" : ""
            }`}
            key={step.title}
          >
            <span
              aria-hidden="true"
              className="relative flex h-16 w-16 items-center justify-center rounded-full border border-[#BFC4BF] bg-white shadow-[0_8px_30px_rgba(21,25,22,0.05)] sm:h-20 sm:w-20"
            >
              <CategoryGlyph color="#1D211F" name={step.icon} size={24} strokeWidth={1.6} />
              {index < PROOF_STEPS.length - 1 ? (
                <span className="absolute -right-5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-[#F4C51A] lg:-right-16">
                  <CategoryGlyph color="#1D211F" name="check" size={12} strokeWidth={2.4} />
                </span>
              ) : null}
            </span>
            <strong className="mt-4 text-sm font-semibold tracking-[-0.02em] text-[#151815] sm:text-base">
              {step.title}
            </strong>
            <span className="mt-1 text-xs text-[#6A706B] sm:text-sm">{step.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentRow({ agent }: { agent: Agent }) {
  const category =
    AGENT_CATEGORIES.find((candidate) => candidate.slug === agent.category) ??
    AGENT_CATEGORIES[0];
  const colors = CATEGORY_COLORS[agent.category];
  const registry = registryStatus(agent);

  return (
    <Link
      className="group grid min-w-0 gap-4 border-t border-[#DDE1DD] py-6 no-underline transition-colors duration-200 hover:bg-white focus-visible:bg-white sm:grid-cols-[72px_minmax(0,1fr)_auto] sm:px-3 lg:py-7"
      href={`/agent/${agent.tokenId}`}
    >
      <span
        aria-hidden="true"
        className="flex h-14 w-14 items-center justify-center rounded-2xl border sm:h-16 sm:w-16"
        style={{
          backgroundColor: colors.background,
          borderColor: colors.border,
        }}
      >
        <CategoryGlyph
          color={colors.foreground}
          name={agent.category}
          size={27}
          strokeWidth={1.8}
        />
      </span>

      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#69706A]">
          <span>{category.label}</span>
          <span aria-hidden="true" className="h-1 w-1 rounded-full bg-[#A4AAA4]" />
          <span>{classificationLabel(agent)}</span>
        </span>
        <span className="mt-2 block text-lg font-semibold tracking-[-0.025em] text-[#151815] sm:text-xl">
          {agent.name}
        </span>
        <span className="mt-2 block max-w-2xl text-sm leading-6 text-[#5F655F]">
          {agent.tagline}
        </span>
        <span className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-[#69706A]">
          <span className="font-mono text-[11px] text-[#4B514C]">#{agent.tokenId}</span>
          <span>{shortenAddress(agent.publisher)}</span>
          <span
            className="inline-flex items-center gap-1.5"
            style={{ color: registry.text }}
          >
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: registry.dot }}
            />
            {registry.label}
          </span>
        </span>
      </span>

      <span className="flex min-h-11 items-center justify-between gap-4 self-end text-sm font-semibold text-[#171A17] sm:self-center">
        <span>View agent</span>
        <span
          aria-hidden="true"
          className="transition-transform duration-200 group-hover:translate-x-1"
        >
          →
        </span>
      </span>
    </Link>
  );
}

export default function DiscoverPage() {
  const {
    data: liveAgents,
    isError,
    isFetching,
    isLoading,
    refetch,
  } = useAgents();
  const [selectedCategory, setSelectedCategory] =
    useState<AgentCategory>("rebalancing");
  const [isExpanded, setIsExpanded] = useState(false);
  const catalogRef = useRef<HTMLElement>(null);

  const filteredAgents = useMemo(
    () =>
      (liveAgents ?? []).filter(
        (agent) => agent.category === selectedCategory,
      ),
    [liveAgents, selectedCategory],
  );
  const visibleAgents = isExpanded
    ? filteredAgents
    : filteredAgents.slice(0, LIST_PREVIEW_LIMIT);
  const activeCategory =
    AGENT_CATEGORIES.find((category) => category.slug === selectedCategory) ??
    AGENT_CATEGORIES[0];
  const activeCopy = CATEGORY_COPY[selectedCategory];

  const selectCategory = (category: AgentCategory, scrollToCatalog = false) => {
    setSelectedCategory(category);
    setIsExpanded(false);

    if (scrollToCatalog) {
      requestAnimationFrame(() => {
        const prefersReducedMotion = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        catalogRef.current?.scrollIntoView({
          behavior: prefersReducedMotion ? "auto" : "smooth",
          block: "start",
        });
      });
    }
  };

  const catalogSignal = isError
    ? "Unavailable"
    : isLoading
      ? "Catalog refreshing"
      : "Convex synced";

  return (
    <div className="bg-[#F8F9F7] text-[#151815]">
      <section className="site-frame border-b border-[#DDE1DD] pb-8 pt-14 sm:pt-20 lg:pb-10 lg:pt-24">
        <div className="grid items-center gap-14 lg:grid-cols-[1.06fr_0.94fr] lg:gap-16">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#4E554F]">
              The agent marketplace on BNB Chain
            </p>
            <h1 className="text-balance mt-6 max-w-[720px] text-[clamp(3rem,6vw,5.25rem)] font-semibold leading-[0.96] tracking-[-0.065em] text-[#101310]">
              Discover agents you can verify.
            </h1>
            <p className="text-pretty mt-7 max-w-xl text-base leading-7 text-[#5C635D] sm:text-lg sm:leading-8">
              Compare purpose, provenance, and permissions before anything touches your wallet.
            </p>

            <div className="mt-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <a
                className="pressable-scale inline-flex min-h-12 items-center justify-center gap-3 rounded-xl bg-[#F4C51A] px-6 py-3 text-sm font-semibold text-[#181A15] no-underline shadow-[0_8px_20px_rgba(170,128,0,0.14)] hover:bg-[#EAB914]"
                href="#agent-catalog"
              >
                Explore agents
                <span aria-hidden="true">→</span>
              </a>
              <a
                className="inline-flex min-h-11 items-center gap-3 border-b border-[#7C827D] text-sm font-medium text-[#303531] no-underline transition-colors hover:border-[#151815] hover:text-[#151815]"
                href="#verification"
              >
                How Dolphin verifies
                <span aria-hidden="true">→</span>
              </a>
            </div>
          </div>

          <ProofRail />
        </div>

        <dl className="mt-14 grid grid-cols-2 border-y border-[#DDE1DD] lg:mt-20 lg:grid-cols-4">
          <div className="border-r border-[#DDE1DD] py-4 pr-4 lg:pr-6">
            <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5F665F]">
              Registry
            </dt>
            <dd className="mt-1 text-sm font-medium text-[#202420]">BNB Chain · ERC-8004</dd>
          </div>
          <div className="py-4 pl-4 lg:border-r lg:border-[#DDE1DD] lg:pl-6 lg:pr-6">
            <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5F665F]">
              Catalog
            </dt>
            <dd className="mt-1 text-sm font-medium text-[#202420]">{catalogSignal}</dd>
          </div>
          <div className="border-r border-t border-[#DDE1DD] py-4 pr-4 lg:pl-6 lg:pr-6">
            <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5F665F]">
              Evidence
            </dt>
            <dd className="mt-1 text-sm font-medium text-[#202420]">Source-linked states</dd>
          </div>
          <div className="border-t border-[#DDE1DD] py-4 pl-4 lg:border-t-0 lg:pl-6">
            <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5F665F]">
              Control
            </dt>
            <dd className="mt-1 text-sm font-medium text-[#202420]">You approve the scope</dd>
          </div>
        </dl>
      </section>

      <section
        className="site-frame scroll-mt-24 py-16 sm:py-20"
        id="agent-catalog"
        ref={catalogRef}
      >
        <div className="flex flex-col gap-8 border-b border-[#DDE1DD] pb-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#6C736D]">
              Browse the catalog
            </p>
            <h2 className="mt-3 text-4xl font-semibold tracking-[-0.055em] text-[#111411] sm:text-5xl">
              Discover
            </h2>
          </div>

          <nav
            aria-label="Filter agents by category"
            className="no-scrollbar flex max-w-full items-end gap-2 overflow-x-auto sm:gap-7"
          >
            {AGENT_CATEGORIES.map((category) => {
              const isSelected = selectedCategory === category.slug;
              return (
                <button
                  aria-pressed={isSelected}
                  className={`min-h-11 shrink-0 border-b-2 pb-3 text-xs transition-colors duration-200 sm:text-sm ${
                    isSelected
                      ? "border-[#151815] font-semibold text-[#151815]"
                      : "border-transparent font-medium text-[#6B716C] hover:border-[#C5CAC5] hover:text-[#252A26]"
                  }`}
                  key={category.slug}
                  onClick={() => selectCategory(category.slug)}
                  type="button"
                >
                  {category.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,0.68fr)_minmax(0,1.32fr)] lg:gap-14">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#6C736D]">
              {activeCopy.eyebrow}
            </p>
            <h3 className="text-balance mt-4 max-w-md text-3xl font-semibold leading-[1.05] tracking-[-0.045em] text-[#151815] sm:text-4xl">
              {activeCopy.heading}
            </h3>
            <p className="mt-5 max-w-md text-sm leading-6 text-[#616862] sm:text-base sm:leading-7">
              {activeCopy.description}
            </p>

            <div
              aria-live="polite"
              className={`mt-7 border-l-2 pl-4 text-sm leading-6 ${
                isError ? "border-[#B6654D] text-[#754536]" : "border-[#B9BEBA] text-[#626963]"
              }`}
            >
              {isError ? (
                <>
                  <p>The shared catalog could not be loaded. Retry the Convex sync to continue.</p>
                  <button
                    className="mt-2 min-h-11 font-semibold text-[#5F382C] underline decoration-[#B6654D] underline-offset-4"
                    onClick={() => void refetch()}
                    type="button"
                  >
                    Retry catalog sync
                  </button>
                </>
              ) : isLoading ? (
                <p>Loading the shared catalog from Convex…</p>
              ) : isFetching ? (
                <p>Checking Convex for fresher catalog records.</p>
              ) : (
                <p>
                  Catalog records are shared with mobile. Direct registry checks run when you open an agent.
                </p>
              )}
            </div>
          </div>

          <div aria-busy={isLoading || isFetching}>
            <div className="flex items-center justify-between gap-4 pb-2">
              <p className="text-sm font-medium text-[#353B36]">{activeCategory.label}</p>
              <p className="text-xs text-[#5F665F]">
                {isError
                  ? "Catalog unavailable"
                  : isLoading
                    ? "Loading…"
                    : "Shared catalog"}
              </p>
            </div>

            {isLoading ? (
              <div aria-label="Loading agent catalog" aria-live="polite">
                {[0, 1].map((item) => (
                  <div
                    className="grid animate-pulse gap-4 border-t border-[#DDE1DD] py-7 sm:grid-cols-[72px_minmax(0,1fr)] sm:px-3"
                    key={item}
                  >
                    <span className="h-16 w-16 rounded-2xl bg-[#E7EAE7]" />
                    <span>
                      <span className="block h-3 w-36 rounded bg-[#E7EAE7]" />
                      <span className="mt-4 block h-6 w-2/3 rounded bg-[#E0E4E0]" />
                      <span className="mt-4 block h-4 w-full max-w-lg rounded bg-[#E7EAE7]" />
                    </span>
                  </div>
                ))}
              </div>
            ) : isError ? (
              <div className="border-t border-[#DDE1DD] py-10">
                <p className="text-lg font-semibold text-[#252A26]">Catalog unavailable</p>
                <p className="mt-2 max-w-xl text-sm leading-6 text-[#676E68]">
                  Dolphin could not reach the shared agent catalog. Retry the sync from the status panel.
                </p>
              </div>
            ) : filteredAgents.length > 0 ? (
              <>
                <div>
                  {visibleAgents.map((agent) => (
                    <AgentRow agent={agent} key={agent.id} />
                  ))}
                </div>

                {filteredAgents.length > LIST_PREVIEW_LIMIT ? (
                  <button
                    className="mt-4 min-h-11 border-b border-[#6F756F] text-sm font-semibold text-[#282D29] transition-colors hover:border-[#151815] hover:text-[#151815]"
                    onClick={() => setIsExpanded((current) => !current)}
                    type="button"
                  >
                    {isExpanded
                      ? "Show fewer agents"
                      : `Show all ${filteredAgents.length} agents`}
                  </button>
                ) : null}
              </>
            ) : (
              <div className="border-t border-[#DDE1DD] py-10">
                <p className="text-lg font-semibold text-[#252A26]">
                  No {activeCategory.label.toLowerCase()} agents are available yet.
                </p>
                <p className="mt-2 max-w-xl text-sm leading-6 text-[#676E68]">
                  Dolphin keeps an empty category honest instead of filling it with sample performance data.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="site-frame border-t border-[#DDE1DD] py-16 sm:py-20">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#6C736D]">
            Four focused collections
          </p>
          <h2 className="text-balance mt-4 text-3xl font-semibold tracking-[-0.045em] text-[#151815] sm:text-4xl">
            More ways to put DeFi on watch
          </h2>
          <p className="mt-4 text-base leading-7 text-[#626963]">
            Move from liquidity management to risk monitoring without changing how you evaluate trust.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-2 border-y border-[#DDE1DD] xl:grid-cols-4">
          {AGENT_CATEGORIES.map((category, index) => {
            const colors = CATEGORY_COLORS[category.slug];
            return (
              <button
                className={`group flex min-h-[230px] flex-col border-[#DDE1DD] px-4 py-6 text-left transition-colors hover:bg-white sm:px-7 sm:py-7 ${
                  index > 1 ? "border-t xl:border-t-0" : ""
                } ${index % 2 === 1 ? "border-l" : ""} ${
                  index > 0 ? "xl:border-l" : ""
                }`}
                key={category.slug}
                onClick={() => selectCategory(category.slug, true)}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className="flex h-11 w-11 items-center justify-center rounded-xl border"
                  style={{
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                  }}
                >
                  <CategoryGlyph
                    color={colors.foreground}
                    name={category.slug}
                    size={21}
                    strokeWidth={1.8}
                  />
                </span>
                <span className="mt-6 block text-lg font-semibold tracking-[-0.025em] text-[#191C19]">
                  {category.label}
                </span>
                <span className="mt-2 line-clamp-4 text-xs leading-5 text-[#656C66] sm:text-sm sm:leading-6">
                  {category.description}
                </span>
                <span className="mt-auto inline-flex items-center gap-2 pt-5 text-sm font-semibold text-[#2C312D]">
                  Explore
                  <span
                    aria-hidden="true"
                    className="transition-transform duration-200 group-hover:translate-x-1"
                  >
                    →
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section
        className="site-frame scroll-mt-24 border-t border-[#DDE1DD] py-16 sm:py-20"
        id="verification"
      >
        <div className="grid gap-10 lg:grid-cols-[0.58fr_1.42fr] lg:gap-16">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#6C736D]">
              The Dolphin standard
            </p>
            <h2 className="text-balance mt-4 max-w-sm text-4xl font-semibold leading-[1.02] tracking-[-0.055em] text-[#121512] sm:text-5xl">
              Proof before permission
            </h2>
          </div>

          <ol className="grid border-y border-[#DDE1DD] md:grid-cols-3">
            <li className="py-7 md:pr-7">
              <span className="font-mono text-sm text-[#5F665F]">01</span>
              <h3 className="mt-5 text-lg font-semibold text-[#1B1F1B]">Verify identity</h3>
              <p className="mt-3 text-sm leading-6 text-[#646B65]">
                Open an agent to run its ERC-8004 registry check against BNB Chain.
              </p>
            </li>
            <li className="border-t border-[#DDE1DD] py-7 md:border-l md:border-t-0 md:px-7">
              <span className="font-mono text-sm text-[#5F665F]">02</span>
              <h3 className="mt-5 text-lg font-semibold text-[#1B1F1B]">Check evidence</h3>
              <p className="mt-3 text-sm leading-6 text-[#646B65]">
                Published metrics keep their source, timestamp, method, and unavailable reason.
              </p>
            </li>
            <li className="border-t border-[#DDE1DD] py-7 md:border-l md:border-t-0 md:pl-7">
              <span className="font-mono text-sm text-[#5F665F]">03</span>
              <h3 className="mt-5 text-lg font-semibold text-[#1B1F1B]">Approve the scope</h3>
              <p className="mt-3 text-sm leading-6 text-[#646B65]">
                Review what an agent requests before hiring, with missing permission data kept visible.
              </p>
            </li>
          </ol>
        </div>
      </section>
    </div>
  );
}
