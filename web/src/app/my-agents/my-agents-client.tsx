"use client";

import Link from "next/link";

import { AgentIcon } from "@/components/agent-icon";
import { MobileMenuButton } from "@/components/mobile-nav";
import { CategoryGlyph } from "@/components/category-glyph";
import { JobDeliveryStatus } from "@/components/job-delivery-status";
import { StatePanel } from "@/components/state-panel";
import { agentRouteId, categoryLabel } from "@/constants/agents";
import { useAgentsByKeys } from "@/hooks/use-agents";
import { useHiredAgents } from "@/hooks/use-hired-agents";
import { useMobileLayout } from "@/hooks/use-mobile-layout";
import { convexClient } from "@/providers/convex-provider";
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

function MobileEmptyAgents() {
  return (
    <div className="mobile-empty-agents">
      <span className="mobile-empty-agents__icon"><CategoryGlyph name="agents" size={28} /></span>
      <h2>No agents yet</h2>
      <p>Review an agent’s identity, data availability, authorization model, and payment readiness before hiring.</p>
      <Link className="mobile-pearl" href="/search">Browse agent catalog <CategoryGlyph name="arrow-right" size={18} /></Link>
    </div>
  );
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
      className="mobile-hire-record interactive group block border-t border-line py-5 no-underline first:border-t-0 sm:py-6"
      /*
       * /manage, not /agent. This said "Manage" and pointed at the PUBLIC
       * record, which then offered "Manage in My agents" pointing back here -
       * two controls both labelled Manage, pointing at each other, with no
       * management anywhere between them. /manage/[id] is the screen that
       * actually manages a hire, including ending it.
       */
      href={`/manage/${agentRouteId(agent?.agentKey ?? fallbackId)}`}
    >
      <article className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:gap-5">
        <div className="flex items-start gap-4 sm:contents">
          <AgentIcon category={category} seed={agent?.iconSeed} size={56} uri={agent?.iconUrl} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-faint">
              <span>{categoryLabel(category)}</span>
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
  const isMobile = useMobileLayout();
  const hires = useHiredAgents(address);
  // Only this wallet's own agents, resolved by key. The catalog is paginated
  // now, so an agent hired months ago may simply not be on page one.
  const agentsByKey = useAgentsByKeys((hires ?? []).map((hire) => hire.agentKey));
  const catalogLoading = false;

  // The map is keyed by BOTH agentKey and bare tokenId, so an older stored
  // reference still resolves.
  const findAgent = (reference: string) => agentsByKey.get(reference);

  if (hires === undefined || catalogLoading) {
    return (
      <StatePanel
        body="Reading hire records for this address and matching them to the shared catalog."
        state="syncing"
        title="Loading your agents"
      />
    );
  }

  if (hires.length === 0) {
    if (isMobile) return <MobileEmptyAgents />;
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
              <div key={`${hire.agentKey}-${hire.hiredAt}`}>
                <AgentRecordRow
                  agent={findAgent(hire.agentKey)}
                  date={hire.hiredAt}
                  fallbackId={hire.agentKey}
                  label="Active hire"
                  tone="live"
                />
                {/*
                 * Was HireSessionRow, which listed spending sessions for this
                 * hire. Sessions are gated off in this build
                 * (FEATURE_SESSION_EXECUTION in altana-policy.ts), and what a
                 * hire record actually needs to say is what happened to the
                 * work that was paid for - so this is the delivery state,
                 * read from the ERC-8183 kernel. Renders nothing for a free
                 * hire, which bought nothing and has nothing to report.
                 */}
                <JobDeliveryStatus agentKey={hire.agentKey} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/*
       * THE "DEVICE PREVIEWS" SECTION WAS REMOVED HERE (2026-09-08).
       *
       * It rendered `previewHires` from the Zustand store, and nothing in this
       * entire project ever called `savePreviewHire`. The section could not
       * appear for any user under any circumstance: dead UI, complete with its
       * own heading, count and explanatory copy, for a feature that was never
       * wired up. `hasCompletedOnboarding` was persisted by the same store and
       * read by nothing, for the same reason - there was no onboarding on the
       * website at all until /onboarding was added alongside this change.
       *
       * The store fields go with it; see store/use-app-store.ts.
       */}
    </div>
  );
}

export function MyAgentsClient() {
  const wallet = useWallet();
  const isMobile = useMobileLayout();

  return (
    <div className="mobile-my-agents site-frame page-shell" style={{ paddingBlockStart: "clamp(1.5rem, 4vw, 3rem)" }}>
      <header className="mobile-only mobile-page-heading"><div><h1>My Agents</h1><p>Hired agents and saved setup previews</p></div><MobileMenuButton /></header>
      <div>
        {!wallet.isConnected || !wallet.address ? (
          isMobile ? <MobileEmptyAgents /> :
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
