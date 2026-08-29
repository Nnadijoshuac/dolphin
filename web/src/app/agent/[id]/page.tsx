"use client";

import Link from "next/link";
import { use } from "react";

import { AgentDetail } from "@/components/agent-detail";
import { ConstellationBg } from "@/components/constellation-bg";
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
      <div className="relative min-h-screen py-20">
        <ConstellationBg opacity={0.3} />
        <div className="site-frame">
          <StatePanel
            body="Reading Dolphin's catalog and re-checking ERC-8004 identity on BNB Smart Chain."
            state="syncing"
            title="Loading Agent Dossier"
          />
        </div>
      </div>
    );
  }

  if (isError || !agent) {
    return (
      <div className="relative min-h-screen py-20">
        <ConstellationBg opacity={0.3} />
        <div className="site-frame">
          <StatePanel
            body={
              error instanceof Error
                ? error.message
                : "This agent was not found in Dolphin's active catalog on BNB Smart Chain."
            }
            state="unavailable"
            title="Agent Record Not Found"
          />
          <div className="mt-6">
            <Link
              className="inline-flex rounded-xl bg-[#F5B300] px-5 py-2.5 text-xs font-black text-[#111214] shadow-sm hover:bg-[#E2A500]"
              href="/search"
            >
              Search Agent Catalog
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen">
      <ConstellationBg opacity={0.35} />
      <AgentDetail agent={agent} />
    </div>
  );
}
