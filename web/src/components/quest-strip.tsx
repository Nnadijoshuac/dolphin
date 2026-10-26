"use client";

import Link from "next/link";
import { useQuery } from "convex/react";

import { SET_AND_QUEST_URL } from "@/constants/site";
import { setAndQuestApi } from "@/convex/api";
import { useNow } from "@/hooks/use-now";
import { useWallet } from "@/wallet/wallet-provider";

/**
 * SET AND EARN, RIGHT UNDER THE HERO (2026-10-26). Mandate, Marque, Pokter and HelloFugu all lead their home
 * page with the quest: the deadline and the steps. Ours sat at the bottom of the page. This strip says the
 * deadline, the two tracks (@BNBCHAIN, 21 Oct: "build 1 qualifying agent and hire 3 different agents across 2+
 * shortlisted marketplaces"; our tracker, convex/setAndQuest.ts, counts the build as hired by 3 other wallets),
 * and - for a connected wallet - its own progress, read from that tracker.
 */
const DEADLINE = Date.UTC(2026, 10, 5, 12, 0);

export function QuestStrip() {
  const now = useNow();
  const wallet = useWallet();
  const progress = useQuery(setAndQuestApi.setAndQuest.progress, wallet.address ? { wallet: wallet.address } : "skip");
  const left = now ? DEADLINE - now : null;
  if (left !== null && left <= 0) return null;
  const days = left === null ? null : Math.floor(left / 86_400_000);
  const hours = left === null ? null : Math.floor((left % 86_400_000) / 3_600_000);
  const hires = progress ? Math.min(progress.hire.onchainAgents, progress.hire.needed) : null;
  const built = progress ? progress.build.agents.length > 0 : null;

  return (
    <section aria-label="BNB Chain Set and Earn" className="border-b border-line bg-[#0d0d0c]">
      <div className="site-frame flex flex-col gap-4 py-5 lg:flex-row lg:items-center lg:gap-8">
        <div className="shrink-0">
          <p className="text-[13px] font-semibold text-[#f3c13a]">BNB Chain Set and Earn</p>
          <p className="mt-0.5 text-[15px] font-semibold text-ink">
            {days === null ? "Ends 5 Nov, 12:00 UTC" : `${days} day${days === 1 ? "" : "s"} ${hours}h left`}
          </p>
        </div>
        <ol className="grid flex-1 gap-3 sm:grid-cols-2">
          <li className="rounded-xl border border-line px-4 py-3">
            <p className="text-[12px] font-semibold text-muted">Step 1</p>
            <p className="mt-0.5 text-[15px] font-semibold text-ink">Hire 3 agents, across 2+ marketplaces</p>
            <p className="mt-0.5 text-[13px] text-ink-soft">
              {hires === null ? "Paid through on-chain escrow, from 0.01 U." : `${hires} of 3 done`}
            </p>
          </li>
          <li className="rounded-xl border border-line px-4 py-3">
            <p className="text-[12px] font-semibold text-muted">Step 2</p>
            <p className="mt-0.5 text-[15px] font-semibold text-ink">Build 1 that 3 other wallets hire</p>
            <p className="mt-0.5 text-[13px] text-ink-soft">
              {built === null ? "Describe it in a sentence. Dolphin builds it." : built ? "Built. Now get 3 other wallets to hire it." : "Not started"}
            </p>
          </li>
        </ol>
        <div className="flex shrink-0 gap-2">
          <Link className="inline-flex h-11 items-center rounded-xl bg-[#f0b90b] px-5 text-[15px] font-semibold no-underline hover:bg-[#ffd54a]" href="/search?ref=home-quest" style={{ color: "#171813" }}>
            Hire agents
          </Link>
          <Link className="inline-flex h-11 items-center rounded-xl border border-line px-5 text-[15px] font-semibold text-ink no-underline hover:border-line-strong" href={`${SET_AND_QUEST_URL}?ref=home-quest`}>
            {wallet.address ? "Your progress" : "How it works"}
          </Link>
        </div>
      </div>
    </section>
  );
}
