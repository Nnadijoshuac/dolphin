import type { Metadata } from "next";

import { OnboardingClient } from "@/app/onboarding/onboarding-client";

/**
 * Server shell, for metadata only. See app/search/page.tsx.
 *
 * Not indexed: it explains the product to someone already on it, and an
 * explainer competing in search results against the catalog itself would be
 * the wrong page winning.
 */
export const metadata: Metadata = {
  title: "How Dolphin works",
  description:
    "What an onchain agent is, what Dolphin will and will not tell you about one, and what happens when you hire it.",
  robots: { index: false, follow: true },
};

export default function OnboardingPage() {
  return <OnboardingClient />;
}
