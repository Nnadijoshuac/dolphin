import type { Metadata } from "next";
import Link from "next/link";

import { JsonLd } from "@/components/json-ld";
import { categoryLabel } from "@/constants/agents";
import { SITE_URL } from "@/constants/site";
import { fetchAgentDirectory, fetchLiveRuns, fetchSetups, fetchTraders, type DirectoryAgent } from "@/server/convex";

/**
 * EVERY AGENT ON DOLPHIN, AS PLAIN LINKS (2026-10-19).
 *
 * Measured on prod the same day: not one page's server HTML linked to a single agent, trader, live run
 * or setup - the catalog loads in the browser, so a crawler that follows links found none of them, and
 * they were reachable only through the sitemap. Search engines rank a page partly by the links that
 * reach it; an orphan ranks badly or not at all. This page is the hub: server-rendered, linked from the
 * footer of every page, one link to everything Dolphin lists, grouped the way people search for it.
 *
 * No number appears here (AGENTS.md SS5): a directory is rebuilt hourly, and a record or a balance would
 * be stale on the page. Each link leads to the live one.
 */
export const revalidate = 3_600;

export const metadata: Metadata = {
  title: "AI agent directory: every agent on Dolphin",
  description:
    "Every AI agent listed on Dolphin, the on-chain AI agent marketplace on BNB Chain: trading agents, live runs on real money, trading setups, and ERC-8004 agents by category.",
  alternates: { canonical: "/agents" },
};

export default async function AgentsDirectoryPage() {
  const [agents, traders, runs, setups] = await Promise.all([fetchAgentDirectory(), fetchTraders(), fetchLiveRuns(), fetchSetups()]);

  const byCategory = new Map<string, DirectoryAgent[]>();
  for (const agent of agents) byCategory.set(agent.category, [...(byCategory.get(agent.category) ?? []), agent]);
  const categories = [...byCategory.entries()]
    .map(([slug, list]) => ({ slug, label: categoryLabel(slug), list: [...list].sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => b.list.length - a.list.length || a.label.localeCompare(b.label));

  return (
    <div className="site-frame page-shell">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "AI agent directory",
          url: `${SITE_URL}/agents`,
          isPartOf: { "@id": `${SITE_URL}/#website` },
          mainEntity: {
            "@type": "ItemList",
            numberOfItems: agents.length,
            itemListElement: agents.slice(0, 200).map((agent, index) => ({
              "@type": "ListItem",
              position: index + 1,
              name: agent.name,
              url: `${SITE_URL}/agent/${encodeURIComponent(agent.tokenId)}`,
            })),
          },
        }}
      />
      <article className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Directory</p>
        <h1 className="mt-2 text-3xl font-semibold text-ink">Every AI agent on Dolphin</h1>
        <p className="mt-4 text-sm leading-6 text-muted">
          Dolphin is an on-chain AI agent marketplace on BNB Chain. It lists the ERC-8004 agents that really answer when
          called, trading agents with their records in the open, and agents trading real money live. This page links to
          all of them. To find one by what it does, use <Link className="underline" href="/search">search</Link>.
        </p>

        {traders.length > 0 ? (
          <Section title="Trading agents" href="/trade" lead="Run one in your own wallet, on practice money first.">
            {traders.map((trader) => (
              <Item href={`/trade/${encodeURIComponent(trader.id)}`} key={trader.id} line={trader.tagline} name={trader.name} />
            ))}
          </Section>
        ) : null}

        {runs.length > 0 ? (
          <Section title="Live: agents trading real money" href="/live" lead="Every decision on the page, every trade on BscScan.">
            {runs.map((run) => (
              <Item
                href={`/live/${encodeURIComponent(run.slug)}`}
                key={run.slug}
                line={run.status === "running" ? "Trading now" : "Run finished"}
                name={run.name}
              />
            ))}
          </Section>
        ) : null}

        {setups.length > 0 ? (
          <Section title="Trading setups" href="/setups" lead="Whole trading-agent setups you can copy into your own agent.">
            {setups.map((setup) => (
              <Item href={`/setups/${encodeURIComponent(setup.id)}`} key={setup.id} line={setup.summary} name={setup.title} />
            ))}
          </Section>
        ) : null}

        {categories.map((category) => (
          <Section
            href={`/search?category=${encodeURIComponent(category.slug)}`}
            key={category.slug}
            title={`${category.label} agents`}
          >
            {category.list.map((agent) => (
              <Item href={`/agent/${encodeURIComponent(agent.tokenId)}`} key={agent.tokenId} line={agent.tagline} name={agent.name} />
            ))}
          </Section>
        ))}

        {agents.length === 0 ? (
          <p className="mt-10 text-sm leading-6 text-muted">
            The catalog could not be read just now. <Link className="underline" href="/search">Search agents</Link> instead.
          </p>
        ) : null}

        <section className="mt-12 border-t border-line pt-5">
          <h2 className="text-base font-semibold text-ink">Build your own</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Describe a trading agent in plain words and Dolphin builds it: rules that run on every closed candle, on
            practice money until you switch it to live. <Link className="underline" href="/dolphin">Build an agent</Link>,
            or <Link className="underline" href="/docs/mcp">build it from Claude or ChatGPT</Link>.
          </p>
        </section>
      </article>
    </div>
  );
}

function Section({ title, href, lead, children }: { title: string; href: string; lead?: string; children: React.ReactNode }) {
  return (
    <section className="mt-10 border-t border-line pt-5">
      <h2 className="text-base font-semibold text-ink">
        <Link className="hover:underline" href={href}>
          {title}
        </Link>
      </h2>
      {lead ? <p className="mt-1 text-sm leading-6 text-muted">{lead}</p> : null}
      <ul className="mt-3 space-y-2">{children}</ul>
    </section>
  );
}

function Item({ href, name, line }: { href: string; name: string; line: string | null }) {
  return (
    <li className="text-sm leading-6">
      <Link className="font-medium text-ink hover:underline" href={href}>
        {name}
      </Link>
      {line ? <span className="text-muted"> — {line.length > 140 ? `${line.slice(0, 137).trimEnd()}…` : line}</span> : null}
    </li>
  );
}
