"use client";

import { useMemo, useState } from "react";

import { AgentCard } from "@/components/agent-card";
import { CategoryGlyph } from "@/components/category-glyph";
import { ConstellationBg } from "@/components/constellation-bg";
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
  "Grid Trading",
  "Wallet Watch",
] as const;

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<AgentCategory | "all">("all");
  const { data: allAgents, isError, isLoading } = useAgents();

  const recentSearches = useAppStore((state) => state.recentSearches);
  const addRecentSearch = useAppStore((state) => state.addRecentSearch);
  const removeRecentSearch = useAppStore((state) => state.removeRecentSearch);
  const clearRecentSearches = useAppStore((state) => state.clearRecentSearches);

  const normalizedQuery = query.trim();

  const searchResults = useMemo(() => {
    if (!allAgents) return [];
    let list = allAgents;

    if (selectedCategoryFilter !== "all") {
      list = list.filter((agent) => agent.category === selectedCategoryFilter);
    }

    if (normalizedQuery) {
      list = searchAgentsLocally(list, normalizedQuery);
    }

    return list;
  }, [allAgents, normalizedQuery, selectedCategoryFilter]);

  const runSuggestedSearch = (term: string) => {
    setQuery(term);
    addRecentSearch(term);
  };

  return (
    <div className="relative min-h-screen py-10 sm:py-16">
      <ConstellationBg opacity={0.4} />

      <div className="site-frame">
        {/* Header Title */}
        <header className="max-w-3xl">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-[#F3E3A6] bg-[#FEF5D6] px-3.5 py-1 text-xs font-bold text-[#946B00]">
            <CategoryGlyph color="#946B00" name="search" size={13} strokeWidth={2.4} />
            <span>STORE SEARCH</span>
          </div>
          <h1 className="mt-4 text-4xl font-black tracking-tight text-[#111214] sm:text-5xl lg:text-6xl">
            Search Agents & Handlers
          </h1>
          <p className="mt-3 text-base leading-relaxed text-[#6E706B]">
            Query agents by strategy, protocol, or verified skill. Discover verified ERC-8004 agents across BNB Smart Chain.
          </p>
        </header>

        {/* Search Bar Input Container */}
        <div className="mt-8 rounded-3xl border border-[#ECE8DE] bg-white p-4 shadow-sm sm:p-6">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (normalizedQuery) addRecentSearch(normalizedQuery);
            }}
            role="search"
          >
            <div className="flex items-center gap-4">
              <CategoryGlyph color="#F5B300" name="search" size={24} strokeWidth={2.4} />
              <input
                autoComplete="off"
                className="min-w-0 flex-1 bg-transparent text-lg font-bold text-[#111214] outline-none placeholder:text-[#A5A79F] sm:text-2xl"
                id="agent-search"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Try Venus, PancakeSwap, or LP..."
                type="search"
                value={query}
              />
              {query.length > 0 && (
                <button
                  aria-label="Clear search"
                  className="pressable-scale rounded-xl bg-[#F5F3EB] px-3.5 py-1.5 text-xs font-bold text-[#6E706B] hover:bg-[#ECE8DE] hover:text-[#111214]"
                  onClick={() => setQuery("")}
                  type="button"
                >
                  Clear
                </button>
              )}
            </div>
          </form>

          {/* Category Filter Chips */}
          <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-[#F3F0E8] pt-4">
            <span className="text-xs font-bold uppercase tracking-wider text-[#A5A79F] mr-1">
              Category:
            </span>
            <button
              className={`rounded-full px-3.5 py-1 text-xs font-bold transition-all ${
                selectedCategoryFilter === "all"
                  ? "border border-[#F3E3A6] bg-[#FEF5D6] text-[#946B00] shadow-sm"
                  : "border border-[#ECE8DE] bg-[#FBF9F4] text-[#6E706B] hover:border-[#F5B300]"
              }`}
              onClick={() => setSelectedCategoryFilter("all")}
              type="button"
            >
              All Categories
            </button>
            {AGENT_CATEGORIES.map((cat) => (
              <button
                className={`rounded-full px-3.5 py-1 text-xs font-bold transition-all ${
                  selectedCategoryFilter === cat.slug
                    ? "border border-[#F3E3A6] bg-[#FEF5D6] text-[#946B00] shadow-sm"
                    : "border border-[#ECE8DE] bg-[#FBF9F4] text-[#6E706B] hover:border-[#F5B300]"
                }`}
                key={cat.slug}
                onClick={() => setSelectedCategoryFilter(cat.slug)}
                type="button"
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Suggested Searches & Recent Searches */}
        {!normalizedQuery && selectedCategoryFilter === "all" && (
          <div className="mt-8 grid gap-8 md:grid-cols-2">
            {/* Suggested Searches */}
            <div className="rounded-3xl border border-[#ECE8DE] bg-white p-6 shadow-sm">
              <h2 className="text-sm font-black uppercase tracking-wider text-[#111214]">
                Suggested Searches
              </h2>
              <div className="mt-4 flex flex-wrap gap-2">
                {suggestedSearches.map((term) => (
                  <button
                    className="pressable-scale rounded-full border border-[#ECE8DE] bg-[#FBF9F4] px-3.5 py-1.5 text-xs font-bold text-[#303236] hover:border-[#F3E3A6] hover:bg-[#FEF5D6] hover:text-[#946B00]"
                    key={term}
                    onClick={() => runSuggestedSearch(term)}
                    type="button"
                  >
                    {term}
                  </button>
                ))}
              </div>
            </div>

            {/* Recent Searches */}
            <div className="rounded-3xl border border-[#ECE8DE] bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-black uppercase tracking-wider text-[#111214]">
                  Recent Searches
                </h2>
                {recentSearches.length > 0 && (
                  <button
                    className="text-xs font-bold text-[#946B00] hover:underline"
                    onClick={clearRecentSearches}
                    type="button"
                  >
                    Clear All
                  </button>
                )}
              </div>

              {recentSearches.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {recentSearches.slice(0, 6).map((term) => (
                    <div
                      className="flex items-center gap-1.5 rounded-full border border-[#ECE8DE] bg-[#FBF9F4] px-3 py-1 text-xs font-bold text-[#303236]"
                      key={term}
                    >
                      <button
                        className="hover:text-[#946B00]"
                        onClick={() => runSuggestedSearch(term)}
                        type="button"
                      >
                        {term}
                      </button>
                      <button
                        aria-label={`Remove ${term}`}
                        className="text-[#A5A79F] hover:text-[#B9473A]"
                        onClick={() => removeRecentSearch(term)}
                        type="button"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-xs text-[#A5A79F]">
                  No recent searches recorded yet.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Results Section */}
        <section aria-labelledby="results-heading" className="mt-12">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-black tracking-tight text-[#111214]" id="results-heading">
                {normalizedQuery || selectedCategoryFilter !== "all"
                  ? `Search Results (${searchResults.length})`
                  : "All Catalog Agents"}
              </h2>
              {normalizedQuery && (
                <p className="mt-1 text-xs text-[#6E706B]">
                  Matching query: <span className="font-bold text-[#111214]">“{normalizedQuery}”</span>
                </p>
              )}
            </div>
          </div>

          <div className="mt-6">
            {isLoading ? (
              <StatePanel
                body="Querying Dolphin catalog for matching records."
                state="syncing"
                title="Searching..."
              />
            ) : isError ? (
              <StatePanel
                body="Could not reach the catalog API."
                state="unavailable"
                title="Search Unavailable"
              />
            ) : searchResults.length === 0 ? (
              <StatePanel
                body="No agents matched your search query or category filter. Try a different keyword or view all categories."
                state="empty"
                title="No Agents Found"
              />
            ) : (
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {searchResults.map((agent) => (
                  <AgentCard agent={agent} key={agent.id} />
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
