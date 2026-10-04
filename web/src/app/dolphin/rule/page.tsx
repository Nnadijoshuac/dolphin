import type { Metadata } from "next";

import { RulePopout } from "@/app/dolphin/rule/rule-popout";

/**
 * ONE TRADING RULE IN ITS OWN TAB (owner, 2026-10-04: "it deserves its own pop-out... not a new
 * browser - a new tab... if you close that tab, it comes back to where it was"). Opened from the rule
 * view; it beats on the same channel as the popped canvas and agent panel (hooks/use-popout.ts), and
 * the main tab reopens the view when this one closes. `?c=` the build conversation, `?r=` the rule.
 */
export const metadata: Metadata = { title: "Trading rule · Dolphin", robots: { index: false } };

export default async function RulePage({ searchParams }: { searchParams: Promise<{ c?: string; r?: string }> }) {
  const { c, r } = await searchParams;
  return <RulePopout conversationKey={c ?? null} ruleId={r ?? null} />;
}
