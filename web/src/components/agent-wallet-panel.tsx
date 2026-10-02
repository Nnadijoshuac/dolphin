"use client";

import { useQuery as useTanstackQuery } from "@tanstack/react-query";
import { useAction, useQuery } from "convex/react";
import { useState } from "react";
import { createPublicClient, formatEther, formatUnits, getAddress, http, parseAbi, type Address } from "viem";
import { bsc } from "viem/chains";
import { switchChain, waitForTransactionReceipt, writeContract } from "wagmi/actions";

import { HoldButton } from "@/components/hold-button";
import { InfoTip } from "@/components/info-tip";
import { BSC_RPC_URL } from "@/constants/agents";
import { x402Api, type BuiltAgentPublic } from "@/convex/api";
import { useAltanaWallet } from "@/wallet/altana-provider";
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

/** One transaction's gas, generously (120k gas at 0.1 gwei), so the builder sees hires left, not wei. */
const GAS_PER_CALL_WEI = BigInt(12_000_000_000_000); // 0.000012 BNB
/** An escrow hire is three transactions: deliver, collect after the window, forward to the builder. */
const TXS_PER_ESCROW_JOB = BigInt(3);
/** Under this many hires of gas, the builder is warned before hires start failing. */
const LOW_GAS_JOBS = 5;
/** What "Top up" sends from the Dolphin Wallet: enough for a few dozen hires. */
const TOP_UP_WEI = BigInt(500_000_000_000_000); // 0.0005 BNB

const client = createPublicClient({ chain: bsc, transport: http(BSC_RPC_URL) });

export type GasLevel = "ok" | "low" | "empty";

/**
 * WHETHER A PAID AGENT CAN WORK (owner, 2026-10-02: "if the agent doesn't
 * have BNB for gas, the agent cannot work"). Public: its wallet address and
 * balance are on-chain facts, so a visitor sees the same status the owner does.
 * Level is null while unread, for a free agent, or for one with no wallet yet.
 */
export function useAgentGas(agent: BuiltAgentPublic): {
  address: string | null;
  wei: bigint | null;
  jobsLeft: number | null;
  level: GasLevel | null;
  refetch: () => void;
} {
  const paid = agent.status === "registered" && agent.network === "bsc" && Boolean(agent.priceRaw);
  const row = useQuery(x402Api.x402.agentWallet, paid ? { hash: agent.hash } : "skip");
  const address = row?.address ?? null;
  const balance = useTanstackQuery({
    queryKey: ["agent-wallet-balance", address],
    enabled: Boolean(address),
    queryFn: () => client.getBalance({ address: address as Address }),
    refetchInterval: 30_000,
  });
  const wei = balance.data ?? null;
  const perJob = agent.protocol === "a2a" ? GAS_PER_CALL_WEI * TXS_PER_ESCROW_JOB : GAS_PER_CALL_WEI;
  const jobsLeft = wei === null ? null : Number(wei / perJob);
  const level: GasLevel | null = !paid || jobsLeft === null ? null : jobsLeft === 0 ? "empty" : jobsLeft < LOW_GAS_JOBS ? "low" : "ok";
  return { address, wei, jobsLeft, level, refetch: () => void balance.refetch() };
}

export function GasExplainer({ escrow }: { escrow: boolean }) {
  return (
    <InfoTip label="Why the agent needs BNB">
      <strong className="block text-ink">Why it needs BNB</strong>
      Your agent signs its own transactions on BNB Chain, and each one costs a small gas fee paid in BNB.
      {escrow
        ? " For every hire it delivers the result on-chain, collects the payment once the dispute window closes, and sends your earnings to your wallet: three small fees."
        : " For every paid call it submits the buyer's payment on-chain, and the U lands in your wallet."}{" "}
      With no BNB it can&apos;t do any of that, so it turns hires down until you top it up. Nobody is charged for a hire it refuses.
      <span className="mt-1.5 block">It only ever spends BNB on gas, and you can withdraw what&apos;s left at any time.</span>
    </InfoTip>
  );
}

export function CopyAddress({ address, label = "Copy the agent's wallet address" }: { address: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-address">
      <span className="copy-address__value" title={address}>
        {address}
      </span>
      <button
        aria-label={label}
        className="copy-address__button"
        onClick={() =>
          void navigator.clipboard?.writeText(address).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
        type="button"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** "Top up 0.0005 BNB from my Dolphin Wallet": the passkey signs, the BNB lands on the agent. */
export function TopUpFromDolphin({ to, onSent }: { to: string; onSent?: () => void }) {
  const dolphin = useAltanaWallet();
  const [state, setState] = useState<State>("idle");
  return (
    <>
      <div className="topup-row">
        {dolphin.status === "connected" ? (
          <button
            disabled={state === "busy"}
            onClick={async () => {
              setState("busy");
              try {
                await dolphin.withdraw({ asset: { kind: "native", symbol: "BNB", decimals: 18 }, amountRaw: TOP_UP_WEI, to: getAddress(to) });
                setState({ done: `Sent ${formatEther(TOP_UP_WEI)} BNB from your Dolphin Wallet. It shows here within a minute.` });
                onSent?.();
              } catch (cause) {
                const text = cause instanceof Error ? cause.message : "";
                setState({
                  error: /cancel|abort|not allowed/i.test(text) ? "You cancelled. Nothing was sent." : toUserMessage(cause, "The top-up did not go through. Try again."),
                });
              }
            }}
            type="button"
          >
            {state === "busy" ? "Confirm with your passkey…" : `Top up ${formatEther(TOP_UP_WEI)} BNB from my Dolphin Wallet`}
          </button>
        ) : null}
        <span className="self-center text-[0.74rem] text-muted">
          {dolphin.status === "connected" ? "Or send" : "Send"} BNB on BNB Chain to the address above.
        </span>
      </div>
      {typeof state === "object" ? (
        <p className={`mt-2 text-[0.76rem] ${"error" in state ? "text-danger" : "text-ink-soft"}`} role={"error" in state ? "alert" : "status"}>
          {"error" in state ? state.error : state.done}
        </p>
      ) : null}
    </>
  );
}

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
  const gas = useAgentGas(agent);
  const jobs = useQuery(x402Api.erc8183Seller.jobsForAgent, eligible && escrow ? { hash: agent.hash } : "skip");
  const create = useAction(x402Api.x402.createAgentWallet);
  const withdraw = useAction(x402Api.x402.withdrawAgentGas);
  const linkProof = useAction(x402Api.erc8183Seller.walletLinkProof);
  const [state, setState] = useState<State>("idle");

  const address = row?.address ?? null;
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

  const wei = gas.wei;
  const linked = Boolean(address && named.data && getAddress(named.data) === getAddress(address));

  return (
    <div className="surface-raised mt-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow flex items-center gap-2">
          Your agent&apos;s wallet <GasExplainer escrow={escrow} />
        </p>
        {address && gas.level ? (
          <span className="gas-status" data-level={gas.level}>
            {gas.level === "empty" ? "Can't take hires" : gas.level === "low" ? "Low on gas" : "Ready for hires"}
          </span>
        ) : null}
      </div>
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
          <div className="mt-3 flex items-baseline justify-between gap-3">
            <p className="text-[1.35rem] font-semibold tracking-[-0.02em] text-ink">
              {wei === null ? "…" : `${Number(formatEther(wei)).toLocaleString("en", { maximumFractionDigits: 6 })} BNB`}
            </p>
            <p className="text-right text-[0.76rem] text-muted">
              {gas.jobsLeft === null ? "Reading its balance…" : `Gas for about ${gas.jobsLeft.toLocaleString("en")} ${gas.jobsLeft === 1 ? "hire" : "hires"}`}
            </p>
          </div>
          {gas.level === "empty" || gas.level === "low" ? (
            <p className={`mt-2 text-[0.8rem] leading-relaxed ${gas.level === "empty" ? "text-danger" : "text-ink-soft"}`} role="status">
              {gas.level === "empty"
                ? "It has no BNB for gas, so it can't take paid hires. Buyers are turned away, and nobody is charged, until you top it up."
                : "It's running low on gas. Top it up before it runs out, or new hires will be turned away."}
            </p>
          ) : null}
          <CopyAddress address={address} />
          <TopUpFromDolphin onSent={gas.refetch} to={address} />

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
