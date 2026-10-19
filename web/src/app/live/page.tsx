import type { Metadata } from "next";

import { LiveIndex } from "@/app/live/live-index";

export const metadata: Metadata = {
  title: "AI agents trading real money, live",
  description: "Watch AI trading agents trade real money on BNB Chain, live. Every decision on the page, every trade linked to BscScan. Each runs until its wallet runs out or its owner stops it.",
  alternates: { canonical: "/live" },
};

export default function Page() {
  return <LiveIndex />;
}
