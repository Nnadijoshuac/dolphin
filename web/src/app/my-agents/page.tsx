"use client";

import Link from "next/link";

import { AgentIcon } from "@/components/agent-icon";
import { CategoryGlyph } from "@/components/category-glyph";
import { HireSessionRow } from "@/components/hire-session-row";
import { StatePanel } from "@/components/state-panel";
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
    timeZone: "UTC",
  }).format(new Date(value));
}

function AgentRecordRow({
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
      className="interactive group block border-t border-line py-5 no-underline first:border-t-0 sm:py-6"
      href={`/agent/${agent?.tokenId ?? fallbackId}`}
    >
      <article className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:gap-5">
        <div className="flex items-start gap-4 sm:contents">
          <AgentIcon category={category} size={56} uri={agent?.iconUrl} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-faint">
              <span>{category.replaceAll("-", " ")}</span>
              <span aria-hidden="true">·</span>
              <span>Hired {formatDate(date)}</span>
            </div>
            <h3 className="mt-1 text-lg font-semibold tracking-[-0.03em] text-ink transition-colors group-hover:text-accent-ink sm:text-xl">
              {agent?.name ?? `Agent #${fallbackId}`}
            </h3>
            <span
              className={`mt-2 inline-flex items-center gap-1.5 text-xs font-medium ${
                tone === "live" ? "text-success" : "text-accent-ink"
              }`}
            >
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${
                  tone === "live" ? "bg-success" : "bg-accent"
                }`}
              />
              {label}
            </span>
          </div>
        </div>

        <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
          Manage
          <CategoryGlyph color="currentColor" name="arrow-right" size={16} strokeWidth={2} />
        </span>
      </article>
    </Link>
  );
}

function ConnectedRecords({ address }: { address: string }) {
  const hires = useHiredAgents(address);
  const { data: agents, isLoading: catalogLoading } = useAgents();
  const previews = useAppStore((state) => state.previewHires);

  const findAgent = (reference: string) =>
    agents?.find(
      (candidate) => candidate.tokenId === reference || candidate.id === reference,
    );

  if (hires === undefined || catalogLoading) {
    return (
      <StatePanel
        body="Reading hire records for this address and matching them to the shared catalog."
        state="syncing"
        title="Loading your agents"
      />
    );
  }

  if (hires.length === 0 && previews.length === 0) {
    return (
      <div className="grid gap-6 border-y border-line py-8 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="flex gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-ink">
            <CategoryGlyph color="currentColor" name="bot" size={21} strokeWidth={2} />
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-[-0.035em] text-ink">
              No agents hired yet
            </h2>
            <p className="mt-1 max-w-xl text-sm leading-6 text-muted">
              Inspect a catalog record, review its evidence, and add it to this address.
            </p>
          </div>
        </div>
        <Link
          className="interactive inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-semibold text-ink no-underline hover:bg-accent-hover"
          href="/search"
        >
          Browse agents
          <CategoryGlyph color="currentColor" name="arrow-right" size={15} strokeWidth={2} />
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-14">
      {hires.length > 0 ? (
        <section aria-labelledby="active-hires-heading">
          <div className="flex items-end justify-between gap-4 border-b border-line pb-5">
            <div>
              <p className="eyebrow">Catalog hires</p>
              <h2 className="section-title mt-3" id="active-hires-heading">
                Active records
              </h2>
            </div>
            <span className="text-sm text-muted">{hires.length}</span>
          </div>
          <div>
            {hires.map((hire) => (
              <div key={`${hire.tokenId}-${hire.hiredAt}`}>
                <AgentRecordRow
                  agent={findAgent(hire.tokenId)}
                  date={hire.hiredAt}
                  fallbackId={hire.tokenId}
                  label="Active hire"
                  tone="live"
                />
                <HireSessionRow tokenId={hire.tokenId} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {previews.length > 0 ? (
        <section aria-labelledby="previews-heading">
          <div className="flex items-end justify-between gap-4 border-b border-line pb-5">
            <div>
              <p className="eyebrow">This browser only</p>
              <h2 className="section-title mt-3" id="previews-heading">
                Device previews
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                No on-chain transaction or backend hire record was created.
              </p>
            </div>
            <span className="text-sm text-muted">{previews.length}</span>
          </div>
          <div>
            {previews.map((preview) => (
              <AgentRecordRow
                agent={findAgent(preview.agentId)}
                date={preview.savedAt}
                fallbackId={preview.agentId}
                key={preview.agentId}
                label="Local preview"
                tone="preview"
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export default function MyAgentsPage() {
  const wallet = useWallet();

  return (
    <div className="site-frame page-shell">
      <header className="page-intro">
        <p className="eyebrow">My agents</p>
        <h1 className="display-title mt-5">Every hire, session, and revoke path in one place.</h1>
        <p className="body-copy mt-6 max-w-[58ch]">
          Review agents associated with your connected address and reach any
          attached spending permission without hunting through settings.
        </p>
      </header>

      <div className="mt-12 sm:mt-16">
        {!wallet.isConnected || !wallet.address ? (
          <div className="grid gap-7 border-y border-line py-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-center">
            <div>
              <h2 className="text-2xl font-semibold tracking-[-0.04em] text-ink">
                Connect your identity wallet
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
                Dolphin uses the public address to retrieve its hire records. This
                connection does not grant an agent spending access.
              </p>
            </div>
            <WalletConnectButton />
          </div>
        ) : !convexClient ? (
          <StatePanel
            body="NEXT_PUBLIC_CONVEX_URL is not set, so Dolphin cannot retrieve durable hire records."
            state="unavailable"
            title="Hire records unavailable"
          />
        ) : (
          <ConnectedRecords address={wallet.address} />
        )}
      </div>
    </div>
  );
}
