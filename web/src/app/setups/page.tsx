import type { Metadata } from "next";

import { SetupsClient } from "@/app/setups/setups-client";

export const metadata: Metadata = {
  title: "Trading setups",
  description: "Whole trading-agent setups built on Dolphin, with a backtest Dolphin runs itself. Copy one into your own agent; its strategy stays locked.",
  alternates: { canonical: "/setups" },
};

export default function SetupsPage() {
  return <SetupsClient />;
}
