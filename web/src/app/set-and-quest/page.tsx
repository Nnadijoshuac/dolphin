import type { Metadata } from "next";

import { SetAndQuestClient } from "@/app/set-and-quest/set-and-quest-client";

export const metadata: Metadata = {
  title: "Set and Quest",
  description:
    "Track the onchain evidence behind your BNB Chain Set and Earn campaign quests.",
  alternates: { canonical: "/set-and-quest" },
};

export default function SetAndQuestPage() {
  return <SetAndQuestClient />;
}
