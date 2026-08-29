"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";

import { AgentCard } from "@/components/agent-card";
import { CategoryGlyph } from "@/components/category-glyph";
import { StatePanel } from "@/components/state-panel";
import { AGENT_CATEGORIES } from "@/constants/agents";
import { useAgents } from "@/hooks/use-agents";
import type { AgentCategory } from "@/types/agent";

const evidencePrinciples = [
  {
    index: "01",
    title: "Identity checked onchain",
    body: "Detail views re-check ERC-8004 registration on BNB Smart Chain.",
  },
  {
    index: "02",
    title: "Every metric keeps its status",
    body: "Live, stale, syncing, and unavailable remain visibly different.",
  },
  {
    index: "03",
    title: "Authority stays explicit",
    body: "Read-only hiring is never presented as autonomous execution.",
  },
] as const;

export default function DiscoverPage() {
  const [activeCategory, setActiveCategory] =
    useState<AgentCategory>("rebalancing");
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
    <>
      <section className="site-frame pt-8 sm:pt-12 lg:pt-16">
        <div className="relative min-h-[610px] overflow-hidden rounded-[22px] bg-[#090b08] text-white shadow-[var(--shadow-floating)] sm:min-h-[660px] lg:min-h-[690px]">
          <Image
            alt="A smoked-glass dolphin moving through precise gold market orbits"
            className="object-cover object-[68%_center] opacity-80 sm:object-[64%_center] lg:object-center lg:opacity-100"
            fill
            priority
            sizes="(max-width: 768px) 100vw, 1344px"
            src="/dolphin-agent-hero.png"
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(9,11,8,0.98)_0%,rgba(9,11,8,0.91)_38%,rgba(9,11,8,0.28)_72%,rgba(9,11,8,0.08)_100%)]" />
          <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-[#090b08] to-transparent lg:hidden" />

          <div className="relative z-10 flex min-h-[610px] max-w-[760px] flex-col justify-between p-7 sm:min-h-[660px] sm:p-10 lg:min-h-[690px] lg:p-14">
            <p className="reveal-one text-xs font-bold tracking-[0.17em] text-[#e9b949]">
              EVIDENCE-FIRST AGENT MARKETPLACE
            </p>

            <div className="pb-2">
              <h1 className="reveal-two text-balance max-w-[720px] text-[clamp(3.2rem,7.3vw,7.2rem)] font-black leading-[0.88] tracking-[-0.075em]">
                Find the agent. See the proof.
              </h1>
              <p className="reveal-three mt-7 max-w-xl text-pretty text-base leading-7 text-white/68 sm:text-lg sm:leading-8">
                Discover BNB Chain agents with live evidence, visible
                provenance, and authority you can inspect before granting it.
              </p>
              <div className="reveal-three mt-9 flex flex-col gap-3 sm:flex-row">
                <button
                  className="pressable-scale inline-flex min-h-12 items-center justify-center rounded-xl bg-[#e9b949] px-6 text-sm font-black text-[#17140c] hover:bg-[#f0c665]"
                  onClick={() =>
                    marketRef.current?.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    })
                  }
                  type="button"
                >
                  Explore agents
                </button>
                <Link
                  className="pressable-scale inline-flex min-h-12 items-center justify-center rounded-xl border border-white/24 bg-white/5 px-6 text-sm font-bold text-white no-underline hover:border-white/48 hover:bg-white/10"
                  href="/search"
                >
                  Search the registry
                </Link>
              </div>
            </div>

            <p className="text-xs leading-5 text-white/45">
              ERC-8004 identity / BNB Smart Chain / fail-closed live data
            </p>
          </div>
        </div>

        <div className="grid border-b border-[var(--line)] sm:grid-cols-3">
          {evidencePrinciples.map((principle) => (
            <div
              className="grid grid-cols-[2.25rem_1fr] gap-3 border-t border-[var(--line)] py-6 sm:border-t-0 sm:px-5 sm:first:pl-0 sm:last:pr-0"
              key={principle.index}
            >
              <span className="font-mono text-xs text-[var(--accent-ink)]">
                {principle.index}
              </span>
              <div>
                <p className="text-sm font-bold text-[var(--ink)]">
                  {principle.title}
                </p>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  {principle.body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section
        aria-labelledby="category-heading"
        className="site-frame py-20 sm:py-24 lg:py-32"
      >
        <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-end">
          <div>
            <p className="text-sm font-semibold text-[var(--accent-ink)]">
              Four ways to put an agent to work
            </p>
            <h2
              className="text-balance mt-4 max-w-xl text-4xl font-black leading-[0.96] tracking-[-0.06em] text-[var(--ink)] sm:text-6xl"
              id="category-heading"
            >
              Start with the job, not the hype.
            </h2>
          </div>
          <p className="max-w-xl text-pretty text-base leading-7 text-[var(--muted)] lg:justify-self-end">
            Every collection maps to the same catalog and live-stat shapes used
            by Dolphin mobile. Choose a category, then inspect what the data can
            and cannot prove.
          </p>
        </div>

        <div className="mt-12 grid border-b border-[var(--line)] md:grid-cols-2 lg:grid-cols-4">
          {AGENT_CATEGORIES.map((category, index) => {
            const isActive = category.slug === activeCategory;

            return (
              <button
                aria-pressed={isActive}
                className={`pressable-scale group min-h-64 border-t border-[var(--line)] p-6 text-left md:odd:border-r lg:border-r lg:last:border-r-0 ${
                  isActive
                    ? "bg-[var(--surface-elevated)]"
                    : "hover:bg-[var(--surface)]"
                }`}
                key={category.slug}
                onClick={() => selectCategory(category.slug, true)}
                type="button"
              >
                <div className="flex items-start justify-between gap-4">
                  <span className="flex h-12 w-12 items-center justify-center rounded-[14px] border border-[var(--line)] bg-[var(--surface)]">
                    <CategoryGlyph
                      color="var(--ink)"
                      name={category.slug}
                      size={24}
                      strokeWidth={1.8}
                    />
                  </span>
                  <span className="font-mono text-xs text-[var(--faint)]">
                    0{index + 1}
                  </span>
                </div>
                <h3 className="mt-8 text-xl font-bold tracking-[-0.035em] text-[var(--ink)]">
                  {category.label}
                </h3>
                <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                  {category.description}
                </p>
                <p className="mt-6 text-xs font-bold text-[var(--accent-ink)]">
                  {isActive ? "Selected" : "View collection"}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      <section
        aria-labelledby="agent-market-heading"
        className="scroll-mt-32 border-y border-[var(--line)] bg-[var(--surface)]"
        id="agent-market"
        ref={marketRef}
      >
        <div className="site-frame py-16 sm:py-20 lg:py-24">
          <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <p className="text-sm font-semibold text-[var(--accent-ink)]">
                Selected collection
              </p>
              <h2
                className="mt-3 text-4xl font-black tracking-[-0.055em] text-[var(--ink)] sm:text-5xl"
                id="agent-market-heading"
              >
                {selectedCategory.label}
              </h2>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-[var(--muted)]">
                {selectedCategory.description}
              </p>
            </div>
            {!isLoading && !isError && (
              <p className="font-mono text-xs text-[var(--faint)]">
                {categoryAgents.length} catalog {categoryAgents.length === 1 ? "record" : "records"}
              </p>
            )}
          </div>

          <div className="mt-10">
            {isLoading ? (
              <StatePanel
                body="Reading Dolphin's shared Convex catalog for BSC agent records."
                state="syncing"
                title="Loading agent evidence"
              />
            ) : isError ? (
              <StatePanel
                body="The shared agent catalog could not be reached. No local substitute has been shown."
                state="unavailable"
                title="Catalog unavailable"
              />
            ) : categoryAgents.length === 0 ? (
              <StatePanel
                body="Dolphin's current catalog has no explicitly classified agents in this collection."
                state="empty"
                title="No catalog records"
              />
            ) : (
              <div className="grid border-b border-[var(--line)] lg:grid-cols-2">
                {categoryAgents.map((agent, index) => (
                  <AgentCard
                    agent={agent}
                    className={index % 2 === 0 ? "lg:border-r" : ""}
                    key={agent.id}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <section
        aria-labelledby="diligence-heading"
        className="site-frame py-20 sm:py-24 lg:py-32"
      >
        <div className="grid gap-14 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="lg:sticky lg:top-32 lg:self-start">
            <p className="text-sm font-semibold text-[var(--accent-ink)]">
              Proof before permission
            </p>
            <h2
              className="text-balance mt-4 text-4xl font-black leading-[0.98] tracking-[-0.055em] text-[var(--ink)] sm:text-5xl"
              id="diligence-heading"
            >
              A due-diligence trail built into every profile.
            </h2>
          </div>

          <div className="border-b border-[var(--line)]">
            {[
              [
                "Identity",
                "Compare the indexed profile with the ERC-8004 registry owner, wallet, and token URI.",
              ],
              [
                "Evidence",
                "Read metric status, freshness, methodology, and source before relying on a number.",
              ],
              [
                "Permission",
                "See the exact hire capability and transaction boundary before connecting a wallet.",
              ],
            ].map(([title, body], index) => (
              <div
                className="grid gap-4 border-t border-[var(--line)] py-7 sm:grid-cols-[3rem_10rem_1fr]"
                key={title}
              >
                <span className="font-mono text-xs text-[var(--faint)]">
                  0{index + 1}
                </span>
                <h3 className="text-base font-bold text-[var(--ink)]">
                  {title}
                </h3>
                <p className="max-w-xl text-sm leading-6 text-[var(--muted)]">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
