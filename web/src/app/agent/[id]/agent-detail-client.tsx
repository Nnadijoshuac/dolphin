"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import { AgentDetail } from "@/components/agent-detail";
import {
  CatalogUnavailable,
  useBackendStatus,
  useReportBackendStatus,
} from "@/components/backend-status";
import { StatePanel } from "@/components/state-panel";
import { useAgentDetail } from "@/hooks/use-agents";
import { track } from "@/lib/analytics";
import type { Agent } from "@/types/agent";

/**
 * The live half of an agent page.
 *
 * The SERVER half (page.tsx beside this file) owns the record's identity: the
 * title, the description, the canonical URL, the OpenGraph card and the JSON-LD.
 * This owns everything that changes while someone is looking at it - the Convex
 * subscription, the on-chain registry check, the hire state, the reviews.
 *
 * ===========================================================================
 * "NOT FOUND" AND "CANNOT REACH THE CATALOG" ARE DIFFERENT ANSWERS
 * ===========================================================================
 * The version this replaced collapsed them:
 *
 *     if (isError || !agent) -> "Agent record not found"
 *
 * `agent` is undefined while loading, undefined forever if the socket never
 * opens, and null only when the backend actually answered "no such agent". So a
 * Convex outage rendered "This agent was not found in Dolphin's active catalog"
 * over a live, registered agent - telling the user a fact about the registry
 * that Dolphin was in no position to know.
 *
 * `useAgentDetail` already distinguished these: it exposes `notFound` for the
 * null case specifically, and the old code ignored it.
 */
export function AgentDetailClient({
  reference,
  initialAgent = null,
}: {
  reference: string;
  /**
   * THE RECORD THE SERVER ALREADY READ. (2026-09-12)
   *
   * page.tsx calls `fetchAgent(id)` to build the title, the description, the
   * OpenGraph card and the JSON-LD - so it holds the name, category, publisher
   * and tagline before a byte of this component runs. It then threw all of it
   * away and handed this component a bare `reference`, so the first thing a
   * visitor saw on the most linkable page in the product was a panel reading
   * "Syncing - Loading agent record".
   *
   * Passing it through is safe against the rule the header comment on page.tsx
   * sets out - identity on the server, live values on the client - because the
   * live values do not come from this object. `LiveStats` reads
   * `useAgentCategoryStats` and falls back to `syncingLiveStats(...)` until
   * that resolves, so every metric renders as explicitly syncing during the
   * server-snapshot paint rather than as a server-timestamped number. The hire
   * state, the registry check and the reviews each subscribe for themselves.
   *
   * What the visitor gets immediately is what the server actually knew: who
   * this agent is. What still waits is everything that can change.
   */
  initialAgent?: Agent | null;
}) {
  const { data: live, isLoading, notFound } = useAgentDetail(reference);
  const backend = useBackendStatus();
  useReportBackendStatus(backend, "agent");

  /*
   * The subscription wins the moment it arrives. `initialAgent` is a snapshot
   * taken at request time and is only ever the opening frame.
   *
   * `notFound` discards it outright: the backend answering "no such agent" is a
   * later and better-informed answer than a snapshot taken seconds earlier, and
   * holding a de-listed record on screen because the server had once seen it
   * would be the same conflation of "gone" and "not loaded" that the note above
   * exists to prevent, running in the other direction.
   */
  const agent = live ?? (notFound ? undefined : (initialAgent ?? undefined));

  const isUnavailable =
    backend.kind === "unreachable" || backend.kind === "unconfigured";

  /* One view event per agent, after the record has actually resolved. */
  const reported = useRef<string | null>(null);
  useEffect(() => {
    if (!agent || reported.current === agent.agentKey) return;
    reported.current = agent.agentKey;

    track("agent_viewed", {
      agentKey: agent.agentKey,
      category: agent.category,
      hasLiveStats: Boolean(agent.hasLiveStats),
      hasPerformanceSeries: (agent.performanceSeries?.length ?? 0) > 1,
    });
  }, [agent]);

  if (agent) return <AgentDetail agent={agent} />;

  /*
   * Order matters. The backend being unreachable is checked BEFORE "not found",
   * because a page that cannot reach the catalog knows nothing about whether
   * this agent exists.
   */
  if (isUnavailable) {
    return (
      <div className="site-frame page-shell">
        <div className="max-w-3xl">
          <CatalogUnavailable
            status={
              backend as Extract<
                typeof backend,
                { kind: "unreachable" | "unconfigured" }
              >
            }
            title="Agent record unavailable"
          />
          <div className="mt-5">
            <Link
              className="interactive inline-flex min-h-11 items-center rounded-xl border border-line bg-paper px-5 text-sm font-semibold text-ink no-underline hover:bg-canvas"
              href="/search"
            >
              Search the catalog
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="site-frame page-shell">
        <div className="max-w-3xl">
          <StatePanel
            body="The catalog answered, and has no record with this identifier. It may have been de-listed, or the link may be wrong."
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

  /* Still loading. `isLoading` is referenced so the branch is explicit. */
  void isLoading;
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
