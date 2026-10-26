import type { Metadata } from "next";

import { LiveRun } from "@/app/live/[slug]/live-run";
import { fetchLiveRun } from "@/server/convex";

/*
 * What a shared run unfurls as (owner, 2026-10-19: no preview on X). Title and description name the agent
 * and its coins - nothing that goes stale; the card is opengraph-image.tsx beside this file. X needs
 * summary_large_image to show that card full width rather than a thumbnail.
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const run = await fetchLiveRun(decodeURIComponent(slug));
  const coins = [...new Set((run?.desk ?? []).map((rule) => (rule.market ?? run?.market ?? "").replace("USDT", "")).filter(Boolean))];
  const name = run?.name ?? "Live run";
  const coinWords = coins.length ? coins.join(", ") : "crypto";
  const title = run?.paper ? `${name} - an AI agent paper trading, live` : `${name} - an AI agent trading real money, live`;
  const description = run?.paper
    ? `${name} paper trades ${coinWords} with demo money at live prices. Watch every decision as it happens.`
    : `${name} trades ${coinWords} with real money on BNB Chain. Watch every decision as it happens - every trade links to its proof.`;
  return {
    title,
    description,
    alternates: { canonical: `/live/${slug}` },
    openGraph: { title, description, type: "website", siteName: "Dolphin" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <LiveRun slug={decodeURIComponent(slug)} />;
}
