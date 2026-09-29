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
import { DolphinLoader } from "@/components/dolphin-loader";
import { MobileMenuButton } from "@/components/mobile-nav";
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
/** A category with fewer agents than this is tucked under the "More" pill. */
const MORE_BELOW = 3;

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
  /* Where the type button is, so the menu opens beside it on desktop. */
  const [filterAnchor, setFilterAnchor] = useState<DOMRect | null>(null);
  const [showMore, setShowMore] = useState(false);

  /*
   * A fade on the pill row's right edge while more pills sit past it - so the
   * row reads as "there is more" instead of looking complete (owner,
   * 2026-09-29). Measured on scroll and on resize, never guessed.
   */
  /*
   * SEARCH COMES BACK ON SCROLL-UP (owner, 2026-09-29): nobody should scroll
   * to the top to change category. Once the controls have scrolled under the
   * header they tuck away while you read down and slide back the moment you
   * scroll up. The title and count stay behind - only search and categories.
   * `rest` = in their normal place; the sentinel sits right above them.
   */
  const controlsRef = useRef<HTMLElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [pin, setPin] = useState<"rest" | "shown" | "tucked">("rest");
  useEffect(() => {
    let last = window.scrollY;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const controls = controlsRef.current;
        const sentinel = sentinelRef.current;
        if (!controls || !sentinel) return;
        const y = window.scrollY;
        const delta = y - last;
        last = y;
        const stickyTop = parseFloat(getComputedStyle(controls).top) || 0;
        if (sentinel.getBoundingClientRect().top >= stickyTop) {
          setPin("rest");
          return;
        }
        if (Math.abs(delta) < 4) return;
        setPin(delta > 0 ? "tucked" : "shown");
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const chipsRef = useRef<HTMLDivElement>(null);
  const [chipsFade, setChipsFade] = useState(false);
  const updateChipsFade = (row: HTMLElement) =>
    setChipsFade(row.scrollWidth - row.clientWidth - row.scrollLeft > 4);
  useEffect(() => {
    const row = chipsRef.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => updateChipsFade(row));
    observer.observe(row);
    for (const child of Array.from(row.children)) observer.observe(child);
    return () => observer.disconnect();
  });
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

  /*
   * THE COUNT UNDER THE TITLE - always read, never written in.
   *
   * This said "24+ records loaded": the size of the first PAGE fetched,
   * dressed as a fact about the catalog (owner, 2026-09-29: "misleading").
   * Now: with no search text, the live total (or the category's) from the
   * facets document the category pills already read; while searching, the
   * number of matches once the list is complete - and nothing before that,
   * because a partial count is not a count.
   */
  const countLine = (() => {
    if (isUnavailable || isLoading) return null;
    if (normalizedQuery || isKindFiltered) {
      if (status !== "Exhausted") return null;
      return `${searchResults.length.toLocaleString()} ${searchResults.length === 1 ? "match" : "matches"}`;
    }
    if (facets.isLoading) return null;
    const total =
      selectedCategory === "all"
        ? facets.totalLive
        : facets.categories.find((category) => category.slug === selectedCategory)?.count ?? 0;
    if (total <= 0) return null;
    return `${total.toLocaleString()} ${total === 1 ? "agent" : "agents"}${selectedCategory === "all" ? " on BNB Chain" : ` in ${categoryLabel(selectedCategory)}`}`;
  })();

  const kindLabel = selectedProtocol === "a2a" ? "Hire" : selectedProtocol === "mcp" ? "Tools" : "All types";

  /*
   * SMALL CATEGORIES GO UNDER "MORE" (owner, 2026-09-29). A drawer holding one
   * or two agents took as much room as one holding eleven. Under MORE_BELOW
   * agents a category is tucked behind a "More" pill that opens them in place,
   * each still named - and it stays open while one of them is selected.
   */
  const mainCategories = facets.categories.filter((category) => category.count >= MORE_BELOW);
  const smallCategories = facets.categories.filter((category) => category.count < MORE_BELOW);
  const moreOpen = showMore || smallCategories.some((category) => category.slug === selectedCategory);

  const chip = (slug: AgentCategory | "all", text: string, count: number | null, tucked = false) => (
    <button
      aria-pressed={selectedCategory === slug}
      className={tucked ? "catalog-chip catalog-chip--tucked" : "catalog-chip"}
      key={slug}
      onClick={() => {
        setSelectedCategory(slug);
        syncSearchUrl(query, slug);
        if (slug !== "all") track("category_selected", { surface: "search", category: slug, count: count ?? 0 });
      }}
      type="button"
    >
      {text}
      {count !== null ? <span className="catalog-chip__count">{count.toLocaleString()}</span> : null}
    </button>
  );

  return (
    <div className="catalog-page mobile-search-page site-frame page-shell">
      {/*
        * The phone's only route off this page: search has no header of its own
        * on a phone, and without this it was a dead end.
        */}
      <div className="mobile-only mobile-search-topbar">
        <MobileMenuButton />
      </div>

      {/* 1. What this page is, and how much is in it. */}
      <header className="catalog-head">
        <h1 className="catalog-title">Agent catalog</h1>
        <p aria-live="polite" className="catalog-count">
          {countLine ?? " "}
        </p>
      </header>

      {/* 2. Search, with the type filter inside it; 3. the categories under it. */}
      <div aria-hidden="true" ref={sentinelRef} />
      <section aria-label="Agent search" className="catalog-controls mobile-search-controls" data-pin={pin} ref={controlsRef}>
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
          <div className="catalog-search">
            <span aria-hidden="true" className="catalog-search__icon">
              <CategoryGlyph color="currentColor" name="search" size={17} strokeWidth={2} />
            </span>
            <input
              autoComplete="off"
              className="catalog-search__input"
              id="agent-search"
              name="q"
              onChange={(event) => setQuery(event.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={(event) => {
                if (!(event.relatedTarget instanceof Element) || !event.relatedTarget.closest(".mobile-search-history")) setIsFocused(false);
              }}
              placeholder={isMobile ? "Search agents" : "Search by name, protocol or skill - try Venus or yield"}
              type="search"
              value={query}
            />
            {query ? (
              <button
                aria-label="Clear search text"
                className="catalog-search__clear"
                onClick={() => {
                  setQuery("");
                  syncSearchUrl("", selectedCategory);
                }}
                type="button"
              >
                <CategoryGlyph color="currentColor" name="close" size={13} />
              </button>
            ) : null}
            <span aria-hidden="true" className="catalog-search__divider" />
            <button
              aria-label={`Agent type: ${kindLabel}`}
              className="catalog-search__filter"
              data-active={isKindFiltered || undefined}
              onClick={(event) => {
                setFilterAnchor(event.currentTarget.getBoundingClientRect());
                setFilterModalOpen(true);
              }}
              type="button"
            >
              <CategoryGlyph color="currentColor" name="filter" size={15} strokeWidth={2} />
              <span className="catalog-search__filter-label">{kindLabel}</span>
            </button>
          </div>
        </form>

        {/*
          * FROM THE CATALOG, not from a hardcoded list. convex/facets.ts counts
          * the live catalog by category on a schedule; a category with no agents
          * never becomes a pill, and a new one appears with no code change.
          */}
        <div
          aria-label="Filter by category"
          className="catalog-chips no-scrollbar"
          data-fade={chipsFade || undefined}
          onScroll={(event) => updateChipsFade(event.currentTarget)}
          ref={chipsRef}
          role="group"
        >
          {chip("all", "All agents", null)}
          {facets.isLoading
            ? [0, 1, 2, 3].map((item) => (
                <span aria-hidden="true" className="skeleton h-8 w-24 shrink-0 rounded-full" key={item} />
              ))
            : mainCategories.map((category) => chip(category.slug, category.label, category.count))}
          {smallCategories.length > 0 ? (
            <button
              aria-expanded={moreOpen}
              className="catalog-chip catalog-chip--more"
              onClick={() => setShowMore((open) => !open)}
              type="button"
            >
              More
              <span className="catalog-chip__count">{smallCategories.length}</span>
              <span aria-hidden="true" className="catalog-chip__chevron">
                <CategoryGlyph color="currentColor" name="chevron-right" size={12} strokeWidth={2.2} />
              </span>
            </button>
          ) : null}
          {moreOpen ? smallCategories.map((category) => chip(category.slug, category.label, category.count, true)) : null}
        </div>
      </section>

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
      ) : <section aria-label="Agents" className="catalog-results" id="search-results">
        {isUnavailable ? (
          <CatalogUnavailable
            status={
              backend as Extract<
                typeof backend,
                { kind: "unreachable" | "unconfigured" }
              >
            }
            title="Search unavailable"
          />
        ) : isLoading ? (
          /* The first read: skeletons in the shape of the cards they become. */
          <div aria-busy="true" aria-label="Loading agents" className={isMobile ? "mobile-result-list" : "catalog-grid"}>
            {Array.from({ length: 6 }, (_, index) => (
              <div aria-hidden="true" className="catalog-card catalog-card--skeleton" key={index}>
                <div className="flex items-center gap-3">
                  <span className="skeleton h-11 w-11 rounded-xl" />
                  <span className="flex-1 space-y-2">
                    <span className="skeleton block h-3.5 w-2/5 rounded" />
                    <span className="skeleton block h-3 w-1/4 rounded" />
                  </span>
                </div>
                <span className="skeleton mt-4 block h-3 w-full rounded" />
                <span className="skeleton mt-2 block h-3 w-3/4 rounded" />
                <span className="skeleton mt-6 block h-4 w-1/3 rounded" />
              </div>
            ))}
          </div>
        ) : searchResults.length === 0 ? (
          <StatePanel
            body="Try a broader term, another category, or a protocol such as Venus or PancakeSwap."
            state="empty"
            title="No matching agents"
          />
        ) : (
          <>
            <div className={isMobile ? "mobile-result-list" : "catalog-grid"}>
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
            </div>
            {/* Plain text, no box (owner, 2026-09-29); the jumping dolphin while it loads. */}
            {status === "CanLoadMore" ? (
              <button className="catalog-more" onClick={() => loadMore()} type="button">
                Show more
              </button>
            ) : null}
            {status === "LoadingMore" ? (
              <DolphinLoader className="catalog-more-loader" label="Loading more agents" showLabel={false} state="done" />
            ) : null}
          </>
        )}
      </section>}

      <FilterModal
        anchor={filterAnchor}
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
        <div className="site-frame page-shell flex justify-center pt-24">
          <DolphinLoader label="Opening the catalog" showLabel={false} state="done" />
        </div>
      }
    >
      <SearchContent />
    </Suspense>
  );
}
