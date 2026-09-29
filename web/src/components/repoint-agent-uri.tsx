"use client";

import { useAction } from "convex/react";
import { BSC_RPC_URL } from "@/constants/agents";
import { ConvexError } from "convex/values";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { bsc } from "viem/chains";
import { switchChain, waitForTransactionReceipt, writeContract } from "wagmi/actions";

import { builtAgentsApi, type BuiltAgentPublic } from "@/convex/api";
import { useWallet, wagmiConfig } from "@/wallet/wallet-provider";
import { useWalletSession } from "@/wallet/wallet-session";

/**
 * UPDATE A BUILT AGENT'S ON-CHAIN LINK. (2026-09-27)
 *
 * Shown only to the agent's owner, and only when the token's URI on the
 * registry is not this agent's registration file - the case of #358958, first
 * registered against the dev backend. The owner's wallet signs
 * setAgentURI(tokenId, registrationUrl); the server then checks the chain
 * reads the new URI before recording it (convex/builtAgentMoves.ts).
 */

const REGISTRY_ABI = parseAbi([
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function setAgentURI(uint256 agentId, string newURI)",
]);

export function RepointAgentUri({ agent }: { agent: BuiltAgentPublic }) {
  const wallet = useWallet();
  const session = useWalletSession();
  const confirmUriUpdate = useAction(builtAgentsApi.builtAgentMoves.confirmUriUpdate);
  const [stage, setStage] = useState<"idle" | "signing" | "confirming" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const isOwner = Boolean(wallet.address && wallet.address.toLowerCase() === agent.ownerAddress.toLowerCase());
  const eligible = isOwner && agent.status === "registered" && agent.network === "bsc" && agent.tokenId !== null;

  /* What the registry says NOW. Read, not assumed: it is what the button fixes. */
  const tokenUri = useQuery({
    queryKey: ["agent-token-uri", agent.registry, agent.tokenId],
    enabled: eligible,
    queryFn: () =>
      // Our RPC: viem's BSC default (rpc.thirdweb.com) refuses browsers (CORS) - seen in production 2026-09-29.
      createPublicClient({ chain: bsc, transport: http(BSC_RPC_URL) }).readContract({
        address: agent.registry as Address,
        abi: REGISTRY_ABI,
        functionName: "tokenURI",
        args: [BigInt(agent.tokenId as string)],
      }),
  });
  const onChainUri = tokenUri.data ?? null;

  if (!eligible || onChainUri === null) return null;
  if (onChainUri === agent.registrationUrl && stage !== "done") return null;

  const update = async () => {
    if (!session.sessionToken || !agent.tokenId) {
      setError("Sign in with this wallet first (the Put on-chain screen has the button).");
      return;
    }
    setError(null);
    setStage("signing");
    try {
      await switchChain(wagmiConfig, { chainId: bsc.id });
      const txHash = await writeContract(wagmiConfig, {
        chainId: bsc.id,
        address: agent.registry as Address,
        abi: REGISTRY_ABI,
        functionName: "setAgentURI",
        args: [BigInt(agent.tokenId), agent.registrationUrl],
      });
      setStage("confirming");
      await waitForTransactionReceipt(wagmiConfig, { chainId: bsc.id, hash: txHash });
      await confirmUriUpdate({ sessionToken: session.sessionToken, hash: agent.hash, transactionHash: txHash });
      await tokenUri.refetch();
      setStage("done");
    } catch (cause) {
      const text = cause instanceof ConvexError ? String(cause.data) : cause instanceof Error ? cause.message : String(cause);
      setError(/user (rejected|denied)|rejected the request/i.test(text) ? "You cancelled the signature. Nothing changed." : text.split("\n")[0].slice(0, 220));
      setStage("idle");
    }
  };

  if (stage === "done") {
    return (
      <div className="surface-raised mt-4 p-5">
        <p className="text-[0.86rem] font-semibold text-ink">On-chain link updated.</p>
        <p className="mt-1 break-all font-mono text-[0.74rem] text-ink-soft">{onChainUri}</p>
      </div>
    );
  }

  return (
    <div className="surface-raised mt-4 border border-danger/30 p-5">
      <p className="eyebrow">Only you see this</p>
      <p className="mt-1 text-[0.9rem] font-semibold text-ink">Its on-chain record points to an old address</p>
      <p className="mt-1 break-all font-mono text-[0.72rem] text-muted">{onChainUri}</p>
      <p className="mt-2 text-[0.8rem] leading-relaxed text-ink-soft">
        Update it to Dolphin&rsquo;s address with one transaction from your wallet. You pay only the network fee. The old
        address stays in the transaction history, as everything on-chain does.
      </p>
      <button
        className="mt-3 flex h-10 w-full items-center justify-center rounded-xl bg-ink text-[13.5px] font-semibold disabled:opacity-30"
        disabled={stage !== "idle"}
        onClick={() => void update()}
        type="button"
      >
        <span className="text-canvas">
          {stage === "signing" ? "Confirm in your wallet…" : stage === "confirming" ? "Confirming on-chain…" : "Update its on-chain link"}
        </span>
      </button>
      {error ? <p className="mt-2 text-[0.78rem] text-danger">{error}</p> : null}
    </div>
  );
}
