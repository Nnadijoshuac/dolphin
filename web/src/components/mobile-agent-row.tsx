"use client";

import Link from "next/link";
import { AgentIcon } from "@/components/agent-icon";
import { categoryLabel } from "@/constants/agents";
import type { AgentSignals } from "@/hooks/use-agents";
import { useNow } from "@/hooks/use-now";
import { track, type AnalyticsSurface } from "@/lib/analytics";
import type { Agent } from "@/types/agent";

/**
 * "Answered 4m ago", from the probe timestamp. Mirrors SignalStrip's helper —
 * see the note there for why this is the one signal every listed agent has.
 */
function answered(verifiedAt: string | null | undefined, now: number): string | null {
  if (!verifiedAt || now === 0) return null;
  const at = new Date(verifiedAt).getTime();
  if (Number.isNaN(at)) return null;
  const seconds = Math.round((now - at) / 1000);
  if (seconds < 0) return null;
  if (seconds < 90) return "Answered just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Answered ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Answered ${hours}h ago`;
  return `Answered ${Math.round(hours / 24)}d ago`;
}

/**
 * Mirrors the app's AgentRow: the summary is evidence from the batched query.
 *
 * ===========================================================================
 * "No hires yet" WAS THE MOST COMMON LINE IN THE PRODUCT (2026-09-12)
 * ===========================================================================
 * Almost no agent in this catalog has a hire, so nearly every row on the phone
 * browse surface rendered that sentence. It is true and it reads as a verdict
 * — and it is worse than the blank desktop card the same day's SignalStrip fix
 * addressed, because a blank space is ambiguous and this is a statement.
 *
 * The fix is the same one: show a DIFFERENT true thing rather than invent
 * evidence. Every listed agent has answered a probe, because answering is what
 * listing means, so the probe timestamp is real for every row and never zero.
 * Hires and reviews still win when they exist — earned evidence outranks
 * liveness — and this fills the silence underneath them.
 */
function summary(signals: AgentSignals | undefined, verifiedAt: string | null | undefined, now: number) {
  const liveness = answered(verifiedAt, now);
  if (!signals) return liveness ?? "Reading hire history…";
  if (signals.hires === 0) return liveness ?? "No hires yet";
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
  /* Server snapshot is 0, so the age is omitted until the client knows the
     time rather than hydrating a mismatch. See use-now.ts. */
  const now = useNow();

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
        <p className="mobile-agent-row__signals">{summary(signals, agent.verifiedAt, now)}</p>
      </div>
      <span aria-hidden="true" className="mobile-pearl mobile-pearl--small">{agent.protocol === "a2a" ? "Hire" : "View"}</span>
    </Link>
  );
}
