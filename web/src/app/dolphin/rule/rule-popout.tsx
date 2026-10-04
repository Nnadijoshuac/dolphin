"use client";

import { useQuery } from "convex/react";
import { useEffect } from "react";

import { RuleView } from "@/components/rule-view";
import { strategyApi } from "@/convex/api";
import { usePopoutBeat } from "@/hooks/use-popout";

const stay = () => undefined;

export function RulePopout({ conversationKey, ruleId }: { conversationKey: string | null; ruleId: string | null }) {
  const view = useQuery(strategyApi.strategy.forConversation, conversationKey ? { conversationKey } : "skip");
  const rule = view?.rules.find((candidate) => candidate.id === ruleId) ?? null;
  // The heartbeat the main tab listens for: when this tab closes, the view goes back where it was.
  usePopoutBeat(ruleId ? `rule:${ruleId}` : null, conversationKey, stay);
  useEffect(() => {
    if (rule) document.title = `${rule.market} ${rule.timeframe} · Trading rule`;
  }, [rule]);

  if (!conversationKey || !ruleId) return <p className="px-6 py-16 text-center text-[0.86rem] text-muted">This link is missing its rule.</p>;
  if (view === undefined) return <p className="px-6 py-16 text-center text-[0.86rem] text-muted">Loading the rule…</p>;
  if (!rule) return <p className="px-6 py-16 text-center text-[0.86rem] text-muted">That rule is no longer in this agent.</p>;
  return (
    <main className="px-4 py-6">
      <RuleView
        conversationKey={conversationKey}
        onClose={() => window.close()}
        rule={rule}
        standalone
        trades={view?.trades.filter((trade) => trade.ruleId === rule.id) ?? []}
      />
    </main>
  );
}
