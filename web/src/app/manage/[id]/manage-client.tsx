"use client";

import Link from "next/link";
import { useMutation } from "convex/react";
import { useState } from "react";

import { AgentIcon } from "@/components/agent-icon";
import { CategoryGlyph } from "@/components/category-glyph";
import { JobDeliveryStatus } from "@/components/job-delivery-status";
import { StatePanel } from "@/components/state-panel";
import { TrackRecord } from "@/components/track-record";
import { categoryLabel } from "@/constants/agents";
import { agentHiresApi } from "@/convex/api";
import { useAgent } from "@/hooks/use-agents";
import { useHiredAgents } from "@/hooks/use-hired-agents";
import { track } from "@/lib/analytics";
import { convexClient } from "@/providers/convex-provider";
import { toUserMessage } from "@/wallet/wallet-errors";
import { WalletConnectButton, useWallet } from "@/wallet/wallet-provider";
import { useWalletSession } from "@/wallet/wallet-session";

/**
 * ===========================================================================
 * THE EXIT. THERE WAS NONE. (2026-09-08)
 * ===========================================================================
 *
 * WHAT THE WEBSITE DID BEFORE THIS ROUTE EXISTED:
 *
 *   /my-agents rendered a row per hire with a "Manage →" affordance pointing at
 *   /agent/[id]. There was no /manage route, so that link went to the public
 *   record - which, for an agent you have already hired, renders "Manage in My
 *   agents" pointing back at /my-agents. Two controls, both labelled Manage,
 *   pointing at each other, and no management anywhere between them.
 *
 *   `cancelHire` was DECLARED in src/convex/api.ts and called from nowhere. On
 *   the website, a hire was permanent. The mobile app fixed this on 2026-09-06;
 *   the website did not, which is exactly the one-directional drift the
 *   two-frontends decision record describes.
 *
 * This is that missing screen: what the hire is, what was paid, what was
 * delivered, how it has been reviewed, and how to end it.
 *
 * ===========================================================================
 * WHAT CANCELLING DOES NOT DO, SAID BEFORE IT IS PRESSED
 * ===========================================================================
 * `cancelHire` ends the SUBSCRIPTION ROW. It does not refund or alter an
 * ERC-8183 escrow: that money is on-chain and Convex has no authority over it,
 * which is why a cancelled paid hire keeps its `paymentJobId`. Saying so in the
 * confirmation is not legal boilerplate - it is the difference between a user
 * cancelling to tidy their list and a user cancelling because they believe it
 * will get their money back.
 */
export function ManageClient({ reference }: { reference: string }) {
  const wallet = useWallet();

  if (!convexClient) {
    return (
      <div className="site-frame page-shell">
        <StatePanel
          body="NEXT_PUBLIC_CONVEX_URL is not set, so Dolphin cannot read hire records."
          state="unavailable"
          title="Hire records unavailable"
        />
      </div>
    );
  }

  if (!wallet.isConnected || !wallet.address) {
    return (
      <div className="site-frame page-shell">
        <div className="grid gap-7 border-y border-line py-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-center">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.04em] text-ink">
              Connect the wallet that hired this agent
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
              A hire record belongs to an address. Dolphin reads the public
              address to find it; connecting grants no spending access.
            </p>
          </div>
          <WalletConnectButton />
        </div>
      </div>
    );
  }

  return <ConnectedManage address={wallet.address} reference={reference} />;
}

function ConnectedManage({
  address,
  reference,
}: {
  address: string;
  reference: string;
}) {
  const { data: agent, notFound } = useAgent(reference, { verifyOnChain: false });
  const hires = useHiredAgents(address);
  const session = useWalletSession();
  const cancelHire = useMutation(agentHiresApi.agentHires.cancelHire);

  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "confirming" }
    | { kind: "cancelling" }
    | { kind: "cancelled" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  if (agent === undefined && !notFound) {
    return (
      <div className="site-frame page-shell">
        <StatePanel
          body="Reading the catalog record and matching it to this wallet's hires."
          state="syncing"
          title="Loading hire"
        />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="site-frame page-shell">
        <StatePanel
          body="The catalog has no record with this identifier, so there is nothing to manage."
          state="unavailable"
          title="Agent not found"
        />
      </div>
    );
  }

  const hire = hires?.find((record) => record.agentKey === agent.agentKey);

  async function runCancel() {
    if (!agent) return;
    setState({ kind: "cancelling" });
    try {
      /*
       * Signs in if needed rather than sending the user to a different screen
       * to do it. Same one-action principle as HireAction: the button says what
       * it does and does all of it. `signIn` returns the token directly because
       * `session.sessionToken` is still null in this closure until React
       * re-renders.
       */
      let token = session.sessionToken;
      if (!token) {
        token = await session.signIn(address);
        if (!token) {
          setState({ kind: "idle" });
          return;
        }
      }

      await cancelHire({ agentKey: agent.agentKey, sessionToken: token });
      setState({ kind: "cancelled" });
      track("hire_cancelled", { agentKey: agent.agentKey });
    } catch (cause) {
      setState({
        kind: "error",
        message: toUserMessage(
          cause,
          "The hire could not be cancelled. Nothing has changed.",
        ),
      });
    }
  }

  const isCancelled = state.kind === "cancelled" || hire?.status === "cancelled";

  return (
    <div className="site-frame page-shell">
      <nav
        aria-label="Breadcrumb"
        className="flex flex-wrap items-center gap-2 text-xs text-muted"
      >
        <Link className="interactive hover:text-ink" href="/my-agents">
          My agents
        </Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page" className="text-ink">
          {agent.name}
        </span>
      </nav>

      <header className="border-b border-line pb-8 pt-6">
        <div className="flex flex-wrap items-start gap-5">
          <AgentIcon category={agent.category} seed={agent.iconSeed} size={64} uri={agent.iconUrl} />
          <div className="min-w-0 flex-1">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-faint">
              {categoryLabel(agent.category)} · ERC-8004 #{agent.tokenId}
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-[-0.045em] text-ink">
              {agent.name}
            </h1>
            {hire ? (
              <p className="mt-2 text-sm text-muted">
                <span
                  aria-hidden="true"
                  className={`mr-2 inline-block h-2 w-2 rounded-full ${
                    isCancelled ? "bg-faint-mark" : "bg-success"
                  }`}
                />
                {isCancelled ? "Cancelled" : "Active hire"} ·{" "}
                {new Date(hire.hiredAt).toLocaleDateString("en", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  timeZone: "UTC",
                })}
                {hire.paymentJobId ? " · paid" : " · free"}
              </p>
            ) : null}
          </div>
          <Link
            className="interactive inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-paper px-4 text-sm font-semibold text-ink no-underline hover:bg-canvas"
            href={`/agent/${agent.tokenId}`}
          >
            Open public record
            <CategoryGlyph color="currentColor" name="arrow-right" size={15} strokeWidth={2} />
          </Link>
        </div>
      </header>

      {!hire ? (
        <div className="py-8">
          <StatePanel
            body="This wallet has no hire record for this agent. If you hired it with a different address, connect that one."
            state="empty"
            title="Not hired by this wallet"
          />
        </div>
      ) : (
        <>
          {/* What happened to the work that was paid for. Renders nothing when free. */}
          <section className="border-b border-line py-8">
            <JobDeliveryStatus agentKey={agent.agentKey} />
          </section>

          <section className="border-b border-line py-8">
            <h2 className="text-lg font-semibold tracking-[-0.03em] text-ink">
              Track record
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
              You have hired this agent, so you can review it once the hire is a
              day old. A cancelled hire still qualifies — someone who tried an
              agent and stopped has the most useful thing to say about it.
            </p>
            <div className="mt-6">
              <TrackRecord agentKey={agent.agentKey} agentName={agent.name} />
            </div>
          </section>

          <section className="py-8">
            <h2 className="text-lg font-semibold tracking-[-0.03em] text-ink">
              End this hire
            </h2>

            {isCancelled ? (
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
                This hire is cancelled. It stays in your history, and you can
                still review the agent — Dolphin does not remove the record,
                because the record is what makes the review verifiable.
              </p>
            ) : (
              <>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
                  Cancelling removes this agent from your active list and stops
                  it counting toward the agent&rsquo;s retention.
                </p>
                {/*
                 * The refund question, answered before the button rather than
                 * after. This is the sentence that stops someone cancelling in
                 * the belief that it reverses a payment.
                 */}
                {hire.paymentJobId ? (
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-danger">
                    This hire was paid for through an ERC-8183 escrow on BNB
                    Smart Chain. Cancelling here does <strong>not</strong> refund
                    it and does not alter the escrow — that money is on-chain and
                    Dolphin has no authority over it.
                  </p>
                ) : null}

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  {state.kind === "confirming" ? (
                    <>
                      <button
                        aria-busy={false}
                        className="interactive min-h-11 rounded-xl bg-danger px-5 text-sm font-semibold text-paper hover:opacity-90"
                        onClick={() => void runCancel()}
                        type="button"
                      >
                        Yes, cancel this hire
                      </button>
                      <button
                        className="interactive min-h-11 rounded-xl border border-line bg-paper px-5 text-sm font-semibold text-ink hover:bg-canvas"
                        onClick={() => setState({ kind: "idle" })}
                        type="button"
                      >
                        Keep it
                      </button>
                    </>
                  ) : (
                    <button
                      aria-busy={state.kind === "cancelling"}
                      className="interactive min-h-11 rounded-xl border border-line bg-paper px-5 text-sm font-semibold text-danger hover:bg-danger-soft disabled:cursor-wait disabled:opacity-60"
                      disabled={state.kind === "cancelling"}
                      onClick={() => setState({ kind: "confirming" })}
                      type="button"
                    >
                      {state.kind === "cancelling"
                        ? "Cancelling…"
                        : "Cancel hire"}
                    </button>
                  )}
                </div>
              </>
            )}

            {state.kind === "error" ? (
              <p className="mt-3 text-xs leading-5 text-danger" role="alert">
                {state.message}
              </p>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
