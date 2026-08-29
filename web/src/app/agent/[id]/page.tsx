"use client";

import { use } from "react";

import { AgentDetail } from "@/components/agent-detail";
import { StatePanel } from "@/components/state-panel";
import { WalletConnectButton } from "@/wallet/wallet-provider";
import { useAgentDetail } from "@/hooks/use-agents";

/**
 * The agent detail route. AgentCard has always linked to /agent/<tokenId> and
 * this page did not exist, so every card on the site led to a 404 - the
 * AgentDetail component was written and never routed to.
 *
 * It reads useAgentDetail, which is convex/agents.ts's getAgent plus a live
 * on-chain ERC-8004 registry check: the same pipeline the list came from, so a
 * detail page can never disagree with the card that linked to it.
 */
export default function AgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: agent, isLoading, isError, error } = useAgentDetail(id);

  if (isLoading) {
    return (
      <div className="py-16">
        <StatePanel
          title="Loading agent"
          body="Reading the ERC-8004 registry and Dolphin's indexed catalog."
          state="syncing"
        />
      </div>
    );
  }

  if (isError || !agent) {
    return (
      <div className="py-16">
        <StatePanel
          title="Agent not found"
          body={
            error instanceof Error
              ? error.message
              : "This agent is not in Dolphin's explicitly classified BSC discovery set."
          }
          state="unavailable"
        />
      </div>
    );
  }

  return (
    <div className="pb-24">
      <AgentDetail agent={agent} />
      <div className="mt-8">
        <WalletConnectButton connectLabel="Connect wallet to hire" />
      </div>
    </div>
  );
}
