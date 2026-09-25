"use client";

import Link from "next/link";
import { useRef } from "react";
import { formatUnits } from "viem";

import { AgentIcon } from "@/components/agent-icon";
import { CategoryGlyph } from "@/components/category-glyph";
import { categoryLabel } from "@/constants/agents";
import type { AgentShelfData } from "@/convex/api";
import type { AgentSignals } from "@/hooks/use-agents";
import { useImpression } from "@/hooks/use-impression";
import { track } from "@/lib/analytics";
import type { Agent } from "@/types/agent";

import styles from "./agent-shelf.module.css";

/**
 * The agent's own quoted price, or null. Never a default: a MISSING quote is
 * not free and renders nothing. A quote of exactly zero is the agent's own
 * signed number, and "Free" says it more plainly than "0 U".
 */
function priceLabel(agent: Agent): string | null {
  const pricing = agent.pricing;
  if (!pricing) return null;
  if (/^0+$/.test(pricing.amountRaw)) return "Free";
  if (pricing.display) return pricing.display;
  try {
    const amount = Number(formatUnits(BigInt(pricing.amountRaw), pricing.tokenDecimals));
    const formatted = amount.toLocaleString("en", { maximumFractionDigits: amount < 1 ? 4 : 2 });
    return `${formatted} ${pricing.tokenSymbol}`;
  } catch {
    return null;
  }
}

/** One earned fact, or nothing. A tile with no hires says what kind of agent it is. */
function signalLabel(agent: Agent, signals: AgentSignals | undefined): string {
  if (signals && signals.hires > 0) {
    return `${signals.hires} ${signals.hires === 1 ? "hire" : "hires"}`;
  }
  return agent.protocol === "a2a" ? "A2A agent" : "MCP server";
}

function ShelfTile({ agent, signals }: { agent: Agent; signals?: AgentSignals }) {
  const ref = useImpression<HTMLAnchorElement>(agent.agentKey);
  const price = priceLabel(agent);

  return (
    <li className={styles.item}>
      <Link
        className={styles.tile}
        href={`/agent/${agent.tokenId}`}
        onClick={() =>
          track("agent_card_opened", {
            agentKey: agent.agentKey,
            category: agent.category,
            surface: "discover",
          })
        }
        ref={ref}
      >
        <AgentIcon category={agent.category} seed={agent.iconSeed} size={72} uri={agent.iconUrl} />
        <h3 className={styles.name}>{agent.name}</h3>
        <p className={styles.category}>{categoryLabel(agent.category)}</p>
        <p className={styles.meta}>
          <span>{signalLabel(agent, signals)}</span>
          {price ? <span className={styles.price}>{price}</span> : null}
        </p>
      </Link>
    </li>
  );
}

export function AgentShelf({
  shelf,
  signals,
}: {
  shelf: AgentShelfData;
  signals: Map<string, AgentSignals>;
}) {
  const rowRef = useRef<HTMLUListElement>(null);
  const headingId = `shelf-${shelf.id}`;

  function scroll(direction: 1 | -1) {
    const row = rowRef.current;
    if (!row) return;
    row.scrollBy({ left: direction * row.clientWidth * 0.85, behavior: "smooth" });
  }

  return (
    <section aria-labelledby={headingId} className={styles.shelf}>
      <div className={styles.header}>
        <div className="min-w-0">
          <h2 className={styles.title} id={headingId}>
            {shelf.title}
          </h2>
          <p className={styles.subtitle}>{shelf.subtitle}</p>
        </div>
        <div className={styles.controls}>
          <button
            aria-label={`Scroll ${shelf.title} back`}
            className={styles.arrow}
            onClick={() => scroll(-1)}
            type="button"
          >
            <span className={styles.flip}>
              <CategoryGlyph color="currentColor" name="arrow-right" size={16} strokeWidth={2} />
            </span>
          </button>
          <button
            aria-label={`Scroll ${shelf.title} forward`}
            className={styles.arrow}
            onClick={() => scroll(1)}
            type="button"
          >
            <CategoryGlyph color="currentColor" name="arrow-right" size={16} strokeWidth={2} />
          </button>
          <Link className={styles.seeAll} href={shelf.href}>
            See all
          </Link>
        </div>
      </div>
      <ul className={styles.row} ref={rowRef}>
        {shelf.agents.map((agent) => (
          <ShelfTile agent={agent} key={agent.agentKey} signals={signals.get(agent.agentKey)} />
        ))}
      </ul>
    </section>
  );
}

export function AgentShelfSkeleton() {
  return (
    <div aria-busy="true" className={styles.shelf} role="status">
      <span className="sr-only">Loading featured agents</span>
      <div aria-hidden="true" className="skeleton h-6 w-56 rounded-md" />
      <div aria-hidden="true" className={styles.row}>
        {[0, 1, 2, 3, 4, 5].map((item) => (
          <div className={styles.item} key={item}>
            <div className={styles.tile}>
              <div className="skeleton h-[72px] w-[72px] rounded-[18px]" />
              <div className="skeleton mt-3 h-4 w-4/5 rounded-md" />
              <div className="skeleton mt-2 h-3 w-1/2 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
