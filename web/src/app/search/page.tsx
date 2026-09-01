"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";

import { AgentCard } from "@/components/agent-card";
import { CategoryGlyph } from "@/components/category-glyph";
import { StatePanel } from "@/components/state-panel";
import { AGENT_CATEGORIES } from "@/constants/agents";
import { useAgents } from "@/hooks/use-agents";
import { searchAgentsLocally } from "@/services/agents-api";
import { useAppStore } from "@/store/use-app-store";
import type { AgentCategory } from "@/types/agent";

const suggestedSearches = [
  "Venus",
  "PancakeSwap",
  "Liquidation",
  "Rebalancing",
  "Yield",
  "Grid trading",
] as const;

function isAgentCategory(value: string | null): value is AgentCategory {
  return AGENT_CATEGORIES.some((category) => category.slug === value);
}

function SearchContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialCategory = searchParams.get("category");
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [selectedCategory, setSelectedCategory] = useState<AgentCategory | "all">(
    isAgentCategory(initialCategory) ? initialCategory : "all",
  );
  const { data: agents, isError, isLoading } = useAgents();

  const recentSearches = useAppStore((state) => state.recentSearches);
  const addRecentSearch = useAppStore((state) => state.addRecentSearch);
  const removeRecentSearch = useAppStore((state) => state.removeRecentSearch);
  const clearRecentSearches = useAppStore((state) => state.clearRecentSearches);

  /*
   * Re-sync from the URL when the URL itself changes — during render, not in an
   * effect.
   *
   * This screen keeps a two-way sync: local state drives the input (typing has
   * to feel immediate), and syncSearchUrl writes it back with router.replace.
   * The old version did the URL -> state half in `useEffect(..., [searchParams])`,
   * which meant every one of our OWN url writes came back as a second render
   * pass that re-set the same two values. `react-hooks/set-state-in-effect`
   * flags exactly that, and it has been failing build-web-site.yml's lint step
   * since e591a04.
   *
   * This is React's documented "adjusting state when a prop changes" pattern:
   * a conditional setState during render. React restarts the render before
   * committing or touching the DOM, so there is no cascade and no extra paint -
   * strictly less work than the effect it replaces. Termination is guaranteed
   * because `syncedParams` is updated in the same branch that tests it, so the
   * condition is false on the immediate re-render.
   *
   * Comparing the serialised params rather than the object matters:
   * `useSearchParams()` can hand back a new instance for identical values,
   * which is what made the effect's dependency fire more often than the URL
   * actually changed.
   */
  const paramsKey = searchParams.toString();
  const [syncedParams, setSyncedParams] = useState(paramsKey);

  if (paramsKey !== syncedParams) {
    const urlCategory = searchParams.get("category");

    setSyncedParams(paramsKey);
    setQuery(searchParams.get("q") ?? "");
    setSelectedCategory(isAgentCategory(urlCategory) ? urlCategory : "all");
  }

  const normalizedQuery = query.trim();
  const searchResults = useMemo(() => {
    if (!agents) return [];

    const categoryResults =
      selectedCategory === "all"
        ? agents
        : agents.filter((agent) => agent.category === selectedCategory);

    return normalizedQuery
      ? searchAgentsLocally(categoryResults, normalizedQuery)
      : categoryResults;
  }, [agents, normalizedQuery, selectedCategory]);

  const syncSearchUrl = (
    nextQuery: string,
    nextCategory: AgentCategory | "all",
  ) => {
    const params = new URLSearchParams();
    const trimmedQuery = nextQuery.trim();

    if (trimmedQuery) params.set("q", trimmedQuery);
    if (nextCategory !== "all") params.set("category", nextCategory);

    const nextUrl = params.size > 0 ? `/search?${params.toString()}` : "/search";
    router.replace(nextUrl, { scroll: false });
  };

  const runSearch = (term: string) => {
    const trimmedTerm = term.trim();

    setQuery(trimmedTerm);
    if (trimmedTerm) addRecentSearch(trimmedTerm);
    syncSearchUrl(trimmedTerm, selectedCategory);
  };

  const hasActiveSearch = normalizedQuery.length > 0 || selectedCategory !== "all";

  return (
    <div className="site-frame page-shell" style={{ paddingBlockStart: 0 }}>
      <section aria-label="Agent search" className="border-y border-line py-6 sm:py-8">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (normalizedQuery) addRecentSearch(normalizedQuery);
            syncSearchUrl(normalizedQuery, selectedCategory);
          }}
          role="search"
        >
          <label className="sr-only" htmlFor="agent-search">
            Search agents
          </label>
          <div className="flex items-center gap-4">
            <CategoryGlyph color="#6c6d64" name="search" size={24} strokeWidth={2} />
            <input
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-2xl font-medium tracking-[-0.035em] placeholder:text-faint sm:text-4xl"
              id="agent-search"
              name="q"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Try Venus, rebalancing, or yield…"
              type="search"
              value={query}
            />
            {query ? (
              <button
                className="interactive shrink-0 text-sm font-semibold text-muted underline-offset-4 hover:text-ink hover:underline"
                onClick={() => {
                  setQuery("");
                  syncSearchUrl("", selectedCategory);
                }}
                type="button"
              >
                Clear
              </button>
            ) : null}
          </div>
        </form>

        <div className="no-scrollbar mt-7 flex gap-1 overflow-x-auto border-b border-line" role="group" aria-label="Filter by category">
          <button
            aria-pressed={selectedCategory === "all"}
            className={`interactive relative shrink-0 px-4 pb-3 text-sm font-medium ${
              selectedCategory === "all" ? "text-ink" : "text-muted hover:text-ink"
            }`}
            onClick={() => {
              setSelectedCategory("all");
              syncSearchUrl(query, "all");
            }}
            type="button"
          >
            All agents
            {selectedCategory === "all" ? (
              <span className="absolute inset-x-3 bottom-0 h-0.5 bg-accent" />
            ) : null}
          </button>
          {AGENT_CATEGORIES.map((category) => {
            const isSelected = selectedCategory === category.slug;

            return (
              <button
                aria-pressed={isSelected}
                className={`interactive relative shrink-0 px-4 pb-3 text-sm font-medium ${
                  isSelected ? "text-ink" : "text-muted hover:text-ink"
                }`}
                key={category.slug}
                onClick={() => {
                  setSelectedCategory(category.slug);
                  syncSearchUrl(query, category.slug);
                }}
                type="button"
              >
                {category.label}
                {isSelected ? (
                  <span className="absolute inset-x-3 bottom-0 h-0.5 bg-accent" />
                ) : null}
              </button>
            );
          })}
        </div>
      </section>

      {!hasActiveSearch ? (
        <section className="grid gap-10 border-b border-line py-10 md:grid-cols-2 md:gap-16">
          <div>
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-sm font-semibold tracking-[-0.01em]">Try a search</h2>
              <span className="text-xs text-faint">Suggestions</span>
            </div>
            <div className="mt-4 border-t border-line">
              {suggestedSearches.map((term) => (
                <button
                  className="interactive group flex w-full items-center justify-between border-b border-line py-3 text-left text-sm text-muted hover:text-ink"
                  key={term}
                  onClick={() => runSearch(term)}
                  type="button"
                >
                  <span>{term}</span>
                  <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">
                    →
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-sm font-semibold tracking-[-0.01em]">Recent searches</h2>
              {recentSearches.length > 0 ? (
                <button
                  className="interactive text-xs text-muted underline-offset-4 hover:text-ink hover:underline"
                  onClick={clearRecentSearches}
                  type="button"
                >
                  Clear all
                </button>
              ) : null}
            </div>
            {recentSearches.length > 0 ? (
              <ul className="mt-4 border-t border-line">
                {recentSearches.slice(0, 6).map((term) => (
                  <li className="flex items-center border-b border-line" key={term}>
                    <button
                      className="interactive flex-1 py-3 text-left text-sm text-muted hover:text-ink"
                      onClick={() => runSearch(term)}
                      type="button"
                    >
                      {term}
                    </button>
                    <button
                      aria-label={`Remove ${term} from recent searches`}
                      className="interactive px-2 py-3 text-xs text-faint hover:text-danger"
                      onClick={() => removeRecentSearch(term)}
                      type="button"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 border-t border-line py-4 text-sm leading-6 text-faint">
                Searches you submit will appear here on this device.
              </p>
            )}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="results-heading" className="pt-12 sm:pt-16" id="search-results">
        <div className="flex flex-col gap-3 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="eyebrow">Results</p>
            <h2 className="section-title mt-3" id="results-heading">
              {normalizedQuery ? `Matching “${normalizedQuery}”` : "Agent catalog"}
            </h2>
          </div>
          {!isLoading && !isError ? (
            <p aria-live="polite" className="text-sm text-muted">
              {searchResults.length} {searchResults.length === 1 ? "record" : "records"}
            </p>
          ) : null}
        </div>

        {isLoading ? (
          <div className="pt-8">
            <StatePanel
              body="Reading the shared Dolphin catalog and applying your filters."
              state="syncing"
              title="Searching the catalog"
            />
          </div>
        ) : isError ? (
          <div className="pt-8">
            <StatePanel
              body="The shared catalog could not be reached. No fallback results are being substituted."
              state="unavailable"
              title="Search unavailable"
            />
          </div>
        ) : searchResults.length === 0 ? (
          <div className="pt-8">
            <StatePanel
              body="Try a broader term, remove the category filter, or search for a protocol such as Venus or PancakeSwap."
              state="empty"
              title="No matching agents"
            />
          </div>
        ) : (
          <div>
            {searchResults.map((agent) => (
              <AgentCard agent={agent} key={agent.id} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="site-frame page-shell">
          <StatePanel
            body="Preparing the catalog filters."
            state="syncing"
            title="Opening search"
          />
        </div>
      }
    >
      <SearchContent />
    </Suspense>
  );
}
