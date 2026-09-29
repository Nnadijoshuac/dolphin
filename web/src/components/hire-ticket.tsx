"use client";

import { useAction, useQuery } from "convex/react";
import { useState } from "react";

import { JobDeliveryStatus } from "@/components/job-delivery-status";
import { agentPaymentsApi, api, type AgentQuote, type HireTicket as HireTicketData } from "@/convex/api";
import { useAltanaWallet } from "@/wallet/altana-provider";
import { DELIVERY_RELEASE_NOTE } from "@/wallet/erc8183-policy";
import { toUserMessage } from "@/wallet/wallet-errors";
import { useWallet } from "@/wallet/wallet-provider";

/**
 * A HIRE THE AGENT ASKED FOR (the Hire block, convex/lib/agentBlocks.ts).
 * The agent quoted a price for a task; this is where the owner decides.
 * Paying runs the same steps as Hire on an agent's page - re-quote, convert
 * BNB if needed, fund the ERC-8183 escrow with the passkey, tell the seller -
 * and nothing moves until the passkey says so.
 *
 * What the chain returns is a commitment to the result, not the result
 * (Agent/HANDOFF_BRIEF.md: "the deliverable field is a hash"), so the
 * delivery status says delivered or not, and says no more than that.
 */
export function HireTicket({ ticket }: { ticket: HireTicketData }) {
  const agent = useQuery(api.agents.get, { reference: ticket.agentKey });
  const requestQuote = useAction(agentPaymentsApi.agentPayments.requestQuote);
  const altana = useAltanaWallet();
  const wallet = useWallet();
  const [state, setState] = useState<{ kind: "idle" } | { kind: "busy"; label: string } | { kind: "paid" } | { kind: "error"; message: string }>({
    kind: "idle",
  });

  const pay = async () => {
    if (!agent) return;
    try {
      if (altana.status !== "connected" || !altana.address) {
        throw new Error("Set up your Dolphin Wallet (Wallet page) and fund it with BNB first.");
      }
      let hirer = wallet.address;
      if (!hirer) {
        setState({ kind: "busy", label: "Check your wallet…" });
        hirer = await wallet.connect();
        if (!hirer) return setState({ kind: "idle" });
      }
      setState({ kind: "busy", label: "Getting the price…" });
      const quote = (await requestQuote({ agentKey: ticket.agentKey, taskDescription: ticket.task })) as AgentQuote;
      setState({ kind: "busy", label: "Checking funds…" });
      const input = { agentKey: ticket.agentKey, category: agent.category, quote, hirerWalletAddress: hirer };
      const conversion = await altana.quoteBnbPayment(input);
      setState({ kind: "busy", label: "Confirm with your passkey…" });
      if (conversion) await altana.payForAgentWithBnb({ ...input, maxBnbInWei: conversion.maxBnbWei });
      else await altana.payForAgent(input);
      setState({ kind: "paid" });
    } catch (cause) {
      setState({ kind: "error", message: toUserMessage(cause, "The payment did not finish. Check your Dolphin Wallet's activity before trying again.") });
    }
  };

  return (
    <div className="hire-ticket mt-3">
      <div className="flex items-baseline gap-2">
        <p className="min-w-0 flex-1 truncate text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-muted">
          Hire {ticket.agentName}
        </p>
        {ticket.priceText ? <p className="shrink-0 text-[0.9rem] font-semibold text-ink">{ticket.priceText}</p> : null}
      </div>
      <p className="mt-1.5 text-[0.84rem] leading-relaxed text-ink">{ticket.task}</p>

      {state.kind === "paid" ? (
        <>
          <p className="mt-2 text-[0.74rem] text-success">Paid into escrow. {ticket.agentName} has been told to start.</p>
          <JobDeliveryStatus agentKey={ticket.agentKey} />
        </>
      ) : (
        <>
          <p className="mt-2 text-[0.7rem] leading-snug text-muted">
            Your agent asked for this. Paying funds an escrow from your Dolphin Wallet for this one job, and the price is quoted again
            before you confirm. If the agent doesn&apos;t deliver, the money comes back to you. {DELIVERY_RELEASE_NOTE}
          </p>
          <button
            className="mt-2.5 h-9 w-full rounded-lg bg-ink !text-[12.5px] font-semibold disabled:opacity-40"
            disabled={!agent || state.kind === "busy"}
            onClick={() => void pay()}
            type="button"
          >
            <span className="text-canvas">{state.kind === "busy" ? state.label : agent === null ? "Agent no longer listed" : "Pay and hire"}</span>
          </button>
          {state.kind === "error" ? (
            <p className="mt-2 whitespace-pre-line text-[0.72rem] leading-snug text-danger" role="alert">
              {state.message}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
