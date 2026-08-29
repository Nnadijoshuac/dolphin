"use client";

import { useMemo, useState } from "react";

import { AgentCard } from "@/components/agent-card";
import { CategoryGlyph } from "@/components/category-glyph";
import { StatePanel } from "@/components/state-panel";
import { AGENT_CATEGORIES } from "@/constants/agents";
import { useAgents } from "@/hooks/use-agents";
import { searchAgentsLocally } from "@/services/agents-api";
import { useAppStore } from "@/store/use-app-store";

const suggestedSearches = [
  "PancakeSwap",
  "Venus",
  "Wallet Watch",
  "Yield",
  "Liquidation",
  "Grid Trading",
] as const;

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const { data: allAgents, isError, isLoading } = useAgents();

  const recentSearches = useAppStore((state) => state.recentSearches);
  const addRecentSearch = useAppStore((state) => state.addRecentSearch);
  const removeRecentSearch = useAppStore((state) => state.removeRecentSearch);
  const clearRecentSearches = useAppStore(
    (state) => state.clearRecentSearches,
  );

  const normalizedQuery = query.trim();
  const searchResults = useMemo(() => {
    if (!allAgents || !normalizedQuery) return [];
    return searchAgentsLocally(allAgents, normalizedQuery);
  }, [allAgents, normalizedQuery]);

  const runSuggestedSearch = (term: string) => {
    setQuery(term);
    addRecentSearch(term);
  };

  return (
    <div className="site-frame py-12 sm:py-16 lg:py-20">
      <header className="grid gap-8 lg:grid-cols-[0.82fr_1.18fr] lg:items-end">
        <div className="reveal-one">
          <p className="text-xs font-bold tracking-[0.16em] text-[var(--accent-ink)]">
            CATALOG SEARCH
          </p>
          <h1 className="text-balance mt-4 max-w-2xl text-5xl font-black leading-[0.92] tracking-[-0.065em] text-[var(--ink)] sm:text-7xl">
            Search the evidence, not the pitch.
          </h1>
        </div>
        <p className="reveal-two max-w-xl text-base leading-7 text-[var(--muted)] lg:justify-self-end">
          Search the same shared catalog used by Dolphin mobile. Results are
          matched locally across names, publishers, categories, descriptions,
          and declared skills.
        </p>
      </header>

      <form
        className="reveal-two mt-12 border-y border-[var(--line)] py-5 sm:mt-16"
        onSubmit={(event) => {
          event.preventDefault();
          if (normalizedQuery) addRecentSearch(normalizedQuery);
        }}
        role="search"
      >
        <label
          className="mb-3 block text-xs font-bold text-[var(--muted)]"
          htmlFor="agent-search"
        >
          Search agents, skills, publishers, or protocols
        </label>
        <div className="flex min-w-0 items-center gap-4">
          <CategoryGlyph color="var(--faint)" name="search" size={24} />
          <input
            autoComplete="off"
            autoFocus
            className="min-w-0 flex-1 bg-transparent text-xl font-semibold tracking-[-0.025em] text-[var(--ink)] outline-none placeholder:text-[var(--faint)] sm:text-3xl"
            id="agent-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Try Venus or liquidation"
            type="search"
            value={query}
          />
          {query.length > 0 && (
            <button
              aria-label="Clear search"
              className="pressable-scale shrink-0 rounded-xl border border-[var(--line)] px-4 py-2 text-xs font-bold text-[var(--muted)] hover:text-[var(--ink)]"
              onClick={() => setQuery("")}
              type="button"
            >
              Clear
            </button>
          )}
        </div>
      </form>

      {normalizedQuery ? (
        <section aria-labelledby="results-heading" className="mt-14">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-[var(--accent-ink)]">
                Search results
              </p>
              <h2
                className="mt-2 text-3xl font-black tracking-[-0.045em] text-[var(--ink)]"
                id="results-heading"
              >
                “{normalizedQuery}”
              </h2>
            </div>
            {!isLoading && !isError && (
              <p className="font-mono text-xs text-[var(--faint)]">
                {searchResults.length} {searchResults.length === 1 ? "match" : "matches"}
              </p>
            )}
          </div>

          <div className="mt-8">
            {isLoading ? (
              <StatePanel
                body="Reading the shared agent catalog before matching your query."
                state="syncing"
                title="Loading searchable records"
              />
            ) : isError ? (
              <StatePanel
                body="The catalog could not be reached, so Dolphin has not shown cached or invented substitutes."
                state="unavailable"
                title="Search unavailable"
              />
            ) : searchResults.length > 0 ? (
              <div className="grid border-b border-[var(--line)] lg:grid-cols-2">
                {searchResults.map((agent, index) => (
                  <AgentCard
                    agent={agent}
                    className={index % 2 === 0 ? "lg:border-r" : ""}
                    key={agent.id}
                  />
                ))}
              </div>
            ) : (
              <StatePanel
                body="Try a category, protocol, publisher, or declared skill."
                state="empty"
                title="No catalog records match this search"
              />
            )}
          </div>
        </section>
      ) : (
        <div className="mt-16 grid gap-16 lg:grid-cols-[0.72fr_1.28fr] lg:gap-24">
          <div className="space-y-14">
            {recentSearches.length > 0 && (
              <section aria-labelledby="recent-heading">
                <div className="flex items-center justify-between gap-4">
                  <h2
                    className="text-xl font-bold tracking-[-0.03em] text-[var(--ink)]"
                    id="recent-heading"
                  >
                    Recent searches
                  </h2>
                  <button
                    className="text-xs font-bold text-[var(--muted)] hover:text-[var(--ink)]"
                    onClick={clearRecentSearches}
                    type="button"
                  >
                    Clear all
                  </button>
                </div>
                <div className="mt-5 border-b border-[var(--line)]">
                  {recentSearches.slice(0, 4).map((item) => (
                    <div
                      className="flex items-center justify-between gap-4 border-t border-[var(--line)] py-4"
                      key={item}
                    >
                      <button
                        className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-[var(--ink)] hover:text-[var(--accent-ink)]"
                        onClick={() => runSuggestedSearch(item)}
                        type="button"
                      >
                        {item}
                      </button>
                      <button
                        aria-label={`Remove ${item} from recent searches`}
                        className="shrink-0 text-xs font-bold text-[var(--faint)] hover:text-[var(--ink)]"
                        onClick={() => removeRecentSearch(item)}
                        type="button"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section aria-labelledby="suggested-heading">
              <h2
                className="text-xl font-bold tracking-[-0.03em] text-[var(--ink)]"
                id="suggested-heading"
              >
                Suggested searches
              </h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                Useful starting points, not popularity rankings.
              </p>
              <div className="mt-5 flex flex-wrap gap-2.5">
                {suggestedSearches.map((term) => (
                  <button
                    className="pressable-scale rounded-full border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-xs font-bold text-[var(--ink-secondary)] hover:border-[var(--accent-border)] hover:text-[var(--accent-ink)]"
                    key={term}
                    onClick={() => runSuggestedSearch(term)}
                    type="button"
                  >
                    {term}
                  </button>
                ))}
              </div>
            </section>
          </div>

          <section aria-labelledby="categories-heading">
            <div>
              <p className="text-sm font-semibold text-[var(--accent-ink)]">
                Browse by job
              </p>
              <h2
                className="mt-3 text-3xl font-black tracking-[-0.045em] text-[var(--ink)]"
                id="categories-heading"
              >
                Explore every category
              </h2>
            </div>
            <div className="mt-7 grid border-b border-[var(--line)] sm:grid-cols-2">
              {AGENT_CATEGORIES.map((category, index) => (
                <button
                  className={`pressable-scale group min-h-52 border-t border-[var(--line)] p-6 text-left hover:bg-[var(--surface)] ${
                    index % 2 === 0 ? "sm:border-r" : ""
                  }`}
                  key={category.slug}
                  onClick={() => runSuggestedSearch(category.label)}
                  type="button"
                >
                  <div className="flex items-center justify-between gap-5">
                    <span className="flex h-11 w-11 items-center justify-center rounded-[14px] border border-[var(--line)] bg-[var(--surface-subtle)]">
                      <CategoryGlyph
                        color="var(--ink)"
                        name={category.slug}
                        size={22}
                      />
                    </span>
                    <span className="font-mono text-xs text-[var(--faint)]">
                      0{index + 1}
                    </span>
                  </div>
                  <h3 className="mt-6 text-lg font-bold tracking-[-0.025em] text-[var(--ink)]">
                    {category.label}
                  </h3>
                  <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                    {category.slug === "grid-trading"
                      ? "Price ladders and their available track-record evidence."
                      : category.description}
                  </p>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
