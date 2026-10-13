import type { Metadata } from "next";

import { TraderPage } from "@/app/trade/[id]/trader-page";

export const metadata: Metadata = {
  title: "Trader",
  description: "A trading agent's rules, record and every trade it took. Run it in your own wallet, on practice money first.",
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TraderPage id={decodeURIComponent(id)} />;
}
