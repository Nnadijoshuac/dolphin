import type { Metadata } from "next";

import { RulePopout } from "@/app/dolphin/rule/rule-popout";

/**
 * ONE TRADING RULE IN ITS OWN WINDOW (owner, 2026-10-04: "it deserves its own pop-out... so that it can
 * just monitor it"). Opened from the rule view's pop-out button; the same live view, as a page, for a
 * second screen. `?c=` is the build conversation (as /dolphin's own `?c=`), `?r=` the rule.
 */
export const metadata: Metadata = { title: "Trading rule · Dolphin", robots: { index: false } };

export default async function RulePage({ searchParams }: { searchParams: Promise<{ c?: string; r?: string }> }) {
  const { c, r } = await searchParams;
  return <RulePopout conversationKey={c ?? null} ruleId={r ?? null} />;
}
