import type { Metadata } from "next";

import { ManageClient } from "@/app/manage/[id]/manage-client";

/**
 * Server shell, for metadata only. See app/search/page.tsx.
 *
 * Not indexed: this page is about one wallet's relationship with one agent and
 * renders nothing without a connected wallet. The agent's PUBLIC record lives
 * at /agent/[id] and is the indexable one.
 */
export const metadata: Metadata = {
  title: "Manage agent",
  description:
    "The hire record for this agent: what was paid, what was delivered, and how to end it.",
  robots: { index: false, follow: false },
};

export default async function ManagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ManageClient reference={id} />;
}
