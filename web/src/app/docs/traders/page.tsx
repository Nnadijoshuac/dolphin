import type { Metadata } from "next";
import Link from "next/link";

import { Code, DocsPage, type DocsSection } from "@/components/docs-page";

export const metadata: Metadata = {
  title: "Trading agents",
  description: "Build a trading agent on Dolphin in one sentence, plug parts into it, publish it to the trading hub, and give it away or sell it.",
  alternates: { canonical: "/docs/traders" },
};

/*
 * THE PORTS (owner, 2026-10-13: "Dolphin is like a laptop... places to plug in extra stuff"). Only what
 * is built is listed: each port names the code that runs it, and the page changes when that code does.
 */
const SECTIONS: DocsSection[] = [
  {
    id: "one-sentence",
    title: "Start with one sentence",
    body: (
      <>
        <p>Open the builder and say what you want, in your own words:</p>
        <Code>{"Buy BNB when it drops a lot and sell when it goes back up. I have 30 dollars."}</Code>
        <p>
          Dolphin turns plain words into numbers (&ldquo;drops a lot&rdquo; becomes a 5% fall over a day), tells you the
          numbers it chose, and builds a rule. A rule needs no AI and no API key. Backtest it on a year of Binance
          prices, then run it with practice money before real money.
        </p>
      </>
    ),
  },
  {
    id: "ports",
    title: "The ports",
    body: (
      <>
        <p>Dolphin is the chassis. Each part below plugs into it, and each one is optional except the rule.</p>
        <ul>
          <li>
            <strong>Market.</strong> Binance&rsquo;s live candles for any pair, 1 minute to 1 day. A Price feed block draws
            the live chart.
          </li>
          <li>
            <strong>Rule.</strong> When to buy, when to sell, size, stop-loss, target and a daily cap. RSI, moving
            averages, MACD, trend, price, % change and Fibonacci levels.
          </li>
          <li>
            <strong>Brain.</strong> A model that must agree before each buy. The first brain is{" "}
            <strong>Jev</strong>, TypeSafe&rsquo;s fast decision model: on any rule, press <em>Ask Jev first</em>, or
            tell the builder &ldquo;check every buy with Jev&rdquo;. Add your key in Keys under any name you like, such as &ldquo;Jev&rdquo;. No key or no answer means no trade. Exits never wait for it.
          </li>
          <li>
            <strong>Hands.</strong> Where it trades: your Dolphin Wallet through PancakeSwap, Binance spot or futures
            with your API key, or your own server with the runner file.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "publish",
    title: "Publish it to the hub",
    body: (
      <p>
        Publish your agent and it is registered on BNB Chain as an ERC-8004 agent, next to every other agent there. A
        published agent whose rules trade from the Dolphin Wallet appears on <Link href="/trade">Trade</Link> under Built by the community,
        with its record from its own trades. Others see what it trades, its size, stop and target, never its
        conditions.
      </p>
    ),
  },
  {
    id: "sell",
    title: "Give it away, or sell it",
    body: (
      <>
        <p>On your trader&rsquo;s page, set a price in U, or leave it free.</p>
        <ul>
          <li>
            <strong>Free:</strong> anyone runs it in their own wallet.
          </li>
          <li>
            <strong>Priced:</strong> a buyer pays once, from their Dolphin Wallet straight to your payout wallet. Dolphin
            reads the payment on BNB Chain before it unlocks, holds nothing, and takes no fee.
          </li>
        </ul>
        <p>
          Either way your rules stay locked: they run on Dolphin and never reach the buyer. A brain runs on the
          buyer&rsquo;s own key, so selling a trader never spends yours.
        </p>
      </>
    ),
  },
  {
    id: "honest",
    title: "What the numbers mean",
    body: (
      <p>
        A backtest replays the rule on past prices with fees and gas counted. It skips any brain check, because a model
        cannot be asked about the past. A trader&rsquo;s live record comes only from trades it really made. Past results
        don&rsquo;t predict what happens next. See the <Link href="/policies/disclaimer">Disclaimer</Link>.
      </p>
    ),
  },
];

export default function Traders() {
  return (
    <DocsPage
      current="/docs/traders"
      sections={SECTIONS}
      summary={<p>Describe a trading agent in one sentence, plug in the parts you want, publish it to the hub, and give it away or sell it.</p>}
      title="Trading agents"
    />
  );
}
