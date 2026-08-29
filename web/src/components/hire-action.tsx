"use client";

import { useMutation } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { CategoryGlyph } from "@/components/category-glyph";
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

  let noticeTitle = "Free to Hire";
  let noticeBody =
    "Stores a verified Dolphin read-only hire record. Creates no unrestricted spend authorization or custodial key transfer.";

  if (showMyAgents) {
    noticeTitle = "Already Hired";
    noticeBody =
      "This wallet already holds a subscription record for this agent. Manage or review your active agents anytime.";
  } else if (!wallet.isConnected) {
    noticeTitle = "Connect Wallet to Hire";
    noticeBody =
      "Dolphin only requests the public wallet address. Connecting does not sign away any assets or permissions.";
  } else if (priceModel === null) {
    noticeTitle = "Awaiting Price Policy";
    noticeBody =
      "The hire price has not resolved. Fails closed instead of assuming an unverified rate.";
  } else if (priceBlocksHire) {
    noticeTitle = "Paid Hiring Not Available";
    noticeBody = `This agent price is ${priceModel.amount} ${priceModel.token}. No x402 seller payment facilitator is configured for this record.`;
  } else if (state.kind === "error") {
    noticeTitle = "Hire Failed";
    noticeBody = state.message;
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-[#ECE8DE] bg-white p-6 shadow-md sm:p-8">
      {/* Top Title & Badge */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="text-[11px] font-black uppercase tracking-wider text-[#946B00]">
            HIRE & ACTIVATE
          </span>
          <h2 className="mt-1 text-2xl font-black tracking-tight text-[#111214]">
            {showMyAgents ? "Agent Activated" : "Hire This Agent"}
          </h2>
        </div>
        <StatusBadge label="Read Only" tone="live" />
      </div>

      <p className="mt-4 text-xs leading-relaxed text-[#6E706B]">
        {access.reason}
      </p>

      {/* Pricing & Permission Details List */}
      <dl className="mt-6 divide-y divide-[#F3F0E8] border-y border-[#ECE8DE] text-xs">
        <div className="flex items-center justify-between py-3">
          <dt className="font-semibold text-[#6E706B]">Dolphin Hire Price</dt>
          <dd className="font-bold text-[#111214]">
            {priceModel === null
              ? "Not resolved"
              : priceIsFree
                ? "Free (0 BNB)"
                : `${priceModel.amount} ${priceModel.token}`}
          </dd>
        </div>
        <div className="flex items-center justify-between py-3">
          <dt className="font-semibold text-[#6E706B]">Custody & Keys</dt>
          <dd className="font-bold text-[#1C6A44]">
            100% Non-Custodial
          </dd>
        </div>
        <div className="flex items-center justify-between py-3">
          <dt className="font-semibold text-[#6E706B]">Required Transactions</dt>
          <dd className="font-bold text-[#111214]">
            {access.minimumTransactions}
          </dd>
        </div>
        <div className="flex items-center justify-between py-3">
          <dt className="font-semibold text-[#6E706B]">Connected Wallet</dt>
          <dd className="font-mono font-bold text-[#303236]">
            {shortAddress(wallet.address)}
          </dd>
        </div>
      </dl>

      {/* Notice Banner */}
      <div className="mt-6 rounded-2xl border border-[#F3E3A6] bg-[#FEF5D6] p-4 text-left">
        <div className="flex items-center gap-2">
          <CategoryGlyph color="#946B00" name="shield" size={15} strokeWidth={2.5} />
          <p className="text-xs font-black text-[#946B00]">{noticeTitle}</p>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-[#6E706B]">{noticeBody}</p>
        {state.kind === "done" && (
          <p className="mt-2 font-mono text-[10px] font-bold text-[#1C6A44]">
            Subscription Record: #{state.id}
          </p>
        )}
      </div>

      {/* Main Action Button */}
      <div className="mt-6">
        {showMyAgents ? (
          <Link
            className="pressable-scale flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-[#111214] px-5 text-sm font-black text-white no-underline shadow-sm hover:bg-[#303236]"
            href="/my-agents"
          >
            <CategoryGlyph color="#F5B300" name="bot" size={16} strokeWidth={2.4} />
            Manage in My Agents
          </Link>
        ) : !wallet.isConnected ? (
          <WalletConnectButton connectLabel="Connect Wallet to Hire" />
        ) : (
          <button
            className="pressable-scale flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-[#F5B300] px-5 text-sm font-black text-[#111214] shadow-sm hover:bg-[#E2A500] disabled:cursor-not-allowed disabled:bg-[#F5F3EB] disabled:text-[#A5A79F]"
            disabled={
              state.kind === "hiring" ||
              priceModel === null ||
              priceBlocksHire
            }
            onClick={() => void onHire()}
            type="button"
          >
            <CategoryGlyph color="#111214" name="sparkle" size={15} strokeWidth={2.4} />
            {state.kind === "hiring" ? "Recording Hire..." : "Hire Agent for Free"}
          </button>
        )}
      </div>

      <p className="mt-4 text-center text-[10px] text-[#A5A79F]">
        Price Source: {price.source.label}. Real ERC-8004 read on BSC.
      </p>
    </div>
  );
}
