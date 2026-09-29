"use client";

/**
 * THE LANDING PAGE'S SECTIONS (revamped 2026-09-29 - owner: "this is the first
 * impression... it has to be new, it has to be good").
 *
 * The old page ran ~8,700px: six near-identical shelves repeating the same
 * agents, then a second full catalog with "Record source / Indexed record"
 * cards, and nothing saying Dolphin also BUILDS agents. The new order:
 *
 *   HeroSearch      a real search field, and "Build an agent" beside it
 *   CategoryTiles   browse by what you need - live counts, plain words
 *   FeaturedTabs    the shelves as tabs over ONE carousel, not six rows
 *   HowItWorks3     find, hire or connect, build - three plain steps
 *   BuildBand       the builder, said loudly
 *
 * Every number is read (facets, shelves); none is written in.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type CSSProperties } from "react";

import { AgentCard } from "@/components/agent-card";
import { CategoryGlyph } from "@/components/category-glyph";
import { categoryDescription } from "@/constants/agents";
import type { AgentShelfData } from "@/convex/api";
import type { AgentSignals } from "@/hooks/use-agents";
import { track } from "@/lib/analytics";

/** Under this many agents a category is gathered into "More categories". */
const TILE_MIN = 3;

/**
 * A COLOUR PER CATEGORY, not an icon (owner, 2026-09-29: the icons "are
 * ugly", and the page "looks somewhat colourless"). Restrained, mid-tone hues
 * that read on both themes; a category nobody has thought of gets one by hash.
 */
const HUES: Record<string, string> = {
  yield: "#1f9d55",
  "grid-trading": "#2f6fdf",
  rebalancing: "#0e9aa7",
  "health-factor": "#d1435b",
  trading: "#7c5ce6",
  payments: "#d98a14",
  general: "#6f7a8a",
  monitoring: "#e0662a",
  security: "#b0452f",
  research: "#3b82a6",
};
const SPARE = ["#1f9d55", "#2f6fdf", "#0e9aa7", "#d1435b", "#7c5ce6", "#d98a14"];
function hueFor(slug: string): string {
  if (HUES[slug]) return HUES[slug];
  let hash = 0;
  for (const char of slug) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return SPARE[hash % SPARE.length];
}

/** One plain line per job, for people who are new to this. */
const PLAIN: Record<string, string> = {
  yield: "Put idle money to work where it earns the most.",
  "grid-trading": "Buy low and sell high inside a price range.",
  rebalancing: "Keep liquidity positions where they earn fees.",
  "health-factor": "Watch your loans and stay clear of liquidation.",
  trading: "Plan and place trades for you.",
  monitoring: "Watch the market and tell you when something moves.",
  payments: "Quote, invoice and settle payments for you.",
  general: "Agents that do a bit of everything.",
  security: "Check contracts and approvals for risk.",
  research: "Dig up and summarise what is going on.",
};
export function HeroSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  return (
    <div className="discover-actions">
      <form
        className="catalog-search discover-search"
        onSubmit={(event) => {
          event.preventDefault();
          const text = query.trim();
          router.push(text ? `/search?q=${encodeURIComponent(text)}` : "/search");
        }}
        role="search"
      >
        <span aria-hidden="true" className="catalog-search__icon">
          <CategoryGlyph color="currentColor" name="search" size={18} strokeWidth={2} />
        </span>
        <label className="sr-only" htmlFor="discover-search">
          Search agents
        </label>
        <input
          autoComplete="off"
          className="catalog-search__input"
          id="discover-search"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="What do you need done? Try yield or Venus"
          type="search"
          value={query}
        />
        <button aria-label="Search" className="discover-search__go" type="submit">
          <CategoryGlyph color="currentColor" name="arrow-right" size={16} strokeWidth={2} />
        </button>
      </form>
      <Link className="discover-build-btn" href="/dolphin" onClick={() => track("build_cta_clicked", { surface: "hero" })}>
        Build an agent
      </Link>
    </div>
  );
}

export function HeroStats({ totalLive, categories }: { totalLive: number; categories: number }) {
  if (totalLive <= 0) return <div className="discover-stats" aria-hidden="true" />;
  return (
    <ul aria-label="The catalog right now" className="discover-stats">
      <li>
        <strong>{totalLive.toLocaleString()}</strong> live agents
      </li>
      {categories > 0 ? (
        <li>
          <strong>{categories}</strong> categories
        </li>
      ) : null}
      <li>Paid jobs held until delivered</li>
    </ul>
  );
}

export function CategoryTiles({
  categories,
  isLoading,
}: {
  categories: { slug: string; label: string; count: number }[];
  isLoading: boolean;
}) {
  const main = categories.filter((category) => category.count >= TILE_MIN);
  const rest = categories.filter((category) => category.count < TILE_MIN);
  const restCount = rest.reduce((sum, category) => sum + category.count, 0);

  return (
    <section aria-labelledby="discover-categories" className="discover-section">
      <div className="discover-section__head">
        <div>
          <h2 className="discover-section__title" id="discover-categories">
            Browse by what you need
          </h2>
          <p className="discover-section__sub">Every agent sorted by the job it does.</p>
        </div>
      </div>
      <div className="discover-tiles">
        {isLoading
          ? Array.from({ length: 8 }, (_, index) => <div aria-hidden="true" className="discover-tile discover-tile--skeleton skeleton" key={index} />)
          : main.map((category, index) => (
              <Link
                className="discover-tile"
                href={`/search?category=${category.slug}`}
                key={category.slug}
                onClick={() => track("category_selected", { surface: "discover", category: category.slug, count: category.count })}
                style={{ "--hue": hueFor(category.slug), animationDelay: `${index * 35}ms` } as CSSProperties}
              >
                <span className="discover-tile__label">
                  <span aria-hidden="true" className="discover-tile__dot" />
                  {category.label}
                </span>
                <span className="discover-tile__desc">{PLAIN[category.slug] ?? categoryDescription(category.slug) ?? `Agents for ${category.label.toLowerCase()}.`}</span>
                <span className="discover-tile__count">
                  <span>
                    <strong>{category.count}</strong> {category.count === 1 ? "agent" : "agents"}
                  </span>
                  <span aria-hidden="true" className="discover-tile__arrow">
                    <CategoryGlyph color="currentColor" name="arrow-right" size={15} strokeWidth={2} />
                  </span>
                </span>
              </Link>
            ))}
        {!isLoading && rest.length > 0 ? (
          <Link className="discover-tile discover-tile--more" href="/search" style={{ "--hue": "var(--ink-soft)" } as CSSProperties}>
            <span className="discover-tile__label">More categories</span>
            <span className="discover-tile__desc">{rest.map((category) => category.label).join(", ")}</span>
            <span className="discover-tile__count">
              <span>
                <strong>{restCount}</strong> {restCount === 1 ? "agent" : "agents"}
              </span>
              <span aria-hidden="true" className="discover-tile__arrow">
                <CategoryGlyph color="currentColor" name="arrow-right" size={15} strokeWidth={2} />
              </span>
            </span>
          </Link>
        ) : null}
      </div>
    </section>
  );
}

/** "Top yield agents" -> "Yield"; the shelf's own subtitle stays as the description. */
function tabLabel(shelf: AgentShelfData): string {
  const trimmed = shelf.title.replace(/^Top\s+/i, "").replace(/\s+agents$/i, "");
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function FeaturedTabs({
  shelves,
  signals,
  isLoading,
}: {
  shelves: AgentShelfData[];
  signals: Map<string, AgentSignals>;
  isLoading: boolean;
}) {
  // "Ready to hire" and "New" lead; category shelves follow (their tiles are above).
  const ordered = useMemo(() => {
    const rank = (shelf: AgentShelfData) => (shelf.id === "favorites" ? 0 : /ready|hire/i.test(shelf.title) ? 1 : /new/i.test(shelf.title) ? 2 : 3);
    return [...shelves].filter((shelf) => shelf.agents.length > 0).sort((a, b) => rank(a) - rank(b));
  }, [shelves]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = ordered.find((shelf) => shelf.id === activeId) ?? ordered[0];
  const railRef = useRef<HTMLDivElement>(null);

  if (!isLoading && !active) return null;

  const scrollBy = (direction: 1 | -1) => {
    const rail = railRef.current;
    if (rail) rail.scrollBy({ left: direction * rail.clientWidth * 0.85, behavior: "smooth" });
  };

  return (
    <section aria-labelledby="discover-featured" className="discover-section">
      <div className="discover-section__head">
        <div>
          <h2 className="discover-section__title" id="discover-featured">
            Featured agents
          </h2>
          <p className="discover-section__sub">{active?.subtitle ?? " "}</p>
        </div>
        <div className="flex items-center gap-2">
          <button aria-label="Scroll back" className="similar__arrow" onClick={() => scrollBy(-1)} type="button">
            <CategoryGlyph color="currentColor" name="chevron-left" size={15} />
          </button>
          <button aria-label="Scroll forward" className="similar__arrow" onClick={() => scrollBy(1)} type="button">
            <CategoryGlyph color="currentColor" name="chevron-right" size={15} />
          </button>
        </div>
      </div>

      <div aria-label="Featured lists" className="discover-tabs no-scrollbar" role="tablist">
        {isLoading && ordered.length === 0
          ? [0, 1, 2, 3].map((item) => <span aria-hidden="true" className="skeleton h-9 w-28 shrink-0 rounded-full" key={item} />)
          : ordered.map((shelf) => (
              <button
                aria-selected={shelf.id === active?.id}
                className="catalog-chip"
                data-selected={shelf.id === active?.id || undefined}
                key={shelf.id}
                onClick={() => {
                  setActiveId(shelf.id);
                  railRef.current?.scrollTo({ left: 0 });
                }}
                role="tab"
                type="button"
              >
                {tabLabel(shelf)}
              </button>
            ))}
      </div>

      <div className="similar__rail no-scrollbar" key={active?.id ?? "loading"} ref={railRef} role="tabpanel">
        {isLoading && !active
          ? Array.from({ length: 3 }, (_, index) => (
              <div className="similar__item" key={index}>
                <div aria-hidden="true" className="catalog-card catalog-card--skeleton h-[210px]" />
              </div>
            ))
          : active?.agents.map((agent) => (
              <div className="similar__item" key={agent.agentKey}>
                <AgentCard agent={agent} signals={signals.get(agent.agentKey)} surface="discover" />
              </div>
            ))}
      </div>
      {active?.href ? (
        <Link className="discover-link" href={active.href}>
          See all {tabLabel(active).toLowerCase()}
          <CategoryGlyph color="currentColor" name="arrow-right" size={14} strokeWidth={2} />
        </Link>
      ) : null}
    </section>
  );
}

export function HowItWorks3() {
  const steps = [
    {
      hue: "#2f6fdf",
      title: "Find one that answers",
      body: "Dolphin calls every agent before listing it. If it does not answer, it is not here.",
    },
    {
      hue: "#1f9d55",
      title: "Hire it, or connect it",
      body: "Pay per job - your money is held until it delivers. Or connect a tools agent to your AI app for free.",
    },
    {
      hue: "#7c5ce6",
      title: "Or build your own",
      body: "Describe what you want in plain words. Dolphin puts the blocks together and it practises with pretend money first.",
    },
  ];
  return (
    <section aria-labelledby="discover-how" className="discover-section">
      <div className="discover-section__head">
        <div>
          <h2 className="discover-section__title" id="discover-how">
            How Dolphin works
          </h2>
          <p className="discover-section__sub">Three things you can do here.</p>
        </div>
      </div>
      <ol className="discover-steps">
        {steps.map((step, index) => (
          <li className="discover-step" key={step.title} style={{ "--hue": step.hue } as CSSProperties}>
            <span className="discover-step__num">0{index + 1}</span>
            <span className="discover-step__title">{step.title}</span>
            <span className="discover-step__body">{step.body}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function BuildBand() {
  return (
    <section aria-labelledby="discover-build" className="discover-build">
      <div className="discover-build__copy">
        <p className="discover-build__eyebrow">Dolphin builder</p>
        <h2 className="discover-build__title" id="discover-build">
          Build an agent that works while you sleep.
        </h2>
        <p className="discover-build__body">
          Say what it should watch and when it should act. Dolphin lays out the blocks - a trigger, a brain, your risk
          limits - tests it on real price history, and runs it with pretend money until you say go.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link className="discover-build__cta" href="/dolphin" onClick={() => track("build_cta_clicked", { surface: "band" })}>
            Open the builder
            <CategoryGlyph color="currentColor" name="arrow-right" size={15} strokeWidth={2} />
          </Link>
        </div>
      </div>
      <BuilderDemo />
    </section>
  );
}

/*
 * THE BUILDER, RUNNING (owner, 2026-09-29: "make it like the actual workflow
 * animation... let it look real"). The same shape as the real canvas -
 * a source into a Trigger that fires once, the Brain, its Strategy beside it,
 * then Risk limits before the Market - with a pulse travelling the wires and
 * each block lighting as it arrives. One 8-second loop, CSS only.
 *
 * It is labelled a demo, and its status lines are words, not numbers: no
 * price, P&L or fill is shown, because none of it is a real reading.
 */
const DEMO_NODES = [
  { id: "hour", label: "Every hour", status: "Tick", x: 0, y: 0, at: 0 },
  { id: "trigger", label: "Trigger", status: "Fired once", x: 0, y: 1, at: 0.14 },
  { id: "brain", label: "Brain", status: "Thinking...", x: 1, y: 1, at: 0.28, brain: true },
  { id: "strategy", label: "Strategy", status: "Rules read", x: 1, y: 2, at: 0.42 },
  { id: "risk", label: "Risk limits", status: "Within limits", x: 2, y: 1, at: 0.6 },
  { id: "market", label: "Market", status: "Order placed (paper)", x: 2, y: 2, at: 0.76 },
] as const;
const DEMO_EDGES = [
  { from: "hour", to: "trigger", at: 0.07 },
  { from: "trigger", to: "brain", at: 0.21 },
  { from: "brain", to: "strategy", at: 0.35 },
  { from: "brain", to: "risk", at: 0.53 },
  { from: "risk", to: "market", at: 0.69 },
] as const;
const COL = 150;
const ROW = 92;
const NODE_W = 124;
const NODE_H = 52;
const CYCLE_S = 8;

function centre(id: string) {
  const node = DEMO_NODES.find((item) => item.id === id)!;
  return { x: node.x * COL + NODE_W / 2, y: node.y * ROW + NODE_H / 2 };
}

function BuilderDemo() {
  const width = 2 * COL + NODE_W;
  const height = 2 * ROW + NODE_H;
  return (
    <div aria-hidden="true" className="builder-demo">
      <div className="builder-demo__canvas" style={{ width, height }}>
        <svg className="builder-demo__wires" height={height} viewBox={`0 0 ${width} ${height}`} width={width}>
          {DEMO_EDGES.map((edge) => {
            const a = centre(edge.from);
            const b = centre(edge.to);
            return (
              <g key={`${edge.from}-${edge.to}`}>
                <line className="builder-demo__wire" x1={a.x} x2={b.x} y1={a.y} y2={b.y} />
                <line
                  className="builder-demo__pulse"
                  pathLength={1}
                  style={{ animationDelay: `${edge.at * CYCLE_S}s` }}
                  x1={a.x}
                  x2={b.x}
                  y1={a.y}
                  y2={b.y}
                />
              </g>
            );
          })}
        </svg>
        {DEMO_NODES.map((node) => (
          <div
            className="builder-demo__node"
            data-brain={"brain" in node ? true : undefined}
            key={node.id}
            style={{ left: node.x * COL, top: node.y * ROW, width: NODE_W, height: NODE_H, animationDelay: `${node.at * CYCLE_S}s` }}
          >
            <span className="builder-demo__label">{node.label}</span>
            <span className="builder-demo__status" style={{ animationDelay: `${node.at * CYCLE_S}s` }}>
              {node.status}
            </span>
          </div>
        ))}
      </div>
      <p className="builder-demo__caption">A demo of a real flow</p>
    </div>
  );
}
