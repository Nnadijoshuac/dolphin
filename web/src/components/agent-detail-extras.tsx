"use client";

/**
 * The parts of an agent's page that make it make sense at first glance
 * (owner, 2026-09-29: "serious, but you should be able to make sense from what
 * you're seeing" - most crypto pages drown a newcomer in jargon).
 *
 *   AtAGlance        four plain facts under the name: cost, how it works,
 *                    whether it is online, and its track record.
 *   PublisherAgents  "Other agents from this wallet" - EXISTS ONLY when the
 *                    wallet has other listed agents; otherwise not rendered.
 *   SimilarAgents    a carousel of agents in the same category, before the
 *                    footer; not rendered when there are none.
 *   plainSkillName   `getVaultsWithTokens` -> "Get vaults with tokens".
 */

import Link from "next/link";
import { useQuery } from "convex/react";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import { AgentCard } from "@/components/agent-card";
import { AgentIcon } from "@/components/agent-icon";
import { priceLabel } from "@/components/agent-shelf";
import { CategoryGlyph } from "@/components/category-glyph";
import { categoryLabel } from "@/constants/agents";
import { api } from "@/convex/api";
import { useAgentList, useAgentSignals } from "@/hooks/use-agents";
import { useNow } from "@/hooks/use-now";
import { convexClient } from "@/providers/convex-provider";
import { ESCROW_REFUND_DAYS } from "@/wallet/erc8183-policy";
import type { Agent } from "@/types/agent";

/** A tool name written for code, said in words. Names that already have spaces are left alone. */
/**
 * Skills a buyer can act on. An A2A seller also publishes the plumbing of being
 * paid - "Negotiate an ERC-8183 job", "Notify the seller a job is funded" -
 * which Dolphin itself calls during a hire. Listed beside what the agent
 * actually does, it reads as a feature and means nothing to the person hiring.
 */
const PAYMENT_PLUMBING = /(negotiat|erc[\s-]?8183|escrow|job is funded|funded job|notify the seller|submit(ted)? (a |the )?deliverable|deliver(y)? (a |the )?job)/i;
export function buyerSkills<T extends { name: string }>(skills: readonly T[]): T[] {
  return skills.filter((skill) => !PAYMENT_PLUMBING.test(skill.name));
}

export function plainSkillName(name: string): string {
  if (/\s/.test(name.trim())) return name;
  const words = name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    // Acronyms (CLM, APY, ERC) keep their capitals; ordinary words are lowercased.
    .map((word) => (word.length > 1 && word === word.toUpperCase() ? word : word.toLowerCase()));
  if (words.length === 0) return name;
  words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
  return words.join(" ");
}

function ago(value: string | null | undefined, now: number): string | null {
  if (!value || now === 0) return null;
  const at = new Date(value).getTime();
  if (Number.isNaN(at) || at > now) return null;
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Four plain facts. Every one is read, none is estimated. */
export function AtAGlance({ agent }: { agent: Agent }) {
  const now = useNow();
  const signals = useAgentSignals(convexClient ? [agent] : []).get(agent.agentKey);
  const isTools = agent.protocol === "mcp";
  // The total a hire costs, the same figure as every card and the hire button.
  // A tool server's price is per call (knowledge, step 4); none published reads Free, as before.
  const label = priceLabel(agent);
  const price = label;
  const paidTools = isTools && Boolean(label) && label !== "Free";
  const checked = ago(agent.verification?.lastProbeAt ?? agent.verifiedAt, now);
  const online = agent.status === "live";

  const facts: { label: string; value: string; sub: string | null; dot?: boolean }[] = [
    {
      label: "Cost",
      value: isTools ? (paidTools ? (label as string) : "Free") : price === "Free" ? "Free" : price ? price : "Quoted when you hire",
      sub: isTools ? (paidTools ? "per call, paid with x402" : "No fees to use it") : price && price !== "Free" ? "per job" : null,
    },
    {
      label: "Type",
      value: isTools ? "Tools you connect" : "Hire it for a job",
      sub: isTools ? "Connect it to your AI app" : "Your payment is held until it delivers",
    },
    {
      label: "Status",
      value: online ? "Online" : agent.status === "unavailable" ? "Offline" : "Not responding",
      sub: checked ? `Checked ${checked}` : null,
      dot: online,
    },
    {
      label: "Track record",
      value: signals && signals.hires > 0 ? `${signals.hires} ${signals.hires === 1 ? "hire" : "hires"}` : "New",
      sub:
        signals && signals.reviews > 0
          ? `${signals.wouldHireAgain} of ${signals.reviews} would hire again`
          : signals && signals.hires > 0
            ? "No reviews yet"
            : "No hires yet",
    },
  ];

  return (
    <dl className="glance">
      {facts.map((fact) => (
        <div className="glance__item" key={fact.label}>
          <dt className="glance__label">{fact.label}</dt>
          <dd className="glance__value">
            {fact.dot ? <span aria-hidden="true" className="glance__dot" /> : null}
            {fact.value}
          </dd>
          {fact.sub ? <dd className="glance__sub">{fact.sub}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

function PublisherRow({ agent }: { agent: Agent }) {
  const label = agent.protocol === "mcp" ? priceLabel(agent) ?? "Tools" : priceLabel(agent);
  const price = label;
  return (
    <li>
      <Link className="publisher-row" href={`/agent/${agent.tokenId}`}>
        <AgentIcon category={agent.category} seed={agent.iconSeed} size={32} uri={agent.iconUrl} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.86rem] font-medium text-ink">{agent.name}</span>
          <span className="block truncate text-[0.72rem] text-muted">{categoryLabel(agent.category)}</span>
        </span>
        {price ? <span className="shrink-0 text-[0.76rem] text-ink-soft">{price}</span> : null}
      </Link>
    </li>
  );
}

/** Rendered ONLY when the publishing wallet has other listed agents. */
export function PublisherAgents({ agent }: { agent: Agent }) {
  if (!convexClient || !agent.publisherAddress) return null;
  return <BackendPublisherAgents agent={agent} ownerAddress={agent.publisherAddress} />;
}

function BackendPublisherAgents({ agent, ownerAddress }: { agent: Agent; ownerAddress: string }) {
  const others = useQuery(api.agents.byOwner, { ownerAddress, excludeKey: agent.agentKey });
  const [open, setOpen] = useState(false);
  if (!others || others.length === 0) return null;

  return (
    <section className="detail-card overflow-hidden !p-0">
      <button
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-6 py-5 text-left"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="detail-card__title">Other agents from this wallet</span>
        <span className="flex items-center gap-2 text-[0.8rem] text-muted">
          {others.length >= 24 ? "24+" : others.length}
          <span className={`flex transition-transform duration-200 ${open ? "rotate-90" : ""}`}>
            <CategoryGlyph color="currentColor" name="chevron-right" size={14} />
          </span>
        </span>
      </button>
      <div className="reveal" data-open={open || undefined} inert={!open}>
        <div className="reveal__inner">
          <ul className="publisher-list">
            {others.map((other) => (
              <PublisherRow agent={other} key={other.agentKey} />
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/** Same category, this agent left out. Not rendered when there is nothing to show. */
export function SimilarAgents({ agent }: { agent: Agent }) {
  const { agents } = useAgentList({ category: agent.category });
  const similar = agents.filter((other) => other.agentKey !== agent.agentKey).slice(0, 12);
  const signals = useAgentSignals(similar);
  const railRef = useRef<HTMLDivElement>(null);

  if (similar.length === 0) return null;

  const scrollBy = (direction: 1 | -1) => {
    const rail = railRef.current;
    if (rail) rail.scrollBy({ left: direction * rail.clientWidth * 0.85, behavior: "smooth" });
  };

  return (
    <section aria-labelledby="similar-heading" className="similar">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[1.15rem] font-semibold tracking-[-0.02em] text-ink" id="similar-heading">
            Similar agents
          </h2>
          <p className="mt-0.5 text-[0.82rem] text-muted">More in {categoryLabel(agent.category)}</p>
        </div>
        {similar.length > 2 ? (
          <div className="hidden gap-2 sm:flex">
            <button aria-label="Scroll back" className="similar__arrow" onClick={() => scrollBy(-1)} type="button">
              <CategoryGlyph color="currentColor" name="chevron-left" size={15} />
            </button>
            <button aria-label="Scroll forward" className="similar__arrow" onClick={() => scrollBy(1)} type="button">
              <CategoryGlyph color="currentColor" name="chevron-right" size={15} />
            </button>
          </div>
        ) : null}
      </div>
      <div className="similar__rail no-scrollbar" ref={railRef}>
        {similar.map((other) => (
          <div className="similar__item" key={other.agentKey}>
            <AgentCard agent={other} signals={signals.get(other.agentKey)} surface="search" />
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * HOW IT WORKS, as a journey (2026-09-29). The escrow, the policy window and
 * the MCP transport, told as four things that happen, in order, in plain
 * words. The line draws itself and the steps light up in turn when the section
 * scrolls into view. The window is ESCROW_REFUND_DAYS, read off the chain.
 * Deliberately says what happens and nothing more: nobody reviews the work,
 * so no step claims anyone checks it (the hire panel carries that notice).
 */
export function HowItWorks({ agent }: { agent: Agent }) {
  const ref = useRef<HTMLOListElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const list = ref.current;
    if (!list || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  const isTools = agent.protocol === "mcp";
  const label = priceLabel(agent);
  const price = label;
  const paidTools = isTools && Boolean(label) && label !== "Free";
  const days = ESCROW_REFUND_DAYS;
  const steps = isTools
    ? [
        { title: "Copy its link", body: "One address, from the panel on this page." },
        { title: "Add it to your AI app", body: "Claude, Cursor, or any app that supports MCP." },
        { title: "Ask in plain words", body: `Your AI uses ${agent.name}’s tools for you.` },
        paidTools
          ? { title: "Pay per call", body: "Paid tools cost U per call, paid by your AI app with x402 straight to the builder. Free tools cost nothing." }
          : { title: "Nothing to pay", body: "No wallet to connect and no fees to use it." },
      ]
    : [
        {
          title: "You pay",
          body:
            price && price !== "Free"
              ? `${label} is held safely - it does not go to the agent yet.`
              : "The price is held safely - it does not go to the agent yet.",
        },
        { title: "It does the job", body: `${agent.name} works on your request and sends back the result.` },
        { title: "You get the result", body: "It shows up in My Agents, with every step recorded." },
        {
          title: "Then it is paid",
          body: `The agent is paid ${days} days after it delivers. If it never delivers, you get your money back.`,
        },
      ];

  return (
    <section className="detail-card">
      <h2 className="detail-card__title">How it works</h2>
      <ol className="journey" data-seen={seen || undefined} ref={ref}>
        {steps.map((step, index) => (
          <li className="journey__step" key={step.title} style={{ "--step": index } as CSSProperties}>
            <span aria-hidden="true" className="journey__dot">
              {index + 1}
            </span>
            <p className="journey__title">{step.title}</p>
            <p className="journey__body">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * ONE LINE, AND "SHOW MORE" ONLY WHEN IT DOES NOT FIT (owner, 2026-09-29: the
 * name and the line under it "must be on one line so the agent always looks
 * perfect"). Overflow is measured, not guessed from a character count, and
 * re-measured when the width changes; text that fits gets no button.
 */
export function OneLine({
  as: Tag = "p",
  className = "",
  children,
  text,
}: {
  as?: "p" | "h1";
  className?: string;
  children?: React.ReactNode;
  text: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      if (!open) setOverflows(node.scrollWidth > node.clientWidth + 1);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [open, text]);

  return (
    <Tag className={`one-line ${className}`} data-open={open || undefined}>
      <span className="one-line__text" ref={ref} title={open ? undefined : text}>
        {text}
      </span>
      {children}
      {overflows ? (
        <button className="one-line__more" onClick={() => setOpen((value) => !value)} type="button">
          {open ? "Show less" : "Show more"}
        </button>
      ) : null}
    </Tag>
  );
}
