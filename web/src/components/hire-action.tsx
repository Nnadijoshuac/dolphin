"use client";

import { useMutation } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { CategoryGlyph } from "@/components/category-glyph";
import { SessionGrantAction } from "@/components/session-grant-action";
import { agentHiresApi } from "@/convex/api";
import { useHiredAgents } from "@/hooks/use-hired-agents";
import { assessAuthorizationCapability } from "@/services/authorization";
import type { Agent } from "@/types/agent";
import { WalletConnectButton, useWallet } from "@/wallet/wallet-provider";

function shortAddress(value: string | null) {
  if (!value) return "Not connected";
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

export function HireAction({ agent }: { agent: Agent }) {
  const wallet = useWallet();
  const hire = useMutation(agentHiresApi.agentHires.hireReadOnlyAgent);
  const hiredAgents = useHiredAgents(wallet.address);
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "hiring" }
    | { kind: "done"; id: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const access = assessAuthorizationCapability(agent.category, "read_only_hire");
  const price = agent.priceModel;
  const priceModel =
    price.status === "live" || price.status === "stale" ? price.value : null;
  const priceIsFree = priceModel !== null && Number(priceModel.amount) === 0;
  const priceBlocksHire = priceModel !== null && !priceIsFree;
  const alreadyHired =
    hiredAgents?.some((record) => record.tokenId === agent.tokenId) ?? false;
  const showMyAgents = alreadyHired || state.kind === "done";

  async function onHire() {
    if (!wallet.address || !priceModel || !priceIsFree) return;

    setState({ kind: "hiring" });
    try {
      const id = await hire({
        tokenId: agent.tokenId,
        category: agent.category,
        walletAddress: wallet.address,
        priceModel,
      });
      setState({ kind: "done", id: String(id) });
    } catch (cause) {
      setState({
        kind: "error",
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  let noticeTitle = "Read-only hire";
  let noticeBody =
    "This creates a Dolphin hire record. It does not grant an agent permission to spend from either wallet.";

  if (showMyAgents) {
    noticeTitle = "Already in My agents";
    noticeBody = "This connected address already has a hire record for this agent.";
  } else if (!wallet.isConnected) {
    noticeTitle = "Connect an address to continue";
    noticeBody =
      "The browser wallet supplies the public address attached to the hire record. This step does not request spending permission.";
  } else if (priceModel === null) {
    noticeTitle = "Price policy unavailable";
    noticeBody =
      "Dolphin will not assume a price while the catalog value is unresolved.";
  } else if (priceBlocksHire) {
    noticeTitle = "Paid hiring is not configured";
    noticeBody = `This record publishes a price of ${priceModel.amount} ${priceModel.token}, but no seller payment facilitator is configured.`;
  } else if (state.kind === "error") {
    noticeTitle = "Hire failed";
    noticeBody = state.message;
  }

  return (
    <div className="surface-raised p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Hire</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-ink">
            {showMyAgents ? "Agent hired" : "Add this agent"}
          </h2>
        </div>
        <span
          className={`mt-1 inline-flex items-center gap-1.5 text-xs font-medium ${
            showMyAgents ? "text-success" : "text-muted"
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${
              showMyAgents ? "bg-success" : "bg-faint"
            }`}
          />
          {showMyAgents ? "Hired" : "Not hired"}
        </span>
      </div>

      <p className="mt-4 text-sm leading-6 text-muted">{access.reason}</p>

      <dl className="mt-6 border-t border-line text-xs">
        <div className="flex items-start justify-between gap-4 border-b border-line py-3">
          <dt className="text-muted">Dolphin price</dt>
          <dd className="text-right font-medium text-ink">
            {priceModel === null
              ? "Not resolved"
              : priceIsFree
                ? `0 ${priceModel.token}`
                : `${priceModel.amount} ${priceModel.token}`}
          </dd>
        </div>
        <div className="flex items-start justify-between gap-4 border-b border-line py-3">
          <dt className="text-muted">Hire access</dt>
          <dd className="text-right font-medium text-ink">Read-only record</dd>
        </div>
        <div className="flex items-start justify-between gap-4 border-b border-line py-3">
          <dt className="text-muted">Required transactions</dt>
          <dd className="text-right font-medium text-ink">{access.minimumTransactions}</dd>
        </div>
        <div className="flex items-start justify-between gap-4 border-b border-line py-3">
          <dt className="text-muted">Browser wallet</dt>
          <dd className="break-all text-right font-mono font-medium text-ink-soft">
            {shortAddress(wallet.address)}
          </dd>
        </div>
      </dl>

      <div className="mt-5 border-l-2 border-accent pl-4">
        <p className="text-xs font-semibold text-ink">{noticeTitle}</p>
        <p className="mt-1 text-xs leading-5 text-muted">{noticeBody}</p>
        {state.kind === "done" ? (
          <p className="mt-2 font-mono text-[0.68rem] text-success">
            Hire record #{state.id}
          </p>
        ) : null}
      </div>

      <div className="mt-6">
        {showMyAgents ? (
          <Link
            className="interactive flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-line bg-paper px-5 text-sm font-semibold text-ink no-underline hover:bg-canvas"
            href="/my-agents"
          >
            Manage in My agents
            <CategoryGlyph color="currentColor" name="arrow-right" size={16} strokeWidth={2} />
          </Link>
        ) : !wallet.isConnected ? (
          <WalletConnectButton connectLabel="Connect wallet to hire" />
        ) : (
          <button
            className="interactive flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-semibold text-ink hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-paper-muted disabled:text-faint"
            disabled={state.kind === "hiring" || priceModel === null || priceBlocksHire}
            onClick={() => void onHire()}
            type="button"
          >
            {state.kind === "hiring" ? "Adding agent…" : "Hire read-only agent"}
          </button>
        )}
      </div>

      <div className="mt-7 border-t border-line pt-6">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-faint">
          Execution permission · separate step
        </p>
        <SessionGrantAction agent={agent} />
      </div>

      <p className="mt-5 text-center text-[0.68rem] leading-5 text-faint">
        Hiring never grants a spending session automatically.
      </p>
    </div>
  );
}
