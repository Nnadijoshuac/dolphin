"use client";

import Link from "next/link";
import { useAction, useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { useEffect, useRef, useState } from "react";
import { createPublicClient, formatUnits, http, parseAbi, type Address } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { switchChain, waitForTransactionReceipt, writeContract } from "wagmi/actions";

import { BUILT_AGENT_CATEGORIES, builtAgentsApi } from "@/convex/api";
import { BSC_TESTNET_RPC_URL, useWallet, wagmiConfig } from "@/wallet/wallet-provider";
import { useWalletSession } from "@/wallet/wallet-session";

/**
 * PUT A BUILT AGENT ON-CHAIN. (2026-09-26, owner's decisions in
 * Agent/PLAN-2026-09-26-build-your-agent.md §6c)
 *
 * The owner's CONNECTED wallet signs `register(tokenURI)` on the ERC-8004
 * Identity Registry and owns the resulting NFT. Dolphin holds no key. The fee
 * shown is read live (gas estimate x gas price) right before signing, and it
 * is the network's, not Dolphin's: nothing on this screen suggests paying
 * lists an agent. Listing is earned by answering Dolphin's probe.
 *
 * Every check that matters is repeated on the server (convex/builtAgents.ts,
 * convex/iconProcessing.ts). The ones here only save a round trip.
 */

const REGISTER_ABI = parseAbi(["function register(string agentURI) returns (uint256 agentId)"]);
const MAX_ICON_BYTES = 2 * 1024 * 1024;
const ACCEPTED = ["image/png", "image/jpeg"];

type Network = "bsc" | "bsc-testnet";
const CHAINS = { bsc, "bsc-testnet": bscTestnet } as const;
const EXPLORER = { bsc: "https://bscscan.com", "bsc-testnet": "https://testnet.bscscan.com" } as const;

function readClient(network: Network) {
  return network === "bsc"
    ? createPublicClient({ chain: bsc, transport: http() })
    : createPublicClient({ chain: bscTestnet, transport: http(BSC_TESTNET_RPC_URL) });
}

/** A readable reason from anything thrown: the server's ConvexError, a wallet refusal, or plain text. */
function reasonOf(cause: unknown): string {
  if (cause instanceof ConvexError) return String(cause.data);
  const text = cause instanceof Error ? cause.message : String(cause);
  if (/user (rejected|denied)|rejected the request|user cancel/i.test(text)) return "You cancelled the signature. Nothing was registered.";
  if (/insufficient funds/i.test(text)) return "Your wallet doesn't have enough BNB for the network fee.";
  const clean = text.replace(/\[CONVEX[^\]]*\]\s*/g, "").replace(/\[Request ID:[^\]]*\]\s*/g, "").split("\n")[0];
  return clean.length > 220 ? `${clean.slice(0, 220)}…` : clean;
}

/** 0.00012345 BNB -> "0.0001235"; 1.5 -> "1.5". */
function bnb(wei: bigint): string {
  const text = formatUnits(wei, 18);
  if (!text.startsWith("0.")) return Number(text).toFixed(4).replace(/\.?0+$/, "");
  const fraction = text.slice(2);
  const zeros = fraction.length - fraction.replace(/^0+/, "").length;
  return `0.${fraction.slice(0, zeros + 4).replace(/0+$/, "")}`;
}

type Prepared = { hash: string; tokenURI: string; registry: string; chainId: number; pageUrl: string };
type Review = { prepared: Prepared; feeWei: bigint; balanceWei: bigint };
type Done = { hash: string; tokenId: string; txHash: string; network: Network };

export function PublishAgentDialog({
  buildConversationKey,
  agentName,
  agentDescription,
  onClose,
}: {
  buildConversationKey: string;
  agentName: string;
  agentDescription: string;
  onClose: () => void;
}) {
  const wallet = useWallet();
  const session = useWalletSession();
  const iconUploadUrl = useMutation(builtAgentsApi.builtAgents.iconUploadUrl);
  const processIcon = useAction(builtAgentsApi.iconProcessing.process);
  const prepareListing = useMutation(builtAgentsApi.builtAgents.prepareListing);
  const confirmRegistration = useAction(builtAgentsApi.builtAgents.confirmRegistration);

  const [icon, setIcon] = useState<{ id: string; url: string | null } | null>(null);
  const [iconBusy, setIconBusy] = useState(false);
  const [category, setCategory] = useState("");
  const [website, setWebsite] = useState("");
  const [xHandle, setXHandle] = useState("");
  const [email, setEmail] = useState("");
  const [network, setNetwork] = useState<Network>("bsc-testnet");
  const [review, setReview] = useState<Review | null>(null);
  const [stage, setStage] = useState<"form" | "reviewing" | "signing" | "confirming" | "done">("form");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && stage !== "signing" && stage !== "confirming") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, stage]);

  /** Any change to the form invalidates a quoted fee: the listing it priced is no longer the one on screen. */
  const edited = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setReview(null);
  };

  const signedIn = Boolean(session.sessionToken) && session.isSignedIn;
  const sameWallet =
    wallet.address && session.address ? wallet.address.toLowerCase() === session.address.toLowerCase() : false;

  async function pickIcon(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) return setError("Icons must be PNG or JPEG.");
    if (file.size > MAX_ICON_BYTES) return setError(`That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. Icons can be at most 2 MB.`);
    if (!session.sessionToken) return setError("Sign in with your wallet first.");
    setIconBusy(true);
    try {
      const { uploadUrl } = await iconUploadUrl({ sessionToken: session.sessionToken });
      const response = await fetch(uploadUrl, { method: "POST", headers: { "content-type": file.type }, body: file });
      if (!response.ok) throw new Error("The upload did not go through. Try again.");
      const { storageId } = (await response.json()) as { storageId: string };
      const processed = await processIcon({ sessionToken: session.sessionToken, storageId });
      setIcon({ id: processed.iconId, url: processed.url });
      setReview(null);
    } catch (cause) {
      setIcon(null);
      setError(reasonOf(cause));
    } finally {
      setIconBusy(false);
    }
  }

  async function prepare() {
    setError(null);
    if (!session.sessionToken || !wallet.address) return setError("Connect and sign in with your wallet first.");
    if (!icon) return setError("Upload an icon first. Every agent needs one.");
    if (!category) return setError("Pick a category.");
    setStage("reviewing");
    try {
      const prepared = await prepareListing({
        sessionToken: session.sessionToken,
        buildConversationKey,
        network,
        iconStorageId: icon.id,
        category,
        ...(website.trim() ? { website: website.trim() } : {}),
        ...(xHandle.trim() ? { x: xHandle.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
      });
      /* The fee, read now: this exact call's gas at this moment's price. */
      const client = readClient(network);
      const account = wallet.address as Address;
      const [gas, gasPrice, balanceWei] = await Promise.all([
        client.estimateContractGas({
          account,
          address: prepared.registry as Address,
          abi: REGISTER_ABI,
          functionName: "register",
          args: [prepared.tokenURI],
        }),
        client.getGasPrice(),
        client.getBalance({ address: account }),
      ]);
      setReview({ prepared, feeWei: gas * gasPrice, balanceWei });
      setStage("form");
    } catch (cause) {
      setError(reasonOf(cause));
      setStage("form");
    }
  }

  async function register() {
    if (!review || !session.sessionToken) return;
    setError(null);
    setStage("signing");
    try {
      const chainId = CHAINS[network].id;
      await switchChain(wagmiConfig, { chainId });
      const txHash = await writeContract(wagmiConfig, {
        chainId,
        address: review.prepared.registry as Address,
        abi: REGISTER_ABI,
        functionName: "register",
        args: [review.prepared.tokenURI],
      });
      setStage("confirming");
      await waitForTransactionReceipt(wagmiConfig, { chainId, hash: txHash });
      const confirmed = await confirmRegistration({
        sessionToken: session.sessionToken,
        hash: review.prepared.hash,
        transactionHash: txHash,
      });
      setDone({ hash: review.prepared.hash, tokenId: confirmed.tokenId, txHash, network });
      setStage("done");
    } catch (cause) {
      setError(reasonOf(cause));
      setStage("form");
    } finally {
      /* The rest of Dolphin reads mainnet; put the wallet back if it was moved. */
      if (network !== "bsc") void switchChain(wagmiConfig, { chainId: bsc.id }).catch(() => undefined);
    }
  }

  const busy = stage === "reviewing" || stage === "signing" || stage === "confirming" || iconBusy;
  const short = review ? review.balanceWei < review.feeWei : false;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        aria-label="Close"
        className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]"
        disabled={stage === "signing" || stage === "confirming"}
        onClick={onClose}
        type="button"
      />
      <div
        aria-label="Put your agent on-chain"
        aria-modal="true"
        className="relative max-h-[92dvh] w-full max-w-[30rem] overflow-y-auto rounded-t-2xl bg-paper px-5 pb-6 pt-5 shadow-[0_20px_60px_rgba(15,23,42,0.25)] sm:rounded-2xl"
        ref={dialogRef}
        role="dialog"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-muted">Put on-chain</p>
            <h2 className="mt-1 text-[1.15rem] font-semibold text-ink">{agentName}</h2>
          </div>
          <button
            aria-label="Close"
            className="grid size-9 place-items-center rounded-full text-muted hover:bg-paper-muted disabled:opacity-30"
            disabled={stage === "signing" || stage === "confirming"}
            onClick={onClose}
            type="button"
          >
            <span aria-hidden className="text-lg leading-none">×</span>
          </button>
        </div>

        {stage === "done" && done ? (
          <div className="mt-5 space-y-3">
            <div className="rounded-xl bg-success/10 px-4 py-3">
              <p className="text-[0.92rem] font-semibold text-ink">{agentName} is on-chain.</p>
              <p className="mt-1 text-[0.8rem] text-ink-soft">
                ERC-8004 agent #{done.tokenId} on {done.network === "bsc" ? "BNB Chain" : "BNB Chain testnet"}, owned by your wallet.
              </p>
            </div>
            <div className="flex flex-col gap-2 text-[0.84rem]">
              <Link className="underline" href={`/agent/${done.hash}`}>
                Open its page
              </Link>
              <a className="underline" href={`${EXPLORER[done.network]}/tx/${done.txHash}`} rel="noopener noreferrer" target="_blank">
                See the registration on BscScan ↗
              </a>
            </div>
            {done.network === "bsc" ? (
              <p className="text-[0.74rem] leading-relaxed text-muted">
                Dolphin lists it once its endpoint answers Dolphin&rsquo;s check, usually within the hour.
              </p>
            ) : (
              <p className="text-[0.74rem] leading-relaxed text-muted">
                This was a testnet rehearsal: it is real, but on the test network, so it is not listed on Dolphin.
              </p>
            )}
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            <p className="text-[0.8rem] leading-relaxed text-ink-soft">{agentDescription}</p>

            {/* 1. Wallet */}
            <section>
              <h3 className="text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-muted">Your wallet</h3>
              {!wallet.isConnected || !wallet.address ? (
                <button
                  className="mt-2 rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-ink"
                  onClick={() => void wallet.connect()}
                  type="button"
                >
                  Connect wallet
                </button>
              ) : !signedIn || !sameWallet ? (
                <div className="mt-2 space-y-1.5">
                  <p className="text-[0.8rem] text-ink-soft">Sign in once so Dolphin knows this wallet is yours. It costs nothing.</p>
                  <button
                    className="rounded-full bg-ink px-4 py-2 text-[13px] font-semibold disabled:opacity-40"
                    disabled={session.isSigningIn}
                    onClick={() => void session.signIn(wallet.address ?? undefined)}
                    type="button"
                  >
                    <span className="text-canvas">{session.isSigningIn ? "Check your wallet…" : "Sign in"}</span>
                  </button>
                </div>
              ) : (
                <p className="mt-2 font-mono text-[0.8rem] text-ink">
                  {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}{" "}
                  <span className="font-sans text-muted">· owns the agent and pays the network fee</span>
                </p>
              )}
            </section>

            {/* 2. Icon */}
            <section>
              <h3 className="text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-muted">Icon (required)</h3>
              <div className="mt-2 flex items-center gap-3">
                <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-line/80 bg-paper-muted">
                  {icon?.url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a Convex storage URL, already resized server-side
                    <img alt="" className="size-full object-cover" src={icon.url} />
                  ) : (
                    <span className="text-[0.65rem] text-faint">{iconBusy ? "Checking…" : "None"}</span>
                  )}
                </div>
                <div className="min-w-0">
                  <label className={`inline-flex cursor-pointer rounded-full border border-line/80 px-3.5 py-1.5 text-[12.5px] font-semibold text-ink ${!signedIn || busy ? "pointer-events-none opacity-40" : "hover:bg-paper-muted"}`}>
                    {icon ? "Replace" : "Upload"}
                    <input
                      accept="image/png,image/jpeg"
                      className="sr-only"
                      disabled={!signedIn || busy}
                      onChange={(event) => {
                        void pickIcon(event.target.files?.[0]);
                        event.target.value = "";
                      }}
                      type="file"
                    />
                  </label>
                  <p className="mt-1 text-[0.7rem] text-muted">PNG or JPEG, up to 2 MB, at least 64×64. It&rsquo;s resized and cleaned.</p>
                </div>
              </div>
            </section>

            {/* 3. Details */}
            <section className="space-y-2.5">
              <h3 className="text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-muted">Details</h3>
              <label className="block text-[0.78rem] text-ink-soft">
                Category (required)
                <select
                  className="mt-1 block w-full rounded-lg border border-line/80 bg-paper px-3 py-2 text-[0.86rem] text-ink"
                  onChange={(event) => edited(setCategory)(event.target.value)}
                  value={category}
                >
                  <option value="">Choose…</option>
                  {BUILT_AGENT_CATEGORIES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {[
                { label: "Website (optional)", value: website, set: edited(setWebsite), placeholder: "https://…" },
                { label: "X handle (optional)", value: xHandle, set: edited(setXHandle), placeholder: "@handle" },
                { label: "Contact email (optional, public)", value: email, set: edited(setEmail), placeholder: "you@example.com" },
              ].map((field) => (
                <label className="block text-[0.78rem] text-ink-soft" key={field.label}>
                  {field.label}
                  <input
                    className="mt-1 block w-full rounded-lg border border-line/80 bg-paper px-3 py-2 text-[0.86rem] text-ink"
                    maxLength={200}
                    onChange={(event) => field.set(event.target.value)}
                    placeholder={field.placeholder}
                    value={field.value}
                  />
                </label>
              ))}
            </section>

            {/* 4. Network */}
            <section>
              <h3 className="text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-muted">Network</h3>
              <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup">
                {(["bsc-testnet", "bsc"] as const).map((option) => (
                  <button
                    aria-checked={network === option}
                    className={`rounded-xl border px-3 py-2.5 text-left text-[0.8rem] ${network === option ? "border-ink bg-paper-muted" : "border-line/80"}`}
                    key={option}
                    onClick={() => edited(setNetwork)(option)}
                    role="radio"
                    type="button"
                  >
                    <span className="block font-semibold text-ink">{option === "bsc" ? "BNB Chain" : "Testnet"}</span>
                    <span className="block text-[0.7rem] text-muted">
                      {option === "bsc" ? "Real, and listed on Dolphin once it answers" : "Free test BNB, not listed"}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            {/* 5. Review and sign */}
            <section className="border-t border-line/60 pt-4">
              {review ? (
                <div className="mb-3 space-y-1 text-[0.8rem]">
                  <p className="flex justify-between gap-3">
                    <span className="text-muted">Network fee, estimated now</span>
                    <span className="text-ink">{bnb(review.feeWei)} {network === "bsc" ? "BNB" : "tBNB"}</span>
                  </p>
                  <p className="flex justify-between gap-3">
                    <span className="text-muted">Dolphin fee</span>
                    <span className="text-ink">None</span>
                  </p>
                  {short ? (
                    <p className="pt-1 text-[0.76rem] text-danger">
                      Your wallet holds {bnb(review.balanceWei)} {network === "bsc" ? "BNB" : "tBNB"}, less than the fee.
                      {network === "bsc-testnet" ? (
                        <>
                          {" "}
                          Get free test BNB from the{" "}
                          <a className="underline" href="https://www.bnbchain.org/en/testnet-faucet" rel="noopener noreferrer" target="_blank">
                            BNB Chain faucet
                          </a>
                          .
                        </>
                      ) : null}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {review ? (
                <button
                  className="flex h-11 w-full items-center justify-center rounded-xl bg-ink text-[14px] font-semibold disabled:opacity-30"
                  disabled={busy || short}
                  onClick={() => void register()}
                  type="button"
                >
                  <span className="text-canvas">
                    {stage === "signing" ? "Check your wallet…" : stage === "confirming" ? "Confirming on-chain…" : "Sign and register"}
                  </span>
                </button>
              ) : (
                <button
                  className="flex h-11 w-full items-center justify-center rounded-xl bg-ink text-[14px] font-semibold disabled:opacity-30"
                  disabled={busy || !signedIn || !sameWallet || !icon || !category}
                  onClick={() => void prepare()}
                  type="button"
                >
                  <span className="text-canvas">{stage === "reviewing" ? "Checking…" : "Review"}</span>
                </button>
              )}
              {error ? <p className="mt-2 text-[0.78rem] text-danger">{error}</p> : null}
              <p className="mt-2 text-[0.7rem] leading-relaxed text-muted">
                Your wallet signs one transaction on the ERC-8004 registry and owns the agent. Paying the network fee does not list it:
                Dolphin lists agents that answer when it checks them.
              </p>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
