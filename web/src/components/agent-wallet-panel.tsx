"use client";

import { useQuery as useTanstackQuery } from "@tanstack/react-query";
import { useAction, useQuery } from "convex/react";
import { useState } from "react";
import { createPublicClient, formatEther, http, type Address } from "viem";
import { bsc } from "viem/chains";

import { HoldButton } from "@/components/hold-button";
import { BSC_RPC_URL } from "@/constants/agents";
import { x402Api, type BuiltAgentPublic } from "@/convex/api";
import { toUserMessage } from "@/wallet/wallet-errors";
import { useWalletSession } from "@/wallet/wallet-session";
import { useWallet } from "@/wallet/wallet-provider";

/**
 * THE AGENT'S OWN WALLET, as its builder sees it (option A, 2026-10-02).
 *
 * A paid agent collects its payments itself: its wallet submits each buyer's
 * signed payment and pays that gas. The U goes straight to the builder's
 * payout wallet; this wallet only ever holds BNB for gas, topped up here by
 * the builder, and can only send it back to the builder. Owner only.
 */

/** One payment's gas, generously (120k gas at 0.1 gwei), so the builder sees calls left, not wei. */
const GAS_PER_CALL_WEI = BigInt(12_000_000_000_000); // 0.000012 BNB

const client = createPublicClient({ chain: bsc, transport: http(BSC_RPC_URL) });

export function AgentWalletPanel({ agent }: { agent: BuiltAgentPublic }) {
  const wallet = useWallet();
  const session = useWalletSession();
  const isOwner = Boolean(wallet.address && wallet.address.toLowerCase() === agent.ownerAddress.toLowerCase());
  const eligible = isOwner && agent.status === "registered" && agent.network === "bsc";
  const row = useQuery(x402Api.x402.agentWallet, eligible ? { hash: agent.hash } : "skip");
  const create = useAction(x402Api.x402.createAgentWallet);
  const withdraw = useAction(x402Api.x402.withdrawAgentGas);
  const [state, setState] = useState<"idle" | "busy" | { done: string } | { error: string }>("idle");

  const address = row?.address ?? null;
  const balance = useTanstackQuery({
    queryKey: ["agent-wallet-balance", address],
    enabled: Boolean(address),
    queryFn: () => client.getBalance({ address: address as Address }),
    refetchInterval: 30_000,
  });

  if (!eligible || row === undefined) return null;

  const run = async (job: () => Promise<string>) => {
    if (!session.sessionToken) return setState({ error: "Sign in with your wallet first." });
    setState("busy");
    try {
      setState({ done: await job() });
    } catch (cause) {
      setState({ error: toUserMessage(cause, "That did not go through. Try again.") });
    }
  };

  const wei = balance.data ?? null;
  const callsLeft = wei === null ? null : Number(wei / GAS_PER_CALL_WEI);

  return (
    <div className="surface-raised mt-4 p-5">
      <p className="eyebrow">Your agent&apos;s wallet</p>
      {!address ? (
        <>
          <p className="mt-2 text-[0.86rem] leading-relaxed text-ink-soft">
            Paid calls need the agent to have its own wallet, so it can collect payments while you&apos;re away.
          </p>
          <button
            className="mt-3 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-canvas disabled:opacity-40"
            disabled={state === "busy"}
            onClick={() => void run(async () => (await create({ sessionToken: session.sessionToken as string, hash: agent.hash })).address && "Wallet created.")}
            type="button"
          >
            {state === "busy" ? "Creating…" : "Create its wallet"}
          </button>
        </>
      ) : (
        <>
          <div className="mt-2 flex items-baseline justify-between gap-3">
            <p className="font-mono text-[0.8rem] text-ink">{address}</p>
            <p className="shrink-0 text-[0.86rem] font-semibold text-ink">
              {wei === null ? "…" : `${Number(formatEther(wei)).toLocaleString("en", { maximumFractionDigits: 6 })} BNB`}
            </p>
          </div>
          <p className="mt-1 text-[0.76rem] leading-relaxed text-muted">
            {callsLeft === null
              ? "Reading its balance…"
              : callsLeft === 0
                ? "Empty. Send it a little BNB so it can collect payments; until then paid calls are refused and nobody is charged."
                : `Gas for about ${callsLeft.toLocaleString("en")} paid calls. It only pays gas: every payment goes straight to your payout wallet.`}
          </p>
          <p className="mt-2 text-[0.76rem] leading-relaxed text-muted">
            To top it up, send BNB on BNB Chain to the address above.
          </p>
          {wei !== null && wei > BigInt(0) ? (
            <div className="mt-3 max-w-xs">
              <HoldButton
                backgroundColor="var(--ink)"
                disabled={state === "busy"}
                doneLabel="Withdrawing…"
                fillColor="#2f8a55"
                holdTime={1200}
                onHold={() => void run(async () => `Sent ${formatEther(BigInt((await withdraw({ sessionToken: session.sessionToken as string, hash: agent.hash })).sentWei))} BNB back to your wallet.`)}
                radius={11}
                size="md"
                textColor="var(--paper)"
              >
                Hold to withdraw to my wallet
              </HoldButton>
            </div>
          ) : null}
        </>
      )}
      {typeof state === "object" ? (
        <p className={`mt-2 text-[0.76rem] ${"error" in state ? "text-danger" : "text-ink-soft"}`} role={"error" in state ? "alert" : undefined}>
          {"error" in state ? state.error : state.done}
        </p>
      ) : null}
    </div>
  );
}
