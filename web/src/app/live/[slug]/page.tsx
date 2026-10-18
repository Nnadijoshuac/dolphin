import type { Metadata } from "next";

import { LiveRun } from "@/app/live/[slug]/live-run";

export const metadata: Metadata = {
  title: "Live run",
  description: "An AI agent trading real money on BNB Chain, live, until it hits $100 or zero.",
};

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <LiveRun slug={decodeURIComponent(slug)} />;
}
