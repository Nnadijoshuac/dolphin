"use client";

import { useMemo, useState } from "react";
import { AGENT_CATEGORIES } from "@/constants/agents";
import { colors, shadows } from "@/constants/theme";
import { useAgents } from "@/hooks/use-agents";
import { AgentCard } from "@/components/agent-card";
import { CategoryGlyph } from "@/components/category-glyph";
import { StatePanel } from "@/components/state-panel";
import { useAppStore } from "@/store/use-app-store";
import { searchAgentsLocally } from "@/services/agents-api";
import type { AgentCategory } from "@/types/agent";

const categoryBgColors: Record<AgentCategory, string> = {
  monitoring: "#F5F3EC",
  "grid-trading": "#FAF5E6",
  "health-factor": "#F9F3F0",
  yield: "#F0F7F2",
};

const categorySubtitles: Record<AgentCategory, string> = {
  monitoring: "Watch wallets",
  "grid-trading": "Price ranges",
  "health-factor": "Borrow risk",
  yield: "Find yield",
};

const POPULAR_SEARCHES = [
  "PancakeSwap",
  "Venus",
  "Wallet Watch",
  "Yield",
  "Liquidation",
  "Grid Trading",
];

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const { data: allAgents } = useAgents();

  const recentSearches = useAppStore((state) => state.recentSearches);
  const addRecentSearch = useAppStore((state) => state.addRecentSearch);
  const removeRecentSearch = useAppStore((state) => state.removeRecentSearch);
  const clearRecentSearches = useAppStore((state) => state.clearRecentSearches);

  const searchResults = useMemo(() => {
    if (!allAgents || !query.trim()) return [];
    return searchAgentsLocally(allAgents, query);
  }, [allAgents, query]);

  const handleTagPress = (tag: string) => {
    setQuery(tag);
    addRecentSearch(tag);
  };

  return (
    <div className="py-6 space-y-6">
      {/* Search Input Bar */}
      <div className="relative">
        <div
          className="flex items-center rounded-2xl bg-white px-4 h-12 border transition-all duration-200 focus-within:border-amber-400 focus-within:ring-2 focus-within:ring-amber-400/20"
          style={{ borderColor: "rgba(17,18,20,0.08)", boxShadow: shadows.subtle }}
        >
          <CategoryGlyph color="#8C8E88" name="search" size={18} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && query.trim()) {
                addRecentSearch(query.trim());
              }
            }}
            placeholder="Search agents, skills, publishers"
            className="ml-3 flex-1 bg-transparent text-sm font-medium outline-none text-zinc-900 placeholder:text-zinc-400"
          />
          {query.length > 0 && (
            <button
              onClick={() => setQuery("")}
              className="p-1 rounded-full hover:bg-zinc-100 text-zinc-400"
            >
              <CategoryGlyph color="#8C8E88" name="revoke" size={14} />
            </button>
          )}
        </div>
      </div>

      {query.trim().length > 0 ? (
        /* Results */
        <div className="space-y-4">
          <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">
            {searchResults.length} {searchResults.length === 1 ? "Agent found" : "Agents found"}
          </p>
          {searchResults.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {searchResults.map((agent) => (
                <AgentCard key={agent.id} agent={agent} />
              ))}
            </div>
          ) : (
            <div className="py-12">
              <StatePanel
                body={`No agents found matching "${query}". Try searching by category, protocol, or skill.`}
                state="unavailable"
                title="No results found"
              />
            </div>
          )}
        </div>
      ) : (
        /* Default Search Home */
        <div className="space-y-6">
          {/* Recent Searches */}
          {recentSearches.length > 0 && (
            <div>
              <div className="flex items-center justify-between pb-2">
                <h3 className="text-sm font-bold text-zinc-900">Recent searches</h3>
                <button
                  onClick={() => clearRecentSearches()}
                  className="text-xs font-bold text-zinc-400 hover:text-zinc-600"
                >
                  Clear all
                </button>
              </div>
              <div className="rounded-2xl bg-white border border-black/5 overflow-hidden divide-y divide-black/5">
                {recentSearches.slice(0, 4).map((item) => (
                  <div key={item} className="flex items-center justify-between px-4 py-3">
                    <button
                      onClick={() => handleTagPress(item)}
                      className="flex-1 flex items-center gap-3 text-left text-sm font-medium text-zinc-800 hover:text-amber-600"
                    >
                      <CategoryGlyph color="#8C8E88" name="clock" size={14} />
                      {item}
                    </button>
                    <button
                      onClick={() => removeRecentSearch(item)}
                      className="p-1 text-zinc-400 hover:text-zinc-600"
                    >
                      <CategoryGlyph color="#A0A0A0" name="revoke" size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Trending */}
          <div>
            <h3 className="text-sm font-bold text-zinc-900 pb-2">Trending on BNB Chain</h3>
            <div className="flex flex-wrap gap-2">
              {POPULAR_SEARCHES.map((term, index) => (
                <button
                  key={term}
                  onClick={() => handleTagPress(term)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-black/5 text-xs font-medium text-zinc-800 hover:border-amber-400 transition-all"
                  style={{ boxShadow: shadows.subtle }}
                >
                  <span className="font-bold text-amber-600">#{index + 1}</span>
                  <span>{term}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Explore Categories */}
          <div>
            <h3 className="text-sm font-bold text-zinc-900 pb-2.5">Explore Categories</h3>
            <div className="grid grid-cols-2 gap-3">
              {AGENT_CATEGORIES.map((cat) => (
                <button
                  key={cat.slug}
                  onClick={() => handleTagPress(cat.label)}
                  className="flex items-center gap-3 p-3.5 rounded-2xl bg-white border border-black/5 text-left transition-all hover:scale-[1.02] hover:shadow-md"
                  style={{ boxShadow: shadows.subtle }}
                >
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl overflow-hidden"
                    style={{ backgroundColor: categoryBgColors[cat.slug] ?? "#F5F3EC" }}
                  >
                    <CategoryGlyph color={colors.ink} name={cat.slug} size={20} strokeWidth={2} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-zinc-900 truncate">{cat.label}</p>
                    <p className="text-xs text-zinc-500 font-medium truncate mt-0.5">
                      {categorySubtitles[cat.slug]}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Suggested for you */}
          {allAgents && allAgents.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-zinc-900 pb-2.5">Suggested for you</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {allAgents.slice(0, 4).map((agent) => (
                  <AgentCard key={agent.id} agent={agent} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
