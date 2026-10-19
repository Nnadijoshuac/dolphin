import type { MetadataRoute } from "next";

import { IS_INDEXABLE, SITE_URL } from "@/constants/site";

/**
 * robots.txt. There was none, so every crawler was operating on defaults with
 * no sitemap pointer and no way to tell a Vercel preview deployment apart from
 * production.
 *
 * The disallow list is not about secrecy - none of these pages is private - it
 * is about crawl budget and index quality. `/my-agents` and `/wallet` render
 * nothing at all without a connected wallet, so an indexed copy of either is a
 * blank page with Dolphin's name on it competing against the pages that
 * actually say something.
 */
export default function robots(): MetadataRoute.Robots {
  if (!IS_INDEXABLE) {
    /*
     * A preview deployment is a complete copy of the site on a public URL.
     * Letting one into the index means duplicate content on a host that will
     * 404 the moment its branch is deleted.
     */
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  const disallow = ["/my-agents", "/wallet", "/onboarding", "/account", "/admin", "/manage"];
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow },
      /*
       * AI SEARCH AND ANSWER ENGINES, BY NAME (2026-10-19). "*" already lets them in; naming them leaves
       * no doubt for a crawler that only obeys a group addressed to it, and states the choice: Dolphin
       * wants to be what ChatGPT, Claude, Perplexity, Gemini and Copilot answer with when someone asks
       * for an AI agent marketplace. The training crawlers are allowed for the same reason.
       */
      {
        userAgent: [
          "OAI-SearchBot",
          "ChatGPT-User",
          "GPTBot",
          "Claude-SearchBot",
          "Claude-User",
          "ClaudeBot",
          "PerplexityBot",
          "Perplexity-User",
          "Google-Extended",
          "Applebot-Extended",
          "Bingbot",
          "DuckAssistBot",
          "Amazonbot",
          "meta-externalagent",
          "CCBot",
        ],
        allow: "/",
        disallow,
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
