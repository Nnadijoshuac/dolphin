"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AgentIcon } from "@/components/agent-icon";
import { CategoryGlyph } from "@/components/category-glyph";
import { HireAction } from "@/components/hire-action";
import { McpUseAction } from "@/components/mcp-use-action";
import { MobileStackHeader } from "@/components/mobile-stack-header";
import { TrackRecord } from "@/components/track-record";
import { useAgentReviews } from "@/hooks/use-agent-reviews";
import { useTokenMetadata } from "@/hooks/use-token-metadata";
import { convexClient } from "@/providers/convex-provider";
import { formatTokenAmount } from "@/wallet/erc8183-policy";
import type { Agent } from "@/types/agent";

function Reviews({ agent }: { agent: Agent }) {
  const reviews = useAgentReviews(agent.agentKey);
  if (!reviews?.total) return null;
  return <section className="mobile-detail-section"><h2>Reviews</h2><TrackRecord agentKey={agent.agentKey} agentName={agent.name} /></section>;
}

export function MobileAgentDetail({ agent, registry }: { agent: Agent; registry: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const price = agent.priceModel.status === "live" || agent.priceModel.status === "stale" ? agent.priceModel.value : null;
  const token = agent.pricing?.token || (price?.token.startsWith("0x") ? price.token : null);
  const metadata = useTokenMetadata(token);
  const priceText = (() => {
    if (agent.protocol === "mcp") return "Free to Connect";
    if (agent.pricing?.display) return agent.pricing.display;
    const raw = agent.pricing?.amountRaw ?? price?.amount;
    if (raw == null) return "Price not reported yet";
    if (Number(raw) === 0) return "Free to hire";
    if (token) {
      const decimals = agent.pricing?.tokenDecimals ?? metadata?.decimals;
      const symbol = agent.pricing?.tokenSymbol ?? metadata?.symbol;
      return decimals == null || !symbol ? "Syncing price…" : `${formatTokenAmount(raw, decimals)} ${symbol}`;
    }
    return `${raw} ${price?.token ?? ""}`;
  })();
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const frame = document.querySelector<HTMLElement>(".app-frame");
    const wasInert = frame?.inert ?? false;
    // A body portal keeps WalletConnect's own modal above this sheet. Native
    // showModal() would put that SDK portal behind an inert top-layer dialog.
    if (frame) frame.inert = true;
    element?.querySelector<HTMLButtonElement>("button")?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const keyboard = (event: KeyboardEvent) => {
      // Let another portal (the wallet chooser) manage its own keyboard focus.
      if (!element?.contains(document.activeElement) && document.activeElement !== document.body) return;
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
      if (event.key !== "Tab" || !element) return;
      const controls = [...element.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')].filter(control => control.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("keydown", keyboard);
      if (frame) frame.inert = wasInert;
      document.body.style.overflow = previous;
      previousFocus?.focus();
    };
  }, [open]);
  const publisher = agent.publisher?.startsWith("0x") ? `${agent.publisher.slice(0, 8)}…${agent.publisher.slice(-6)}` : agent.publisher;
  return <>
    <MobileStackHeader title={agent.name} share />
    <div className="mobile-agent-detail">
      <header className="mobile-detail-identity"><AgentIcon category={agent.category} seed={agent.iconSeed} size={72} uri={agent.iconUrl} /><div><h1>{agent.name}</h1><p>{publisher || "Unlisted publisher"} <span>· #{agent.tokenId}</span></p></div></header>
      {agent.tagline && <p className="mobile-detail-tagline">{agent.tagline}</p>}
      <section className="mobile-detail-action">
        <div><p>{agent.protocol === "mcp" ? "MCP server" : "Hire price"}</p><h2>{priceText}</h2></div>
        <button className="mobile-pearl" type="button" onClick={() => setOpen(true)}>{agent.protocol === "mcp" ? "Use" : "Hire this agent"}</button>
        <p>{agent.protocol === "mcp" ? "Connect to your AI client" : "Review the price and payment before hiring"}</p>
      </section>
      <section className="mobile-detail-section"><h2>Overview</h2><p className="mobile-detail-description">{expanded ? agent.description : agent.description.slice(0, 220)}{agent.description.length > 220 && <> {expanded ? "" : "… "}<button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Show less" : "Show more"}</button></>}</p>
        {agent.skills.length > 0 && <div className="mobile-detail-skills">{agent.skills.map(skill => <span key={`${skill.name}-${skill.evidence}`}>{skill.name}</span>)}</div>}
      </section>
      {convexClient && <Reviews agent={agent} />}
      <div className="mobile-detail-registry">{registry}</div>
    </div>
    {open && createPortal(<div className="mobile-sheet-backdrop" onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}><div ref={dialog} role="dialog" aria-modal="true" className="mobile-action-sheet" aria-labelledby="mobile-action-title">
      <header><h2 id="mobile-action-title">{agent.protocol === "mcp" ? "Use" : "Hire"} {agent.name}</h2><button className="mobile-circle" type="button" aria-label="Close" onClick={() => setOpen(false)}><CategoryGlyph name="close" size={18} /></button></header>
      {agent.protocol === "mcp" ? <McpUseAction agent={agent} /> : <HireAction agent={agent} />}
    </div></div>, document.body)}
  </>;
}
