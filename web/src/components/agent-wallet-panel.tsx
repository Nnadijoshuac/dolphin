"use client";

import { useQuery as useTanstackQuery } from "@tanstack/react-query";
import { useAction, useQuery } from "convex/react";
import { useState } from "react";
import { createPublicClient, formatEther, formatUnits, getAddress, http, parseAbi, type Address } from "viem";
import { bsc } from "viem/chains";
import { switchChain, waitForTransactionReceipt, writeContract } from "wagmi/actions";

import { HoldButton } from "@/components/hold-button";
import { BSC_RPC_URL } from "@/constants/agents";
import { x402Api, type BuiltAgentPublic } from "@/convex/api";
import { toUserMessage } from "@/wallet/wallet-errors";
import { useWalletSession } from "@/wallet/wallet-session";
import { useWallet, wagmiConfig } from "@/wallet/wallet-provider";

/**
 * THE AGENT'S OWN WALLET, as its builder sees it (option A, 2026-10-02).
 *
 * A paid agent collects its payments itself:
 *   - x402: its wallet submits each buyer's signed payment and pays that gas;
 *     the U goes straight to the builder's payout wallet.
 *   - escrow (A2A agents): it delivers and collects, then forwards every
 *     payout to the builder. Escrow buyers pay the wallet the agent's on-chain
 *     identity names, so the owner links this wallet once.
 * It only ever holds BNB for gas, topped up here, and can only send that back
 * to the builder. Owner only.
 */

/** One payment's gas, generously (120k gas at 0.1 gwei), so the builder sees calls left, not wei. */
const GAS_PER_CALL_WEI = BigInt(12_000_000_000_000); // 0.000012 BNB

const client = createPublicClient({ chain: bsc, transport: http(BSC_RPC_URL) });

const REGISTRY_ABI = parseAbi([
  "function getAgentWallet(uint256 agentId) view returns (address)",
  "function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes signature)",
]);

const JOB_WORDS = {
  accepted: "Working on it",
  submitted: "Delivered · paid after the dispute window",
  settled: "Paid · sending to you",
  forwarded: "Paid to your payout wallet",
  failed: "Not completed · the buyer is refunded",
} as const;

type State = "idle" | "busy" | { done: string } | { error: string };

export function AgentWalletPanel({ agent }: { agent: BuiltAgentPublic }) {
  const wallet = useWallet();
  const session = useWalletSession();
  const isOwner = Boolean(wallet.address && wallet.address.toLowerCase() === agent.ownerAddress.toLowerCase());
  const eligible = isOwner && agent.status === "registered" && agent.network === "bsc";
  const escrow = agent.protocol === "a2a" && Boolean(agent.priceRaw);

  const row = useQuery(x402Api.x402.agentWallet, eligible ? { hash: agent.hash } : "skip");
  const jobs = useQuery(x402Api.erc8183Seller.jobsForAgent, eligible && escrow ? { hash: agent.hash } : "skip");
  const create = useAction(x402Api.x402.createAgentWallet);
  const withdraw = useAction(x402Api.x402.withdrawAgentGas);
  const linkProof = useAction(x402Api.erc8183Seller.walletLinkProof);
  const [state, setState] = useState<State>("idle");

  const address = row?.address ?? null;
  const balance = useTanstackQuery({
    queryKey: ["agent-wallet-balance", address],
    enabled: Boolean(address),
    queryFn: () => client.getBalance({ address: address as Address }),
    refetchInterval: 30_000,
  });
  /* Who escrow buyers pay: the address the agent's on-chain identity names. Read, not assumed. */
  const named = useTanstackQuery({
    queryKey: ["agent-identity-wallet", agent.registry, agent.tokenId],
    enabled: eligible && escrow && Boolean(agent.tokenId),
    queryFn: () =>
      client.readContract({ address: agent.registry as Address, abi: REGISTRY_ABI, functionName: "getAgentWallet", args: [BigInt(agent.tokenId as string)] }),
  });

  if (!eligible || row === undefined) return null;

  const token = session.sessionToken;
  const run = async (job: (sessionToken: string) => Promise<string>) => {
    if (!token) return setState({ error: "Sign in with your wallet first." });
    setState("busy");
    try {
      setState({ done: await job(token) });
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : "";
      setState({
        error: /user (rejected|denied)|rejected the request/i.test(text) ? "You cancelled. Nothing changed." : toUserMessage(cause, "That did not go through. Try again."),
      });
    }
  };

  const link = (sessionToken: string) => async () => {
    const proof = await linkProof({ sessionToken, hash: agent.hash });
    await switchChain(wagmiConfig, { chainId: bsc.id });
    const tx = await writeContract(wagmiConfig, {
      chainId: bsc.id,
      address: proof.registry as Address,
      abi: REGISTRY_ABI,
      functionName: "setAgentWallet",
      args: [BigInt(proof.tokenId), proof.agentWallet as Address, BigInt(proof.deadline), proof.signature as `0x${string}`],
    });
    await waitForTransactionReceipt(wagmiConfig, { chainId: bsc.id, hash: tx });
    await named.refetch();
    return "Linked. Escrow buyers now pay the agent, and it forwards every payout to you.";
  };

  const wei = balance.data ?? null;
  const callsLeft = wei === null ? null : Number(wei / GAS_PER_CALL_WEI);
  const linked = Boolean(address && named.data && getAddress(named.data) === getAddress(address));

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
            onClick={() => void run(async (sessionToken) => (await create({ sessionToken, hash: agent.hash }), "Wallet created."))}
            type="button"
          >
            {state === "busy" ? "Creating…" : "Create its wallet"}
          </button>
        </>
      ) : (
        <>
          <div className="mt-2 flex items-baseline justify-between gap-3">
            <p className="min-w-0 truncate font-mono text-[0.8rem] text-ink">{address}</p>
            <p className="shrink-0 text-[0.86rem] font-semibold text-ink">
              {wei === null ? "…" : `${Number(formatEther(wei)).toLocaleString("en", { maximumFractionDigits: 6 })} BNB`}
            </p>
          </div>
          <p className="mt-1 text-[0.76rem] leading-relaxed text-muted">
            {callsLeft === null
              ? "Reading its balance…"
              : callsLeft === 0
                ? "Empty. Send it a little BNB so it can collect payments; until then paid calls are refused and nobody is charged."
                : `Gas for about ${callsLeft.toLocaleString("en")} paid calls. It only pays gas: every payment reaches your payout wallet.`}
          </p>
          <p className="mt-2 text-[0.76rem] leading-relaxed text-muted">To top it up, send BNB on BNB Chain to the address above.</p>

          {escrow ? (
            <div className="mt-4 border-t border-line/70 pt-4">
              <p className="text-[0.86rem] font-semibold text-ink">Escrow hires</p>
              {linked ? (
                <p className="mt-1 text-[0.76rem] leading-relaxed text-muted">
                  Linked to its on-chain identity. A buyer funds a job, the agent delivers, and after the 7-day dispute window it
                  collects and sends the U to your payout wallet.
                </p>
              ) : (
                <>
                  <p className="mt-1 text-[0.76rem] leading-relaxed text-muted">
                    Escrow buyers pay the wallet its on-chain identity names, which is still your own. Link this one with a single
                    transaction from your wallet; you pay only its gas.
                  </p>
                  <button
                    className="mt-2 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-canvas disabled:opacity-40"
                    disabled={state === "busy" || named.isPending || !token}
                    onClick={() => token && void run(link(token))}
                    type="button"
                  >
                    {state === "busy" ? "Check your wallet…" : "Link it to its identity"}
                  </button>
                </>
              )}
              {jobs && jobs.length > 0 ? (
                <ul className="mt-3 divide-y divide-line/60">
                  {jobs.map((job) => (
                    <li className="flex items-center justify-between gap-3 py-2 text-[0.8rem]" key={job.jobId}>
                      <span className="text-ink">
                        Job #{job.jobId} · {formatUnits(BigInt(job.budgetRaw), 18)} U
                      </span>
                      <span className="text-right text-muted">{JOB_WORDS[job.status]}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {wei !== null && wei > BigInt(0) ? (
            <div className="mt-4 max-w-xs">
              <HoldButton
                backgroundColor="var(--ink)"
                disabled={state === "busy"}
                doneLabel="Withdrawing…"
                fillColor="#2f8a55"
                holdTime={1200}
                onHold={() =>
                  void run(async (sessionToken) => `Sent ${formatEther(BigInt((await withdraw({ sessionToken, hash: agent.hash })).sentWei))} BNB back to your wallet.`)
                }
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
