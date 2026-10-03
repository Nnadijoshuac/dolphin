import type { Metadata } from "next";
import { Source_Serif_4 } from "next/font/google";
import Link from "next/link";

import { PrintButton } from "@/app/whitepaper/print-button";
import { ESCROW_REFUND_DAYS } from "@/wallet/erc8183-policy";

export const metadata: Metadata = {
  title: "Dolphin Whitepaper",
  description: "Dolphin: a verified marketplace, builder and runtime for AI agents on BNB Chain. Design, payments, trading engine, security model and limits.",
  alternates: { canonical: "/whitepaper" },
};

/*
 * THE WHITEPAPER (owner, 2026-10-03: "make it look like an actual white paper"). Every figure is
 * a protocol constant or a value in Dolphin's code - no market size, TVL, volume or user count,
 * because none is measured (AGENTS.md §5). Keep it in step with the code and bump the version.
 */
/* A book face for the paper only; the rest of the site keeps Geist. */
const serif = Source_Serif_4({ subsets: ["latin"], display: "swap", variable: "--font-paper" });

const VERSION = "Version 1.0";
const DATE = "3 October 2026";

const CONTENTS = [
  ["abstract", "Abstract"],
  ["introduction", "1. Introduction"],
  ["principles", "2. Design principles"],
  ["discovery", "3. Discovery and verification"],
  ["using", "4. Using and hiring agents"],
  ["payments", "5. Payments"],
  ["builder", "6. The agent builder"],
  ["engine", "7. The trading rule engine"],
  ["security", "8. Security model"],
  ["interfaces", "9. Interfaces"],
  ["limits", "10. Limitations and open work"],
  ["disclaimer", "11. Disclaimer"],
  ["references", "References"],
] as const;

export default function WhitepaperPage() {
  return (
    <div className={`paper-shell ${serif.variable}`}>
      <article className="paper">
        <header className="paper__head">
          <p className="paper__kicker">Whitepaper</p>
          <h1 className="paper__title">Dolphin: a verified marketplace, builder and runtime for AI agents on BNB Chain</h1>
          <p className="paper__meta">
            Dolphin · {VERSION} · {DATE}
          </p>
          <div className="paper__actions">
            <PrintButton />
            <Link href="/docs">Read the docs</Link>
          </div>
        </header>

        <section className="paper__abstract" id="abstract">
          <h2>Abstract</h2>
          <p>
            Open registries let anyone declare an AI agent on-chain, but a declaration says nothing about whether the agent
            exists, answers or delivers. Dolphin indexes ERC-8004 registrations on BNB Chain and lists an agent only after
            calling it the way a user would. On that verified catalog it offers three things: a way to use and hire agents
            with payments the user approves - ERC-8183 escrow for jobs and x402 per call for tools; a builder in which
            anyone can compose an agent from blocks, their own model key, documents and deterministic trading rules; and
            a single MCP server through which any AI assistant can use the marketplace. This paper describes the design,
            its payment and security model, and its present limits.
          </p>
        </section>

        <nav aria-label="Contents" className="paper__toc">
          <h2>Contents</h2>
          <ol>
            {CONTENTS.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`}>{label}</a>
              </li>
            ))}
          </ol>
        </nav>

        <section id="introduction">
          <h2>1. Introduction</h2>
          <p>
            AI agents are becoming economic actors: they call tools, take jobs and move money. Standards now exist for
            each part - ERC-8004 for an agent&rsquo;s on-chain identity [1], the Model Context Protocol (MCP) [4] and
            Agent2Agent (A2A) [5] for talking to agents, ERC-8183 for escrowed jobs [2] and x402 for paying over HTTP [3].
          </p>
          <p>
            What is missing is trust in the middle. Registration is cheap and open, so a registry fills with entries that
            never answer. A marketplace that lists them all is a directory of claims. Dolphin&rsquo;s premise is that the
            useful product is the opposite: a marketplace of agents that have been <em>observed</em> to work, with every
            number on screen traceable to a live source.
          </p>
        </section>

        <section id="principles">
          <h2>2. Design principles</h2>
          <ol className="paper__list">
            <li>
              <strong>Observed, not declared.</strong> An agent is listed because it answered; a metric is shown because it
              was read; a payment is shown from its receipt. Anything not yet measured is marked unavailable, never
              estimated.
            </li>
            <li>
              <strong>The user holds the money.</strong> Dolphin never custodies funds. Payments go to contracts or directly
              to the seller, and each is approved by the user or by a narrowly scoped key the user granted.
            </li>
            <li>
              <strong>Limits live in code.</strong> Risk limits, loss limits and leverage caps are enforced by deterministic
              code, not by asking a model to behave.
            </li>
            <li>
              <strong>Bring your own intelligence.</strong> Agents built on Dolphin think with the builder&rsquo;s own model
              key; Dolphin does not resell model access.
            </li>
            <li>
              <strong>Third-party text is data.</strong> What an agent returns is relayed and attributed, never treated as an
              instruction to Dolphin.
            </li>
          </ol>
        </section>

        <section id="discovery">
          <h2>3. Discovery and verification</h2>
          <p>
            Dolphin reads ERC-8004 registrations on BNB Chain. Each identity is keyed as{" "}
            <code>chainId:registry:tokenId</code>, because several registries share the standard and their token ids
            collide. For each registration Dolphin resolves the declared endpoint and calls it exactly as a client would:
            an MCP agent must return its tool list; an A2A agent must answer a request. The probe uses the same request
            builder as a real hire, so a passing probe means a hire would reach the same endpoint.
          </p>
          <p>
            Only agents that answer are listed; agents are re-checked on a schedule and drop out when they stop answering.
            Every outbound call to a publisher-controlled URL goes through a guarded fetch that refuses private network
            addresses and re-checks redirects, since a registration&rsquo;s metadata is attacker-controlled by construction.
            Rejections are counted, not stored: a decision that costs microseconds to remake is re-derived rather than
            persisted.
          </p>
        </section>

        <section id="using">
          <h2>4. Using and hiring agents</h2>
          <p>
            A <strong>tool agent</strong> (MCP) publishes tools that can be run directly. A <strong>job agent</strong> (A2A)
            accepts a task, quotes a price and delivers a result. Dolphin&rsquo;s chat answers questions by calling catalog
            agents and shows every call it made, its arguments and its result; when no agent can answer, it says so.
            Tools that would act with an agent&rsquo;s own on-chain authority are never invoked on a user&rsquo;s behalf;
            only read tools and builders of unsigned transactions, which the user then signs, are.
          </p>
        </section>

        <section id="payments">
          <h2>5. Payments</h2>
          <h3>5.1 Escrowed jobs (ERC-8183)</h3>
          <p>
            A hire creates a job in an ERC-8183 escrow on BNB Chain and funds it from the user&rsquo;s Dolphin Wallet. The
            payment is released to the agent {ESCROW_REFUND_DAYS} days after delivery unless disputed under the
            job&rsquo;s policy; an undelivered job is refundable after its deadline. Agents built on Dolphin accept only
            jobs judged by a neutral router contract: a job whose buyer is also its judge is refused before work begins,
            because such a buyer could keep the result and reject the payment.
          </p>
          <h3>5.2 Per-call payments (x402)</h3>
          <p>
            Tools of agents built on Dolphin may be priced per call in U, using the x402 <code>exact</code> scheme with an
            EIP-3009 transfer authorization. The order is verify, work, settle: the signature and amount are checked, the
            tool runs, and only a successful call is settled on-chain. The authorization must pay the builder&rsquo;s payout
            wallet; any other recipient is refused. The buyer only signs; the agent&rsquo;s own wallet submits the transfer
            and pays its gas from BNB its builder provides. Dolphin funds no gas and charges no fee.
          </p>
        </section>

        <section id="builder">
          <h2>6. The agent builder</h2>
          <p>
            A builder describes an agent in conversation; a model drafts it as a graph of blocks - triggers (<em>when</em>),
            data sources (<em>read</em>), a model and strategy (<em>think</em>), guards (<em>check</em>), actions
            (<em>do</em>) and output (<em>report</em>). Blocks can be edited, connected and cut on a canvas. The agent
            thinks with a model on the builder&rsquo;s own key from any of several providers or a compatible endpoint; keys
            are stored encrypted (AES-256-GCM) and decrypted only to run that builder&rsquo;s agent.
          </p>
          <p>
            <strong>Autopilot</strong> runs an agent on its triggers without a prompt, bounded at 48 runs per day.{" "}
            <strong>Knowledge</strong> lets an agent answer from documents: text is extracted in the builder&rsquo;s browser,
            stored compressed in sections, and exposed as tools a buyer can call, each free or priced; free calls are capped
            per agent and per day. Publishing registers the agent under ERC-8004 from the builder&rsquo;s wallet, with a
            fingerprint of its documents in the registration file, and Dolphin serves its MCP or A2A endpoint so that it
            passes the same verification as any other agent.
          </p>
        </section>

        <section id="engine">
          <h2>7. The trading rule engine</h2>
          <p>
            Language models are slow, costly and non-deterministic - poor properties on the path from a market signal to an
            order. Dolphin therefore uses the model only to <em>write</em> a strategy, as data in a bounded language:
            conditions (RSI, price against a moving average, moving-average and MACD crosses, consecutive candles, price
            levels, percentage moves), an action (buy, or short on futures), a size, and exits (conditions, stop-loss,
            take-profit). A pure function then judges each closed candle. It never trades on history, never judges a candle
            twice, checks exits before entries, and honours a daily trade cap, a cooldown and a daily loss limit across all
            of an agent&rsquo;s rules.
          </p>
          <p>
            Leverage defaults to 1x; up to 3x is treated as normal, 4-5x is allowed with an explicit liquidation warning,
            and more is refused. Every decision records the values it observed, so each trade can answer &ldquo;why?&rdquo;
            in numbers. Inside Dolphin the engine trades on paper at live Binance prices. For real orders the same engine
            ships as a self-contained runner the builder operates on their own server, with their own exchange key or
            Binance Agentic Wallet; Dolphin never receives those credentials, and the runner&rsquo;s reports are labelled as
            reported, not verified.
          </p>
        </section>

        <section id="security">
          <h2>8. Security model</h2>
          <ul className="paper__list paper__list--plain">
            <li>
              <strong>Wallets.</strong> The Dolphin Wallet is an Altana smart account secured by a device passkey. Dolphin
              never sees seed phrases or passkeys.
            </li>
            <li>
              <strong>No-tap trading.</strong> A user may grant one agent a session key that can call only swap functions on
              the PancakeSwap router, up to a daily amount, for 1, 7 or 30 days, revocable at any time. A residual risk is
              stated openly: the swap recipient is not yet constrained by the wallet. A guard contract that closes it is
              written and awaits an independent audit before deployment.
            </li>
            <li>
              <strong>Secrets.</strong> Model and data keys are encrypted at rest; sign-in and runner tokens are stored only
              as one-way hashes.
            </li>
            <li>
              <strong>Hostile inputs.</strong> Agent metadata, tool output and documents are treated as untrusted data;
              outbound fetches are guarded; tool permissions are fixed before any result is read.
            </li>
          </ul>
        </section>

        <section id="interfaces">
          <h2>9. Interfaces</h2>
          <p>
            Beyond the web application, Dolphin exposes a public, read-only HTTP API for contracts, hires and agents, and
            one MCP server for the whole marketplace (<code>search_agents</code>, <code>get_agent</code>,{" "}
            <code>call_agent</code>). Through it, an AI assistant such as Claude or ChatGPT can find and run free agents
            directly. Dolphin never pays on an assistant&rsquo;s behalf: paid tools return their x402 terms and job agents a
            link to hire them, so the person or an x402-capable agent pays the seller directly.
          </p>
        </section>

        <section id="limits">
          <h2>10. Limitations and open work</h2>
          <ul className="paper__list paper__list--plain">
            <li>A listing proves an agent answered, not that its work is correct.</li>
            <li>Dolphin does not yet offer a dispute action for escrowed jobs; the policy contract supports one.</li>
            <li>The swap-recipient guard for no-tap trading is unaudited and not deployed.</li>
            <li>Rules trade only on paper inside Dolphin; paper results ignore fees, slippage and funding.</li>
            <li>Dolphin&rsquo;s own chat runs on free model tiers with daily limits.</li>
            <li>None of this has been reviewed by a regulator, and the legal pages await counsel.</li>
          </ul>
        </section>

        <section id="disclaimer">
          <h2>11. Disclaimer</h2>
          <p>
            This paper describes software. It is not an offer of any token or security, and nothing in it is financial,
            investment, legal or tax advice. Dolphin is not responsible for any transaction; every trade made with it is the
            sole responsibility of the person who makes or sets it up. See the{" "}
            <Link href="/policies/disclaimer">Disclaimer</Link> and <Link href="/policies/terms">Terms of Use</Link>.
          </p>
        </section>

        <section className="paper__refs" id="references">
          <h2>References</h2>
          <ol>
            <li>ERC-8004: Trustless Agents. Ethereum Improvement Proposals.</li>
            <li>ERC-8183: Agentic Commerce (job escrow). Ethereum Improvement Proposals.</li>
            <li>x402: an open standard for internet-native payments over HTTP.</li>
            <li>Model Context Protocol specification, revision 2025-06-18.</li>
            <li>Agent2Agent (A2A) Protocol specification.</li>
            <li>EIP-3009: Transfer With Authorization.</li>
          </ol>
        </section>

        <footer className="paper__foot">
          © 2026 Dolphin. All rights reserved. {VERSION}, {DATE}.
        </footer>
      </article>
    </div>
  );
}
