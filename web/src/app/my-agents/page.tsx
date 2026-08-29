"use client";

import Link from "next/link";

import { AgentIcon } from "@/components/agent-icon";
import { CategoryGlyph } from "@/components/category-glyph";
import { ConstellationBg } from "@/components/constellation-bg";
import { StatePanel } from "@/components/state-panel";
import { StatusBadge } from "@/components/status-badge";
import { useAgents } from "@/hooks/use-agents";
import { useHiredAgents } from "@/hooks/use-hired-agents";
import { convexClient } from "@/providers/convex-provider";
import { useAppStore } from "@/store/use-app-store";
import type { Agent } from "@/types/agent";
import { WalletConnectButton, useWallet } from "@/wallet/wallet-provider";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function AgentRecordCard({
  agent,
  fallbackId,
  date,
  label,
  tone,
}: {
  agent?: Agent;
  fallbackId: string;
  date: string;
  label: string;
  tone: "live" | "preview";
}) {
  const category = agent?.category ?? "monitoring";

  return (
    <Link
      className="pressable-scale group flex flex-col justify-between rounded-3xl border border-[#ECE8DE] bg-white p-6 no-underline shadow-sm hover:border-[#F5B300]/50 hover:shadow-md sm:flex-row sm:items-center sm:gap-6"
      href={`/agent/${agent?.tokenId ?? fallbackId}`}
    >
      <div className="flex items-center gap-4">
        <AgentIcon category={category} size={64} uri={agent?.iconUrl} />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xl font-black tracking-tight text-[#111214] group-hover:text-[#946B00] transition-colors">
              {agent?.name ?? `Agent #${fallbackId}`}
            </h3>
            <StatusBadge label={label} tone={tone} />
          </div>
          <p className="mt-1 text-xs capitalize text-[#6E706B]">
            {category.replaceAll("-", " ")} • Hired on {formatDate(date)}
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-[#F3F0E8] pt-3 sm:mt-0 sm:border-0 sm:pt-0">
        <span className="flex items-center gap-1 text-xs font-bold text-[#111214] group-hover:text-[#946B00]">
          Manage Agent
          <CategoryGlyph color="currentColor" name="arrow-right" size={13} strokeWidth={2.5} />
        </span>
      </div>
    </Link>
  );
}

function ConnectedRecords({ address }: { address: string }) {
  const hires = useHiredAgents(address);
  const { data: agents, isLoading: catalogLoading } = useAgents();
  const previews = useAppStore((state) => state.previewHires);

  const findAgent = (reference: string) =>
    agents?.find(
      (candidate) =>
        candidate.tokenId === reference || candidate.id === reference,
    );

  if (hires === undefined || catalogLoading) {
    return (
      <StatePanel
        body="Querying active agent subscriptions and matching catalog entries for this wallet."
        state="syncing"
        title="Loading Your Agents"
      />
    );
  }

  if (hires.length === 0 && previews.length === 0) {
    return (
      <div className="rounded-3xl border border-[#ECE8DE] bg-white p-8 text-center sm:p-12 shadow-sm">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-[#F3E3A6] bg-[#FEF5D6]">
          <CategoryGlyph color="#946B00" name="bot" size={32} strokeWidth={2.2} />
        </div>
        <h2 className="mt-6 text-2xl font-black tracking-tight text-[#111214]">
          No Active Agents Hired Yet
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[#6E706B]">
          Explore the Dolphin catalog, inspect real protocol performance, and add an autonomous agent to this wallet.
        </p>
        <div className="mt-6">
          <Link
            className="pressable-scale inline-flex items-center gap-2 rounded-2xl bg-[#F5B300] px-6 py-3 text-xs font-black text-[#111214] shadow-sm hover:bg-[#E2A500]"
            href="/search"
          >
            <CategoryGlyph color="#111214" name="search" size={14} strokeWidth={2.4} />
            Browse Agent Catalog
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {hires.length > 0 && (
        <section aria-labelledby="backend-hires-heading">
          <div>
            <span className="text-[11px] font-black uppercase tracking-wider text-[#946B00]">
              ON-CHAIN SUBSCRIPTIONS
            </span>
            <h2
              className="mt-1 text-2xl font-black tracking-tight text-[#111214]"
              id="backend-hires-heading"
            >
              Active Agent Hires ({hires.length})
            </h2>
            <p className="mt-1 text-xs text-[#6E706B]">
              Real Dolphin subscription records attached to this wallet address on BNB Chain.
            </p>
          </div>
          <div className="mt-6 grid gap-4">
            {hires.map((hire) => (
              <AgentRecordCard
                agent={findAgent(hire.tokenId)}
                date={hire.hiredAt}
                fallbackId={hire.tokenId}
                key={`${hire.tokenId}-${hire.hiredAt}`}
                label="Active"
                tone="live"
              />
            ))}
          </div>
        </section>
      )}

      {previews.length > 0 && (
        <section aria-labelledby="previews-heading">
          <div>
            <span className="text-[11px] font-black uppercase tracking-wider text-[#A5A79F]">
              LOCAL PREVIEWS
            </span>
            <h2
              className="mt-1 text-2xl font-black tracking-tight text-[#111214]"
              id="previews-heading"
            >
              Device Previews ({previews.length})
            </h2>
            <p className="mt-1 text-xs text-[#6E706B]">
              Saved on this browser only. No on-chain transaction was submitted.
            </p>
          </div>
          <div className="mt-6 grid gap-4">
            {previews.map((preview) => (
              <AgentRecordCard
                agent={findAgent(preview.agentId)}
                date={preview.savedAt}
                fallbackId={preview.agentId}
                key={preview.agentId}
                label="Preview"
                tone="preview"
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default function MyAgentsPage() {
  const wallet = useWallet();

  return (
    <div className="relative min-h-screen py-10 sm:py-16">
      <ConstellationBg opacity={0.4} />

      <div className="site-frame">
        {/* Header Title */}
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-[#F3E3A6] bg-[#FEF5D6] px-3.5 py-1 text-xs font-bold text-[#946B00]">
            <CategoryGlyph color="#946B00" name="bot" size={13} strokeWidth={2.4} />
            <span>AGENT CONTROL ROOM</span>
          </div>
          <h1 className="mt-4 text-4xl font-black tracking-tight text-[#111214] sm:text-5xl lg:text-6xl">
            My Hired Agents
          </h1>
          <p className="mt-3 text-base leading-relaxed text-[#6E706B]">
            Manage your active agents, monitor operational statuses, review session boundaries, and inspect live activity logs on BNB Smart Chain.
          </p>
        </div>

        {/* Content Area */}
        <div className="mt-10">
          {!wallet.isConnected || !wallet.address ? (
            <div className="rounded-3xl border border-[#ECE8DE] bg-white p-8 shadow-sm sm:p-10">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-2xl font-black tracking-tight text-[#111214]">
                    Connect Your Wallet to View Hired Agents
                  </h2>
                  <p className="mt-2 max-w-xl text-sm leading-relaxed text-[#6E706B]">
                    Connect your wallet to retrieve your active subscription records on BNB Smart Chain.
                  </p>
                </div>
                <WalletConnectButton />
              </div>
            </div>
          ) : !convexClient ? (
            <StatePanel
              body="NEXT_PUBLIC_CONVEX_URL is not set, so hire records cannot be retrieved."
              state="unavailable"
              title="Backend Not Configured"
            />
          ) : (
            <ConnectedRecords address={wallet.address} />
          )}
        </div>
      </div>
    </div>
  );
}
