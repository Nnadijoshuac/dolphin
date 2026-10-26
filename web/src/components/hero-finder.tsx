"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCategoryFacets } from "@/hooks/use-agents";
import { NEW_CONVERSATION, useDolphinPlaceStore } from "@/store/use-dolphin-place-store";

/**
 * FIND OR BUILD, FROM THE FIRST SCREEN (owner, 2026-10-26: "make it very easy for people to find and build
 * their agent"). One field with two jobs. Find searches the marketplace, the graded categories one tap away with
 * their live counts. Build takes the agent in plain words and opens the builder with it already written - the
 * builder keeps unsent text per conversation in this browser (store/use-dolphin-place-store.ts), so nothing
 * is sent until the person presses send there.
 */
const GRADED = ["yield", "grid-trading", "rebalancing", "health-factor"];
const IDEAS = [
  "Buy BNB when RSI drops under 30 on 4h candles. Sell at +5% or a 3% loss. $10 a trade.",
  "Check a token's safety before I buy it: honeypot, taxes, owner powers, liquidity.",
  "Watch my Venus position and tell me how far it is from liquidation.",
];

export function HeroFinder() {
  const router = useRouter();
  const facets = useCategoryFacets();
  const [mode, setMode] = useState<"find" | "build">("find");
  const [text, setText] = useState("");
  const categories = facets.categories.filter((c) => GRADED.includes(c.slug) && c.count > 0);

  const go = (value: string) => {
    const query = value.trim();
    if (mode === "find") {
      router.push(query ? `/search?q=${encodeURIComponent(query)}&ref=home-find` : "/search?ref=home-find");
      return;
    }
    const place = useDolphinPlaceStore.getState();
    place.setNewMode("build");
    if (query) place.setComposer(NEW_CONVERSATION, query);
    router.push("/dolphin?mode=build&new=1&ref=home-build");
  };

  return (
    <div className="mt-8 w-full max-w-[640px]">
      <div className="inline-flex rounded-full bg-white/[0.08] p-1" role="tablist">
        {(
          [
            ["find", "Find an agent"],
            ["build", "Build your own"],
          ] as const
        ).map(([key, label]) => (
          <button
            aria-selected={mode === key}
            className={`rounded-full px-4 py-1.5 text-[14px] font-semibold transition-colors ${mode === key ? "bg-[#f4f3ec]" : "hover:opacity-100"}`}
            key={key}
            // Set directly: the hero's dark theme colours its text, which made the selected tab cream on cream.
            style={{ color: mode === key ? "#171813" : "rgba(244,243,236,0.75)" }}
            onClick={() => setMode(key)}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      <form
        className="mt-3 flex items-center gap-2 rounded-2xl border border-white/15 bg-[#0d0d0c]/80 p-2 backdrop-blur"
        onSubmit={(event) => {
          event.preventDefault();
          go(text);
        }}
      >
        <input
          aria-label={mode === "find" ? "Search agents" : "Describe the agent you want"}
          className="h-11 min-w-0 flex-1 bg-transparent px-3 text-[16px] text-[#f4f3ec] outline-none placeholder:text-[#f4f3ec]/45"
          onChange={(event) => setText(event.target.value)}
          placeholder={mode === "find" ? "Search agents - try Venus, yield or grid" : "Describe the agent you want, in plain words"}
          value={text}
        />
        <button className="h-11 shrink-0 rounded-xl bg-[#f0b90b] px-5 text-[15px] font-semibold hover:bg-[#ffd54a]" style={{ color: "#171813" }} type="submit">
          {mode === "find" ? "Search" : "Build it"}
        </button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2">
        {mode === "find"
          ? categories.map((category) => (
              <Link
                className="rounded-full border border-white/15 px-3 py-1.5 text-[13px] text-[#f4f3ec]/85 no-underline hover:border-white/40 hover:text-[#f4f3ec]"
                href={`/search?category=${category.slug}&ref=home-find`}
                key={category.slug}
              >
                {category.label} <span className="text-[#f4f3ec]/50">{category.count}</span>
              </Link>
            ))
          : IDEAS.map((idea) => (
              <button
                className="max-w-full truncate rounded-full border border-white/15 px-3 py-1.5 text-left text-[13px] text-[#f4f3ec]/85 hover:border-white/40 hover:text-[#f4f3ec]"
                key={idea}
                onClick={() => setText(idea)}
                type="button"
              >
                {idea}
              </button>
            ))}
      </div>
    </div>
  );
}
