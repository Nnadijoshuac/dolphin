import type { Metadata } from "next";

import { DolphinClient } from "@/app/dolphin/dolphin-client";

/**
 * The server shell around the Dolphin agent.
 *
 * Same split as /search: it exists so the route can export `metadata`, which a
 * `"use client"` module cannot. The screen itself is a client component and
 * always will be - it is a live Convex subscription driven by an input.
 */
export const metadata: Metadata = {
  title: "Dolphin — ask the marketplace",
  description:
    "Ask a question and Dolphin answers it by calling the ERC-8004 agents listed on BNB Smart Chain, showing which agents it consulted, what it asked them, and what each one returned.",
  alternates: { canonical: "/dolphin" },
  openGraph: {
    title: "Dolphin — ask the marketplace",
    description:
      "An agent that consults other agents. Ask a question and see exactly which ERC-8004 agents on BNB Smart Chain were called to answer it.",
    url: "/dolphin",
  },
};

/**
 * `?agent=` is read HERE, on the server, and passed down as a prop.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT `useSearchParams` IN THE CLIENT COMPONENT
 * ---------------------------------------------------------------------------
 * That was the first version, and it shipped a blank page. A component calling
 * `useSearchParams` has to sit under a Suspense boundary, and with the whole
 * screen inside one the static prerender rendered the fallback - so serving the
 * build returned HTTP 200 with a correct `<title>` and an EMPTY body. Every
 * word of the empty state, and everything a crawler would index, existed only
 * after hydration.
 *
 * Reading the param on the server costs the route its static rendering and buys
 * back complete HTML on first paint. For a page whose entire job is to be
 * understood by someone who has never seen it, that is the right side of the
 * trade.
 *
 * `searchParams` is a Promise in this version of Next - verified against
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md,
 * not from memory.
 */
export default async function DolphinPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const agent = (await searchParams).agent;
  const seedAgentKey = typeof agent === "string" && agent.length > 0 ? agent : null;

  return <DolphinClient seedAgentKey={seedAgentKey} />;
}
