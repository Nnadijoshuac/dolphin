"use client";

import Link from "next/link";

import { AgentIcon } from "@/components/agent-icon";
import type { Agent, AgentCategory } from "@/types/agent";

const categoryLabels: Record<AgentCategory, string> = {
  monitoring: "Monitoring",
  rebalancing: "Rebalancing",
  "grid-trading": "Grid trading",
  "health-factor": "Health factor",
  yield: "Yield",
};

type AgentCardProps = {
  agent: Agent;
  className?: string;
};

export function AgentCard({ agent, className = "" }: AgentCardProps) {
  return (
    <Link
      className={`pressable-scale group flex min-h-72 flex-col border-t border-[var(--line)] p-6 no-underline hover:bg-[var(--surface-elevated)] sm:p-8 ${className}`}
      href={`/agent/${agent.tokenId}`}
    >
      <div className="flex items-start justify-between gap-5">
        <AgentIcon category={agent.category} size={64} uri={agent.iconUrl} />
        <span className="rounded-full border border-[var(--line)] px-3 py-1.5 text-[11px] font-bold text-[var(--muted)]">
          {categoryLabels[agent.category]}
        </span>
      </div>

      <div className="mt-8 flex-1">
        <h3 className="text-2xl font-bold tracking-[-0.045em] text-[var(--ink)]">
          {agent.name}
        </h3>
        <p className="text-pretty mt-3 max-w-lg text-sm leading-6 text-[var(--muted)]">
          {agent.tagline}
        </p>
      </div>

      <div className="mt-8 flex items-end justify-between gap-5 border-t border-[var(--line-light)] pt-5">
        <div className="min-w-0">
          <p className="text-[10px] font-bold tracking-[0.12em] text-[var(--faint)]">
            PUBLISHER
          </p>
          <p className="mt-1 truncate text-xs font-semibold text-[var(--ink-secondary)]">
            {agent.publisher}
          </p>
        </div>
        <span className="shrink-0 text-sm font-bold text-[var(--accent-ink)] transition-transform duration-200 group-hover:translate-x-1">
          Open evidence
        </span>
      </div>
    </Link>
  );
}
