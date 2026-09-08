/**
 * The site's own identity: origin, name, and the copy search engines and social
 * cards see.
 *
 * ===========================================================================
 * WHY AN ABSOLUTE ORIGIN IS REQUIRED (2026-09-08)
 * ===========================================================================
 * `sitemap.xml`, `robots.txt`, `<link rel="canonical">` and every OpenGraph
 * image URL must be ABSOLUTE. A relative one is either ignored or resolved
 * against the wrong host, and on Vercel the wrong host is a real risk: every
 * branch gets its own preview domain, and a preview that advertises itself as
 * canonical competes with production in the index.
 *
 * So this is a constant with a production default, overridable by
 * NEXT_PUBLIC_SITE_URL, and preview deployments deliberately do NOT set it -
 * see the note in .env.example. `metadataBase` in app/layout.tsx reads this,
 * which is what lets every other file in the app declare image and canonical
 * paths as relative strings and have Next resolve them correctly.
 */

const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();

/** The production origin. Vercel, via Vercel's own Git integration. */
export const PRODUCTION_URL = "https://dolphinamp.vercel.app";

/** Never with a trailing slash - every consumer concatenates a path onto it. */
export const SITE_URL = (configured && configured.length > 0
  ? configured
  : PRODUCTION_URL
).replace(/\/+$/, "");

export const SITE_NAME = "Dolphin";

export const SITE_DESCRIPTION =
  "Discover, understand, and hire ERC-8004 AI agents on BNB Chain. Every metric carries its source, its freshness, and what it does not know.";

/**
 * Whether this deployment should allow itself to be indexed.
 *
 * Vercel sets VERCEL_ENV to "production" | "preview" | "development". Only
 * production may be crawled: a preview build is a copy of the whole site on a
 * public URL, and letting one into the index means duplicate content pointing
 * at an ephemeral host that will 404 when the branch is deleted.
 */
export const IS_INDEXABLE =
  process.env.NEXT_PUBLIC_VERCEL_ENV === undefined
    ? SITE_URL === PRODUCTION_URL
    : process.env.NEXT_PUBLIC_VERCEL_ENV === "production";
