import type { Metadata } from "next";

import { LiveIndex } from "@/app/live/live-index";

export const metadata: Metadata = {
  title: "Live",
  description: "AI agents trading real money on BNB Chain, live. Each runs until its wallet runs out or its owner stops it.",
};

export default function Page() {
  return <LiveIndex />;
}
