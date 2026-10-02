"use client";

import { useQuery } from "convex/react";
import { useState } from "react";

import { AgentWalletPanel, CopyAddress, GasExplainer, useAgentGas } from "@/components/agent-wallet-panel";
import { RepointAgentUri } from "@/components/repoint-agent-uri";
import { BUILT_AGENT_CATEGORIES, builtAgentsApi, type BuiltAgentPublic } from "@/convex/api";

/**
 * THE PAGE OF AN AGENT BUILT ON DOLPHIN: /agent/<hash>. (2026-09-26)
 *
 * Everything shown is the published snapshot (convex/builtAgents.ts) and the
 * chain facts Dolphin confirmed: the token, its owner, its registration
 * transaction. Nothing here is a metric - a built agent has no track record
 * yet, so none is shown.
 */

function CopyLine({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-muted">{label}</p>
        <p className="truncate font-mono text-[0.78rem] text-ink">{value}</p>
      </div>
      <button
        className="shrink-0 rounded-full border border-line/80 px-3 py-1 text-[12px] font-semibold text-ink-soft hover:bg-paper-muted"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        type="button"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function BuiltAgentPage({ hash }: { hash: string }) {
  const agent = useQuery(builtAgentsApi.builtAgents.publicByHash, { hash });

  if (agent === undefined) {
    return (
      <div className="site-frame page-shell">
        <p className="py-24 text-center text-sm text-muted">Loading agent…</p>
      </div>
    );
  }
  if (agent === null) {
    return (
      <div className="site-frame page-shell">
        <div className="py-24 text-center">
          <h1 className="text-lg font-semibold text-ink">No such agent</h1>
          <p className="mt-2 text-sm text-muted">This link does not point to an agent built on Dolphin.</p>
        </div>
      </div>
    );
  }

  return <BuiltAgentView agent={agent} />;
}

function BuiltAgentView({ agent }: { agent: BuiltAgentPublic }) {
  const gas = useAgentGas(agent);
  const category = BUILT_AGENT_CATEGORIES.find((option) => option.value === agent.category)?.label ?? agent.category;
  const live = agent.status === "registered";
  const escrow = agent.protocol === "a2a" && Boolean(agent.priceRaw);
  const onChain =
    agent.status === "registered"
      ? `ERC-8004 #${agent.tokenId} · ${agent.networkLabel}${agent.network === "bsc-testnet" ? " (test network)" : ""}`
      : agent.status === "awaiting-signature"
        ? "Not on-chain yet"
        : "Taken offline";

  return (
    <div className="site-frame page-shell">
      <div className="mx-auto max-w-[48rem] py-8">
        <header className="flex items-start gap-4 sm:gap-5">
          <div className="size-20 shrink-0 overflow-hidden rounded-[22px] border border-line/80 bg-paper-muted sm:size-24">
            {agent.iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- a Convex storage URL, resized server-side
              <img alt={`${agent.name} icon`} className="size-full object-cover" src={agent.iconUrl} />
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <p className="eyebrow">Built on Dolphin · {category}</p>
            <h1 className="mt-1 text-[1.75rem] font-semibold leading-tight tracking-[-0.03em] text-ink sm:text-[2rem]">{agent.name}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className={`agent-chip ${live ? "agent-chip--live" : "agent-chip--stop"}`}>{onChain}</span>
              <span className="agent-chip">{agent.protocol === "a2a" ? "A2A agent" : "MCP tool server"}</span>
              <span className="agent-chip">
                {agent.priceDisplay ? `${agent.priceDisplay} per ${agent.protocol === "a2a" ? "hire" : "call"}` : "Free"}
              </span>
              {gas.level ? (
                <span className={`agent-chip ${gas.level === "ok" ? "agent-chip--live" : gas.level === "low" ? "agent-chip--warn" : "agent-chip--stop"}`}>
                  {gas.level === "empty" ? "Paused: out of gas" : gas.level === "low" ? "Low on gas" : "Taking hires"}
                  <GasExplainer escrow={escrow} />
                </span>
              ) : null}
            </div>
          </div>
        </header>

        <p className="mt-6 text-[1rem] leading-relaxed text-ink">{agent.description}</p>

        {gas.level === "empty" ? (
          <p className="mt-4 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-[0.84rem] leading-relaxed text-ink-soft" role="status">
            This agent can&apos;t take paid hires right now: its wallet has no BNB for gas. Hires are turned away, and nobody is charged,
            until its builder tops it up.
          </p>
        ) : null}

        <RepointAgentUri agent={agent} />
        <AgentWalletPanel agent={agent} />

        {agent.status !== "unpublished" ? (
          <section className="surface-raised mt-4 p-5">
            <p className="eyebrow">Use it from your own app or agent</p>
            <p className="mt-2 text-[0.84rem] leading-relaxed text-ink-soft">
              {agent.protocol === "a2a" ? (
                <>
                  Send it a task over A2A (<span className="font-mono">message/send</span>) and it answers with the result.
                </>
              ) : (
                <>
                  Its MCP server offers <span className="font-mono">ask</span> (ask it a question)
                  {agent.tools.length > 0 ? " and the tools below" : ""}.
                </>
              )}{" "}
              {agent.priceDisplay
                ? agent.protocol === "a2a"
                  ? `Each hire costs ${agent.priceDisplay}, held in escrow on BNB Chain until it delivers, or paid with x402.`
                  : `Each call costs ${agent.priceDisplay}, paid with x402.`
                : "Free to use."}
            </p>
            <div className="mt-2 divide-y divide-line/60">
              <CopyLine label={agent.protocol === "a2a" ? "A2A agent card" : "MCP endpoint"} value={agent.endpointUrl} />
              <CopyLine label="Registration file" value={agent.registrationUrl} />
            </div>
          </section>
        ) : null}

        <section className="surface-raised mt-4 p-5">
          <p className="eyebrow">What it can do</p>
          {agent.tools.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {agent.tools.map((tool) => (
                <li className="agent-chip" key={`${tool.agentKey}:${tool.toolName}`} title={`from ${tool.agentName}`}>
                  <span className="font-mono">{tool.toolName}</span>
                  <span className="font-normal text-muted">· {tool.agentName}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-3 text-[0.8rem] leading-relaxed text-muted">
            It only reads. It cannot sign, trade or move anyone&apos;s funds, and it answers when asked.
          </p>
        </section>

        <section className="mt-6 grid gap-x-8 gap-y-4 border-t border-line/70 pt-5 text-[0.8rem] sm:grid-cols-2">
          <div className="min-w-0">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-muted">Owner</p>
            <CopyAddress address={agent.ownerAddress} label="Copy the owner's address" />
          </div>
          <div className="space-y-1.5 text-ink-soft sm:pt-5">
            {agent.registerTxUrl ? (
              <p>
                <a className="underline" href={agent.registerTxUrl} rel="noopener noreferrer" target="_blank">
                  Registration transaction ↗
                </a>
              </p>
            ) : null}
            {agent.links.website ? (
              <p>
                <a className="underline" href={agent.links.website} rel="noopener noreferrer nofollow" target="_blank">
                  Website ↗
                </a>
              </p>
            ) : null}
            {agent.links.x ? (
              <p>
                <a className="underline" href={`https://x.com/${agent.links.x}`} rel="noopener noreferrer nofollow" target="_blank">
                  @{agent.links.x} on X ↗
                </a>
              </p>
            ) : null}
            {agent.links.email ? <p>{agent.links.email}</p> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
