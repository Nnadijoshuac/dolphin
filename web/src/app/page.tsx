"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { AgentCard } from "@/components/agent-card";
import { CategoryGlyph } from "@/components/category-glyph";
import { ConstellationBg } from "@/components/constellation-bg";
import { StatePanel } from "@/components/state-panel";
import { AGENT_CATEGORIES } from "@/constants/agents";
import { useAgents } from "@/hooks/use-agents";
import type { AgentCategory } from "@/types/agent";

const evidencePrinciples = [
  {
    index: "01",
    title: "ERC-8004 On-Chain Identity",
    body: "Every agent is registered as a unique ERC-8004 identity on BNB Smart Chain, verifiable directly on BscScan.",
    icon: "shield" as const,
  },
  {
    index: "02",
    title: "Live Protocol Proof",
    body: "Health factors, LP ranges, and APYs are pulled directly from Venus, PancakeSwap, and Aave contracts with live timestamps.",
    icon: "sparkle" as const,
  },
  {
    index: "03",
    title: "Non-Custodial Session Bounds",
    body: "Agents operate within user-defined daily spend limits and call allowlists via Altana guardrails. Revoke in one tap anytime.",
    icon: "bot" as const,
  },
] as const;

export default function DiscoverPage() {
  const [activeCategory, setActiveCategory] = useState<AgentCategory>("rebalancing");
  const { data: agents, isLoading, isError } = useAgents();
  const marketRef = useRef<HTMLElement>(null);

  const selectedCategory =
    AGENT_CATEGORIES.find((category) => category.slug === activeCategory) ??
    AGENT_CATEGORIES[0];
  const categoryAgents =
    agents?.filter((agent) => agent.category === activeCategory) ?? [];

  const selectCategory = (category: AgentCategory, moveToMarket = false) => {
    setActiveCategory(category);
    if (moveToMarket) {
      window.requestAnimationFrame(() => {
        marketRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  };

  return (
    <div className="relative min-h-screen">
      <ConstellationBg opacity={0.65} />

      {/* Hero Showcase Section */}
      <section className="site-frame pt-6 sm:pt-10 lg:pt-12">
        <div className="relative overflow-hidden rounded-[36px] border border-[#ECE8DE] bg-gradient-to-br from-white via-[#FDFBF7] to-[#F7F2E7] p-8 shadow-[0_16px_48px_rgba(245,179,0,0.08)] sm:p-12 lg:p-16">
          {/* Subtle Ambient Gold Glow Circles */}
          <div className="pointer-events-none absolute -right-20 -top-20 h-96 w-96 rounded-full bg-[radial-gradient(circle,rgba(245,179,0,0.15)_0%,transparent_70%)] blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 left-1/3 h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(245,179,0,0.08)_0%,transparent_70%)] blur-2xl" />

          <div className="relative z-10 grid gap-12 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
            {/* Left Column: Headlines, Value Prop & Actions */}
            <div>
              <div className="reveal-one inline-flex items-center gap-2 rounded-full border border-[#F3E3A6] bg-[#FEF5D6] px-3.5 py-1.5 shadow-sm">
                <span className="h-2 w-2 rounded-full bg-[#F5B300] animate-pulse" />
                <span className="text-xs font-black uppercase tracking-wider text-[#946B00]">
                  BNB Smart Chain Agent Hub
                </span>
              </div>

              <h1 className="reveal-two mt-6 text-balance text-4xl font-black leading-[1.05] tracking-tight text-[#111214] sm:text-5xl lg:text-[62px]">
                Discover AI Agents. <br />
                <span className="bg-gradient-to-r from-[#B38115] via-[#F5B300] to-[#946B00] bg-clip-text text-transparent">
                  Inspect the Live Proof.
                </span>
              </h1>

              <p className="reveal-three mt-6 max-w-xl text-pretty text-base leading-relaxed text-[#4A4B4F] sm:text-lg">
                Explore autonomous on-chain agents registered under ERC-8004. Compare verified track records, inspect real protocol reads, and hire with scoped non-custodial boundaries.
              </p>

              {/* Action Buttons */}
              <div className="reveal-three mt-8 flex flex-wrap items-center gap-4">
                <button
                  className="pressable-scale inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-[#F5B300] px-7 text-sm font-black text-[#111214] shadow-[0_4px_16px_rgba(245,179,0,0.3)] hover:bg-[#E2A500]"
                  onClick={() =>
                    marketRef.current?.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    })
                  }
                  type="button"
                >
                  <CategoryGlyph color="#111214" name="sparkle" size={16} strokeWidth={2.4} />
                  Explore Agents
                </button>

                <Link
                  className="pressable-scale inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border border-[#ECE8DE] bg-white px-7 text-sm font-bold text-[#111214] no-underline shadow-sm hover:border-[#F5B300]/50 hover:bg-[#FBF9F4]"
                  href="/search"
                >
                  <CategoryGlyph color="#111214" name="search" size={16} strokeWidth={2} />
                  Search Catalog
                </Link>
              </div>

              {/* Trust Indicators */}
              <div className="mt-10 flex flex-wrap items-center gap-6 border-t border-[#ECE8DE] pt-6 text-xs font-semibold text-[#6E706B]">
                <div className="flex items-center gap-2">
                  <CategoryGlyph color="#1C6A44" name="shield" size={15} strokeWidth={2.5} />
                  <span>ERC-8004 Identity</span>
                </div>
                <div className="flex items-center gap-2">
                  <CategoryGlyph color="#295C92" name="layers" size={15} strokeWidth={2.5} />
                  <span>Venus & PancakeSwap Live</span>
                </div>
                <div className="flex items-center gap-2">
                  <CategoryGlyph color="#946B00" name="sparkle" size={15} strokeWidth={2.5} />
                  <span>Altana Session Limits</span>
                </div>
              </div>
            </div>

            {/* Right Column: Hero Visual & Live Proof Card */}
            <div className="reveal-three relative">
              <div className="relative mx-auto flex max-w-[420px] flex-col items-center justify-center rounded-3xl border border-[#ECE8DE] bg-white p-6 shadow-[0_20px_60px_rgba(17,18,20,0.08)]">
                {/* Floating Status Badge */}
                <div className="absolute -top-4 right-6 flex items-center gap-2 rounded-full border border-[#BFE0CC] bg-[#DCEFE4] px-4 py-1.5 text-xs font-black text-[#1C6A44] shadow-sm">
                  <span className="h-2 w-2 rounded-full bg-[#1C6A44] animate-pulse" />
                  Live BSC Proof
                </div>

                {/* Coin Video / High-Res Media */}
                <div className="relative h-64 w-64 overflow-hidden rounded-full border-4 border-[#FFF9E6] shadow-inner">
                  <video
                    autoPlay
                    className="h-full w-full object-cover scale-110"
                    loop
                    muted
                    playsInline
                    src="/coin.mp4"
                  />
                </div>

                {/* Spotlight Mini Card */}
                <div className="mt-6 w-full rounded-2xl border border-[#ECE8DE] bg-[#FBF9F4] p-4 text-left">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-black uppercase tracking-wider text-[#946B00]">
                      FEATURED AGENT SPOTLIGHT
                    </span>
                    <span className="rounded-md bg-[#FEF5D6] px-2 py-0.5 text-[10px] font-bold text-[#946B00]">
                      Venus Protocol
                    </span>
                  </div>

                  <p className="mt-2 text-base font-black text-[#111214]">
                    Venus Liquidation Sentinel
                  </p>
                  <p className="mt-0.5 text-xs text-[#6E706B]">
                    Monitors borrow health factor & triggers automated buffer repay.
                  </p>

                  <div className="mt-3 flex items-center justify-between border-t border-[#ECE8DE] pt-2 text-[11px]">
                    <span className="font-semibold text-[#1C6A44]">
                      ● Status: Active & Syncing
                    </span>
                    <span className="font-mono font-bold text-[#303236]">
                      0x4f8...b7a9
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Live Marketplace Metrics Ticker */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-[#ECE8DE] bg-white p-5 shadow-sm">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#6E706B]">
              Registered Agents
            </span>
            <p className="mt-2 text-2xl font-black text-[#111214]">
              {agents ? `${agents.length} Catalog Records` : "Syncing..."}
            </p>
            <p className="mt-1 text-xs text-[#946B00]">
              ERC-8004 On-Chain Standard
            </p>
          </div>

          <div className="rounded-2xl border border-[#ECE8DE] bg-white p-5 shadow-sm">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#6E706B]">
              Graded Categories
            </span>
            <p className="mt-2 text-2xl font-black text-[#111214]">
              4 Core Tracks
            </p>
            <p className="mt-1 text-xs text-[#295C92]">
              Rebalancing, Grid, Health, Yield
            </p>
          </div>

          <div className="rounded-2xl border border-[#ECE8DE] bg-white p-5 shadow-sm">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#6E706B]">
              Verified Protocol Reads
            </span>
            <p className="mt-2 text-2xl font-black text-[#111214]">
              Venus & PancakeSwap
            </p>
            <p className="mt-1 text-xs text-[#1C6A44]">
              Live Smart Contract Queries
            </p>
          </div>

          <div className="rounded-2xl border border-[#ECE8DE] bg-white p-5 shadow-sm">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#6E706B]">
              Custody Model
            </span>
            <p className="mt-2 text-2xl font-black text-[#111214]">
              100% Non-Custodial
            </p>
            <p className="mt-1 text-xs text-[#65478A]">
              Altana Scoped Session Keys
            </p>
          </div>
        </div>
      </section>

      {/* Category Explorer Section */}
      <section
        aria-labelledby="category-heading"
        className="site-frame py-16 sm:py-20 lg:py-24"
      >
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-[#F3E3A6] bg-[#FEF5D6] px-3 py-1 text-xs font-bold text-[#946B00]">
              <CategoryGlyph color="#946B00" name="layers" size={13} strokeWidth={2.4} />
              <span>Explore by Strategy</span>
            </div>
            <h2
              className="mt-3 text-3xl font-black tracking-tight text-[#111214] sm:text-4xl lg:text-5xl"
              id="category-heading"
            >
              Choose an Agent by Its Job
            </h2>
          </div>
          <p className="max-w-xl text-sm leading-relaxed text-[#6E706B]">
            All categories match the exact taxonomy of Dolphin mobile. Select a category below to inspect agents and their verified live metrics.
          </p>
        </div>

        {/* Category Cards Grid */}
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {AGENT_CATEGORIES.map((category, index) => {
            const isActive = category.slug === activeCategory;
            const count =
              agents?.filter((a) => a.category === category.slug).length ?? 0;

            return (
              <button
                aria-pressed={isActive}
                className={`pressable-scale group flex flex-col justify-between rounded-3xl border p-6 text-left shadow-sm transition-all ${
                  isActive
                    ? "border-[#F5B300] bg-white ring-2 ring-[#F5B300]/30 shadow-md"
                    : "border-[#ECE8DE] bg-white hover:border-[#F5B300]/40 hover:bg-[#FDFBF7]"
                }`}
                key={category.slug}
                onClick={() => selectCategory(category.slug, true)}
                type="button"
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div
                      className={`flex h-14 w-14 items-center justify-center rounded-2xl border ${
                        isActive
                          ? "border-[#F3E3A6] bg-[#FEF5D6]"
                          : "border-[#ECE8DE] bg-[#FBF9F4] group-hover:bg-[#FEF5D6]"
                      }`}
                    >
                      <CategoryGlyph
                        color={isActive ? "#946B00" : "#111214"}
                        name={category.slug}
                        size={28}
                        strokeWidth={2.2}
                      />
                    </div>
                    <span className="font-mono text-xs font-bold text-[#A5A79F]">
                      0{index + 1}
                    </span>
                  </div>

                  <h3 className="mt-6 text-xl font-black tracking-tight text-[#111214]">
                    {category.label}
                  </h3>
                  <p className="mt-2 text-xs leading-relaxed text-[#6E706B]">
                    {category.description}
                  </p>
                </div>

                <div className="mt-6 flex items-center justify-between border-t border-[#F3F0E8] pt-4">
                  <span className="font-mono text-xs font-semibold text-[#A5A79F]">
                    {count} {count === 1 ? "agent" : "agents"}
                  </span>
                  <span
                    className={`text-xs font-extrabold ${
                      isActive ? "text-[#946B00]" : "text-[#111214] group-hover:text-[#946B00]"
                    }`}
                  >
                    {isActive ? "Selected ✓" : "Browse →"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Selected Collection Agent Marketplace Grid */}
      <section
        aria-labelledby="agent-market-heading"
        className="scroll-mt-28 border-y border-[#ECE8DE] bg-white/70 backdrop-blur-sm"
        id="agent-market"
        ref={marketRef}
      >
        <div className="site-frame py-16 sm:py-20 lg:py-24">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-[#F3E3A6] bg-[#FEF5D6] px-3 py-1 text-xs font-extrabold text-[#946B00]">
                  ACTIVE COLLECTION
                </span>
                <span className="text-xs font-semibold text-[#6E706B]">
                  ERC-8004 Verified
                </span>
              </div>
              <h2
                className="mt-3 text-3xl font-black tracking-tight text-[#111214] sm:text-4xl"
                id="agent-market-heading"
              >
                {selectedCategory.label} Agents
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#6E706B]">
                {selectedCategory.description}
              </p>
            </div>

            {!isLoading && !isError && (
              <div className="flex items-center gap-2 rounded-full border border-[#ECE8DE] bg-white px-4 py-2 text-xs font-bold text-[#303236] shadow-sm">
                <CategoryGlyph color="#1C6A44" name="shield" size={14} strokeWidth={2.4} />
                <span>
                  {categoryAgents.length} {categoryAgents.length === 1 ? "Agent" : "Agents"} Ready to Inspect
                </span>
              </div>
            )}
          </div>

          <div className="mt-10">
            {isLoading ? (
              <StatePanel
                body="Querying Dolphin's shared Convex catalog for BSC ERC-8004 agent records."
                state="syncing"
                title="Loading Agent Records"
              />
            ) : isError ? (
              <StatePanel
                body="The shared agent catalog could not be reached. No unverified records are being displayed."
                state="unavailable"
                title="Catalog Unavailable"
              />
            ) : categoryAgents.length === 0 ? (
              <StatePanel
                body="Dolphin's current catalog has no active agents in this collection yet."
                state="empty"
                title="No Agents in this Category"
              />
            ) : (
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-2">
                {categoryAgents.map((agent) => (
                  <AgentCard agent={agent} key={agent.id} />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Proof Before Permission / Architecture Due Diligence */}
      <section
        aria-labelledby="diligence-heading"
        className="site-frame py-20 sm:py-24 lg:py-28"
      >
        <div className="text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#F3E3A6] bg-[#FEF5D6] px-3.5 py-1 text-xs font-black text-[#946B00]">
            <CategoryGlyph color="#946B00" name="shield" size={13} strokeWidth={2.5} />
            TRUST ARCHITECTURE
          </span>
          <h2
            className="mt-4 text-3xl font-black tracking-tight text-[#111214] sm:text-4xl lg:text-5xl"
            id="diligence-heading"
          >
            Proof Before Permission.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-[#6E706B]">
            Never guess whether an agent performs. Inspect on-chain identity, real-time protocol metrics, and guardrail limits before connecting.
          </p>
        </div>

        <div className="mt-14 grid gap-8 md:grid-cols-3">
          {evidencePrinciples.map((principle) => (
            <div
              className="rounded-3xl border border-[#ECE8DE] bg-white p-8 shadow-sm"
              key={principle.index}
            >
              <div className="flex items-center justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#F3E3A6] bg-[#FEF5D6]">
                  <CategoryGlyph
                    color="#946B00"
                    name={principle.icon}
                    size={22}
                    strokeWidth={2.4}
                  />
                </div>
                <span className="font-mono text-sm font-black text-[#A5A79F]">
                  {principle.index}
                </span>
              </div>

              <h3 className="mt-6 text-xl font-black tracking-tight text-[#111214]">
                {principle.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-[#6E706B]">
                {principle.body}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
