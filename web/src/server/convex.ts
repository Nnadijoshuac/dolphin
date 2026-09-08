import "server-only";

import { ConvexHttpClient } from "convex/browser";

import { api } from "@/convex/api";
import type { Agent } from "@/types/agent";

/**
 * Convex, read from the SERVER.
 *
 * ===========================================================================
 * WHY A SECOND CLIENT EXISTS (2026-09-08)
 * ===========================================================================
 * `providers/convex-provider.tsx` holds a `ConvexReactClient`, which is a
 * WebSocket subscription and only works in a browser. Everything on this site
 * used it, because every route was `"use client"` - which is also why the site
 * had no server-rendered content, no per-agent `<title>`, and nothing for a
 * crawler or a social unfurler to read.
 *
 * `ConvexHttpClient` is the other half: a plain HTTP request, usable in
 * `generateMetadata`, `sitemap.ts`, and a server component. It does not
 * subscribe and does not update - which is exactly right for metadata, and
 * exactly wrong for the live parts of the page. The two coexist on purpose:
 * the server renders the record's IDENTITY, and the client subscribes to its
 * LIVE VALUES on top.
 *
 * ===========================================================================
 * IT MUST NEVER THROW A PAGE AWAY
 * ===========================================================================
 * Every function here returns null rather than raising. Metadata generation
 * that throws takes the whole route down with it, so a slow Convex deployment
 * would turn a working agent page into a 500. Degraded metadata is a bad day;
 * a 500 on the most linkable page in the product is an outage.
 */

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();

/**
 * Ten seconds. Long enough for a cold Convex function, short enough that it
 * cannot hold a render open past what a crawler will wait for.
 */
const REQUEST_TIMEOUT_MS = 10_000;

function client(): ConvexHttpClient | null {
  return convexUrl ? new ConvexHttpClient(convexUrl) : null;
}

async function withTimeout<T>(work: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      work,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), REQUEST_TIMEOUT_MS);
      }),
    ]);
  } catch (cause) {
    console.error("[dolphin] server-side Convex read failed", cause);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** One agent by `agentKey` or bare token id, or null for any failure at all. */
export async function fetchAgent(reference: string): Promise<Agent | null> {
  const convex = client();
  if (!convex) return null;

  const row = await withTimeout(
    convex.query(api.agents.get, { reference }) as Promise<Agent | null>,
  );

  return row ?? null;
}

/** The browse chips, for the sitemap's category URLs. */
export async function fetchCategories(): Promise<
  { slug: string; label: string; count: number }[]
> {
  const convex = client();
  if (!convex) return [];

  const facets = await withTimeout(convex.query(api.facets.list, {}));
  return facets?.categories ?? [];
}

/**
 * Every live agent's token id, for the sitemap.
 *
 * PAGED, and capped. There is no unpaginated catalog read by design (a Convex
 * query has a one-second budget), so this walks pages like any other consumer.
 * The cap is what stops a growing catalog from turning sitemap generation into
 * an unbounded loop against a per-request time limit; when it is reached the
 * caller emits what it has, which is a smaller sitemap rather than none.
 */
const SITEMAP_PAGE_SIZE = 200;
const SITEMAP_MAX_AGENTS = 5_000;

export async function fetchAgentIdsForSitemap(): Promise<
  { tokenId: string; updatedAt: string | null }[]
> {
  const convex = client();
  if (!convex) return [];

  const collected: { tokenId: string; updatedAt: string | null }[] = [];
  let cursor: string | null = null;

  while (collected.length < SITEMAP_MAX_AGENTS) {
    const page: { page: Agent[]; isDone: boolean; continueCursor: string } | null =
      await withTimeout(
        convex.query(api.agents.list, {
          paginationOpts: { numItems: SITEMAP_PAGE_SIZE, cursor },
        }),
      );

    if (!page) break;

    for (const agent of page.page) {
      if (!agent.tokenId) continue;
      collected.push({
        tokenId: agent.tokenId,
        // `checkedAt` is when Dolphin last verified the record, which is the
        // honest <lastmod>: it is when this PAGE's content could have changed.
        updatedAt: agent.registryVerification?.registered?.asOf ?? null,
      });
    }

    if (page.isDone) break;
    cursor = page.continueCursor;
  }

  return collected;
}
