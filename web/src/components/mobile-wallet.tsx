"use client";

import Link from "next/link";
import { useState } from "react";
import { useBalance } from "wagmi";
import { useQuery } from "convex/react";
import { CategoryGlyph } from "@/components/category-glyph";
import { AgentIcon } from "@/components/agent-icon";
import { agentPaymentsApi } from "@/convex/api";
import { useHiredAgents } from "@/hooks/use-hired-agents";
import { useAgentsByKeys } from "@/hooks/use-agents";
import { convexClient } from "@/providers/convex-provider";
import { useAltanaWallet } from "@/wallet/altana-provider";
import { formatBnb } from "@/wallet/altana-policy";
import { formatTokenAmount } from "@/wallet/erc8183-policy";
import { useWallet, WalletConnectButton } from "@/wallet/wallet-provider";

function Activity() {
  const identity = useWallet();
  const dolphin = useAltanaWallet();
  const hires = useHiredAgents(identity.isConnected ? identity.address : null);
  const jobs = useQuery(agentPaymentsApi.agentPayments.getJobsForAltanaWallet, dolphin.address ? { altanaWalletAddress: dolphin.address } : "skip");
  const agents = useAgentsByKeys([...(hires ?? []).map(h => h.agentKey), ...(jobs ?? []).map(j => j.agentKey)]);
  const items = [
    ...(jobs ?? []).map(job => ({ key: `job:${job.jobId}`, agentKey: job.agentKey, name: job.agentName, date: job.verifiedAt, status: job.jobStatus, amount: `${formatTokenAmount(job.budgetRaw, job.paymentTokenDecimals)} ${job.paymentTokenSymbol}` })),
    ...(hires ?? []).filter(hire => !hire.paymentJobId).map(hire => ({ key: `hire:${hire.agentKey}`, agentKey: hire.agentKey, name: agents.get(hire.agentKey)?.name ?? "Agent", date: hire.hiredAt, status: "Hired · no payment", amount: null })),
  ].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const loading = (identity.isConnected && hires === undefined) || (dolphin.address && jobs === undefined);
  return <section className="mobile-wallet-activity">
    <header><h2>Agent activity</h2>{items.length > 4 && <Link href="/my-agents">See all</Link>}</header>
    {items.length ? items.slice(0, 4).map(item => {
      const agent = agents.get(item.agentKey);
      return <Link className="mobile-activity-row" href={`/manage/${encodeURIComponent(item.agentKey)}`} key={item.key}>
        <AgentIcon category={agent?.category ?? "monitoring"} seed={agent?.iconSeed} uri={agent?.iconUrl} size={48} />
        <div><h3>{agent?.name ?? item.name}</h3><p>{item.status} · {new Date(item.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</p></div>
        {item.amount && <strong>{item.amount}</strong>}
      </Link>;
    }) : <ActivityEmpty loading={Boolean(loading)} />}
  </section>;
}

function ActivityEmpty({ loading = false, unavailable = false }: { loading?: boolean; unavailable?: boolean }) {
  return <div className="mobile-activity-empty"><span><CategoryGlyph name="clock" size={23} /></span><h3>{unavailable ? "Activity unavailable" : loading ? "Checking activity…" : "No agent activity yet"}</h3><p>{unavailable ? "Activity cannot be read right now." : "Hires and payments to agents will appear here."}</p></div>;
}

export function MobileWallet() {
  const identity = useWallet();
  const dolphin = useAltanaWallet();
  const [hidden, setHidden] = useState(false);
  const [notice, setNotice] = useState("");
  const identityAddress = identity.isConnected ? identity.address : null;
  const balance = useBalance({ address: identityAddress as `0x${string}` | undefined, chainId: 56, query: { enabled: Boolean(identityAddress) } });
  // Sum only known accounts, and never present a partial total as complete.
  const count = Number(Boolean(identityAddress)) + Number(Boolean(dolphin.address && dolphin.address.toLowerCase() !== identityAddress?.toLowerCase()));
  const reading = dolphin.status === "loading" || (identityAddress && balance.isLoading) || (dolphin.address && dolphin.balanceWei === null && dolphin.isReadingBalance);
  const failed = (identityAddress && (balance.isError || !balance.data)) || (dolphin.address && (dolphin.balanceError || dolphin.balanceWei === null));
  const total = !reading && !failed && count > 0
    ? (identityAddress ? balance.data!.value : BigInt(0)) + (dolphin.address && dolphin.address.toLowerCase() !== identityAddress?.toLowerCase() ? dolphin.balanceWei! : BigInt(0)) : null;
  async function receive() {
    if (!identityAddress) return;
    try { await navigator.clipboard.writeText(identityAddress); setNotice("Wallet address copied"); }
    catch { setNotice(`Receive at ${identityAddress}`); }
  }
  return <div className="mobile-wallet">
    <header className="mobile-wallet-topbar">
      <Link className="mobile-circle" href="/account" aria-label="Account details"><CategoryGlyph name="wallet" size={20} /></Link>
      <Link className="mobile-circle" href="/account#security" aria-label="Wallet and security details"><CategoryGlyph name="info" size={20} /></Link>
    </header>
    <section className="mobile-wallet-total" aria-label="Wallet overview">
      <h1>Total balance</h1>
      <p className="mobile-wallet-amount">{hidden ? "••••" : total !== null ? formatBnb(total) : reading ? "…" : "—"}<span>BNB</span></p>
      {total !== null && <button type="button" className="mobile-balance-visibility" onClick={() => setHidden(!hidden)}>{hidden ? "Show" : "Hide"}</button>}
      <p className="mobile-wallet-note">{reading ? "Reading balances…" : count === 0 ? "Connect a wallet to see your balance" : total === null ? "Unable to read the full balance" : `Across ${count} ${count === 1 ? "account" : "accounts"} on BNB`}</p>
      {identityAddress ? <div className="mobile-wallet-actions">
        <button type="button" onClick={() => void receive()}><span><CategoryGlyph name="receive" size={23} /></span>Receive</button>
        <a href={`https://bscscan.com/address/${identityAddress}`} target="_blank" rel="noreferrer"><span><CategoryGlyph name="external" size={23} /></span>BscScan</a>
        <button type="button" onClick={() => { void balance.refetch(); dolphin.refreshBalance(); }}><span><CategoryGlyph name="refresh" size={23} /></span>Refresh</button>
      </div> : <div className="mobile-wallet-connect"><WalletConnectButton connectLabel="Connect wallet" /></div>}
      {notice && <p className="mobile-wallet-note" role="status">{notice}</p>}
    </section>
    <Link className="mobile-dolphin-account" href="/account">
      <header><span><CategoryGlyph name="bot" size={21} /></span><div><h2>Dolphin Wallet</h2><p>BNB · pays agents you hire</p></div><CategoryGlyph name="chevron-right" size={16} /></header>
      <strong>{dolphin.address ? hidden ? "••••" : dolphin.balanceWei !== null && !dolphin.balanceError ? `${formatBnb(dolphin.balanceWei)} BNB` : dolphin.isReadingBalance ? "…" : "Unavailable" : dolphin.status === "loading" ? "…" : dolphin.status === "unsupported" ? "Unavailable" : "Not set up"}</strong>
      <p>{dolphin.address ? `${dolphin.address.slice(0, 8)}…${dolphin.address.slice(-6)}` : dolphin.status === "loading" ? "Checking this device" : dolphin.status === "unsupported" ? dolphin.unsupportedReason : "Create one in Account details"}</p>
    </Link>
    {convexClient ? <Activity /> : <section className="mobile-wallet-activity"><header><h2>Agent activity</h2></header><ActivityEmpty unavailable /></section>}
  </div>;
}
