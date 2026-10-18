import type { Metadata } from "next";

import { LiveRun } from "@/app/live/[slug]/live-run";

export const metadata: Metadata = {
  title: "Live run",
  description: "An AI agent trading real money on BNB Chain, live, every trade in the open.",
};

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <LiveRun slug={decodeURIComponent(slug)} />;
}
