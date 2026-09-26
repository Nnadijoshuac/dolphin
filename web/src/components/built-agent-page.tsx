"use client";

import { useQuery } from "convex/react";
import { useState } from "react";

import { BUILT_AGENT_CATEGORIES, builtAgentsApi } from "@/convex/api";

/**
 * THE PAGE OF AN AGENT BUILT ON DOLPHIN: /agent/<hash>. (2026-09-26)
 *
 * Everything shown is the published snapshot (convex/builtAgents.ts) and the
 * chain facts Dolphin confirmed: the token, its owner, its registration
 * transaction. Nothing here is a metric - a built agent has no track record
 * yet, so none is shown.
 */

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

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

  const category = BUILT_AGENT_CATEGORIES.find((option) => option.value === agent.category)?.label ?? agent.category;
  const status =
    agent.status === "registered"
      ? `ERC-8004 agent #${agent.tokenId} on ${agent.networkLabel}`
      : agent.status === "awaiting-signature"
        ? "Not on-chain yet: waiting for its owner to sign the registration"
        : "Taken offline by its owner";

  return (
    <div className="site-frame page-shell">
      <div className="mx-auto max-w-[44rem] py-8">
        <div className="flex items-start gap-4">
          <div className="size-20 shrink-0 overflow-hidden rounded-2xl border border-line/80 bg-paper-muted">
            {agent.iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- a Convex storage URL, resized server-side
              <img alt={`${agent.name} icon`} className="size-full object-cover" src={agent.iconUrl} />
            ) : null}
          </div>
          <div className="min-w-0">
            <p className="eyebrow">Built on Dolphin · {category}</p>
            <h1 className="mt-1 text-[1.6rem] font-semibold tracking-[-0.03em] text-ink">{agent.name}</h1>
            <p className={`mt-1 text-[0.8rem] ${agent.status === "registered" ? "text-ink-soft" : "text-muted"}`}>
              {status}
              {agent.network === "bsc-testnet" && agent.status === "registered" ? " (test network)" : ""}
            </p>
          </div>
        </div>

        <p className="mt-6 text-[0.98rem] leading-relaxed text-ink">{agent.description}</p>

        <div className="surface-raised mt-6 p-5">
          <p className="eyebrow">Tools it uses</p>
          <ul className="mt-2 space-y-1.5">
            {agent.tools.map((tool) => (
              <li className="text-[0.86rem] text-ink" key={`${tool.agentKey}:${tool.toolName}`}>
                <span className="font-mono">{tool.toolName}</span>
                <span className="text-muted"> · from {tool.agentName}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[0.74rem] leading-relaxed text-muted">
            It only reads. It cannot sign, trade or move funds, and it answers when asked.
          </p>
        </div>

        {agent.status !== "unpublished" ? (
          <div className="surface-raised mt-4 p-5">
            <p className="eyebrow">Use it from your own app or agent</p>
            <div className="mt-1 divide-y divide-line/60">
              <CopyLine label="MCP endpoint" value={agent.mcpUrl} />
              <CopyLine label="Registration file" value={agent.registrationUrl} />
            </div>
            <p className="mt-2 text-[0.74rem] leading-relaxed text-muted">
              Its MCP server offers <span className="font-mono">ask</span> (ask it a question) and the tools above.
            </p>
          </div>
        ) : null}

        <div className="mt-4 space-y-1 text-[0.8rem] text-ink-soft">
          <p>
            Owner <span className="font-mono">{short(agent.ownerAddress)}</span>
          </p>
          {agent.registerTxUrl ? (
            <a className="underline" href={agent.registerTxUrl} rel="noopener noreferrer" target="_blank">
              Registration transaction ↗
            </a>
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
      </div>
    </div>
  );
}
