"use client";

import Link from "next/link";
import { use } from "react";

import { AgentDetail } from "@/components/agent-detail";
import { HireAction } from "@/components/hire-action";
import { StatePanel } from "@/components/state-panel";
import { useAgentDetail } from "@/hooks/use-agents";
import { convexClient } from "@/providers/convex-provider";

export default function AgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: agent, isLoading, isError, error } = useAgentDetail(id);

  if (isLoading) {
    return (
      <div className="site-frame py-20">
        <StatePanel
          body="Reading Dolphin's catalog and re-checking ERC-8004 identity on BNB Smart Chain."
          state="syncing"
          title="Loading the agent dossier"
        />
      </div>
    );
  }

  if (isError || !agent) {
    return (
      <div className="site-frame py-20">
        <StatePanel
          body={
            error instanceof Error
              ? error.message
              : "This agent is not in Dolphin's explicitly classified BSC discovery set."
          }
          state="unavailable"
          title="Agent not found"
        />
        <Link
          className="mt-7 inline-flex text-sm font-bold text-[var(--accent-ink)]"
          href="/search"
        >
          Search the catalog
        </Link>
      </div>
    );
  }

  return (
    <div className="site-frame py-8 sm:py-12 lg:py-16">
      <nav aria-label="Breadcrumb" className="mb-10">
        <Link
          className="text-xs font-bold text-[var(--muted)] no-underline hover:text-[var(--ink)]"
          href="/"
        >
          Discover
        </Link>
        <span className="mx-2 text-[var(--faint)]">/</span>
        <span className="text-xs font-bold capitalize text-[var(--ink)]">
          {agent.category.replaceAll("-", " ")}
        </span>
      </nav>

      <div className="grid min-w-0 gap-14 xl:grid-cols-[minmax(0,1fr)_390px] xl:items-start">
        <AgentDetail agent={agent} />

        <aside aria-label="Hire this agent" className="xl:sticky xl:top-28">
          {convexClient ? (
            <HireAction agent={agent} />
          ) : (
            <div className="rounded-[18px] border border-[var(--line)] bg-[var(--surface)] p-6">
              <StatePanel
                body="NEXT_PUBLIC_CONVEX_URL is unset, so a hire cannot be recorded."
                compact
                state="unavailable"
                title="Backend not configured"
              />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
