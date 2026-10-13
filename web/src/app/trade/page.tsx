import type { Metadata } from "next";

import { TradeHub } from "@/app/trade/trade-hub";

export const metadata: Metadata = {
  title: "Agents that trade",
  description: "Trading agents with their records in the open. Run one in your own wallet, on practice money first, and stop it any time.",
  alternates: { canonical: "/trade" },
};

export default function TradePage() {
  return <TradeHub />;
}
