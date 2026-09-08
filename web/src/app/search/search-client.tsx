"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { AgentCard } from "@/components/agent-card";
import { MobileAgentRow } from "@/components/mobile-agent-row";
import {
  CatalogUnavailable,
  useBackendStatus,
  useReportBackendStatus,
} from "@/components/backend-status";
import { CategoryGlyph } from "@/components/category-glyph";
import { FilterModal } from "@/components/filter-modal";
import { StatePanel } from "@/components/state-panel";
import {
  useAgentList,
  useAgentSignals,
  useCategoryFacets,
  type AgentProtocol,
} from "@/hooks/use-agents";
import {
  SEARCH_DEBOUNCE_MS,
  useDebouncedValue,
} from "@/hooks/use-debounced-value";
import { track } from "@/lib/analytics";
import { useAppStore } from "@/store/use-app-store";
import { useMobileLayout } from "@/hooks/use-mobile-layout";
import { categoryLabel } from "@/constants/agents";
import type { AgentCategory } from "@/types/agent";

/**
 * A `?category=` value, or "all".
 *
 * NOT validated against a known list, and that is the fix rather than a
 * loosening. This tested `AGENT_CATEGORIES.some(...)` over a hardcoded five,
 * while the backend classifies agents into thirteen slugs - so a monitoring,
 * research, security or `general` agent arriving here from its own detail-page
 * breadcrumb (`/search?category=<slug>`, agent-detail.tsx) had its category
 * silently discarded and landed on "All agents". The link looked like it worked.
 *
 * The valid set is a property of the catalog and is not known at the moment
 * this runs, so anything slug-shaped is passed to the backend. A slug with no
 * agents in it returns nothing, and the empty state below already says so.
 */
function readCategoryParam(value: string | null): AgentCategory | "all" {
  if (!value) return "all";
  const trimmed = value.trim().toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed) ? trimmed : "all";
}

function SearchContent() {
  const isMobile = useMobileLayout();
  const [isFocused, setIsFocused] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialCategory = searchParams.get("category");
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [selectedCategory, setSelectedCategory] = useState<AgentCategory | "all">(
    () => readCategoryParam(initialCategory),
  );
  /*
   * WHAT the agent is, not what it does. The backend has indexed this since the
   * rebuild and the website never declared it, so the filter could not be
   * offered - caught by `npm run check:convex-api` on its first run.
   *
   * Named in user language rather than protocol language, as the mobile app
   * does: an A2A agent is one you commission and pay for, an MCP agent publishes
   * tools you call yourself. Showing them undifferentiated is what made MCP
   * agents look like broken A2A ones.
   */
  const [selectedProtocol, setSelectedProtocol] = useState<AgentProtocol | "all">(
    "all",
  );
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const isKindFiltered = selectedProtocol !== "all";

  const addRecentSearch = useAppStore((state) => state.addRecentSearch);
  const recentSearches = useAppStore((state) => state.recentSearches);
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
    setSyncedParams(paramsKey);
    setQuery(searchParams.get("q") ?? "");
    setSelectedCategory(readCategoryParam(searchParams.get("category")));
  }

  const normalizedQuery = query.trim();
  /*
   * DEBOUNCED (2026-09-08). `normalizedQuery` updates on every keystroke, and
   * feeding it straight to useAgentList opened one Convex SUBSCRIPTION per
   * character - eleven server-side search-index queries to type "pancakeswap",
   * ten of them discarded before painting. See hooks/use-debounced-value.
   *
   * The input still renders from `query`, so typing is unchanged.
   */
  const debouncedQuery = useDebouncedValue(normalizedQuery, SEARCH_DEBOUNCE_MS);

  const facets = useCategoryFacets();
  const backend = useBackendStatus();
  useReportBackendStatus(backend, "search");

  /*
   * SERVER-SIDE (2026-09-07). This used to hold the entire catalog and run
   * `searchAgentsLocally` over it - a substring scan across every field of
   * every agent, in the browser, on every keystroke. It is now a Convex search
   * index, paginated and relevance-ordered, which is what makes a catalog of
   * thousands searchable rather than merely downloadable.
   */
  const {
    agents: searchResults,
    status,
    isLoading,
    loadMore,
  } = useAgentList({
    search: debouncedQuery,
    category: selectedCategory === "all" ? undefined : selectedCategory,
    protocol: selectedProtocol === "all" ? undefined : selectedProtocol,
  });

  /*
   * A REAL ERROR STATE. This was `const isError = false`, which made the
   * "Search unavailable" panel below unreachable dead code and left "No
   * matching agents" as the only thing this page could say about a backend it
   * could not reach. See components/backend-status.tsx.
   */
  const isUnavailable =
    backend.kind === "unreachable" || backend.kind === "unconfigured";

  /* One batched query for every result on the page, never one per row. */
  const signals = useAgentSignals(searchResults);

  /*
   * One event per settled search, not per keystroke. The QUERY TEXT is never
   * sent - only its length and whether it found anything, which is what makes
   * "are people searching and finding nothing" answerable without reading over
   * anyone's shoulder. See lib/analytics.ts.
   */
  const reportedSearch = useRef<string | null>(null);
  useEffect(() => {
    if (isLoading || debouncedQuery.length === 0) return;

    const signature = `${debouncedQuery}::${selectedCategory}`;
    if (reportedSearch.current === signature) return;
    reportedSearch.current = signature;

    track("search_submitted", {
      queryLength: debouncedQuery.length,
      category: selectedCategory === "all" ? null : selectedCategory,
      resultCount: searchResults.length,
    });
  }, [debouncedQuery, selectedCategory, isLoading, searchResults.length]);

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

  return (
    <div className="mobile-search-page site-frame page-shell" style={{ paddingBlockStart: 0 }}>
      <section aria-label="Agent search" className="mobile-search-controls pt-6 sm:pt-8">
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
          <div className="mobile-search-field flex items-center gap-4">
            <CategoryGlyph color="#6c6d64" name="search" size={24} strokeWidth={2} />
            <input
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-2xl font-medium tracking-[-0.035em] placeholder:text-faint sm:text-4xl"
              id="agent-search"
              name="q"
              onChange={(event) => setQuery(event.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={(event) => {
                if (!(event.relatedTarget instanceof Element) || !event.relatedTarget.closest(".mobile-search-history")) setIsFocused(false);
              }}
              placeholder={isMobile ? "Search agents, skills, publishers" : "Try Venus, rebalancing, or yield…"}
              type="search"
              value={query}
            />
            {query ? (
              <button
                aria-label="Clear search text"
                className="mobile-search-clear interactive shrink-0 text-sm font-semibold text-muted underline-offset-4 hover:text-ink hover:underline"
                onClick={() => {
                  setQuery("");
                  syncSearchUrl("", selectedCategory);
                }}
                type="button"
              >
                {isMobile ? <CategoryGlyph name="close" color="currentColor" size={14} /> : "Clear"}
              </button>
            ) : null}

            <button
              aria-label={
                isKindFiltered
                  ? `Filter by kind: ${selectedProtocol === "a2a" ? "Hire" : "Tools"}`
                  : "Filter by kind"
              }
              className={`interactive flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-all sm:h-11 sm:w-11 ${
                isKindFiltered
                  ? "border-accent bg-accent text-ink shadow-sm"
                  : "border-line bg-paper text-muted hover:border-line-strong hover:text-ink"
              }`}
              onClick={() => setFilterModalOpen(true)}
              title={
                isKindFiltered
                  ? `Filtering by ${selectedProtocol === "a2a" ? "Hire" : "Tools"}`
                  : "Filter by kind"
              }
              type="button"
            >
              <CategoryGlyph
                color="currentColor"
                name="filter"
                size={18}
                strokeWidth={2}
              />
            </button>
          </div>
        </form>

        <div className="mobile-category-rail no-scrollbar mt-7 flex gap-1 overflow-x-auto border-b border-line" role="group" aria-label="Filter by category">
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
          {/*
           * FROM THE CATALOG, not from a hardcoded five. convex/facets.ts
           * counts the live catalog by category on a schedule; a category with
           * no agents in it never becomes a tab, and a category nobody has
           * thought of yet becomes one with no code change. See the note in
           * @/constants/agents for the eight categories this list used to omit.
           */}
          {facets.isLoading
            ? [0, 1, 2].map((item) => (
                <span
                  aria-hidden="true"
                  className="skeleton mx-2 mb-3 h-5 w-20 shrink-0 rounded-md"
                  key={item}
                />
              ))
            : facets.categories.map((category) => {
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
                      track("category_selected", {
                        surface: "search",
                        category: category.slug,
                        count: category.count,
                      });
                    }}
                    type="button"
                  >
                    {category.label}
                    <span className="ml-1.5 text-[0.7rem] font-normal tabular-nums text-faint">
                      {category.count.toLocaleString()}
                    </span>
                    {isSelected ? (
                      <span className="absolute inset-x-3 bottom-0 h-0.5 bg-accent" />
                    ) : null}
                  </button>
                );
              })}
        </div>
      </section>

      {isMobile && isKindFiltered ? (
        <button className="mobile-active-filter" type="button" onClick={() => setSelectedProtocol("all")} aria-label={`Remove ${selectedProtocol === "a2a" ? "Hire" : "Tools"} filter`}>
          {selectedProtocol === "a2a" ? "Hire · A2A" : "Tools · MCP"}<CategoryGlyph name="close" color="currentColor" size={10} />
        </button>
      ) : null}

      {isMobile && isFocused && !normalizedQuery ? (
        <section aria-label="Recent searches" className="mobile-search-history">
          {recentSearches.length > 0 ? <>
            <header><h2>Recent searches</h2><button type="button" onClick={clearRecentSearches}>Clear all</button></header>
            {recentSearches.slice(0, 6).map((recent) => (
              <div className="mobile-history-row" key={recent}>
                <button type="button" onClick={() => { setQuery(recent); addRecentSearch(recent); syncSearchUrl(recent, selectedCategory); }}>
                  <CategoryGlyph name="clock" color="var(--muted)" size={15} /><span className="truncate">{recent}</span>
                </button>
                <button aria-label={`Remove ${recent}`} type="button" onClick={() => removeRecentSearch(recent)}><CategoryGlyph name="close" color="var(--muted)" size={14} /></button>
              </div>
            ))}
          </> : <p className="px-6 pt-14 text-center text-sm text-muted">Search by agent name, capability, or protocol</p>}
        </section>
      ) : <section aria-labelledby="results-heading" className="mobile-search-results pt-8 sm:pt-12" id="search-results">
        <div className="mobile-results-header flex flex-col gap-3 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="eyebrow">Results</p>
            <h2 className="section-title mt-3" id="results-heading">
              {normalizedQuery ? `Matching “${normalizedQuery}”` : isMobile ? selectedCategory === "all" ? "All agents" : categoryLabel(selectedCategory) : "Agent catalog"}
            </h2>
            {isMobile && !normalizedQuery ? <p className="mobile-results-subtitle">{selectedProtocol === "a2a" ? "Hireable tasks · Escrow backed" : selectedProtocol === "mcp" ? "Free direct tools · MCP endpoints" : "Verified live on BNB Chain"}</p> : null}
          </div>
          {!isLoading && !isUnavailable && (!isMobile || normalizedQuery) ? (
            /*
             * "N records" only when the list is EXHAUSTED - i.e. when N really
             * is the number of matches. Otherwise "N+ loaded", because this
             * printed the fetched-so-far count as if it were the total and said
             * "24 records" with a "Show more results" button beneath it.
             */
            <p aria-live="polite" className="text-sm text-muted">
              {status === "Exhausted"
                ? `${searchResults.length} ${searchResults.length === 1 ? "record" : "records"}`
                : `${searchResults.length}+ records loaded`}
            </p>
          ) : null}
        </div>

        {isUnavailable ? (
          <div className="pt-8">
            <CatalogUnavailable
              status={
                backend as Extract<
                  typeof backend,
                  { kind: "unreachable" | "unconfigured" }
                >
              }
              title="Search unavailable"
            />
          </div>
        ) : isLoading ? (
          <div className="pt-8">
            <StatePanel
              body="Reading the shared Dolphin catalog and applying your filters."
              state="syncing"
              title="Searching the catalog"
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
          <div className={isMobile ? "mobile-result-list" : undefined}>
            {searchResults.map((agent) => isMobile ? (
              <MobileAgentRow agent={agent} key={agent.agentKey} signals={signals.get(agent.agentKey)} onOpen={() => { if (normalizedQuery) addRecentSearch(normalizedQuery); }} />
            ) : (
              <AgentCard
                agent={agent}
                key={agent.id}
                signals={signals.get(agent.agentKey)}
                surface="search"
              />
            ))}
            {status === "CanLoadMore" ? (
              <button
                className="mt-6 w-full border border-line py-3 text-sm font-semibold text-ink"
                onClick={() => loadMore()}
                type="button"
              >
                Show more results
              </button>
            ) : null}
            {status === "LoadingMore" ? (
              <p className="mt-6 text-center text-sm text-faint">Loading more…</p>
            ) : null}
          </div>
        )}
      </section>}

      <FilterModal
        isOpen={filterModalOpen}
        onClose={() => setFilterModalOpen(false)}
        onSelectProtocol={setSelectedProtocol}
        protocol={selectedProtocol}
      />
    </div>
  );
}

export function SearchClient() {
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
