import type { Metadata } from "next";

import { TraderPage } from "@/app/trade/[id]/trader-page";
import { fetchTraders } from "@/server/convex";

/* Each trader by its own name (2026-10-19): every trader page was titled "Trader" and inherited the home page's canonical. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const trader = (await fetchTraders()).find((row) => row.id === decodeURIComponent(id));
  const title = trader ? `${trader.name} — AI trading agent on BNB Chain` : "Trader";
  const description = trader
    ? `${trader.tagline} ${trader.risk} risk, ${trader.timeframe} candles. Its rules, record and every trade, in the open. Run it in your own wallet, on practice money first.`
    : "A trading agent's rules, record and every trade it took. Run it in your own wallet, on practice money first.";
  return { title, description, alternates: { canonical: `/trade/${id}` } };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TraderPage id={decodeURIComponent(id)} />;
}
