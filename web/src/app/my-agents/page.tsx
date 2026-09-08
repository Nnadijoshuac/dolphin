import type { Metadata } from "next";

import { MyAgentsClient } from "@/app/my-agents/my-agents-client";

/**
 * Server shell, for metadata only. See app/search/page.tsx for the reasoning.
 *
 * NOT INDEXED, and that is not a privacy claim - a hire record is public, keyed
 * by a public address. It is an index-quality one: this page renders nothing at
 * all without a connected wallet, so an indexed copy is a blank page carrying
 * Dolphin's name, competing in search results against the pages that actually
 * say something. robots.ts disallows the path for the same reason.
 */
export const metadata: Metadata = {
  title: "My agents",
  description:
    "The agents this wallet has hired, what was paid for, and what has been delivered.",
  robots: { index: false, follow: false },
};

export default function MyAgentsPage() {
  return <MyAgentsClient />;
}
