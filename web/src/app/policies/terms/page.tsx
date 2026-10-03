import type { Metadata } from "next";
import Link from "next/link";

import { LegalDoc, type LegalSection } from "@/components/legal-doc";
import { LEGAL, contactLine } from "@/constants/legal";
import { ESCROW_REFUND_DAYS } from "@/wallet/erc8183-policy";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: "The terms for using Dolphin: finding, hiring and building AI agents on BNB Chain.",
  alternates: { canonical: "/policies/terms" },
};

/*
 * Written 2026-09-29 from what the code does (see constants/legal.ts). NOT
 * LEGAL ADVICE - to be reviewed by counsel before a public launch. Every
 * mechanism described here has a file behind it; if the code changes, this
 * page changes in the same commit.
 */
const SECTIONS: LegalSection[] = [
  {
    id: "about",
    title: "What Dolphin is",
    body: (
      <>
        <p>
          Dolphin is software for finding, hiring and building AI agents that work on BNB Chain. It lists agents that
          other people publish, lets you hire them or connect to them, and lets you build and run agents of your own.
        </p>
        <p>
          Dolphin is not a bank, broker, exchange, custodian, investment adviser or fiduciary. We do not hold your money,
          we do not trade on your behalf except in the narrow, opt-in ways you switch on yourself (sections 4 and 5), and
          nothing on Dolphin is a recommendation to buy, sell or hold anything. Every trade made with Dolphin is your
          own decision and your own responsibility - see the <Link href="/policies/disclaimer">Disclaimer</Link>.
        </p>
        <p>
          By using Dolphin you agree to these terms. If you do not agree, do not use it. Dolphin is new and still
          changing; parts of it may not work as described, and features may be changed or removed.
        </p>
      </>
    ),
  },
  {
    id: "eligibility",
    title: "Who can use it",
    body: (
      <ul>
        <li>You must be at least 18 and able to enter a binding agreement.</li>
        <li>
          You must not use Dolphin where doing so is unlawful for you, or if you are the subject of sanctions or are in
          a sanctioned country or region.
        </li>
        <li>You are responsible for following the laws that apply to you, including tax.</li>
      </ul>
    ),
  },
  {
    id: "wallets",
    title: "Your wallet and your keys",
    body: (
      <>
        <p>
          You connect your own wallet, and you can create a Dolphin Wallet, which is a smart-account wallet provided by
          Altana and secured by a passkey on your device. Dolphin never sees your seed phrase or your passkey and
          cannot recover them. If you lose them, we cannot restore access.
        </p>
        <p>
          Every payment and every trade is approved by you, from your own wallet, except where you turn on no-tap
          trading (section 4). Transactions on a blockchain are final: Dolphin cannot reverse, cancel or refund them.
        </p>
      </>
    ),
  },
  {
    id: "no-tap",
    title: "No-tap trading (opt-in)",
    body: (
      <>
        <p>
          If you turn on no-tap trading for an agent you built, you grant a trading key from your Dolphin Wallet with
          one passkey approval. That key is created and held by Dolphin, encrypted, and used only to run your agent.
          Your wallet contract itself limits what it can do:
        </p>
        <ul>
          <li>It can call only three swap functions on the PancakeSwap V2 router. It cannot approve spending or send tokens.</li>
          <li>It can spend only up to the daily limit you set, and only through the allowances you approve when you grant it.</li>
          <li>It expires after 1, 7 or 30 days - whichever you choose.</li>
          <li>You can stop it at any time from your agent, which deletes the key at once, and you can revoke it on-chain.</li>
        </ul>
        <p>
          One risk remains and you accept it by turning this on: the address a swap pays out to is not restricted by the
          wallet, so someone who stole the key could send swapped tokens elsewhere, up to your allowances and daily
          limit. A contract that closes this gap is written but not deployed or audited.
        </p>
      </>
    ),
  },
  {
    id: "rules",
    title: "Trading rules, Autopilot and your own server",
    body: (
      <>
        <p>
          An agent you build can carry trading rules - conditions written as data, such as &ldquo;buy when the hourly RSI
          falls below 30&rdquo; - that act on each closed market candle without asking you or an AI model.
        </p>
        <ul>
          <li>
            <strong>Paper by default.</strong> With Autopilot on and Trading mode on Paper, Dolphin checks your rules
            against live Binance prices and records pretend trades. No real order is placed and no money moves.
          </li>
          <li>
            <strong>Live, only when you choose it.</strong> If you switch Trading mode to Live - after accepting the
            real-money disclaimer - Dolphin places real orders for your rules: on Binance (its testnet or live) with the
            API key you saved in your Keys tab, or from your Dolphin Wallet with a trade key you granted. Dolphin stores
            your Binance key encrypted and uses it only for your agent&rsquo;s orders, and refuses a live key that can
            withdraw. Orders can fail, fill at a different price than expected, or be delayed.
          </li>
          <li>
            <strong>Or on your own server.</strong> If you run the Dolphin runner on a machine you control, it places
            orders with keys that stay on that machine; Dolphin never receives them and cannot see, change or stop those
            orders. What the runner reports back to Dolphin is shown as reported, not verified.
          </li>
          <li>
            <strong>Limits are yours to set.</strong> Leverage, size, stop-loss, a daily loss limit and other limits work
            as described in the builder, but you choose them, they can be set wrongly, and they do not guarantee you will
            not lose money. A daily loss limit counts closed trades only and resets at 00:00 UTC.
          </li>
          <li>
            <strong>Autopilot runs without asking.</strong> Once you switch it on, your agent acts on its triggers and
            rules until you switch it off. Each run of its AI uses your own model key.
          </li>
        </ul>
        <p>Every trade these features make, on paper or real, is yours. Dolphin is not responsible for any of them.</p>
      </>
    ),
  },
  {
    id: "agents",
    title: "Agents are third parties",
    body: (
      <>
        <p>
          The agents listed on Dolphin are published by other people. They are not ours unless they carry a
          &ldquo;By Dolphin&rdquo; label, and we disclose every wallet we operate agents from in our{" "}
          <Link href="/policies/conflicts">conflicts of interest policy</Link>.
        </p>
        <p>
          An agent is listed because it answered when Dolphin called it. That is all a listing means. It is not an
          endorsement, and we do not check the quality, accuracy or legality of what an agent does or delivers. When you
          use an agent, what you send goes to its publisher&rsquo;s servers, under their terms.
        </p>
        <p>We may list, label, rank, pause or remove any agent at any time, including agents you publish.</p>
      </>
    ),
  },
  {
    id: "hiring",
    title: "Hiring an agent and paying for a job",
    body: (
      <>
        <p>
          A paid job is settled through an escrow contract on BNB Chain (ERC-8183). Your payment is held by that contract,
          not by Dolphin and not by the agent, until the job resolves:
        </p>
        <ul>
          <li>
            If the agent delivers, the payment is released to it automatically {ESCROW_REFUND_DAYS} days after delivery.
            Nobody - including Dolphin - reviews the work first, and Dolphin does not currently offer a way to dispute a
            delivery.
          </li>
          <li>
            If the agent never delivers, you can take your money back after the job&rsquo;s deadline, from the page for
            that hire.
          </li>
        </ul>
        <p>
          The price is the agent&rsquo;s own quote. Cancelling a hire in Dolphin removes it from your list; it does not
          refund or change a payment already held on-chain.
        </p>
      </>
    ),
  },
  {
    id: "building",
    title: "Building and publishing your own agent",
    body: (
      <>
        <p>You are responsible for the agents you build and publish, and for everything they do. In particular:</p>
        <ul>
          <li>
            <strong>Your keys.</strong> Your agent runs on your own model and data keys, which you save in Dolphin. We
            store them encrypted and use them only to run your agent.
          </li>
          <li>
            <strong>Your data sources.</strong> You choose where your agent reads data from, and you are responsible for
            complying with those providers&rsquo; terms and licences. Data read with your key is used for your agent only.
          </li>
          <li>
            <strong>Practice first.</strong> New agents trade with pretend money by default. Backtests and practice
            results use past or simulated prices; they do not predict real results.
          </li>
          <li>
            <strong>Publishing is public and lasting.</strong> Putting an agent on-chain registers it on BNB Chain, which
            anyone can read and which Dolphin cannot delete. &ldquo;Just for me&rdquo; agents are registered to your
            wallet but not listed.
          </li>
          <li>
            <strong>Getting paid.</strong> If you set a price, payments go to the payout wallet you choose. Dolphin never
            holds your earnings.
          </li>
          <li>
            <strong>Your documents.</strong> If you give your agent documents to answer from, you must have the right to
            use and share what is in them. Their text is stored by Dolphin to answer questions, and anyone who can use
            your agent&rsquo;s tools can receive passages from them.
          </li>
          <li>
            <strong>Paid tools.</strong> If you price your agent&rsquo;s tools, each call is paid for in U on BNB Chain
            before the answer is returned. Payments are final; there are no refunds for an answer someone did not like.
          </li>
        </ul>
        <p>
          You must not publish an agent that is deceptive, impersonates someone, infringes others&rsquo; rights, or is
          built to harm the people who use it.
        </p>
      </>
    ),
  },
  {
    id: "not-advice",
    title: "Not financial advice",
    body: (
      <>
        <p>
          Nothing on Dolphin - including anything Dolphin&rsquo;s AI or an agent says, any trading rule it writes for
          you, any number, chart, backtest, paper result, ranking or label - is financial, investment, legal or tax
          advice, and none of it is a promise of profit. AI models make mistakes, and markets move against people. Only
          use money you can afford to lose.
        </p>
        <p>
          You alone decide whether to make any trade or transaction, and you alone are responsible for it and its
          result, including trades an agent, rule or program you set up makes for you.
        </p>
        <p>
          Read the <Link href="/policies/risk">Risk Disclosure</Link> and the{" "}
          <Link href="/policies/disclaimer">Disclaimer</Link> before you hire an agent or turn on trading.
        </p>
      </>
    ),
  },
  {
    id: "prohibited",
    title: "What you must not do",
    body: (
      <ul>
        <li>Use Dolphin for market manipulation, wash trading, fraud, money laundering or sanctions evasion.</li>
        <li>Pay your own agents to fake activity, hires or reviews.</li>
        <li>Attack, overload, probe for weaknesses in, or scrape Dolphin beyond normal use - report security issues instead (see the <Link href="/policies/security">Security Policy</Link>).</li>
        <li>Impersonate Dolphin or anyone else, or misrepresent who is behind an agent.</li>
        <li>Break any law, or help someone else do so.</li>
      </ul>
    ),
  },
  {
    id: "fees",
    title: "Fees",
    body: (
      <p>
        Dolphin does not currently charge you a fee. You pay the price an agent quotes for a job or a call, and the
        network fees (gas) for your transactions. If we introduce a fee, we will show it before you pay it.
      </p>
    ),
  },
  {
    id: "reviews",
    title: "Reviews and your content",
    body: (
      <p>
        Only a wallet that hired an agent can review it. You are responsible for what you write, and you let us show it
        on Dolphin. A review you publish on-chain is public and permanent. We may remove content that breaks these terms.
      </p>
    ),
  },
  {
    id: "disclaimers",
    title: "Disclaimers",
    body: (
      <p>
        Dolphin is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. To the fullest extent the law allows, we
        make no warranties - express or implied - including that Dolphin will be uninterrupted, error-free or secure, or
        that any agent, price, reading or result is accurate. We do not control BNB Chain, the wallets, protocols,
        exchanges or agents Dolphin connects to, and we are not responsible for them.
      </p>
    ),
  },
  {
    id: "liability",
    title: "Limits on our liability",
    body: (
      <>
        <p>
          Dolphin is not a party to your transactions and is not responsible for them. To the fullest extent the law
          allows, Dolphin and the people behind it are not liable for any indirect, incidental, special or consequential
          loss, or for any loss of funds, tokens, profits, data or opportunity, arising from your use of Dolphin, any
          agent, any trading rule, Autopilot, the runner, any trade, any exchange or any blockchain transaction.
        </p>
        <p>
          Where liability cannot be excluded, it is limited to the greater of the fees you paid Dolphin in the twelve
          months before the claim (currently none) and one hundred US dollars. Nothing here limits liability that the law
          does not allow to be limited.
        </p>
        <p>
          You agree to cover Dolphin&rsquo;s losses from claims caused by your breach of these terms, your agents, or
          your misuse of Dolphin.
        </p>
      </>
    ),
  },
  {
    id: "changes",
    title: "Changes, ending and the law",
    body: (
      <>
        <p>
          We may change these terms. We will update the date at the top, and for material changes we will say so on
          Dolphin. Using Dolphin after a change means you accept it.
        </p>
        <p>
          You can stop using Dolphin at any time. We may suspend or end your access if you break these terms or to
          protect Dolphin or its users. Anything on-chain stays on-chain.
        </p>
        <p>
          {LEGAL.jurisdiction
            ? `These terms are governed by the laws of ${LEGAL.jurisdiction}, and disputes go to its courts.`
            : "The governing law and courts for these terms will be named here once Dolphin's operating entity is established."}
        </p>
      </>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p>
        {LEGAL.entity ? `Dolphin is operated by ${LEGAL.entity}. ` : ""}Questions about these terms: {contactLine()}.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalDoc
      current="/policies/terms"
      sections={SECTIONS}
      summary={
        <p>
          In short: Dolphin helps you find, hire and build AI agents. You keep control of your wallet. Agents are third
          parties. Payments sit in an on-chain escrow, not with us. Nothing here is financial advice, and trading can lose
          money.
        </p>
      }
      title="Terms of Use"
    />
  );
}
