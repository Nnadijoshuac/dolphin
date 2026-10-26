import type { Metadata } from "next";

import { DolphinClient } from "@/app/dolphin/dolphin-client";
import { fetchAgent } from "@/server/convex";

/**
 * The server shell around the Dolphin agent.
 *
 * Same split as /search: it exists so the route can export `metadata`, which a
 * `"use client"` module cannot. The screen itself is a client component and
 * always will be - it is a live Convex subscription driven by an input.
 */
/*
 * The builder is the link shared most (2026-10-26: the owner's build post on X unfurled as a grey box - this
 * page's own openGraph replaced the inherited one and named no image). Titled for what people come to do.
 */
export const metadata: Metadata = {
  title: { absolute: "Build an AI agent in one sentence | Dolphin" },
  description:
    "Describe the agent you want in plain words and Dolphin builds it: trading rules that run on every closed candle, practice money first, live on BNB Chain when you are ready.",
  alternates: { canonical: "/dolphin" },
  openGraph: {
    title: "Build an AI agent in one sentence | Dolphin",
    description: "Describe the agent you want in plain words and Dolphin builds it. Practice money first, live on BNB Chain when you are ready.",
    url: "/dolphin",
    images: ["/opengraph-image"],
  },
  twitter: { card: "summary_large_image", images: ["/opengraph-image"] },
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
  const sp = await searchParams;
  const agent = sp.agent;
  let name = typeof sp.name === "string" ? sp.name : null;
  const ask = sp.ask;
  const seedAgentKey = typeof agent === "string" && agent.length > 0 ? agent : null;

  if (seedAgentKey && !name) {
    try {
      const agentDoc = await fetchAgent(seedAgentKey);
      if (agentDoc?.name) {
        name = agentDoc.name;
      }
    } catch {
      // ignore
    }
  }

  const autoAsk = ask === "1" || ask === "true" || (seedAgentKey !== null && ask !== "0");

  /*
   * `?c=<conversationKey>` opens that conversation (2026-09-27). The key is the
   * conversation's capability, so a link carrying it is a way back into a draft
   * that works whatever this browser's local history holds. Only the key's own
   * shape is accepted.
   */
  const openKey = typeof sp.c === "string" && /^[0-9a-f]{64}$/.test(sp.c) ? sp.c : null;

  return (
    <DolphinClient
      autoAsk={autoAsk}
      initialConversationKey={openKey}
      solo={openKey && (sp.solo === "draft" || sp.solo === "canvas") ? sp.solo : null}
      seedAgentKey={seedAgentKey}
      seedAgentName={name}
      freshBuild={sp.mode === "build" && sp.new === "1" && !openKey}
    />
  );
}
