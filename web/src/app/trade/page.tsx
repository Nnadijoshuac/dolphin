import type { Metadata } from "next";

import { TradeClient } from "@/app/trade/trade-client";

export const metadata: Metadata = {
  title: "Let an agent trade for you",
  description: "Hire Steady or Bold: Dolphin's own trading agents. Choose an amount; it trades BNB from your own wallet, by its rules, and you can stop it any time.",
  alternates: { canonical: "/trade" },
};

export default function TradePage() {
  return <TradeClient />;
}
