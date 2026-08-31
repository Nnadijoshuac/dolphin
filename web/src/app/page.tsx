"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { AgentCard } from "@/components/agent-card";
import { AgentIcon } from "@/components/agent-icon";
import { CategoryGlyph } from "@/components/category-glyph";
import { StatePanel } from "@/components/state-panel";
import { AGENT_CATEGORIES } from "@/constants/agents";
import { useAgents } from "@/hooks/use-agents";
import type { AgentCategory } from "@/types/agent";

const categoryNumbers = ["01", "02", "03", "04"] as const;

export default function DiscoverPage() {
  const { data: agents, isError, isLoading } = useAgents();
  const [selectedCategory, setSelectedCategory] = useState<AgentCategory | null>(null);

  const catalog = agents ?? [];
  const featuredAgent =
    catalog.find((agent) => agent.category === "health-factor") ?? catalog[0];
  const visibleAgents = useMemo(
    () =>
      selectedCategory
        ? catalog.filter((agent) => agent.category === selectedCategory)
        : catalog,
    [catalog, selectedCategory],
  );
  const selectedLabel = AGENT_CATEGORIES.find(
    (category) => category.slug === selectedCategory,
  )?.label;

  return (
    <div>
      <section className="site-frame pb-12 pt-14 sm:pb-16 sm:pt-20 lg:pt-24">
        <div className="grid items-end gap-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.7fr)]">
          <div className="page-intro">
            <p className="eyebrow">ERC-8004 agents · BNB Chain</p>
            <h1 className="display-title mt-5">Find an agent you can actually understand.</h1>
            <p className="body-copy mt-6 max-w-[58ch]">
              Compare what each agent does, where its data comes from, and what
              access it needs before you decide to hire it.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                className="interactive inline-flex min-h-12 items-center justify-between gap-8 rounded-xl border border-line bg-paper px-4 text-sm text-muted no-underline hover:bg-paper-strong sm:min-w-[340px]"
                href="/search"
              >
                <span className="flex items-center gap-3">
                  <CategoryGlyph color="currentColor" name="search" size={18} />
                  Search agents, protocols, or skills
                </span>
                <span aria-hidden="true" className="text-faint">↗</span>
              </Link>
              <a
                className="interactive inline-flex min-h-12 items-center px-2 text-sm font-semibold text-ink-soft underline-offset-4 hover:text-ink hover:underline"
                href="#how-it-works"
              >
                How Dolphin evaluates records
              </a>
            </div>
          </div>

          <div className="border-l border-line pl-6 sm:pl-8">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-faint">
              A clear place to start
            </p>
            {isLoading ? (
              <div aria-label="Loading featured agent" className="mt-5 space-y-4">
                <div className="skeleton h-14 w-14 rounded-[14px]" />
                <div className="skeleton h-6 w-2/3 rounded-md" />
                <div className="skeleton h-4 w-full rounded-md" />
              </div>
            ) : featuredAgent ? (
              <Link
                className="group mt-5 block no-underline"
                href={`/agent/${featuredAgent.tokenId}`}
              >
                <div className="flex items-center gap-4">
                  <AgentIcon
                    category={featuredAgent.category}
                    size={58}
                    uri={featuredAgent.iconUrl}
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-medium capitalize text-muted">
                      {featuredAgent.category.replaceAll("-", " ")} agent
                    </p>
                    <h2 className="mt-0.5 truncate text-xl font-semibold tracking-[-0.035em] transition-colors group-hover:text-accent-ink">
                      {featuredAgent.name}
                    </h2>
                  </div>
                </div>
                <p className="mt-4 line-clamp-3 text-sm leading-6 text-muted">
                  {featuredAgent.tagline}
                </p>
                <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-ink">
                  Inspect the record
                  <CategoryGlyph
                    color="currentColor"
                    name="arrow-right"
                    size={16}
                    strokeWidth={2}
                  />
                </span>
              </Link>
            ) : (
              <p className="mt-4 text-sm leading-6 text-muted">
                The catalog has no agent records to feature yet.
              </p>
            )}
          </div>
        </div>
      </section>

      <section aria-labelledby="categories-heading" className="border-y border-line bg-paper">
        <div className="site-frame py-10 sm:py-12">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="eyebrow">Browse by job</p>
              <h2 className="section-title mt-3" id="categories-heading">
                Four different kinds of help.
              </h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-muted">
              Each category is evaluated with metrics that fit the work—not a
              one-size-fits-all score.
            </p>
          </div>

          <div className="mt-9 grid border-l border-t border-line md:grid-cols-2 lg:grid-cols-4">
            {AGENT_CATEGORIES.map((category, index) => {
              const isSelected = selectedCategory === category.slug;
              const count = catalog.filter(
                (agent) => agent.category === category.slug,
              ).length;

              return (
                <button
                  aria-pressed={isSelected}
                  className={`interactive relative min-h-[220px] border-b border-r border-line p-5 text-left sm:p-6 ${
                    isSelected ? "bg-accent-soft" : "bg-paper hover:bg-canvas"
                  }`}
                  key={category.slug}
                  onClick={() =>
                    setSelectedCategory((current) =>
                      current === category.slug ? null : category.slug,
                    )
                  }
                  type="button"
                >
                  <div className="flex items-center justify-between text-xs font-medium text-faint">
                    <span>{categoryNumbers[index]}</span>
                    <span>{count} in catalog</span>
                  </div>
                  <div className="mt-8 flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-paper-strong">
                    <CategoryGlyph
                      color="#654b00"
                      name={category.slug}
                      size={20}
                      strokeWidth={2}
                    />
                  </div>
                  <h3 className="mt-5 text-lg font-semibold tracking-[-0.03em]">
                    {category.label}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-muted">{category.description}</p>
                  {isSelected ? (
                    <span className="absolute bottom-0 left-0 top-0 w-1 bg-accent" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section aria-labelledby="catalog-heading" className="site-frame py-14 sm:py-20">
        <div className="flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="eyebrow">Catalog</p>
            <h2 className="section-title mt-3" id="catalog-heading">
              {selectedLabel ? `${selectedLabel} agents` : "All agents"}
            </h2>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted">
            {!isLoading && !isError ? (
              <span>{visibleAgents.length} records</span>
            ) : null}
            {selectedCategory ? (
              <button
                className="interactive font-semibold text-ink underline underline-offset-4 hover:text-accent-ink"
                onClick={() => setSelectedCategory(null)}
                type="button"
              >
                Show all
              </button>
            ) : null}
          </div>
        </div>

        <div>
          {isLoading ? (
            <div aria-label="Loading agent catalog" className="divide-y divide-line">
              {[0, 1, 2].map((item) => (
                <div className="flex gap-4 py-6" key={item}>
                  <div className="skeleton h-14 w-14 shrink-0 rounded-[14px]" />
                  <div className="w-full space-y-3">
                    <div className="skeleton h-5 w-1/3 rounded-md" />
                    <div className="skeleton h-4 w-2/3 rounded-md" />
                  </div>
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className="pt-8">
              <StatePanel
                body="Dolphin could not reach the shared agent catalog. No fallback numbers or records are being shown in its place."
                state="unavailable"
                title="Catalog unavailable"
              />
            </div>
          ) : visibleAgents.length === 0 ? (
            <div className="pt-8">
              <StatePanel
                body="There are no catalog records in this category yet. Choose another category or return later."
                state="empty"
                title="No agents found"
              />
            </div>
          ) : (
            <div>
              {visibleAgents.map((agent) => (
                <AgentCard agent={agent} key={agent.id} />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="border-y border-line bg-paper" id="how-it-works">
        <div className="site-frame py-14 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.4fr]">
            <div>
              <p className="eyebrow">Proof before permission</p>
              <h2 className="section-title mt-3">Know what is real—and what is not.</h2>
            </div>
            <div className="grid border-t border-line md:grid-cols-3">
              {[
                {
                  number: "01",
                  title: "Identity",
                  body: "Every record keeps its ERC-8004 reference and publisher information visible.",
                },
                {
                  number: "02",
                  title: "Evidence",
                  body: "Metrics carry a source and check time. Missing feeds remain clearly unavailable.",
                },
                {
                  number: "03",
                  title: "Control",
                  body: "Session-enabled hires expose their cap, expiry, scope, and revoke action.",
                },
              ].map((item) => (
                <article className="border-b border-line py-6 md:border-l md:px-6" key={item.number}>
                  <p className="text-xs font-medium text-faint">{item.number}</p>
                  <h3 className="mt-8 text-lg font-semibold tracking-[-0.03em]">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted">{item.body}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
