"use client";

import { useRef, useState } from "react";
import { AGENT_CATEGORIES } from "@/constants/agents";
import { colors, shadows } from "@/constants/theme";
import { useAgents } from "@/hooks/use-agents";
import { AgentCard } from "@/components/agent-card";
import { CategoryGlyph } from "@/components/category-glyph";
import { StatePanel } from "@/components/state-panel";
import { BrandMark } from "@/components/brand-mark";
import type { AgentCategory } from "@/types/agent";

export default function DiscoverPage() {
  const [activeCategory, setActiveCategory] = useState<AgentCategory>("monitoring");
  const { data: agents, isLoading, isError } = useAgents();
  const carouselRef = useRef<HTMLDivElement>(null);

  const handleSelectCategory = (slug: AgentCategory) => {
    setActiveCategory(slug);
    const index = AGENT_CATEGORIES.findIndex((c) => c.slug === slug);
    if (index !== -1 && carouselRef.current) {
      const containerWidth = carouselRef.current.clientWidth;
      carouselRef.current.scrollTo({
        left: index * containerWidth,
        behavior: "smooth",
      });
    }
  };

  const handleScroll = () => {
    if (!carouselRef.current) return;
    const containerWidth = carouselRef.current.clientWidth;
    if (containerWidth <= 0) return;
    const index = Math.round(carouselRef.current.scrollLeft / containerWidth);
    if (index >= 0 && index < AGENT_CATEGORIES.length) {
      const nextCat = AGENT_CATEGORIES[index].slug;
      if (nextCat !== activeCategory) {
        setActiveCategory(nextCat);
      }
    }
  };

  return (
    <div className="pb-16">
      {/* Scrollable Dolphin Brand Header */}
      <div className="flex items-center gap-3 pt-6 pb-2">
        <BrandMark size={36} />
        <div>
          <h2 className="text-base font-black tracking-tight" style={{ color: colors.ink }}>
            Dolphin
          </h2>
          <p className="text-[11px] font-medium text-zinc-400">
            ERC-8004 AI agent marketplace · on BNB Chain
          </p>
        </div>
      </div>

      {/* Sticky Header Layer: Discover Title + Docked Category Tabs */}
      <div className="sticky top-0 z-30 pt-3 pb-2 bg-[#FBF9F4] border-b border-zinc-200/60">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl md:text-3xl font-black tracking-tight" style={{ color: colors.ink }}>
            Discover
          </h1>
        </div>

        {/* Category Tabs fitted across the bar */}
        <div className="mt-3 flex items-center justify-between border-b border-zinc-200/60 pb-1">
          {AGENT_CATEGORIES.map((cat) => {
            const isActive = activeCategory === cat.slug;
            return (
              <button
                key={cat.slug}
                onClick={() => handleSelectCategory(cat.slug)}
                className="text-[13px] sm:text-sm font-semibold pb-2 border-b-2 transition-all whitespace-nowrap px-1"
                style={{
                  borderColor: isActive ? colors.gold : "transparent",
                  color: isActive ? colors.ink : colors.muted,
                }}
              >
                {cat.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="pt-4 space-y-6">
        {/* Featured Hero Card */}
        <div
          onClick={() => handleSelectCategory("monitoring")}
          className="cursor-pointer overflow-hidden rounded-3xl p-6 md:p-8 text-white relative transition-all duration-300 hover:scale-[1.01]"
          style={{
            backgroundColor: "#000000",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: shadows.floating,
          }}
        >
          <div className="relative z-10 max-w-lg">
            <div
              className="inline-flex items-center rounded-full px-2.5 py-1 mb-3 text-[10px] font-bold uppercase tracking-widest border"
              style={{
                backgroundColor: "#2A2415",
                borderColor: "rgba(245, 179, 0, 0.35)",
                color: colors.gold,
              }}
            >
              MONITORING
            </div>

            <h2 className="text-2xl md:text-3xl font-black leading-tight">
              Agents that watch{"\n"}while you sleep
            </h2>

            <p className="mt-2 text-xs md:text-sm text-zinc-400 leading-relaxed">
              Autonomous agents that track markets and safeguard your positions 24/7 on BNB Smart Chain.
            </p>

            <div className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-[#F5B300]">
              Explore collection
              <CategoryGlyph color="#F5B300" name="arrow-right" size={14} strokeWidth={2.5} />
            </div>
          </div>
        </div>

        {/* Slideable Category Lists Carousel */}
        <div
          ref={carouselRef}
          onScroll={handleScroll}
          className="flex overflow-x-auto snap-x snap-mandatory scroll-smooth no-scrollbar -mx-5 px-5"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {AGENT_CATEGORIES.map((cat) => {
            const categoryAgents = agents?.filter((a) => a.category === cat.slug) ?? [];
            return (
              <div
                key={cat.slug}
                className="w-full shrink-0 snap-center"
              >
                {isLoading ? (
                  <div className="py-12">
                    <StatePanel
                      body="Fetching 8004scan-indexed BSC agent records..."
                      state="syncing"
                      title="Loading Agents"
                    />
                  </div>
                ) : isError ? (
                  <div className="py-12">
                    <StatePanel
                      body="Unable to connect to registry API. Please check your network connection."
                      state="unavailable"
                      title="Sync Failed"
                    />
                  </div>
                ) : categoryAgents.length === 0 ? (
                  <div className="py-12">
                    <StatePanel
                      body="No agents found in this category. Check back soon."
                      state="unavailable"
                      title="No Agents Found"
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {categoryAgents.map((agent) => (
                      <AgentCard key={agent.id} agent={agent} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
