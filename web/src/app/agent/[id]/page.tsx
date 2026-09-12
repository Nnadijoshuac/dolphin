import type { Metadata } from "next";

import { AgentDetailClient } from "@/app/agent/[id]/agent-detail-client";
import { categoryLabel } from "@/constants/agents";
import { SITE_NAME } from "@/constants/site";
import { fetchAgent } from "@/server/convex";

/**
 * ===========================================================================
 * THE ONE PAGE ON THIS SITE THAT COMPOUNDS. (2026-09-08)
 * ===========================================================================
 *
 * WHAT THIS WAS. `"use client"` at line 1, `use(params)`, and a `useAgentDetail`
 * hook. Every one of the hundreds of agent records therefore:
 *
 *   - shared ONE title, the root layout's "Dolphin — AI agents on BNB Chain"
 *   - had no description, no canonical URL, no OpenGraph tags
 *   - served a crawler and a social unfurler an empty shell and a spinner
 *
 * A marketplace's per-item page is the only asset it owns that earns traffic
 * indefinitely: hundreds of pages, each about a distinct named thing, each
 * independently linkable. This product's entire proposition is discovery and
 * it had made its most discoverable surface invisible.
 *
 * ===========================================================================
 * THE SPLIT: IDENTITY ON THE SERVER, LIVE VALUES ON THE CLIENT
 * ===========================================================================
 * This file is now a SERVER component. It reads the agent over HTTP
 * (server/convex.ts) purely to produce metadata and to answer "does this exist"
 * before rendering anything.
 *
 * It does NOT server-render the whole record, and that is deliberate rather than
 * a shortcut. The page's live half - protocol stats, registry verification, the
 * hire state, reviews - is a Convex SUBSCRIPTION plus a wallet, and both are
 * browser-only. Rendering a snapshot of a live metric on the server would put a
 * value on screen with a server-side timestamp and no way to say it had gone
 * stale, which is the one thing AGENTS.md SS5 exists to prevent. So the server
 * owns the record's IDENTITY (name, category, publisher, description) and the
 * client subscribes to everything that changes.
 *
 * ===========================================================================
 * WHY NOT `notFound()` WHEN THE SERVER READ FAILS
 * ===========================================================================
 * `fetchAgent` returns null for BOTH "no such agent" and "could not reach
 * Convex", and those must not be conflated: rendering a 404 for a backend
 * outage would tell a crawler that a real, live agent page had been deleted,
 * and that de-indexes it. So a null here degrades to generic metadata and lets
 * the client component decide - it can tell the two apart, because it can
 * distinguish `row === null` (the backend said no) from a socket that never
 * opened. See components/backend-status.tsx.
 */

type AgentPageProps = { params: Promise<{ id: string }> };

/** Metadata for a record that could not be read. Deliberately not indexed. */
const UNRESOLVED_METADATA: Metadata = {
  title: "Agent record",
  description:
    "An ERC-8004 agent record on BNB Smart Chain, with its data sources and freshness shown alongside every value.",
  robots: { index: false, follow: true },
};

export async function generateMetadata({
  params,
}: AgentPageProps): Promise<Metadata> {
  const { id } = await params;
  const agent = await fetchAgent(id);

  if (!agent) return UNRESOLVED_METADATA;

  const label = categoryLabel(agent.category);
  const canonical = `/agent/${encodeURIComponent(agent.tokenId)}`;

  /*
   * The tagline is the publisher's own words. Trimmed to a length that survives
   * a search result and a social card intact rather than being cut mid-word by
   * whoever is rendering it.
   */
  const summary =
    agent.tagline?.trim() ||
    agent.description?.trim() ||
    `An ERC-8004 ${label.toLowerCase()} agent registered on BNB Smart Chain.`;
  const description =
    summary.length > 155 ? `${summary.slice(0, 152).trimEnd()}…` : summary;

  const title = `${agent.name} — ${label} agent`;

  return {
    title,
    description,
    alternates: { canonical },
    /*
     * An agent whose record Dolphin could not verify on-chain is still shown,
     * but is not submitted to an index as a verified listing. Curated and
     * indexed records are; everything else is followed but not indexed.
     */
    robots:
      agent.recordStatus === "indexed"
        ? { index: true, follow: true }
        : { index: false, follow: true },
    openGraph: {
      type: "profile",
      siteName: SITE_NAME,
      title,
      description,
      url: canonical,
      /*
       * Relative, resolved against `metadataBase` in the root layout. The image
       * itself is generated per-agent by opengraph-image.tsx beside this file.
       */
      images: [{ url: `${canonical}/opengraph-image` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${canonical}/opengraph-image`],
    },
    other: {
      /*
       * The identity, as metadata, because this is the thing that makes the
       * record checkable by something other than a human reading the page.
       */
      "dolphin:agent-key": agent.agentKey,
      "dolphin:token-id": agent.tokenId,
      "dolphin:chain": "bnb-smart-chain-56",
    },
  };
}

export default async function AgentPage({ params }: AgentPageProps) {
  const { id } = await params;

  /*
   * Read on the server so the structured data below describes THIS agent, and
   * so a crawler that does not run JavaScript still receives the record's
   * identity. The client component re-reads it as a live subscription; Convex
   * dedupes that against its own cache, so this is not a doubled cost to the
   * user.
   */
  const agent = await fetchAgent(id);

  return (
    <>
      {agent ? (
        /*
         * JSON-LD. This is what lets a search engine understand the page as a
         * described THING - a named product with a publisher and a category -
         * rather than as a bag of words. Emitted server-side because a crawler
         * that does not execute scripts must still see it.
         *
         * Only fields Dolphin can actually source appear. There is no
         * aggregateRating: the reviews on this site are structured outcomes
         * rather than stars precisely because a star average over this many
         * reviewers is noise (convex/agentReviews.ts), and inventing one for a
         * rich-result badge would be exactly the fabrication AGENTS.md SS5
         * forbids - in the one place it would be most rewarded.
         */
        <script
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              name: agent.name,
              applicationCategory: "BusinessApplication",
              description: agent.tagline || agent.description || undefined,
              identifier: agent.agentKey,
              url: `/agent/${encodeURIComponent(agent.tokenId)}`,
              image: agent.iconUrl || undefined,
              operatingSystem: "Web",
              author: agent.publisher
                ? { "@type": "Organization", name: agent.publisher }
                : undefined,
            }),
          }}
          type="application/ld+json"
        />
      ) : null}
      {/*
       * The record read above is handed straight to the client component. It
       * was already fetched for the metadata and the JSON-LD; not passing it on
       * meant a visitor's first paint was "Syncing - Loading agent record" on a
       * page whose identity the server had in hand. See the note on
       * `initialAgent` for why this does not put a live value on screen.
       */}
      <AgentDetailClient initialAgent={agent} reference={id} />
    </>
  );
}
