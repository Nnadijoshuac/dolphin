import type { Metadata } from "next";

import { LiveIndex } from "@/app/live/live-index";

export const metadata: Metadata = {
  title: "AI agents trading live",
  description: "Watch AI trading agents trade live - real money on BNB Chain with every trade linked to BscScan, or paper trades with demo money at live prices. Every decision on the page.",
  alternates: { canonical: "/live" },
};

export default function Page() {
  return <LiveIndex />;
}
