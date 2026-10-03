import type { Metadata } from "next";
import Link from "next/link";

import { LegalDoc, type LegalSection } from "@/components/legal-doc";
import { contactLine } from "@/constants/legal";

export const metadata: Metadata = {
  title: "Disclaimer",
  description: "Dolphin gives no financial, legal or tax advice, and every trade is the responsibility of the person who makes or sets it up.",
  alternates: { canonical: "/policies/disclaimer" },
};

/*
 * THE DISCLAIMER (owner, 2026-10-03: "Dolphin is not responsible for any transaction, our models
 * don't give legal advice, any trade is solely the responsibility of the person taking it").
 * Plain words, one page, linked from the footer, the Terms and the Autopilot confirmation.
 * NOT LEGAL ADVICE - to be reviewed by counsel before a public launch (constants/legal.ts).
 */
const SECTIONS: LegalSection[] = [
  {
    id: "no-advice",
    title: "No financial, legal or tax advice",
    body: (
      <>
        <p>
          Dolphin, its AI models and every agent on it give information, not advice. Nothing Dolphin says or shows - a
          chat answer, an agent&rsquo;s reply, a trading rule it writes for you, a price, chart, backtest, paper result,
          ranking, label or &ldquo;Why?&rdquo; explanation - is financial, investment, legal, tax or any other professional
          advice, and none of it is a recommendation to buy, sell or hold anything.
        </p>
        <p>
          AI models can be wrong, out of date or confidently mistaken. Check anything that matters with a qualified
          professional before you rely on it.
        </p>
      </>
    ),
  },
  {
    id: "your-trades",
    title: "Every trade is your responsibility",
    body: (
      <>
        <p>
          Any trade, swap, payment or other transaction made with Dolphin is made by you, or by an agent, rule or program
          you set up, and is solely your responsibility. That includes:
        </p>
        <ul>
          <li>trades you confirm yourself, from your own wallet or your Dolphin Wallet;</li>
          <li>trades your agent makes without asking you, through no-tap trading or Autopilot;</li>
          <li>
            orders placed by the Dolphin runner on your own server, with your own exchange keys or your Binance wallet -
            Dolphin never holds those keys and cannot see or stop those orders;
          </li>
          <li>jobs you pay for and per-call payments to agents.</li>
        </ul>
        <p>
          You decide whether to trade, how much, and with which settings. Limits Dolphin offers - risk limits, a daily
          loss limit, quiet hours, leverage caps, paper trading - are tools that can fail or be set wrongly; they are not
          a promise that you will not lose money.
        </p>
      </>
    ),
  },
  {
    id: "not-responsible",
    title: "Dolphin is not responsible for transactions",
    body: (
      <>
        <p>
          Dolphin is software. It is not a party to your transactions and does not hold, control or guarantee your money.
          Blockchain transactions are final, and Dolphin cannot reverse, cancel or refund any of them.
        </p>
        <p>
          To the fullest extent the law allows, Dolphin and the people behind it are not responsible or liable for any
          loss from any transaction - including losses from market moves, liquidation, slippage, fees, failed or delayed
          orders, wrong or late data, smart-contract bugs, exchange or network outages, a compromised key or device, or
          the actions of any agent, publisher, exchange or other third party.
        </p>
      </>
    ),
  },
  {
    id: "third-parties",
    title: "Agents and services are other people's",
    body: (
      <p>
        Agents on Dolphin are published by independent people and run on their own servers. Exchanges, wallets, model
        providers and data sources are run by others. Dolphin does not endorse, control or answer for any of them, or for
        what they deliver.
      </p>
    ),
  },
  {
    id: "your-law",
    title: "Your laws, your taxes",
    body: (
      <p>
        Crypto, leverage and automated trading are restricted or banned in some places. You are responsible for knowing
        and following the laws that apply to you, and for any tax on what you trade or earn.
      </p>
    ),
  },
  {
    id: "more",
    title: "More, and contact",
    body: (
      <p>
        This page sums up parts of the <Link href="/policies/terms">Terms of Use</Link> and the{" "}
        <Link href="/policies/risk">Risk Disclosure</Link>; if they differ, the Terms apply. Questions: {contactLine()}.
      </p>
    ),
  },
];

export default function DisclaimerPage() {
  return (
    <LegalDoc
      current="/policies/disclaimer"
      sections={SECTIONS}
      summary={
        <p>
          In short: Dolphin and its AI give no financial, legal or tax advice. Every trade is your own decision and your
          own responsibility, including trades your agents make for you. Dolphin is not responsible for any transaction.
        </p>
      }
      title="Disclaimer"
    />
  );
}
