"use client";

import { useMutation } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { StatusBadge } from "@/components/status-badge";
import { agentHiresApi } from "@/convex/api";
import { useHiredAgents } from "@/hooks/use-hired-agents";
import { assessAuthorizationCapability } from "@/services/authorization";
import type { Agent } from "@/types/agent";
import { WalletConnectButton, useWallet } from "@/wallet/wallet-provider";

function shortAddress(value: string | null) {
  if (!value) return "Not connected";
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
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

  const access = assessAuthorizationCapability(
    agent.category,
    "read_only_hire",
  );
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

  let noticeTitle = "Free to hire";
  let noticeBody =
    "This stores a real read-only hire record. It creates no wallet session, spend cap, signature, or transaction.";

  if (showMyAgents) {
    noticeTitle = "Already hired";
    noticeBody =
      "This wallet has a Dolphin hire record for the agent. That record is not proof of live execution.";
  } else if (!wallet.isConnected) {
    noticeTitle = "Connect a wallet to hire";
    noticeBody =
      "Dolphin needs only the public wallet address. Connecting does not sign or approve anything.";
  } else if (priceModel === null) {
    noticeTitle = "Waiting on Dolphin price policy";
    noticeBody =
      "The hire price has not resolved. The action stays unavailable instead of assuming it is free.";
  } else if (priceBlocksHire) {
    noticeTitle = "Paid hiring is not available";
    noticeBody = `This Dolphin price is ${priceModel.amount} ${priceModel.token}. No verified x402 seller-side payment path is wired into this build.`;
  } else if (state.kind === "error") {
    noticeTitle = "Hire failed";
    noticeBody = state.message;
  }

  return (
    <div className="overflow-hidden rounded-[18px] bg-[var(--dark-card)] text-white shadow-[var(--shadow-floating)]">
      <div className="p-6 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold tracking-[0.14em] text-white/46">
              HIRE REVIEW
            </p>
            <h2 className="mt-3 text-2xl font-black tracking-[-0.045em]">
              Add to My Agents
            </h2>
          </div>
          <StatusBadge label="Read only" tone="live" />
        </div>

        <p className="mt-5 text-sm leading-6 text-white/62">
          {access.reason}
        </p>

        <dl className="mt-7 border-b border-white/12">
          <div className="flex items-start justify-between gap-5 border-t border-white/12 py-4">
            <dt className="text-xs text-white/48">Dolphin hire price</dt>
            <dd className="text-right text-sm font-bold">
              {priceModel === null
                ? "Not resolved"
                : priceIsFree
                  ? "Free"
                  : `${priceModel.amount} ${priceModel.token}`}
            </dd>
          </div>
          <div className="flex items-start justify-between gap-5 border-t border-white/12 py-4">
            <dt className="text-xs text-white/48">Publisher price</dt>
            <dd className="text-right text-sm font-bold">Not published</dd>
          </div>
          <div className="flex items-start justify-between gap-5 border-t border-white/12 py-4">
            <dt className="text-xs text-white/48">Wallet transactions</dt>
            <dd className="text-right text-sm font-bold">
              {access.minimumTransactions}
            </dd>
          </div>
          <div className="flex items-start justify-between gap-5 border-t border-white/12 py-4">
            <dt className="text-xs text-white/48">Public address</dt>
            <dd className="max-w-[190px] truncate text-right font-mono text-xs font-bold">
              {shortAddress(wallet.address)}
            </dd>
          </div>
        </dl>

        <div className="mt-6 border-l-2 border-[#e9b949] pl-4">
          <p className="text-sm font-bold text-white">{noticeTitle}</p>
          <p className="mt-1 text-xs leading-5 text-white/55">{noticeBody}</p>
          {state.kind === "done" && (
            <p className="mt-2 font-mono text-[10px] text-white/38">
              Record {state.id}
            </p>
          )}
        </div>

        <div className="mt-7">
          {showMyAgents ? (
            <Link
              className="pressable-scale flex min-h-12 w-full items-center justify-center rounded-xl bg-[#e9b949] px-5 text-sm font-black text-[#17140c] no-underline hover:bg-[#f0c665]"
              href="/my-agents"
            >
              Open My Agents
            </Link>
          ) : !wallet.isConnected ? (
            <WalletConnectButton connectLabel="Connect wallet to hire" />
          ) : (
            <button
              className="pressable-scale min-h-12 w-full rounded-xl bg-[#e9b949] px-5 text-sm font-black text-[#17140c] hover:bg-[#f0c665] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/38"
              disabled={
                state.kind === "hiring" ||
                priceModel === null ||
                priceBlocksHire
              }
              onClick={() => void onHire()}
              type="button"
            >
              {state.kind === "hiring" ? "Recording hire..." : "Hire for free"}
            </button>
          )}
        </div>

        <p className="mt-5 text-[10px] leading-4 text-white/38">
          Price source: {price.source.label}. ERC-8004 and 8004scan expose no
          publisher price field for Dolphin to read.
        </p>
      </div>
    </div>
  );
}
