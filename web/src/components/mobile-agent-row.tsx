"use client";

import Link from "next/link";
import { AgentIcon } from "@/components/agent-icon";
import { categoryLabel } from "@/constants/agents";
import type { AgentSignals } from "@/hooks/use-agents";
import { track, type AnalyticsSurface } from "@/lib/analytics";
import type { Agent } from "@/types/agent";

// Mirrors the app's AgentRow: the summary is evidence from the batched query.
function summary(signals: AgentSignals | undefined) {
  if (!signals) return "Reading hire history…";
  if (signals.hires === 0) return "No hires yet";
  const hires = `${signals.hires} ${signals.hires === 1 ? "hire" : "hires"}`;
  if (signals.reviews === 0) return hires;
  if (signals.wouldHireAgainRate === null) {
    return `${hires} · ${signals.wouldHireAgain}/${signals.reviews} would hire again`;
  }
  return `${hires} · ${signals.reviews} ${signals.reviews === 1 ? "review" : "reviews"} · ${Math.round(signals.wouldHireAgainRate * 100)}% would hire again`;
}

export function MobileAgentRow({ agent, signals, surface = "search", onOpen }: {
  agent: Agent;
  signals?: AgentSignals;
  surface?: AnalyticsSurface;
  onOpen?: () => void;
}) {
  return (
    <Link
      className="mobile-agent-row"
      href={`/agent/${encodeURIComponent(agent.tokenId ?? (agent.agentKey.includes(":") ? agent.agentKey.split(":").pop()! : agent.agentKey))}`}
      onClick={() => {
        onOpen?.();
        track("agent_card_opened", { agentKey: agent.agentKey, category: agent.category, surface });
      }}
    >
      <AgentIcon category={agent.category} seed={agent.iconSeed} size={56} uri={agent.iconUrl} />
      <div className="mobile-agent-row__copy">
        <h3>{agent.name}</h3>
        <p>{categoryLabel(agent.category)} · {agent.tagline}</p>
        <p className="mobile-agent-row__signals">{summary(signals)}</p>
      </div>
      <span aria-hidden="true" className="mobile-pearl mobile-pearl--small">{agent.protocol === "a2a" ? "Hire" : "View"}</span>
    </Link>
  );
}
