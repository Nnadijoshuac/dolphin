"use client";

import Link from "next/link";

import { AgentIcon } from "@/components/agent-icon";
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

function AgentRecord({
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
      className="pressable-scale group grid gap-5 border-t border-[var(--line)] py-6 no-underline sm:grid-cols-[auto_1fr_auto] sm:items-center"
      href={`/agent/${agent?.tokenId ?? fallbackId}`}
    >
      <AgentIcon category={category} size={60} uri={agent?.iconUrl} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="truncate text-xl font-bold tracking-[-0.03em] text-[var(--ink)]">
            {agent?.name ?? `Agent #${fallbackId}`}
          </h2>
          <StatusBadge label={label} tone={tone} />
        </div>
        <p className="mt-1 text-sm capitalize text-[var(--muted)]">
          {category.replaceAll("-", " ")} / {formatDate(date)}
        </p>
      </div>
      <span className="text-sm font-bold text-[var(--accent-ink)] transition-transform duration-200 group-hover:translate-x-1">
        View record
      </span>
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
        body="Reading this wallet's active hire records and matching catalog entries."
        state="syncing"
        title="Loading your agents"
      />
    );
  }

  if (hires.length === 0 && previews.length === 0) {
    return (
      <div className="border-y border-[var(--line)] py-12">
        <p className="text-2xl font-bold tracking-[-0.04em] text-[var(--ink)]">
          No agents hired yet
        </p>
        <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--muted)]">
          Review identity, evidence, pricing, and permission boundaries before
          adding an agent to this wallet.
        </p>
        <Link
          className="pressable-scale mt-6 inline-flex rounded-xl bg-[var(--ink)] px-5 py-3 text-sm font-bold text-[var(--canvas)] no-underline"
          href="/search"
        >
          Browse agents
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-12">
      {hires.length > 0 && (
        <section aria-labelledby="backend-hires-heading">
          <div className="max-w-2xl">
            <h2
              className="text-2xl font-bold tracking-[-0.04em] text-[var(--ink)]"
              id="backend-hires-heading"
            >
              Backend hire records
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              These are real Dolphin subscription records. They are not
              transactions, wallet sessions, or proof of agent execution.
            </p>
          </div>
          <div className="mt-6 border-b border-[var(--line)]">
            {hires.map((hire) => (
              <AgentRecord
                agent={findAgent(hire.tokenId)}
                date={hire.hiredAt}
                fallbackId={hire.tokenId}
                key={`${hire.tokenId}-${hire.hiredAt}`}
                label="Hired"
                tone="live"
              />
            ))}
          </div>
        </section>
      )}

      {previews.length > 0 && (
        <section aria-labelledby="previews-heading">
          <div className="max-w-2xl">
            <h2
              className="text-2xl font-bold tracking-[-0.04em] text-[var(--ink)]"
              id="previews-heading"
            >
              Device previews
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Saved on this browser only. No payment, authorization, or
              execution transaction was submitted.
            </p>
          </div>
          <div className="mt-6 border-b border-[var(--line)]">
            {previews.map((preview) => (
              <AgentRecord
                agent={findAgent(preview.agentId)}
                date={preview.savedAt}
                fallbackId={preview.agentId}
                key={preview.agentId}
                label="Device preview"
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
    <div className="site-frame py-12 sm:py-16 lg:py-20">
      <div className="reveal-one max-w-3xl">
        <p className="text-xs font-bold tracking-[0.16em] text-[var(--accent-ink)]">
          YOUR CONTROL ROOM
        </p>
        <h1 className="mt-4 text-4xl font-black tracking-[-0.06em] text-[var(--ink)] sm:text-6xl">
          My agents
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-[var(--muted)]">
          See what this wallet hired, what only exists on this device, and what
          has not been activated.
        </p>
      </div>

      <div className="reveal-two mt-12 lg:mt-16">
        {!wallet.isConnected || !wallet.address ? (
          <div className="grid gap-8 border-y border-[var(--line)] py-10 lg:grid-cols-[1fr_360px] lg:items-center">
            <div>
              <h2 className="text-2xl font-bold tracking-[-0.04em] text-[var(--ink)]">
                Connect the hiring wallet
              </h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--muted)]">
                Dolphin reads the public address to find its hire records. It
                requests no signature or spending approval for this view.
              </p>
            </div>
            <WalletConnectButton />
          </div>
        ) : !convexClient ? (
          <StatePanel
            body="NEXT_PUBLIC_CONVEX_URL is unset, so hire records cannot be read."
            state="unavailable"
            title="Backend not configured"
          />
        ) : (
          <ConnectedRecords address={wallet.address} />
        )}
      </div>
    </div>
  );
}
