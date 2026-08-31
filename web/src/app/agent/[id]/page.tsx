"use client";

import Link from "next/link";
import { use } from "react";

import { AgentDetail } from "@/components/agent-detail";
import { StatePanel } from "@/components/state-panel";
import { useAgentDetail } from "@/hooks/use-agents";

export default function AgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: agent, isLoading, isError, error } = useAgentDetail(id);

  if (isLoading) {
    return (
      <div className="site-frame page-shell">
        <div className="max-w-3xl">
          <StatePanel
            body="Reading the shared catalog and checking the ERC-8004 identity on BNB Smart Chain."
            state="syncing"
            title="Loading agent record"
          />
        </div>
      </div>
    );
  }

  if (isError || !agent) {
    return (
      <div className="site-frame page-shell">
        <div className="max-w-3xl">
          <StatePanel
            body={
              error instanceof Error
                ? error.message
                : "This agent was not found in Dolphin's active catalog on BNB Smart Chain."
            }
            state="unavailable"
            title="Agent record not found"
          />
          <div className="mt-5">
            <Link
              className="interactive inline-flex min-h-11 items-center rounded-xl bg-accent px-5 text-sm font-semibold text-ink no-underline hover:bg-accent-hover"
              href="/search"
            >
              Search the catalog
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <AgentDetail agent={agent} />;
}
