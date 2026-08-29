"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import { AgentCard } from "@/components/agent-card";
import { CategoryGlyph } from "@/components/category-glyph";
import { ConstellationBg } from "@/components/constellation-bg";
import { AGENT_CATEGORIES } from "@/constants/agents";
import { EDITORIAL_AGENTS } from "@/data/editorial-agents";
import { useAgents } from "@/hooks/use-agents";
import type { Agent } from "@/types/agent";

export default function DiscoverPage() {
  const { data: liveAgents } = useAgents();
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const videoRef = useRef<HTMLVideoElement>(null);

  // Fallback to editorial catalog if live list is empty
  const catalog: Agent[] = liveAgents && liveAgents.length > 0 ? liveAgents : EDITORIAL_AGENTS;

  // Filter agents by category
  const filteredAgents = useMemo(() => {
    if (selectedCategory === "all") return catalog;
    return catalog.filter((a: Agent) => a.category === selectedCategory);
  }, [catalog, selectedCategory]);

  // Featured Spotlight Agent (App Store "App of the Day")
  const featuredAgent: Agent = useMemo(() => {
    return (
      catalog.find((a: Agent) => a.tokenId === "302257") ||
      catalog.find((a: Agent) => a.category === "health-factor") ||
      catalog[0]
    );
  }, [catalog]);

  // Curated collections for store shelves
  const healthFactorAgents = useMemo(
    () => catalog.filter((a: Agent) => a.category === "health-factor"),
    [catalog],
  );
  const rebalancingAgents = useMemo(
    () => catalog.filter((a: Agent) => a.category === "rebalancing"),
    [catalog],
  );
  const yieldAgents = useMemo(
    () => catalog.filter((a: Agent) => a.category === "yield"),
    [catalog],
  );
  const gridTradingAgents = useMemo(
    () => catalog.filter((a: Agent) => a.category === "grid-trading"),
    [catalog],
  );

  return (
    <div className="relative pb-24">
      <ConstellationBg opacity={0.5} />

      {/* Top Store Navigation: Category Filter Pills */}
      <div className="sticky top-20 z-30 border-b border-[#ECE8DE] bg-[#FBF9F4]/95 backdrop-blur-md">
        <div className="site-frame flex items-center gap-2 overflow-x-auto py-3.5 no-scrollbar">
          <button
            className={`pressable-scale flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-xs font-black transition-all ${
              selectedCategory === "all"
                ? "border border-[#F3E3A6] bg-[#FEF5D6] text-[#946B00] shadow-sm"
                : "border border-[#ECE8DE] bg-white text-[#6E706B] hover:border-[#F5B300]/40 hover:text-[#111214]"
            }`}
            onClick={() => setSelectedCategory("all")}
            type="button"
          >
            <CategoryGlyph
              color={selectedCategory === "all" ? "#946B00" : "currentColor"}
              name="sparkle"
              size={13}
              strokeWidth={2.4}
            />
            All Categories
          </button>

          {AGENT_CATEGORIES.map((cat) => {
            const isSelected = selectedCategory === cat.slug;
            return (
              <button
                className={`pressable-scale flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-xs font-black transition-all ${
                  isSelected
                    ? "border border-[#F3E3A6] bg-[#FEF5D6] text-[#946B00] shadow-sm"
                    : "border border-[#ECE8DE] bg-white text-[#6E706B] hover:border-[#F5B300]/40 hover:text-[#111214]"
                }`}
                key={cat.slug}
                onClick={() => setSelectedCategory(cat.slug)}
                type="button"
              >
                <CategoryGlyph
                  color={isSelected ? "#946B00" : "currentColor"}
                  name={cat.slug}
                  size={13}
                  strokeWidth={2.4}
                />
                {cat.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="site-frame mt-8 space-y-12">
        {/* App Store / Google Play Spotlight Banner */}
        <section className="relative overflow-hidden rounded-[32px] border border-[#ECE8DE] bg-white p-8 shadow-sm lg:p-12">
          {/* Subtle Ambient Gold Radiance */}
          <div className="pointer-events-none absolute -right-20 -top-20 h-96 w-96 rounded-full bg-[radial-gradient(circle,rgba(245,179,0,0.18)_0%,transparent_70%)] blur-3xl" />

          <div className="relative z-10 grid items-center gap-8 lg:grid-cols-[1.2fr_0.8fr]">
            {/* Spotlight Content */}
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="flex items-center gap-1.5 rounded-full border border-[#F3E3A6] bg-[#FEF5D6] px-3.5 py-1 text-xs font-black uppercase tracking-wide text-[#946B00]">
                  <span>⭐</span>
                  <span>Featured Agent of the Day</span>
                </span>
                <span className="flex items-center gap-1 text-xs font-extrabold text-[#1C6A44]">
                  <span className="h-2 w-2 rounded-full bg-[#1C6A44]" />
                  Venus Protocol Live
                </span>
              </div>

              <h1 className="text-balance text-3xl font-black tracking-tight text-[#111214] sm:text-5xl">
                {featuredAgent.name}
              </h1>

              <p className="max-w-xl text-base leading-relaxed text-[#4A4B4F]">
                {featuredAgent.tagline}
              </p>

              {/* App Store Highlights Row */}
              <div className="flex flex-wrap items-center gap-6 pt-2 text-xs font-bold text-[#6E706B]">
                <div className="flex items-center gap-1.5">
                  <span className="text-base text-[#946B00]">★</span>
                  <span className="text-sm font-black text-[#111214]">4.9</span>
                  <span className="text-[11px] font-semibold text-[#A5A79F]">Reputation</span>
                </div>
                <div className="h-4 w-px bg-[#ECE8DE]" />
                <div>
                  <span className="font-mono text-sm font-black text-[#111214]">ERC-8004</span>
                  <span className="ml-1 text-[11px] font-semibold text-[#A5A79F]">Standard</span>
                </div>
                <div className="h-4 w-px bg-[#ECE8DE]" />
                <div className="flex items-center gap-1 text-[#1C6A44]">
                  <CategoryGlyph color="#1C6A44" name="shield" size={13} strokeWidth={2.5} />
                  <span>100% Non-Custodial</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-3 pt-4">
                <Link
                  className="pressable-scale flex items-center gap-2 rounded-full bg-[#F5B300] px-7 py-3 text-sm font-black text-[#111214] no-underline shadow-sm hover:bg-[#E2A500]"
                  href={`/agent/${featuredAgent.tokenId}`}
                >
                  <span>GET AGENT</span>
                  <CategoryGlyph color="#111214" name="arrow-right" size={15} strokeWidth={2.5} />
                </Link>

                <Link
                  className="pressable-scale flex items-center gap-2 rounded-full border border-[#ECE8DE] bg-[#FBF9F4] px-6 py-3 text-sm font-bold text-[#303236] no-underline hover:border-[#F5B300]/50 hover:bg-white"
                  href={`/search?category=${featuredAgent.category}`}
                >
                  <span>More in Health Factor</span>
                </Link>
              </div>
            </div>

            {/* Visual Media Centerpiece: Interactive BNB Coin Animation */}
            <div className="flex items-center justify-center">
              <div className="relative h-64 w-64 sm:h-72 sm:w-72">
                <video
                  aria-label="BNB Smart Money Coin showcase"
                  autoPlay
                  className="h-full w-full object-contain drop-shadow-[0_20px_40px_rgba(245,179,0,0.25)]"
                  loop
                  muted
                  playsInline
                  ref={videoRef}
                  src="/coin.mp4"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Dynamic Store View: Either Filtered Grid or Curated App Store Shelves */}
        {selectedCategory !== "all" ? (
          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-black tracking-tight text-[#111214]">
                  {AGENT_CATEGORIES.find((c) => c.slug === selectedCategory)?.label} Agents
                </h2>
                <p className="mt-1 text-xs text-[#6E706B]">
                  {filteredAgents.length} verified autonomous agents available on BNB Smart Chain
                </p>
              </div>
            </div>

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {filteredAgents.map((agent: Agent) => (
                <AgentCard agent={agent} key={agent.id} />
              ))}
            </div>
          </section>
        ) : (
          <div className="space-y-14">
            {/* Shelf 1: Liquidation & Health Factor Sentinels */}
            {healthFactorAgents.length > 0 && (
              <section className="space-y-6">
                <div className="flex items-end justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#DCEFE4]">
                        <CategoryGlyph color="#1C6A44" name="health-factor" size={14} strokeWidth={2.4} />
                      </span>
                      <h2 className="text-2xl font-black tracking-tight text-[#111214]">
                        Liquidation & Health Factor Sentinels
                      </h2>
                    </div>
                    <p className="mt-1 text-xs text-[#6E706B]">
                      Real-time Venus Protocol & Aave collateral monitoring to safeguard loans before liquidation.
                    </p>
                  </div>

                  <button
                    className="text-xs font-bold text-[#946B00] hover:underline"
                    onClick={() => setSelectedCategory("health-factor")}
                    type="button"
                  >
                    See all →
                  </button>
                </div>

                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {healthFactorAgents.map((agent: Agent) => (
                    <AgentCard agent={agent} key={agent.id} />
                  ))}
                </div>
              </section>
            )}

            {/* Shelf 2: Concentrated Liquidity Rebalancing */}
            {rebalancingAgents.length > 0 && (
              <section className="space-y-6">
                <div className="flex items-end justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#FEF5D6]">
                        <CategoryGlyph color="#946B00" name="rebalancing" size={14} strokeWidth={2.4} />
                      </span>
                      <h2 className="text-2xl font-black tracking-tight text-[#111214]">
                        Top Rebalancing & LP Managers
                      </h2>
                    </div>
                    <p className="mt-1 text-xs text-[#6E706B]">
                      PancakeSwap V3 active range reset and concentrated liquidity fee capture.
                    </p>
                  </div>

                  <button
                    className="text-xs font-bold text-[#946B00] hover:underline"
                    onClick={() => setSelectedCategory("rebalancing")}
                    type="button"
                  >
                    See all →
                  </button>
                </div>

                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {rebalancingAgents.map((agent: Agent) => (
                    <AgentCard agent={agent} key={agent.id} />
                  ))}
                </div>
              </section>
            )}

            {/* Shelf 3: High Yield Optimizers */}
            {yieldAgents.length > 0 && (
              <section className="space-y-6">
                <div className="flex items-end justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#E9E1F4]">
                        <CategoryGlyph color="#65478A" name="yield" size={14} strokeWidth={2.4} />
                      </span>
                      <h2 className="text-2xl font-black tracking-tight text-[#111214]">
                        DeFi Yield & Vault Auto-Compounders
                      </h2>
                    </div>
                    <p className="mt-1 text-xs text-[#6E706B]">
                      Automated yield routing across Beefy, Lista, and Aave pools on BSC.
                    </p>
                  </div>

                  <button
                    className="text-xs font-bold text-[#946B00] hover:underline"
                    onClick={() => setSelectedCategory("yield")}
                    type="button"
                  >
                    See all →
                  </button>
                </div>

                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {yieldAgents.map((agent: Agent) => (
                    <AgentCard agent={agent} key={agent.id} />
                  ))}
                </div>
              </section>
            )}

            {/* Shelf 4: Grid Trading & Order Ladders */}
            {gridTradingAgents.length > 0 && (
              <section className="space-y-6">
                <div className="flex items-end justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#DDE9F8]">
                        <CategoryGlyph color="#295C92" name="grid-trading" size={14} strokeWidth={2.4} />
                      </span>
                      <h2 className="text-2xl font-black tracking-tight text-[#111214]">
                        Grid Trading & Geometric Engines
                      </h2>
                    </div>
                    <p className="mt-1 text-xs text-[#6E706B]">
                      Automated price ladder buy/sell orders capturing volatility on BNB pairs.
                    </p>
                  </div>

                  <button
                    className="text-xs font-bold text-[#946B00] hover:underline"
                    onClick={() => setSelectedCategory("grid-trading")}
                    type="button"
                  >
                    See all →
                  </button>
                </div>

                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {gridTradingAgents.map((agent: Agent) => (
                    <AgentCard agent={agent} key={agent.id} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {/* App Store Diligence: "Proof Before Permission" Security Standard */}
        <section className="rounded-[32px] border border-[#ECE8DE] bg-white p-8 shadow-sm sm:p-12">
          <div className="max-w-2xl">
            <span className="text-xs font-black uppercase tracking-wider text-[#946B00]">
              The BNB Chain Standard
            </span>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-[#111214]">
              Proof Before Permission
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-[#6E706B]">
              Unlike black-box trading bots, every agent on Dolphin is anchored on-chain with verifiable ERC-8004 identity and scoped session bounds.
            </p>
          </div>

          <div className="mt-8 grid gap-6 md:grid-cols-3">
            <div className="rounded-2xl border border-[#ECE8DE] bg-[#FBF9F4] p-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-[#946B00] shadow-sm">
                <CategoryGlyph color="#946B00" name="sparkle" size={20} strokeWidth={2.2} />
              </div>
              <h3 className="mt-4 text-base font-black text-[#111214]">
                1. ERC-8004 Provenance
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-[#6E706B]">
                Tokenized on-chain registration on BNB Chain linking publishers, verified capabilities, and metadata without middlemen.
              </p>
            </div>

            <div className="rounded-2xl border border-[#ECE8DE] bg-[#FBF9F4] p-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-[#1C6A44] shadow-sm">
                <CategoryGlyph color="#1C6A44" name="health-factor" size={20} strokeWidth={2.2} />
              </div>
              <h3 className="mt-4 text-base font-black text-[#111214]">
                2. Live Protocol Feeds
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-[#6E706B]">
                Real-time data feeds directly from Venus Protocol and PancakeSwap V3 contracts. Zero fake or mocked numbers.
              </p>
            </div>

            <div className="rounded-2xl border border-[#ECE8DE] bg-[#FBF9F4] p-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-[#295C92] shadow-sm">
                <CategoryGlyph color="#295C92" name="shield" size={20} strokeWidth={2.2} />
              </div>
              <h3 className="mt-4 text-base font-black text-[#111214]">
                3. Non-Custodial Bounds
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-[#6E706B]">
                Altana session guardrails enforce spend limits and call allowlists on-chain. You can instantly revoke access at any time.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
