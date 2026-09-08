import type { Metadata } from "next";
import { Suspense } from "react";

import { DolphinClient } from "@/app/dolphin/dolphin-client";

/**
 * The server shell around the Dolphin agent.
 *
 * Same split as /search: it exists so the route can export `metadata`, which a
 * `"use client"` module cannot. The screen itself is a client component and
 * always will be - it is a live Convex subscription driven by an input, and
 * there is nothing here worth server-rendering.
 */
export const metadata: Metadata = {
  title: "Dolphin — ask the marketplace",
  description:
    "Ask a question and Dolphin answers it by calling the ERC-8004 agents listed on BNB Smart Chain, showing which agents it consulted and what each one returned.",
  alternates: { canonical: "/dolphin" },
  openGraph: {
    title: "Dolphin — ask the marketplace",
    description:
      "An agent that consults other agents. Ask a question and see exactly which ERC-8004 agents on BNB Smart Chain were called to answer it.",
    url: "/dolphin",
  },
};

export default function DolphinPage() {
  /*
   * Suspense is REQUIRED, not decorative: DolphinClient reads `?agent=` with
   * `useSearchParams`, and a component doing that must sit under a Suspense
   * boundary or it opts the whole route out of static rendering and fails the
   * build.
   */
  return (
    <Suspense fallback={null}>
      <DolphinClient />
    </Suspense>
  );
}
